-- Sprint-3 M1: in-app notifications.
--
-- Polling-only bus. The unique key on
-- (recipient_id, type, subject_type, subject_id) gives producers
-- idempotent fan-out — calling notify() twice for the same event
-- never duplicates a row. The (recipient_id, read_at, created_at DESC)
-- index serves both the unread-count query and the recent-feed query
-- without a sort.

CREATE TABLE "notifications" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "recipient_id" uuid NOT NULL,
  "actor_id"     uuid,
  "type"         text NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id"   text NOT NULL,
  "body"         text NOT NULL DEFAULT '',
  "url"          text,
  "read_at"      timestamptz,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "notifications_recipient_fk"
    FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "notifications_actor_fk"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX "notifications_recipient_subject_unique"
  ON "notifications" ("recipient_id", "type", "subject_type", "subject_id");

CREATE INDEX "notifications_recipient_unread_idx"
  ON "notifications" ("recipient_id", "read_at", "created_at" DESC);

-- Re-create trigram GIN indexes on documents (Prisma drops these on
-- every migration because the schema cannot express them).
CREATE INDEX IF NOT EXISTS "documents_title_trgm_idx" ON "documents" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "documents_description_trgm_idx" ON "documents" USING gin ("description" gin_trgm_ops);
