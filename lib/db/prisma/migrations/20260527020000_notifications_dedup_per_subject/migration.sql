-- Sprint-3 M1 follow-up: dedup contract is per-(recipient, subject),
-- not per-(recipient, type, subject). One comment cannot produce more
-- than one notification row for the same recipient even when they
-- qualify for multiple types (e.g. mentioned in a reply to their own
-- comment). The producer enforces type precedence — reply wins over
-- mention — and the unique index here makes the rule durable.

DROP INDEX IF EXISTS "notifications_recipient_subject_unique";

CREATE UNIQUE INDEX "notifications_recipient_subject_unique"
  ON "notifications" ("recipient_id", "subject_type", "subject_id");

-- Re-create trigram GIN indexes on documents (Prisma drops these on
-- every migration because the schema cannot express them).
CREATE INDEX IF NOT EXISTS "documents_title_trgm_idx" ON "documents" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "documents_description_trgm_idx" ON "documents" USING gin ("description" gin_trgm_ops);
