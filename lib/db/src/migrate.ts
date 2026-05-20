/**
 * Apply Prisma migrations to the database in DATABASE_URL.
 *
 * This is a thin wrapper that shells out to `prisma migrate deploy` so the
 * same script works both in dev (`pnpm --filter @workspace/db run migrate`)
 * and in any Dockerfile / start-up hook that wants to run pending
 * migrations before launching the API.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(here, "..", "prisma", "schema.prisma");

console.log(`[db:migrate] running prisma migrate deploy (schema=${schemaPath})`);

const result = spawnSync(
  "npx",
  ["prisma", "migrate", "deploy", `--schema=${schemaPath}`],
  { stdio: "inherit" },
);

if (result.status !== 0) {
  console.error("[db:migrate] failed");
  process.exit(result.status ?? 1);
}
console.log("[db:migrate] done");
