import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity";
import { courses, categories, tags } from "./taxonomy";

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    courseId: uuid("course_id").references(() => courses.id, {
      onDelete: "set null",
    }),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    materialType: text("material_type").notNull().default("other"),
    semester: text("semester"),
    academicYear: integer("academic_year"),
    visibility: text("visibility").notNull().default("public"),
    status: text("status").notNull().default("published"),
    uploaderId: uuid("uploader_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // Versioning fields reserved (no UI in Sprint 2)
    currentVersion: integer("current_version").notNull().default(1),
    isLatestVersion: boolean("is_latest_version").notNull().default(true),
    parentDocumentId: uuid("parent_document_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedBy: uuid("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("documents_course_idx").on(t.courseId),
    index("documents_category_idx").on(t.categoryId),
    index("documents_material_type_idx").on(t.materialType),
    index("documents_semester_year_idx").on(t.semester, t.academicYear),
    index("documents_uploader_idx").on(t.uploaderId),
    index("documents_created_at_idx").on(t.createdAt),
    index("documents_deleted_at_idx")
      .on(t.deletedAt)
      .where(sql`${t.deletedAt} IS NULL`),
    // Trigram indexes for search (require pg_trgm extension)
    index("documents_title_trgm_idx").using(
      "gin",
      sql`${t.title} gin_trgm_ops`,
    ),
    index("documents_description_trgm_idx").using(
      "gin",
      sql`${t.description} gin_trgm_ops`,
    ),
  ],
);

export const documentFiles = pgTable(
  "document_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    originalFilename: text("original_filename").notNull(),
    storedFilename: text("stored_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    storagePath: text("storage_path").notNull(),
    storageDriver: text("storage_driver").notNull().default("local"),
    checksum: text("checksum").notNull(),
    versionLabel: text("version_label"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("document_files_document_idx").on(t.documentId),
    index("document_files_checksum_idx").on(t.checksum),
  ],
);

export const documentTags = pgTable(
  "document_tags",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.tagId] }),
    index("document_tags_tag_idx").on(t.tagId),
  ],
);

export const materialViewHistory = pgTable(
  "material_view_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    viewedAt: timestamp("viewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("material_view_history_user_viewed_idx").on(t.userId, t.viewedAt),
    index("material_view_history_document_idx").on(t.documentId),
  ],
);

export type Document = typeof documents.$inferSelect;
export type DocumentFile = typeof documentFiles.$inferSelect;
export type DocumentTag = typeof documentTags.$inferSelect;
export type MaterialView = typeof materialViewHistory.$inferSelect;
