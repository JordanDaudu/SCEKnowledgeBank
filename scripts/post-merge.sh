#!/bin/bash
# Post-merge setup. Runs automatically after each task merge.
#
# IMPORTANT: use `prisma migrate deploy` here, never `prisma db push`.
# `db push` reconciles the live DB to the current Prisma model and will
# happily drop columns that the schema no longer declares — including
# `documents.search_text` / `documents.search_vector`, which are still
# read at runtime via raw SQL (see `documents.repo.ts`). `migrate deploy`
# only applies pending migrations, so no destructive drops slip in.
set -euo pipefail

pnpm install --frozen-lockfile
pnpm --filter @workspace/db run generate
pnpm --filter @workspace/db run migrate
