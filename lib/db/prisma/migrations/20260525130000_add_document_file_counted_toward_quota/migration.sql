-- US-10 fix: restore-version reuses an existing storage_path and is
-- intentionally NOT billed against the uploader's quota. Without this
-- flag, the delete-document path would sum every DocumentFile.size_bytes
-- (including never-billed restore rows) and over-release quota, letting
-- a user zero out their used_bytes via a restore+delete cycle even
-- when other documents still occupy real storage.
--
-- Backfill `true` for historical rows — every pre-existing file was
-- billed normally on its original upload.
ALTER TABLE "document_files"
  ADD COLUMN "counted_toward_quota" BOOLEAN NOT NULL DEFAULT true;
