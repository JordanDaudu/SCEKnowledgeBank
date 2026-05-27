-- Sprint-3 completion: restore the per-(recipient, type, subject)
-- dedup contract. The previous per-(recipient, subject) index would
-- suppress the second of `document.rejected` → `document.approved`
-- for the same uploader+document across a reject→resubmit→approve
-- cycle, because both rows share the same (recipient, subject).
-- Including `type` lets both review outcomes through while still
-- protecting against duplicate inserts from the same producer event.
--
-- Cross-type collisions on the same subject (e.g. mention vs reply
-- on the same comment) stay the producer's responsibility — the
-- comment producer enforces type precedence (reply > mention) before
-- calling `notify(...)`.

DROP INDEX IF EXISTS "notifications_recipient_subject_unique";
DROP INDEX IF EXISTS "notifications_recipient_type_subject_unique";

CREATE UNIQUE INDEX "notifications_recipient_type_subject_unique"
  ON "notifications" ("recipient_id", "type", "subject_type", "subject_id");

-- Re-create trigram GIN indexes on documents (Prisma drops these on
-- every migration because the schema cannot express them).
CREATE INDEX IF NOT EXISTS "documents_title_trgm_idx" ON "documents" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "documents_description_trgm_idx" ON "documents" USING gin ("description" gin_trgm_ops);
