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
