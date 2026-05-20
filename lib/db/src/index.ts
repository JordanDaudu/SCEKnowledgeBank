/**
 * Database access for the Knowledge Bank backend.
 *
 * Exports:
 * - `db`  — singleton `PrismaClient` used by every repository. Lazily
 *           reused across hot-reloads in development via a global cache to
 *           avoid exhausting Postgres connections during dev restarts.
 * - `pool` — a small dedicated `pg.Pool` used only by
 *           `connect-pg-simple` for session storage (PrismaClient does not
 *           expose a `pg.Pool`).
 *
 * Prisma is the only ORM in runtime code; the previous Drizzle modules have
 * been removed in this commit.
 */
import { Prisma, PrismaClient } from "@prisma/client";

// Re-export the `Prisma` value namespace so repositories can use
// `Prisma.sql` / `Prisma.join` / `Prisma.empty` template helpers
// without depending on `@prisma/client` directly.
export { Prisma };
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const globalForPrisma = globalThis as unknown as {
  __knowledgeBankPrisma?: PrismaClient;
  __knowledgeBankPool?: pg.Pool;
};

export const db: PrismaClient =
  globalForPrisma.__knowledgeBankPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__knowledgeBankPrisma = db;
}

export const pool: pg.Pool =
  globalForPrisma.__knowledgeBankPool ??
  new Pool({ connectionString: process.env.DATABASE_URL });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__knowledgeBankPool = pool;
}

// Re-export Prisma's generated types so downstream packages don't have to
// pull `@prisma/client` directly.
export type {
  Role,
  User,
  UserRole,
  Permission,
  RolePermission,
  Course,
  CourseEnrollment,
  Category,
  Tag,
  Document,
  DocumentFile,
  DocumentTag,
  MaterialViewHistory,
  Comment,
  MaterialRequest,
  RequestVote,
  AuditLog,
} from "@prisma/client";
