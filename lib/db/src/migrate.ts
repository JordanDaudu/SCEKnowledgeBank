/**
 * Apply Drizzle SQL migrations from ./drizzle to the database in DATABASE_URL.
 *
 * Run with `pnpm --filter @workspace/db run migrate`. Idempotent: drizzle's
 * migrator records which migrations have been applied in `__drizzle_migrations`.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, "..", "drizzle");

async function main() {
  console.log(`[db:migrate] applying migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log("[db:migrate] done");
}

main()
  .catch((err) => {
    console.error("[db:migrate] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
