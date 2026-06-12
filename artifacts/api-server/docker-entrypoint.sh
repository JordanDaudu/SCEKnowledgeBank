#!/bin/sh
# Entrypoint shared by the API runtime image and the api-init (migrate) image.
#
#   start              (default in runtime image) — exec the bundled API server.
#                      Does not touch the schema; the api-init service handles
#                      migrations and seeding before the API starts.
#   migrate            — apply Prisma migrations and exit. Requires the
#                      migrate image (prisma CLI + workspace sources).
#   seed               — run the seed script and exit. Requires the migrate
#                      image (tsx + workspace sources).
#   migrate-and-seed   (default in migrate image) — apply the schema, then run
#                      the seed once (gated by a sentinel under /data/storage)
#                      and exit. Used by the api-init compose service.
#   backfill-pdf-text  — re-extract text for PDFs missing it and exit. Runs the
#                      bundled maintenance script; needs the DB + storage volume.
#   <anything else>    — exec the given command verbatim.
set -eu

SEED_SENTINEL="${SEED_SENTINEL:-/data/storage/.seeded}"

run_migrate() {
  echo "[entrypoint] applying database schema via prisma migrate deploy"
  pnpm --filter @workspace/db run migrate
}

run_seed() {
  echo "[entrypoint] running seed script"
  pnpm --filter @workspace/api-server run seed
}

case "${1:-start}" in
  start)
    echo "[entrypoint] starting API server on port ${PORT}"
    exec node --enable-source-maps ./artifacts/api-server/dist/index.mjs
    ;;
  migrate)
    run_migrate
    ;;
  seed)
    run_seed
    ;;
  migrate-and-seed)
    run_migrate
    if [ ! -f "${SEED_SENTINEL}" ]; then
      run_seed
      mkdir -p "$(dirname "${SEED_SENTINEL}")"
      date -u +"%Y-%m-%dT%H:%M:%SZ" > "${SEED_SENTINEL}"
    else
      echo "[entrypoint] seed sentinel ${SEED_SENTINEL} present; skipping seed"
    fi
    ;;
  backfill-pdf-text)
    echo "[entrypoint] backfilling extracted text for PDFs missing it"
    exec node --enable-source-maps ./artifacts/api-server/dist/scripts/backfill-pdf-text.mjs
    ;;
  *)
    exec "$@"
    ;;
esac
