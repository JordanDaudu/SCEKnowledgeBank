-- Sprint 2, task #29: persisted @mentions on comments.
--
-- Adds a join table linking a Comment to the User it mentions. Unique
-- on (comment_id, mentioned_user_id) so re-saving the same comment
-- never duplicates a row. Both FKs cascade — if the comment or user
-- is removed, the mention row disappears with it.

CREATE TABLE "comment_mentions" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "comment_id"        uuid NOT NULL,
  "mentioned_user_id" uuid NOT NULL,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "comment_mentions_comment_fk"
    FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE,
  CONSTRAINT "comment_mentions_user_fk"
    FOREIGN KEY ("mentioned_user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "comment_mentions_comment_user_unique"
  ON "comment_mentions" ("comment_id", "mentioned_user_id");
CREATE INDEX "comment_mentions_user_idx"
  ON "comment_mentions" ("mentioned_user_id");

-- Re-create trigram GIN indexes on documents (Prisma drops these on
-- every migration because the schema cannot express them).
CREATE INDEX IF NOT EXISTS "documents_title_trgm_idx" ON "documents" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "documents_description_trgm_idx" ON "documents" USING gin ("description" gin_trgm_ops);
