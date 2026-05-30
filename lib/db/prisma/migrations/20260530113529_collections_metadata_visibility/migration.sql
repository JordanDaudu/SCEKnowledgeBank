-- Phase 1 Collections / Prep Hub split — metadata columns + tags join.
--
-- Adds four optional metadata columns to study_collections (subject
-- category FK, free-text exam name, semester, academic year), creates
-- the study_collection_tags join table, and renames the `shared`
-- visibility value to `public`.

-- AlterTable: new metadata columns on study_collections
ALTER TABLE "study_collections"
  ADD COLUMN "category_id"   UUID,
  ADD COLUMN "exam_name"     TEXT,
  ADD COLUMN "semester"      TEXT,
  ADD COLUMN "academic_year" INTEGER;

-- CreateTable: study_collection_tags join
CREATE TABLE "study_collection_tags" (
  "id"            UUID        NOT NULL DEFAULT gen_random_uuid(),
  "collection_id" UUID        NOT NULL,
  "tag_id"        UUID        NOT NULL,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "study_collection_tags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: tag lookup
CREATE INDEX "study_collection_tags_tag_idx"
  ON "study_collection_tags" ("tag_id");

-- CreateIndex: unique (collection, tag) pair
CREATE UNIQUE INDEX "study_collection_tags_unique"
  ON "study_collection_tags" ("collection_id", "tag_id");

-- CreateIndex: category lookup on study_collections
CREATE INDEX "study_collections_category_idx"
  ON "study_collections" ("category_id");

-- AddForeignKey: study_collections → categories
ALTER TABLE "study_collections"
  ADD CONSTRAINT "study_collections_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: study_collection_tags → study_collections
ALTER TABLE "study_collection_tags"
  ADD CONSTRAINT "study_collection_tags_collection_id_fkey"
  FOREIGN KEY ("collection_id") REFERENCES "study_collections"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: study_collection_tags → tags
ALTER TABLE "study_collection_tags"
  ADD CONSTRAINT "study_collection_tags_tag_id_fkey"
  FOREIGN KEY ("tag_id") REFERENCES "tags"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Phase 1: rename the `shared` visibility value to `public`. A public
-- collection's materials are already platform-approved, so publishing needs
-- no approval step. `isOfficial` collections remain discoverable regardless.
UPDATE "study_collections" SET "visibility" = 'public' WHERE "visibility" = 'shared';
