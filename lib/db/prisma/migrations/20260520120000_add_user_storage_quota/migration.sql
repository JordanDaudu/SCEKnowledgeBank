-- Per-user storage quota: track running bytes used and an optional
-- per-user override of the server default quota. Both columns are
-- BIGINT so we can safely sum multi-GB uploads.
--
-- Same note as the previous migration: `prisma migrate dev` emits
-- DROP INDEX for the pg_trgm GIN indexes on `documents` because the
-- Prisma schema cannot express them. We re-create them at the end so
-- search suggestions continue to work after this migration applies.

ALTER TABLE "users"
  ADD COLUMN "used_bytes"  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "quota_bytes" BIGINT;

-- Re-create trigram GIN indexes on documents (see note at top of file).
CREATE INDEX IF NOT EXISTS "documents_title_trgm_idx" ON "documents" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "documents_description_trgm_idx" ON "documents" USING gin ("description" gin_trgm_ops);
