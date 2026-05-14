# syntax=docker/dockerfile:1.7
# Multi-stage build for the @workspace/api-server artifact.
#
# Stages:
#   1. deps    — install all pnpm workspace dependencies (with dev deps; needed
#                for the esbuild bundle step and for drizzle-kit/tsx at runtime).
#   2. builder — produce the bundled server at artifacts/api-server/dist.
#   3. runtime — minimal image that ships the bundled server + workspace
#                sources needed for drizzle-kit migrations and the seed script.

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

# ---------- runtime ----------
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
ENV PORT=8080
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable \
    && apk add --no-cache wget tini

WORKDIR /app

# Copy the workspace + installed node_modules from the build stages. drizzle-kit
# (for `pnpm --filter @workspace/db run push`) and tsx (for the seed script)
# live in node_modules; the seed and schema files live under lib/ and
# artifacts/api-server/src/. We keep them so the entrypoint can apply the
# schema and seed on first boot.
COPY --from=builder /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/package.json ./
COPY --from=builder /app/tsconfig.base.json /app/tsconfig.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/artifacts/api-server/package.json ./artifacts/api-server/
COPY --from=builder /app/artifacts/api-server/src ./artifacts/api-server/src
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
