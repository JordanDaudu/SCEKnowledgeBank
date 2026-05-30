-- Collection Engagement Phase 2 (A2).
--
-- Adds five denormalised counter columns to study_collections and four
-- engagement join tables: likes, ratings (1-5), views, and comments.
-- All counters default to 0 and are updated by service-layer mutations.

-- AlterTable: denormalised counter columns on study_collections
ALTER TABLE "study_collections"
  ADD COLUMN "like_count"    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rating_count"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rating_sum"    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "view_count"    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "comment_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable: study_collection_likes
CREATE TABLE "study_collection_likes" (
  "id"            UUID        NOT NULL DEFAULT gen_random_uuid(),
  "collection_id" UUID        NOT NULL,
  "user_id"       UUID        NOT NULL,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "study_collection_likes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "study_collection_likes_unique"
  ON "study_collection_likes" ("collection_id", "user_id");
CREATE INDEX "study_collection_likes_user_idx"
  ON "study_collection_likes" ("user_id");

ALTER TABLE "study_collection_likes"
  ADD CONSTRAINT "study_collection_likes_collection_id_fkey"
  FOREIGN KEY ("collection_id") REFERENCES "study_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "study_collection_likes"
  ADD CONSTRAINT "study_collection_likes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: study_collection_ratings
CREATE TABLE "study_collection_ratings" (
  "id"            UUID        NOT NULL DEFAULT gen_random_uuid(),
  "collection_id" UUID        NOT NULL,
  "user_id"       UUID        NOT NULL,
  "value"         INTEGER     NOT NULL,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "study_collection_ratings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "study_collection_ratings_unique"
  ON "study_collection_ratings" ("collection_id", "user_id");
CREATE INDEX "study_collection_ratings_user_idx"
  ON "study_collection_ratings" ("user_id");

ALTER TABLE "study_collection_ratings"
  ADD CONSTRAINT "study_collection_ratings_collection_id_fkey"
  FOREIGN KEY ("collection_id") REFERENCES "study_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "study_collection_ratings"
  ADD CONSTRAINT "study_collection_ratings_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: study_collection_views
CREATE TABLE "study_collection_views" (
  "id"            UUID        NOT NULL DEFAULT gen_random_uuid(),
  "collection_id" UUID        NOT NULL,
  "user_id"       UUID        NOT NULL,
  "viewed_at"     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "study_collection_views_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "study_collection_views_collection_idx"
  ON "study_collection_views" ("collection_id");
CREATE INDEX "study_collection_views_user_viewed_idx"
  ON "study_collection_views" ("user_id", "viewed_at");

ALTER TABLE "study_collection_views"
  ADD CONSTRAINT "study_collection_views_collection_id_fkey"
  FOREIGN KEY ("collection_id") REFERENCES "study_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "study_collection_views"
  ADD CONSTRAINT "study_collection_views_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: study_collection_comments
CREATE TABLE "study_collection_comments" (
  "id"            UUID        NOT NULL DEFAULT gen_random_uuid(),
  "collection_id" UUID        NOT NULL,
  "author_id"     UUID        NOT NULL,
  "body"          TEXT        NOT NULL,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"    TIMESTAMPTZ,
  CONSTRAINT "study_collection_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "study_collection_comments_collection_created_idx"
  ON "study_collection_comments" ("collection_id", "created_at");
CREATE INDEX "study_collection_comments_author_idx"
  ON "study_collection_comments" ("author_id");

ALTER TABLE "study_collection_comments"
  ADD CONSTRAINT "study_collection_comments_collection_id_fkey"
  FOREIGN KEY ("collection_id") REFERENCES "study_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "study_collection_comments"
  ADD CONSTRAINT "study_collection_comments_author_id_fkey"
  FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
