-- AI suggestions v2 (design 2026-06-10): allow the model to propose
-- brand-new tag names. Stored alongside the catalog-tag id suggestions;
-- Tag rows are created only when the uploader accepts. Purely additive.
ALTER TABLE "document_ai_suggestions"
  ADD COLUMN "suggested_new_tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
