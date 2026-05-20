-- Sprint 2, task #28: Postgres full-text search for documents.
--
-- Adds a denormalised `search_text` haystack on `documents` plus a
-- `search_vector tsvector` generated column over it, with a GIN index
-- for fast ranked lookups. The haystack is kept in sync by triggers on
-- the source tables — the application never writes it directly.
--
-- Haystack covers: title, description, course code/title/lecturer,
-- tag names (joined via document_tags), and the latest extracted text
-- from associated document_files. `search_vector` itself is a STORED
-- generated column so reads never re-tokenise.

ALTER TABLE "documents"
  ADD COLUMN "search_text" TEXT;

-- Generated tsvector column. Using `simple` config would skip stemming;
-- we use `english` to match `plainto_tsquery('english', q)` at read
-- time. STORED so reads don't tokenize.
ALTER TABLE "documents"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("search_text", ''))) STORED;

CREATE INDEX IF NOT EXISTS "documents_search_vector_gin_idx"
  ON "documents" USING gin ("search_vector");

-- ─── Helper: aggregate the haystack for one document ──────────────
-- Returns NULL only if the doc id doesn't exist (defensive); for
-- alive documents we always return at least the title/description.
CREATE OR REPLACE FUNCTION kb_compute_doc_search_text(p_doc_id uuid)
RETURNS text LANGUAGE sql STABLE AS $fn$
  SELECT
    coalesce(d.title, '') || ' ' ||
    coalesce(d.description, '') || ' ' ||
    coalesce(c.code, '') || ' ' ||
    coalesce(c.title, '') || ' ' ||
    coalesce(c.lecturer_name, '') || ' ' ||
    coalesce((
      SELECT string_agg(t.name, ' ')
      FROM document_tags dt
      JOIN tags t ON t.id = dt.tag_id
      WHERE dt.document_id = d.id
    ), '') || ' ' ||
    coalesce((
      SELECT string_agg(coalesce(df.extracted_text, ''), ' ')
      FROM document_files df
      WHERE df.document_id = d.id
    ), '')
  FROM documents d
  LEFT JOIN courses c ON c.id = d.course_id
  WHERE d.id = p_doc_id;
$fn$;

-- ─── Helper: refresh one document's search_text ───────────────────
-- Used by all the AFTER triggers below. The UPDATE re-fires the
-- BEFORE-UPDATE trigger on documents but it short-circuits to the
-- same value, so no recursion.
CREATE OR REPLACE FUNCTION kb_refresh_doc_search_text(p_doc_id uuid)
RETURNS void LANGUAGE sql AS $fn$
  UPDATE documents
  SET search_text = kb_compute_doc_search_text(p_doc_id)
  WHERE id = p_doc_id;
$fn$;

-- ─── Trigger: documents BEFORE INSERT/UPDATE ──────────────────────
-- Rebuilds search_text from the row + joined data without an extra
-- round-trip. On INSERT, document_tags/files don't exist yet — they
-- arrive via their own AFTER triggers below.
CREATE OR REPLACE FUNCTION kb_documents_search_text_biut()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.search_text :=
    coalesce(NEW.title, '') || ' ' ||
    coalesce(NEW.description, '') || ' ' ||
    coalesce((
      SELECT coalesce(c.code, '') || ' ' ||
             coalesce(c.title, '') || ' ' ||
             coalesce(c.lecturer_name, '')
      FROM courses c WHERE c.id = NEW.course_id
    ), '') || ' ' ||
    coalesce((
      SELECT string_agg(t.name, ' ')
      FROM document_tags dt
      JOIN tags t ON t.id = dt.tag_id
      WHERE dt.document_id = NEW.id
    ), '') || ' ' ||
    coalesce((
      SELECT string_agg(coalesce(df.extracted_text, ''), ' ')
      FROM document_files df
      WHERE df.document_id = NEW.id
    ), '');
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER documents_search_text_biut
  BEFORE INSERT OR UPDATE OF title, description, course_id ON documents
  FOR EACH ROW EXECUTE FUNCTION kb_documents_search_text_biut();

-- ─── Trigger: document_files ──────────────────────────────────────
CREATE OR REPLACE FUNCTION kb_document_files_search_text_aiud()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM kb_refresh_doc_search_text(OLD.document_id);
    RETURN OLD;
  ELSE
    PERFORM kb_refresh_doc_search_text(NEW.document_id);
    RETURN NEW;
  END IF;
END;
$fn$;

CREATE TRIGGER document_files_search_text_aiu
  AFTER INSERT OR UPDATE OF extracted_text ON document_files
  FOR EACH ROW EXECUTE FUNCTION kb_document_files_search_text_aiud();

CREATE TRIGGER document_files_search_text_ad
  AFTER DELETE ON document_files
  FOR EACH ROW EXECUTE FUNCTION kb_document_files_search_text_aiud();

-- ─── Trigger: document_tags ───────────────────────────────────────
CREATE OR REPLACE FUNCTION kb_document_tags_search_text_aid()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM kb_refresh_doc_search_text(OLD.document_id);
    RETURN OLD;
  ELSE
    PERFORM kb_refresh_doc_search_text(NEW.document_id);
    RETURN NEW;
  END IF;
END;
$fn$;

CREATE TRIGGER document_tags_search_text_ai
  AFTER INSERT ON document_tags
  FOR EACH ROW EXECUTE FUNCTION kb_document_tags_search_text_aid();

CREATE TRIGGER document_tags_search_text_ad
  AFTER DELETE ON document_tags
  FOR EACH ROW EXECUTE FUNCTION kb_document_tags_search_text_aid();

-- ─── Trigger: tags (name changes propagate to every linked doc) ───
CREATE OR REPLACE FUNCTION kb_tags_search_text_au()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE documents d
  SET search_text = kb_compute_doc_search_text(d.id)
  WHERE EXISTS (
    SELECT 1 FROM document_tags dt
    WHERE dt.document_id = d.id AND dt.tag_id = NEW.id
  );
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER tags_search_text_au
  AFTER UPDATE OF name ON tags
  FOR EACH ROW EXECUTE FUNCTION kb_tags_search_text_au();

-- ─── Trigger: courses (code/title/lecturer changes) ───────────────
CREATE OR REPLACE FUNCTION kb_courses_search_text_au()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE documents d
  SET search_text = kb_compute_doc_search_text(d.id)
  WHERE d.course_id = NEW.id;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER courses_search_text_au
  AFTER UPDATE OF code, title, lecturer_name ON courses
  FOR EACH ROW EXECUTE FUNCTION kb_courses_search_text_au();

-- ─── Initial backfill ─────────────────────────────────────────────
UPDATE documents SET search_text = kb_compute_doc_search_text(id);

-- Re-create trigram GIN indexes on documents (Prisma drops them on
-- every generated migration; we keep the safety-net here per the
-- pattern in prior Sprint-2 migrations).
CREATE INDEX IF NOT EXISTS "documents_title_trgm_idx"
  ON "documents" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "documents_description_trgm_idx"
  ON "documents" USING gin ("description" gin_trgm_ops);
