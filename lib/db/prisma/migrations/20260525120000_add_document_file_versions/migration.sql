-- US-5: linear versioning columns on document_files.
--
-- Each DocumentFile row is a version. `version_number` is monotonic per
-- document (1, 2, 3…). Backfill: every existing row becomes version 1 of
-- its document; `uploaded_by_id` is backfilled from the parent
-- document's `uploader_id` so old rows still carry attribution.

ALTER TABLE "document_files"
  ADD COLUMN "version_number" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "change_note" TEXT,
  ADD COLUMN "uploaded_by_id" UUID;

-- Backfill uploader from parent document.
UPDATE "document_files" df
SET "uploaded_by_id" = d."uploader_id"
FROM "documents" d
WHERE df."document_id" = d."id"
  AND df."uploaded_by_id" IS NULL;

-- For documents that already had multiple files (rare, from earlier
-- exploratory uploads), assign version_number by uploaded_at ASC so the
-- oldest = v1, newest = max(version).
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY document_id
           ORDER BY uploaded_at ASC, id ASC
         ) AS rn
  FROM "document_files"
)
UPDATE "document_files" df
SET "version_number" = r.rn
FROM ranked r
WHERE df.id = r.id;

-- Keep documents.current_version in sync with the actual max version.
UPDATE "documents" d
SET "current_version" = sub.max_v
FROM (
  SELECT document_id, MAX(version_number) AS max_v
  FROM "document_files"
  GROUP BY document_id
) sub
WHERE d.id = sub.document_id
  AND d.current_version <> sub.max_v;

ALTER TABLE "document_files"
  ADD CONSTRAINT "document_files_uploaded_by_id_fkey"
  FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "document_files_document_version_idx"
  ON "document_files" ("document_id", "version_number" DESC);
