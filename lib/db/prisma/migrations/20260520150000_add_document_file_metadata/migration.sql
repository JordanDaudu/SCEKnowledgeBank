-- Sprint 2, task #27: server-side metadata extraction.
--
-- Each upload now optionally produces extracted text, page count,
-- detected title / author (PDF), image dimensions, and a server-
-- generated thumbnail stored under its own storage key. All columns
-- are nullable: extraction can fail per-file without failing the
-- upload, and pre-existing rows have nothing to extract.
--
-- As with the earlier Sprint-2 migrations, Prisma drops the pg_trgm
-- GIN indexes on documents because the schema cannot express them;
-- we re-create them at the end.

ALTER TABLE "document_files"
  ADD COLUMN "extracted_text"      TEXT,
  ADD COLUMN "page_count"          INTEGER,
  ADD COLUMN "detected_title"      TEXT,
  ADD COLUMN "author"              TEXT,
  ADD COLUMN "image_width"         INTEGER,
  ADD COLUMN "image_height"        INTEGER,
  ADD COLUMN "thumbnail_path"      TEXT,
  ADD COLUMN "thumbnail_mime_type" TEXT;

-- Re-create trigram GIN indexes on documents (see note at top of file).
CREATE INDEX IF NOT EXISTS "documents_title_trgm_idx" ON "documents" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "documents_description_trgm_idx" ON "documents" USING gin ("description" gin_trgm_ops);
