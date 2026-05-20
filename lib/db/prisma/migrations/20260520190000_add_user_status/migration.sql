-- Task: add account-lifecycle status and optional profile fields to users.
--
-- `status` mirrors the new auth contract: ACTIVE / PENDING_APPROVAL /
-- DISABLED. Existing rows backfill to ACTIVE so seeded demo accounts
-- keep working. `student_id`, `lecturer_id`, `department` are
-- optional registration metadata.

ALTER TABLE "users"
  ADD COLUMN "status" text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "student_id" text,
  ADD COLUMN "lecturer_id" text,
  ADD COLUMN "department" text;

ALTER TABLE "users"
  ADD CONSTRAINT "users_status_check"
  CHECK ("status" IN ('ACTIVE', 'PENDING_APPROVAL', 'DISABLED'));

CREATE INDEX "users_status_idx" ON "users" ("status");

-- Re-create trigram GIN indexes on documents (Prisma drops these on
-- every migration because the schema cannot express them).
CREATE INDEX IF NOT EXISTS "documents_title_trgm_idx" ON "documents" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "documents_description_trgm_idx" ON "documents" USING gin ("description" gin_trgm_ops);
