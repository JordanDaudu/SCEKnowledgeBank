-- Sprint-3 M2: review & approval workflow on documents.
--
-- Adds reviewer columns and an index that covers the queue path
-- (status='pending_review' filtered by course, oldest-first).
-- Existing rows keep status='published' and NULL reviewer columns,
-- which is exactly what we want — the workflow is opt-in.

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "reviewed_by" UUID,
  ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "review_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "submitted_for_review_at" TIMESTAMPTZ;

ALTER TABLE "documents"
  DROP CONSTRAINT IF EXISTS "documents_reviewed_by_fkey";
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_reviewed_by_fkey"
  FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "documents_status_course_submitted_idx"
  ON "documents" ("status", "course_id", "submitted_for_review_at");

-- Re-create trigram GIN indexes on documents (Prisma drops these on
-- every migration because the schema cannot express them).
CREATE INDEX IF NOT EXISTS "documents_title_trgm_idx" ON "documents" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "documents_description_trgm_idx" ON "documents" USING gin ("description" gin_trgm_ops);
