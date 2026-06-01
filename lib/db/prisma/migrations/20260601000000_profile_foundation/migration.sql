-- Profile foundation: username + avatar columns.
ALTER TABLE "users" ADD COLUMN "username" TEXT;
ALTER TABLE "users" ADD COLUMN "avatar_storage_path" TEXT;
ALTER TABLE "users" ADD COLUMN "avatar_mime_type" TEXT;

-- Backfill username from the email local-part, canonicalized to [a-z0-9_], capped at 30.
UPDATE "users"
SET "username" = left(
  regexp_replace(lower(split_part("email", '@', 1)), '[^a-z0-9_]', '_', 'g'),
  30
)
WHERE "deleted_at" IS NULL AND "username" IS NULL;

-- Enforce the 3-char minimum by right-padding short values.
UPDATE "users"
SET "username" = rpad("username", 3, '_')
WHERE "deleted_at" IS NULL AND char_length("username") < 3;

-- Deterministically de-duplicate collisions with a numeric suffix.
WITH ranked AS (
  SELECT "id", "username",
         row_number() OVER (PARTITION BY "username" ORDER BY "created_at", "id") AS rn
  FROM "users"
  WHERE "deleted_at" IS NULL
)
UPDATE "users" u
SET "username" = left(ranked."username", 27) || '_' || ranked.rn
FROM ranked
WHERE u."id" = ranked."id" AND ranked.rn > 1;

-- Case-insensitive-by-storage uniqueness, soft-delete aware (mirrors the email index).
CREATE UNIQUE INDEX "users_username_unique" ON "users" ("username") WHERE "deleted_at" IS NULL;
