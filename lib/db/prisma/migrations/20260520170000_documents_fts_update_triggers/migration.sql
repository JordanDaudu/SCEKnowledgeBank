-- Sprint 2, task #28 follow-up: close trigger fan-out gaps for the
-- document FTS haystack.
--
-- The initial migration covered INSERT/DELETE on document_tags and
-- INSERT/DELETE + UPDATE OF extracted_text on document_files, but
-- omitted UPDATE on either join table. If a document_tags row is
-- re-pointed (document_id or tag_id changes), or a document_files row
-- is moved between documents, both the OLD and NEW owning documents'
-- haystacks need refreshing. These additive triggers close that gap.

-- ─── document_tags: handle UPDATE that moves a tag link ──────────
CREATE OR REPLACE FUNCTION kb_documents_fts_on_tag_link_update()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.document_id IS DISTINCT FROM NEW.document_id THEN
    PERFORM kb_refresh_doc_search_text(OLD.document_id);
    PERFORM kb_refresh_doc_search_text(NEW.document_id);
  ELSIF OLD.tag_id IS DISTINCT FROM NEW.tag_id THEN
    -- Same doc, different tag — still needs a refresh.
    PERFORM kb_refresh_doc_search_text(NEW.document_id);
  END IF;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS kb_documents_fts_tag_link_update_trg ON document_tags;
CREATE TRIGGER kb_documents_fts_tag_link_update_trg
AFTER UPDATE ON document_tags
FOR EACH ROW EXECUTE FUNCTION kb_documents_fts_on_tag_link_update();

-- ─── document_files: handle UPDATE that moves a file between docs ─
-- Existing AFTER UPDATE OF extracted_text trigger continues to handle
-- the common case where only the extracted body changes. This handler
-- additionally refreshes both sides if `document_id` itself shifts.
CREATE OR REPLACE FUNCTION kb_documents_fts_on_file_owner_update()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.document_id IS DISTINCT FROM NEW.document_id THEN
    PERFORM kb_refresh_doc_search_text(OLD.document_id);
    PERFORM kb_refresh_doc_search_text(NEW.document_id);
  END IF;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS kb_documents_fts_file_owner_update_trg ON document_files;
CREATE TRIGGER kb_documents_fts_file_owner_update_trg
AFTER UPDATE OF document_id ON document_files
FOR EACH ROW EXECUTE FUNCTION kb_documents_fts_on_file_owner_update();
