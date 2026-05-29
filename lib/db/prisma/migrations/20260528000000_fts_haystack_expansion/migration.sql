-- Refinement Phase 1: expand the FTS haystack.
--
-- The Sprint-2 haystack (migration 20260520160000) covered title,
-- description, course code/title/lecturer, tag names, and per-file
-- extracted_text. The search-foundation phase additionally requires
-- searching by filename, category, uploader name, and the smart
-- metadata captured on each file (detected_title, author, keywords).
--
-- We redefine the two builder functions to include those fields, widen
-- the trigger column lists so the relevant writes refresh the haystack,
-- and backfill every existing document. `search_vector` is a STORED
-- generated column, so it re-derives automatically on the backfill UPDATE.

-- ─── Helper: aggregate the haystack for one document ──────────────
CREATE OR REPLACE FUNCTION kb_compute_doc_search_text(p_doc_id uuid)
RETURNS text LANGUAGE sql STABLE AS $fn$
  SELECT
    coalesce(d.title, '') || ' ' ||
    coalesce(d.description, '') || ' ' ||
    coalesce(c.code, '') || ' ' ||
    coalesce(c.title, '') || ' ' ||
    coalesce(c.lecturer_name, '') || ' ' ||
    coalesce(cat.name, '') || ' ' ||
    coalesce(u.display_name, '') || ' ' ||
    coalesce((
      SELECT string_agg(t.name, ' ')
      FROM document_tags dt
      JOIN tags t ON t.id = dt.tag_id
      WHERE dt.document_id = d.id
    ), '') || ' ' ||
    coalesce((
      SELECT string_agg(
        coalesce(df.extracted_text, '') || ' ' ||
        coalesce(df.original_filename, '') || ' ' ||
        coalesce(df.display_filename, '') || ' ' ||
        coalesce(df.detected_title, '') || ' ' ||
        coalesce(df.author, '') || ' ' ||
        coalesce(array_to_string(df.keywords, ' '), ''), ' ')
      FROM document_files df
      WHERE df.document_id = d.id
    ), '')
  FROM documents d
  LEFT JOIN courses c ON c.id = d.course_id
  LEFT JOIN categories cat ON cat.id = d.category_id
  LEFT JOIN users u ON u.id = d.uploader_id
  WHERE d.id = p_doc_id;
$fn$;

-- ─── Trigger fn: documents BEFORE INSERT/UPDATE ───────────────────
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
      SELECT cat.name FROM categories cat WHERE cat.id = NEW.category_id
    ), '') || ' ' ||
    coalesce((
      SELECT u.display_name FROM users u WHERE u.id = NEW.uploader_id
    ), '') || ' ' ||
    coalesce((
      SELECT string_agg(t.name, ' ')
      FROM document_tags dt
      JOIN tags t ON t.id = dt.tag_id
      WHERE dt.document_id = NEW.id
    ), '') || ' ' ||
    coalesce((
      SELECT string_agg(
        coalesce(df.extracted_text, '') || ' ' ||
        coalesce(df.original_filename, '') || ' ' ||
        coalesce(df.display_filename, '') || ' ' ||
        coalesce(df.detected_title, '') || ' ' ||
        coalesce(df.author, '') || ' ' ||
        coalesce(array_to_string(df.keywords, ' '), ''), ' ')
      FROM document_files df
      WHERE df.document_id = NEW.id
    ), '');
  RETURN NEW;
END;
$fn$;

-- Widen the documents trigger to also refresh on category/uploader change.
DROP TRIGGER IF EXISTS documents_search_text_biut ON documents;
CREATE TRIGGER documents_search_text_biut
  BEFORE INSERT OR UPDATE OF title, description, course_id, category_id, uploader_id
  ON documents
  FOR EACH ROW EXECUTE FUNCTION kb_documents_search_text_biut();

-- Widen the document_files trigger to refresh on the new metadata columns.
DROP TRIGGER IF EXISTS document_files_search_text_aiu ON document_files;
CREATE TRIGGER document_files_search_text_aiu
  AFTER INSERT OR UPDATE OF
    extracted_text, original_filename, display_filename,
    detected_title, author, keywords
  ON document_files
  FOR EACH ROW EXECUTE FUNCTION kb_document_files_search_text_aiud();

-- Propagate category renames into every document in that category.
CREATE OR REPLACE FUNCTION kb_categories_search_text_au()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE documents d
  SET search_text = kb_compute_doc_search_text(d.id)
  WHERE d.category_id = NEW.id;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS categories_search_text_au ON categories;
CREATE TRIGGER categories_search_text_au
  AFTER UPDATE OF name ON categories
  FOR EACH ROW EXECUTE FUNCTION kb_categories_search_text_au();

-- ─── Backfill every existing document ─────────────────────────────
UPDATE documents SET search_text = kb_compute_doc_search_text(id);

-- Re-create trigram GIN indexes (Prisma drops them on generated
-- migrations; keep the safety-net per the established pattern).
CREATE INDEX IF NOT EXISTS "documents_title_trgm_idx"
  ON "documents" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "documents_description_trgm_idx"
  ON "documents" USING gin ("description" gin_trgm_ops);
