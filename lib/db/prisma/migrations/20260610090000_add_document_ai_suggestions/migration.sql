-- AI summary + tag suggestions (design 2026-06-10).
-- documents.ai_summary holds the uploader-ACCEPTED summary only;
-- pending/failed suggestions live in document_ai_suggestions.
ALTER TABLE "documents" ADD COLUMN "ai_summary" TEXT NOT NULL DEFAULT '';

CREATE TABLE "document_ai_suggestions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "document_id" UUID NOT NULL,
  "summary" TEXT NOT NULL DEFAULT '',
  "suggested_tag_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  "status" TEXT NOT NULL DEFAULT 'pending',
  "error" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "resolved_at" TIMESTAMPTZ,
  CONSTRAINT "document_ai_suggestions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_ai_suggestions_document_unique"
  ON "document_ai_suggestions" ("document_id");

ALTER TABLE "document_ai_suggestions"
  ADD CONSTRAINT "document_ai_suggestions_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
