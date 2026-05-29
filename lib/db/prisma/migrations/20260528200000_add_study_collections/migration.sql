-- Refinement Phase 6: Prep Hub — study collections, items, and progress.
--
-- Collections group EXISTING documents (by FK; no content duplication).
-- Learning paths reuse study_collections via kind='learning_path' +
-- is_official. study_progress is per-user reviewed/completed state.

CREATE TABLE "study_collections" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "owner_id"    UUID NOT NULL,
  "title"       TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "kind"        TEXT NOT NULL DEFAULT 'collection',
  "is_official" BOOLEAN NOT NULL DEFAULT false,
  "course_id"   UUID,
  "visibility"  TEXT NOT NULL DEFAULT 'private',
  "exam_date"   TIMESTAMPTZ,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"  TIMESTAMPTZ,
  CONSTRAINT "study_collections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "study_collections_owner_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "study_collections_course_fkey"
    FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE SET NULL
);
CREATE INDEX "study_collections_owner_idx" ON "study_collections" ("owner_id");
CREATE INDEX "study_collections_official_course_idx"
  ON "study_collections" ("is_official", "course_id");

CREATE TABLE "study_collection_items" (
  "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
  "collection_id" UUID NOT NULL,
  "document_id"   UUID NOT NULL,
  "position"      INTEGER NOT NULL DEFAULT 0,
  "note"          TEXT,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "study_collection_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "study_collection_items_collection_fkey"
    FOREIGN KEY ("collection_id") REFERENCES "study_collections"("id") ON DELETE CASCADE,
  CONSTRAINT "study_collection_items_document_fkey"
    FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "study_collection_items_unique"
  ON "study_collection_items" ("collection_id", "document_id");
CREATE INDEX "study_collection_items_position_idx"
  ON "study_collection_items" ("collection_id", "position");

CREATE TABLE "study_progress" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id"     UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'reviewing',
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "study_progress_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "study_progress_user_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "study_progress_document_fkey"
    FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "study_progress_unique"
  ON "study_progress" ("user_id", "document_id");
CREATE INDEX "study_progress_user_idx" ON "study_progress" ("user_id");

-- Re-create trigram GIN indexes (Prisma drops them on generated
-- migrations; keep the safety-net per the established pattern).
CREATE INDEX IF NOT EXISTS "documents_title_trgm_idx"
  ON "documents" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "documents_description_trgm_idx"
  ON "documents" USING gin ("description" gin_trgm_ops);
