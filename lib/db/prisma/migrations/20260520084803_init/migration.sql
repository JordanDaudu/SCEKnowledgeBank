-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "primary_role_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "lecturer_name" TEXT NOT NULL,
    "lecturer_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "course_id" UUID,
    "category_id" UUID,
    "material_type" TEXT NOT NULL DEFAULT 'other',
    "semester" TEXT,
    "academic_year" INTEGER,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "status" TEXT NOT NULL DEFAULT 'published',
    "uploader_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "is_latest_version" BOOLEAN NOT NULL DEFAULT true,
    "parent_document_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "original_filename" TEXT NOT NULL,
    "display_filename" TEXT NOT NULL,
    "stored_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "storage_driver" TEXT NOT NULL DEFAULT 'local',
    "checksum" TEXT NOT NULL,
    "version_label" TEXT,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_tags" (
    "document_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "document_tags_pkey" PRIMARY KEY ("document_id","tag_id")
);

-- CreateTable
CREATE TABLE "material_view_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "viewed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_view_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "parent_id" UUID,
    "body" TEXT NOT NULL,
    "page_number" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "course_id" UUID,
    "requested_by" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "fulfilling_document_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "material_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_votes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "sid" TEXT NOT NULL,
    "sess" JSON NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_unique" ON "roles"("name");

-- CreateIndex
CREATE INDEX "users_primary_role_idx" ON "users"("primary_role_id");

-- CreateIndex
CREATE INDEX "user_roles_role_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_unique" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "courses_lecturer_name_idx" ON "courses"("lecturer_name");

-- CreateIndex
CREATE UNIQUE INDEX "courses_code_unique" ON "courses"("code");

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_unique" ON "categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_unique" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_unique" ON "tags"("name");

-- CreateIndex
CREATE INDEX "documents_course_idx" ON "documents"("course_id");

-- CreateIndex
CREATE INDEX "documents_category_idx" ON "documents"("category_id");

-- CreateIndex
CREATE INDEX "documents_material_type_idx" ON "documents"("material_type");

-- CreateIndex
CREATE INDEX "documents_semester_year_idx" ON "documents"("semester", "academic_year");

-- CreateIndex
CREATE INDEX "documents_uploader_idx" ON "documents"("uploader_id");

-- CreateIndex
CREATE INDEX "documents_created_at_idx" ON "documents"("created_at");

-- CreateIndex
CREATE INDEX "document_files_document_idx" ON "document_files"("document_id");

-- CreateIndex
CREATE INDEX "document_files_checksum_idx" ON "document_files"("checksum");

-- CreateIndex
CREATE INDEX "document_tags_tag_idx" ON "document_tags"("tag_id");

-- CreateIndex
CREATE INDEX "material_view_history_user_viewed_idx" ON "material_view_history"("user_id", "viewed_at");

-- CreateIndex
CREATE INDEX "material_view_history_document_idx" ON "material_view_history"("document_id");

-- CreateIndex
CREATE INDEX "comments_document_created_idx" ON "comments"("document_id", "created_at");

-- CreateIndex
CREATE INDEX "comments_parent_idx" ON "comments"("parent_id");

-- CreateIndex
CREATE INDEX "comments_author_idx" ON "comments"("author_id");

-- CreateIndex
CREATE INDEX "material_requests_status_created_idx" ON "material_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "material_requests_course_idx" ON "material_requests"("course_id");

-- CreateIndex
CREATE INDEX "request_votes_request_idx" ON "request_votes"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "request_votes_user_request_unique" ON "request_votes"("user_id", "request_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs"("actor_user_id");

-- CreateIndex
CREATE INDEX "session_expire_idx" ON "session"("expire");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_primary_role_id_fkey" FOREIGN KEY ("primary_role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_lecturer_user_id_fkey" FOREIGN KEY ("lecturer_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_tags" ADD CONSTRAINT "document_tags_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_tags" ADD CONSTRAINT "document_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_view_history" ADD CONSTRAINT "material_view_history_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_view_history" ADD CONSTRAINT "material_view_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_fulfilling_document_id_fkey" FOREIGN KEY ("fulfilling_document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_votes" ADD CONSTRAINT "request_votes_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "material_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_votes" ADD CONSTRAINT "request_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Behaviour-preserving raw SQL (constraints Prisma cannot express) ──
-- pg_trgm enables similarity()/`%` queries and the GIN trigram indexes
-- below; previously created by the Drizzle baseline migration.
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Partial unique on email so reactivating a soft-deleted user with the same
-- address is allowed (matches the previous Drizzle `users_email_active_unique`).
CREATE UNIQUE INDEX "users_email_active_unique" ON "users" ("email") WHERE "deleted_at" IS NULL;

-- Partial index used by every alive-row filter on documents.
CREATE INDEX "documents_deleted_at_idx" ON "documents" ("deleted_at") WHERE "deleted_at" IS NULL;

-- Trigram GIN indexes powering suggestion search (LIKE/`%`/similarity()).
CREATE INDEX "documents_title_trgm_idx" ON "documents" USING gin ("title" gin_trgm_ops);
CREATE INDEX "documents_description_trgm_idx" ON "documents" USING gin ("description" gin_trgm_ops);
