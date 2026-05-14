# Knowledge Bank

A course material sharing platform for students, lecturers, and administrators. The stack is a Vite + React web app, a Node/Express API server, and PostgreSQL.

## Run with Docker

You can go from a clean clone to a running stack with one command. Requirements: Docker and Docker Compose v2.

```bash
# 1. Set the two required secrets (any long random strings will do)
export SESSION_SECRET=$(openssl rand -hex 32)
export SIGNED_URL_SECRET=$(openssl rand -hex 32)

# 2. Build and start the whole stack (database, API, web)
docker compose up --build
```

The API container applies the database schema and seeds demo data on first boot, so you can log in as soon as the web app loads. If you ever want to re-run the seed manually:

```bash
docker compose run --rm api seed
```

Once everything is up:

- Web app: <http://localhost:5173>
- API:     <http://localhost:8080> (health check at `/api/healthz`)
- Postgres: `localhost:5432` (user/password/db: `knowledge_bank`)

To stop and remove everything (including uploaded files and the database volume):

```bash
docker compose down -v
```

### Demo logins

The seed script creates three accounts. They all use the password `demo1234`.

| Role       | Email            | Password   |
| ---------- | ---------------- | ---------- |
| Student    | `student@demo`   | `demo1234` |
| Lecturer   | `lecturer@demo`  | `demo1234` |
| Admin      | `admin@demo`     | `demo1234` |

### Environment variables

Required (the stack will refuse to start without these):

| Variable             | What it does                                          |
| -------------------- | ----------------------------------------------------- |
| `SESSION_SECRET`     | Signs user session cookies. Use a long random string. |
| `SIGNED_URL_SECRET`  | Signs download URLs for uploaded files.               |

Optional (sensible defaults are baked in):

| Variable         | Default                   | What it does                                                                 |
| ---------------- | ------------------------- | ---------------------------------------------------------------------------- |
| `WEB_ORIGIN`     | `http://localhost:5173`   | Origin the API allows for CORS and cookies. Change if you host the web app elsewhere. |
| `VITE_API_BASE`  | `http://localhost:8080`   | Base URL the web app calls at build time. Change if the API is on a different host. |

If you put your web app or API on a different hostname or port, set both `WEB_ORIGIN` and `VITE_API_BASE` before running `docker compose up --build` so the web image is rebuilt with the right API base.

## Run locally without Docker

The monorepo is managed by pnpm. Install once at the repo root, then start the services individually. Use `.env.example` as a starting point for your local `.env`.

```bash
pnpm install
cp .env.example .env  # then fill in SESSION_SECRET and SIGNED_URL_SECRET

# 1. Apply database migrations (creates pg_trgm extension + all tables)
pnpm --filter @workspace/db run migrate

# 2. Seed demo data (idempotent — safe to re-run)
pnpm --filter @workspace/api-server run seed

# 3. Start the API server and the web app (separate terminals, or use the
#    configured workflows in Replit)
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/web run dev
```

### Schema changes

The database schema lives in `lib/db/src/schema`. When you change it:

```bash
# Produce a new SQL migration file under lib/db/drizzle/
pnpm --filter @workspace/db run generate

# Apply it
pnpm --filter @workspace/db run migrate
```

The first migration enables the `pg_trgm` extension that powers trigram search on document titles and descriptions.

## Uploads, signed URLs, and limits

- Maximum upload size: `MAX_UPLOAD_MB` (default **50 MB**). The web app refuses files larger than `VITE_MAX_UPLOAD_MB` before they hit the network, and the server rejects them at the route boundary as well.
- Allowed MIME types are listed in `ALLOWED_MIME_TYPES`. They are validated both by the declared `Content-Type` *and* by a magic-byte sniff so a `.pdf` rename of an executable is rejected.
- Previews and downloads use **short-lived signed URLs**: the API issues a token valid for `SIGNED_URL_TTL_SECONDS` (default **300 s**) bound to the document id and the requesting user. Requests to `/api/documents/:id/preview` and `/api/documents/:id/download` without a token return **401**; expired/tampered tokens also return **401**.

## Storage

Two storage drivers ship in the box:

- `local` (default) writes files to `STORAGE_LOCAL_ROOT` (default `.data/storage`).
- `s3` is a thin stub — set `STORAGE_DRIVER=s3` and wire up real credentials in the storage module to use it.

## Tests, typecheck, and build

```bash
pnpm run typecheck            # all packages
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/web run build
```
