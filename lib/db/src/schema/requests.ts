import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./identity";
import { courses } from "./taxonomy";
import { documents } from "./documents";

export const materialRequests = pgTable(
  "material_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    courseId: uuid("course_id").references(() => courses.id, {
      onDelete: "set null",
    }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("open"),
    fulfillingDocumentId: uuid("fulfilling_document_id").references(
      () => documents.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("material_requests_status_created_idx").on(t.status, t.createdAt),
    index("material_requests_course_idx").on(t.courseId),
  ],
);

export const requestVotes = pgTable(
  "request_votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => materialRequests.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("request_votes_user_request_unique").on(t.userId, t.requestId),
    index("request_votes_request_idx").on(t.requestId),
  ],
);

export type MaterialRequest = typeof materialRequests.$inferSelect;
export type RequestVote = typeof requestVotes.$inferSelect;
