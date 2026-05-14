# syntax=docker/dockerfile:1.7
# Multi-stage build for the @workspace/web artifact.
#
# Stages:
#   1. deps    — install all pnpm workspace dependencies.
#   2. builder — produce the static bundle in artifacts/web/dist/public.
#   3. runtime — nginx:alpine that serves the built static assets.

ARG NODE_VERSION=24-alpine
ARG NGINX_VERSION=1.27-alpine

# ---------- deps ----------
FROM node:${NODE_VERSION} AS deps
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable

WORKDIR /app

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

# VITE_API_BASE is baked into the static bundle, so it must be supplied at
# build time. Defaults to localhost:8080 to match the demo compose setup.
ARG VITE_API_BASE=http://localhost:8080
ENV VITE_API_BASE=${VITE_API_BASE}

COPY tsconfig.base.json tsconfig.json ./
COPY lib ./lib
COPY artifacts/web ./artifacts/web

RUN pnpm --filter @workspace/web run build

# ---------- runtime ----------
FROM nginx:${NGINX_VERSION} AS runtime

# Copy the static SPA assets and the nginx config that serves them with
# SPA-style fallback to index.html.
COPY --from=builder /app/artifacts/web/dist/public /usr/share/nginx/html
COPY artifacts/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
