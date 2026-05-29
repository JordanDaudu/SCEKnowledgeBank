-- Sprint-3 M1 follow-up: add the dedicated feed index.
--
-- The original (recipient_id, read_at, created_at DESC) index is
-- shaped for the unread-count and unread-only-feed paths. The default
-- list endpoint (`/api/notifications` with no `unreadOnly` filter)
-- runs `WHERE recipient_id = ? ORDER BY created_at DESC LIMIT N` and
-- cannot use that index for the ordering because `read_at` sits
-- between the equality and the sort column. This index handles that
-- path with a clean range scan.

CREATE INDEX "notifications_recipient_feed_idx"
  ON "notifications" ("recipient_id", "created_at" DESC);

-- Re-create trigram GIN indexes on documents (Prisma drops these on
-- every migration because the schema cannot express them).
CREATE INDEX IF NOT EXISTS "documents_title_trgm_idx" ON "documents" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "documents_description_trgm_idx" ON "documents" USING gin ("description" gin_trgm_ops);
