-- Collection Moderation (Phase 4): reversible hidden flag on study_collections.
ALTER TABLE "study_collections" ADD COLUMN "hidden_at" TIMESTAMPTZ;
ALTER TABLE "study_collections" ADD COLUMN "hidden_by" UUID;
ALTER TABLE "study_collections" ADD COLUMN "hidden_reason" TEXT;
CREATE INDEX IF NOT EXISTS "study_collections_hidden_at_idx"
  ON "study_collections" ("hidden_at");
