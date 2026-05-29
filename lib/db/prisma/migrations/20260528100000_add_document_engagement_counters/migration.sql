-- Refinement Phase 2: denormalised engagement counters for ranking.
--
-- Ranking/discovery needs view/download/favorite counts per document
-- without a per-request GROUP BY over the (unbounded) event tables.
-- We add three counter columns maintained incrementally by the
-- application (recordView, favorite add/remove, download audit) and
-- backfill them from the source-of-truth event tables here.

ALTER TABLE "documents"
  ADD COLUMN "view_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "download_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "favorite_count" INTEGER NOT NULL DEFAULT 0;

-- Backfill views from material_view_history.
UPDATE "documents" d
SET "view_count" = sub.c
FROM (
  SELECT document_id, count(*)::int AS c
  FROM material_view_history
  GROUP BY document_id
) sub
WHERE sub.document_id = d.id;

-- Backfill favorites from document_favorites.
UPDATE "documents" d
SET "favorite_count" = sub.c
FROM (
  SELECT document_id, count(*)::int AS c
  FROM document_favorites
  GROUP BY document_id
) sub
WHERE sub.document_id = d.id;

-- Backfill downloads from audit_logs (entity_id is TEXT; documents.id is uuid).
UPDATE "documents" d
SET "download_count" = sub.c
FROM (
  SELECT entity_id, count(*)::int AS c
  FROM audit_logs
  WHERE action = 'document.download' AND entity_type = 'document'
  GROUP BY entity_id
) sub
WHERE sub.entity_id = d.id::text;

CREATE INDEX IF NOT EXISTS "documents_view_count_idx" ON "documents" ("view_count");
CREATE INDEX IF NOT EXISTS "documents_download_count_idx" ON "documents" ("download_count");
CREATE INDEX IF NOT EXISTS "documents_favorite_count_idx" ON "documents" ("favorite_count");

-- Re-create trigram GIN indexes (Prisma drops them on generated
-- migrations; keep the safety-net per the established pattern).
CREATE INDEX IF NOT EXISTS "documents_title_trgm_idx"
  ON "documents" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "documents_description_trgm_idx"
  ON "documents" USING gin ("description" gin_trgm_ops);
