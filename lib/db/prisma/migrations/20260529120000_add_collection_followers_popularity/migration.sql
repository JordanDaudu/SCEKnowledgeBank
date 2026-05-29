-- Exam Prep Hub (US-55 popularity ranking, US-56 follow bundles).
--
-- Adds a denormalised popularity_score to study_collections (recomputed
-- from followers + items by the service) and a study_collection_followers
-- join table for following shared/official collections.

ALTER TABLE "study_collections"
  ADD COLUMN "popularity_score" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "study_collections_visibility_popularity_idx"
  ON "study_collections" ("visibility", "popularity_score" DESC);

CREATE TABLE "study_collection_followers" (
  "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
  "collection_id" UUID NOT NULL,
  "user_id"       UUID NOT NULL,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "study_collection_followers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "study_collection_followers_collection_fkey"
    FOREIGN KEY ("collection_id") REFERENCES "study_collections"("id") ON DELETE CASCADE,
  CONSTRAINT "study_collection_followers_user_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "study_collection_followers_unique"
  ON "study_collection_followers" ("collection_id", "user_id");
CREATE INDEX "study_collection_followers_user_idx"
  ON "study_collection_followers" ("user_id");
