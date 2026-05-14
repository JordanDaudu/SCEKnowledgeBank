#!/bin/sh
# Entrypoint for the API container.
#
#   start          (default) — apply schema, seed once, then run the server
#   migrate        — apply the drizzle schema and exit
#   seed           — run the seed script and exit
#   <anything>     — exec the given command verbatim
#
# The first-boot schema push + seed are gated by sentinel files written under
# /data/storage so re-running the container does not re-seed.
set -eu

SEED_SENTINEL="${SEED_SENTINEL:-/data/storage/.seeded}"

run_migrate() {
  echo "[entrypoint] applying database schema via drizzle-kit push"
  pnpm --filter @workspace/db run push
}

run_seed() {
  echo "[entrypoint] running seed script"
  pnpm --filter @workspace/api-server run seed
}

case "${1:-start}" in
  start)
    run_migrate
    if [ ! -f "${SEED_SENTINEL}" ]; then
      run_seed
      mkdir -p "$(dirname "${SEED_SENTINEL}")"
      date -u +"%Y-%m-%dT%H:%M:%SZ" > "${SEED_SENTINEL}"
    else
      echo "[entrypoint] seed sentinel ${SEED_SENTINEL} present; skipping seed"
    fi
    echo "[entrypoint] starting API server on port ${PORT}"
    exec node --enable-source-maps ./artifacts/api-server/dist/index.mjs
    ;;
  migrate)
    run_migrate
    ;;
  seed)
    run_seed
    ;;
  *)
    exec "$@"
    ;;
esac
