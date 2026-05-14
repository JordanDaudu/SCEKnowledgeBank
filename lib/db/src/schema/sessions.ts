import { pgTable, text, json, timestamp, index } from "drizzle-orm/pg-core";

// Compatible with connect-pg-simple's expected schema (sid / sess / expire).
export const sessions = pgTable(
  "session",
  {
    sid: text("sid").primaryKey(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { precision: 6, withTimezone: false }).notNull(),
  },
  (t) => [index("session_expire_idx").on(t.expire)],
);
