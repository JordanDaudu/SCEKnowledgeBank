# Threat Model

## Project Overview

Knowledge Bank is a scholarly document repository for university communities. Students, lecturers, and admins upload, browse, search, preview, download, comment on, and request academic materials under role-based access. The stack is a pnpm monorepo: React 19 + Vite 7 web frontend, Express 5 API server with cookie-based sessions backed by Postgres (`connect-pg-simple`), Prisma ORM on PostgreSQL, Zod-validated config and request bodies, and a pluggable file-storage driver (local filesystem or GCS bucket). Hosted on Replit; OpenAPI is the source of truth and `lib/api-spec/openapi.yaml` drives generated typed hooks (Orval) and Zod schemas. Sprint-3 added notifications, a review/approval workflow, a v2 search surface, smart metadata extraction, workspace analytics, and collaboration polish (reactions, favorites/following, request status transitions).

## Assets

- **User credentials and sessions.** Email + bcrypt-hashed password in `users`; opaque session ids in the `session` table. Compromise allows impersonation across all role tiers including admin.
- **Uploaded documents and version blobs.** Stored via the storage driver (`local` at `.data/storage` or a GCS bucket). Some documents are `restricted` (course-enrolled only) or `private` (uploader/owner/admin). Bytes must never be served outside that visibility envelope, including via direct blob URLs.
- **Course / enrollment graph.** Determines who can read `restricted` content and who may review pending uploads. Tampering grants unintended read access to course materials.
- **Audit log (`audit_logs`).** Captures auth, uploads, edits, deletes, comments, requests, votes, downloads, and review transitions. Required for repudiation defence.
- **Application secrets.** `SESSION_SECRET`, `SIGNED_URL_SECRET`, `DATABASE_URL`, object-storage bucket id + signed-URL secret. All sourced from environment; never logged. `SIGNED_URL_SECRET` leakage forges preview/download tokens for any document; `SESSION_SECRET` leakage forges sessions.
- **Notifications.** Per-recipient feed bound by `(recipient, type, subjectType, subjectId)`. Cross-recipient leakage would reveal private comment / review activity.
- **Analytics aggregates.** Workspace- or course-scoped counts of views, downloads, uploads, and the pending-review backlog. Admin or course-lecturer only.

## Trust Boundaries

- **Browser to API.** The single largest boundary. The web app uses `credentials: include`; the API authenticates every non-public route via the session cookie and authorizes via `permissions.service`. All client input is untrusted and validated server-side with Zod (request bodies + query params) before reaching services.
- **API to PostgreSQL.** Prisma is the only ORM and all queries are parameterized (including the raw-SQL search ranking path, which uses Prisma's tagged-template binding). String concatenation into SQL is forbidden.
- **API to object storage.** Driver abstraction (`getStorage()`); blob reads only happen through `/preview` and `/download` endpoints that first verify a short-lived HMAC token plus the visibility predicate. The web never holds raw bucket URLs.
- **Public vs authenticated vs admin/lecturer.** Auth routes (`/auth/login`, `/auth/register`) are public; everything else requires a session. Admin-only routes (`/admin/*`, workspace analytics) check role server-side. Lecturer-only / course-lecturer surfaces (review queue, course analytics, course-scoped uploads) are gated by `permissions.service` against the document's course.
- **Uploader vs viewer.** `restricted` and `private` visibility filters are applied at every read site (list, search v1+v2 + facets + autocomplete, detail, comments, versions, signed-URL issuance, recently-viewed, material-request visibility). There is no uploader/owner bypass for `restricted` — losing the enrollment loses the read.

## Scan Anchors

- **Production entry points.** `artifacts/api-server/src/index.ts` → `app.ts` → `routes/*.ts`. Every route file mounts under `/api` via `app.ts`. New endpoints must register on the central app instance to receive the auth + Zod-validation middlewares.
- **Highest-risk code areas.**
  - `artifacts/api-server/src/services/permissions.service.ts` — central authority for `canView/canEdit/canDelete/canComment/canManageVersions/canUpload/canUploadToCourse` plus review reviewer/submitter checks. Any new read or write surface MUST consult it rather than inlining ownership checks.
  - `artifacts/api-server/src/lib/signed-url.ts` and the `/documents/:id/preview|download` route handlers — HMAC issuance and verification for blob access.
  - `artifacts/api-server/src/services/search.service.ts` — raw SQL via Prisma tagged templates; `ts_headline` snippets are returned with sentinel markers (`[[KBMARK]]…[[/KBMARK]]`) and the web html-escapes before swapping in `<mark>`. Any future change to that contract must keep the escape-then-replace order intact.
  - Upload paths in `routes/documents.ts` and `services/documents.service.ts` — multipart parsing, MIME allowlist, size cap (413 on overflow), checksum + quota enforcement, smart-metadata extractor chain.
- **Public surfaces.** `/auth/login`, `/auth/register`, `/auth/logout`, plus the OpenAPI spec endpoint. Everything else is authenticated.
- **Admin / lecturer surfaces.** `/admin/users*`, `/documents/pending-review`, approve/reject document routes, `/analytics/workspace`, `/analytics/courses/:id`.
- **Dev-only areas (ignore unless proven reachable in production).** `artifacts/mockup-sandbox/*` (canvas component preview, never deployed with the API), `artifacts/api-server/src/scripts/seed-demo*.ts` (CLI scripts, not mounted on the HTTP server). The Semgrep finding for dynamic-method dispatch in `artifacts/mockup-sandbox/src/App.tsx` is in this dev-only sandbox — the loader keys come from a Vite glob over a controlled fixtures directory, not user input.

## Threat Categories

### Spoofing

Authentication is cookie-based: `connect-pg-simple` persists sessions in Postgres signed by `SESSION_SECRET`. Cookies must remain `httpOnly` and `sameSite=lax` (or stricter) and `secure` in production. `SESSION_SECRET` and `SIGNED_URL_SECRET` MUST be overridden in production — `env.ts` rejects boot if they fall below the minimum length. Preview/download HMAC tokens bind `{documentId, action, userId, exp}` and a request without a valid token returns 401, never 200 with empty bytes. New notification or webhook producers MUST verify the authenticated session of the producer side before emitting events on behalf of a user.

### Tampering

Every write route validates its body with a generated Zod schema before touching the service layer; client-supplied IDs are re-resolved against the database. The review workflow rejects any transition not on the explicit allow-list (`draft|rejected → pending_review → approved|rejected`), and `reviewReason` is trimmed + length-bound. Voting on material requests is gated by a unique `(user_id, request_id)` index with `ON CONFLICT DO NOTHING`, so concurrent duplicate votes cannot both land. Quota math runs server-side in `quota.service.canFit` — the client cannot bypass it by under-reporting file size. Search snippets are returned with sentinel markers, never raw HTML, so the server cannot accidentally smuggle markup into client-rendered HTML.

### Repudiation

`audit_logs` captures auth, uploads, edits, deletes, comments, requests, votes, downloads, and review transitions with the acting user id and timestamp. Any new sensitive write (e.g. future bulk-admin tools, role changes) MUST emit an audit row in the same transaction. Audit rows are append-only at the application layer; database-level immutability is not enforced and is a known gap.

### Information Disclosure

`permissions.service` is consulted at every read site and at signed-URL issuance, so `restricted` and `private` documents never leak via list, search v1+v2, search facets, autocomplete, detail, comments, version list, recently-viewed, material-request visibility, or analytics aggregates. Autocomplete is explicitly scoped to documents the caller can already see so uploader/tag/course names attached only to invisible docs are not enumerable. Pino-http now demotes 2xx access lines to `debug` (M7), but log content rules are unchanged: no passwords, no session ids, no signed-URL tokens, no `SIGNED_URL_SECRET`/`SESSION_SECRET`/`DATABASE_URL` ever appear in logs. Error responses surface a `code` + message; stack traces are not returned to the client in production.

### Denial of Service

Upload size is capped server-side and returns 413 on overflow; the MIME allowlist drops disallowed types. Quota gating in `quota.service` blocks an uploader from exhausting storage. Search snippet generation (`ts_headline`) runs against the indexed FTS column, not raw blob bytes. Analytics endpoints are cached in-process (~30 s) so a single admin polling the dashboard does not stampede the read replica. Known gap: there is no global rate limiter on `/auth/login` or `/auth/register`; brute-forcing the demo password set is possible. Adding `express-rate-limit` on auth + public endpoints is the recommended follow-up before public exposure.

### Elevation of Privilege

Authorization is centralized in `permissions.service` and the review workflow's reviewer/submitter checks; no route may re-implement ownership inline. The reviewer test for the pending-review queue and per-document approve/reject is `admin OR lecturer of doc.courseId` — both flags are server-issued on every `Document` DTO (`canSubmitForReview`, `canReview`), so a tampered frontend cannot surface a CTA that the server will not honor. Restoring an older document version inserts a new version row through the same `canManageVersions` gate and reuses the original blob's `storage_path` so the uploader is never billed twice and the historical blob's access surface is unchanged. All Prisma queries are parameterized; no `child_process` / shell exec is invoked from request handlers; no `eval` / `Function(...)` of user data. Path traversal in the local storage driver is prevented by storing under a content-addressed layout keyed by checksum + uuid, never by client-supplied filename.
