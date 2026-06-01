-- Account purge: mark an anonymized (PII-scrubbed) tombstone, distinct from soft-delete.
ALTER TABLE "users" ADD COLUMN "anonymized_at" TIMESTAMPTZ;
