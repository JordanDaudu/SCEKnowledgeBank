# syntax=docker/dockerfile:1.7
# Multi-stage build for the @workspace/api-server artifact.
#
# Stages:
#   1. deps    — install all pnpm workspace dependencies (with dev deps; needed
#                for the esbuild bundle step and for drizzle-kit/tsx in the
#                migrate image).
#   2. builder — produce the bundled server at artifacts/api-server/dist.
#   3. migrate — one-shot image used by the `api-init` compose service. Ships
#                the workspace sources + node_modules needed to run
#                `drizzle-kit push` and the tsx seed script, then exits.
#   4. runtime — minimal image for the long-running API. Ships only the
#                bundled dist/index.mjs plus tini and wget for healthchecks.
#                Everything the bundled server needs is already inlined by
#                esbuild, so no node_modules / source tree is copied in.

ARG NODE_VERSION=24-alpine

# ---------- deps ----------
FROM node:${NODE_VERSION} AS deps
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable

WORKDIR /app

# Copy workspace manifests first so dependency installs cache well.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/web/package.json ./artifacts/web/
COPY artifacts/mockup-sandbox/package.json ./artifacts/mockup-sandbox/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/db/package.json ./lib/db/
COPY lib/storage/package.json ./lib/storage/
COPY scripts/package.json ./scripts/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile

# ---------- builder ----------
FROM deps AS builder
WORKDIR /app

# Copy the rest of the workspace and build the API bundle.
COPY tsconfig.base.json tsconfig.json ./
COPY lib ./lib
COPY artifacts/api-server ./artifacts/api-server

RUN pnpm --filter @workspace/api-server run build

# ---------- migrate (one-shot init image) ----------
FROM node:${NODE_VERSION} AS migrate
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable

WORKDIR /app

# Workspace sources + node_modules for drizzle-kit push and tsx seed script.
COPY --from=builder /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/package.json ./
COPY --from=builder /app/tsconfig.base.json /app/tsconfig.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/artifacts/api-server/package.json ./artifacts/api-server/
COPY --from=builder /app/artifacts/api-server/src ./artifacts/api-server/src

# Storage volume mount point (compose mounts kb_storage here so the seed
# script can write seeded files alongside the API).
RUN mkdir -p /data/storage

COPY artifacts/api-server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["migrate-and-seed"]

# ---------- runtime (long-running API) ----------
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
ENV PORT=8080
RUN apk add --no-cache wget tini

WORKDIR /app

# Bundled server only. esbuild has inlined every dependency the request path
# needs (pino workers are bundled by esbuild-plugin-pino), so no node_modules
# or workspace source tree is required here.
COPY --from=builder /app/artifacts/api-server/dist ./artifacts/api-server/dist

# Storage volume mount point (compose mounts kb_storage here).
RUN mkdir -p /data/storage

COPY artifacts/api-server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/healthz" >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["start"]
