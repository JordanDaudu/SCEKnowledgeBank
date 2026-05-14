import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./identity";
import { documents } from "./documents";

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    parentId: uuid("parent_id"),
    body: text("body").notNull(),
    pageNumber: integer("page_number"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("comments_document_created_idx").on(t.documentId, t.createdAt),
    index("comments_parent_idx").on(t.parentId),
    index("comments_author_idx").on(t.authorId),
  ],
);

export type Comment = typeof comments.$inferSelect;
