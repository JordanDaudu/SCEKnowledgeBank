-- Sprint-3 M6: reactions on comments + per-document favorites
-- (favorites double as the "Following" list and the activity
-- notification subscription set).

CREATE TABLE "comment_reactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "comment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_reactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "comment_reactions_comment_user_kind_unique"
    ON "comment_reactions"("comment_id", "user_id", "kind");
CREATE INDEX "comment_reactions_comment_idx" ON "comment_reactions"("comment_id");
CREATE INDEX "comment_reactions_user_idx" ON "comment_reactions"("user_id");

ALTER TABLE "comment_reactions"
    ADD CONSTRAINT "comment_reactions_comment_id_fkey"
    FOREIGN KEY ("comment_id") REFERENCES "comments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comment_reactions"
    ADD CONSTRAINT "comment_reactions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;


CREATE TABLE "document_favorites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_favorites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_favorites_user_document_unique"
    ON "document_favorites"("user_id", "document_id");
CREATE INDEX "document_favorites_document_idx" ON "document_favorites"("document_id");
CREATE INDEX "document_favorites_user_created_idx"
    ON "document_favorites"("user_id", "created_at" DESC);

ALTER TABLE "document_favorites"
    ADD CONSTRAINT "document_favorites_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_favorites"
    ADD CONSTRAINT "document_favorites_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "documents"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
