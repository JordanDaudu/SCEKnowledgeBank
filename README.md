# Knowledge Bank

A standalone academic-materials platform for universities. Students, lecturers, and administrators upload, search, review, discuss, request, and track course documents. Built as a pnpm monorepo with a React + Vite web client, an Express 5 API server, and PostgreSQL via Prisma.

## Features

### Authentication & roles
- Session-cookie auth (Argon2 password hashes, signed cookies).
- Three primary roles: `student`, `lecturer`, `admin`. Course-level membership (`student` / `lecturer`) is independent of the global role.

### Document upload & storage
- Multipart upload through `POST /api/documents/upload`. Each file is virus-/magic-byte sniffed, MIME-validated, and capped by `MAX_UPLOAD_MB`.
- Two storage drivers ship in the box: `local` (default in dev — writes under `.data/storage`) and `gcs` (default on Replit when the bucket env vars are present). Drivers are selected at runtime by `STORAGE_DRIVER` or auto-picked from the environment.
- Versioning: every file write produces a new `DocumentFile` row with a monotonic version number and optional change note. Previous versions remain downloadable; quota is counted on the active version; older versions can be **restored** (forward-only — history is preserved). The document detail page has a versions panel, and the **Upload History** page (`/uploads`) lists your documents with an expandable per-document **revision timeline**.
- Previews and downloads use short-lived signed URLs (`SIGNED_URL_TTL_SECONDS`, default 300 s) bound to the document id and the requesting user.

### Student-upload review workflow
- Students upload only to courses they're enrolled in. Server re-checks enrollment on every upload; client course picker is filtered to `me.enrollments`.
- Every student upload is forced to `status="draft"` regardless of client input.
- Upload body accepts `autoSubmitForReview` (default ON in the UI). When true, the route iterates the newly drafted docs and calls `documents.service.submitForReview` per doc so the audit + notification pipelines fire exactly once.
- State machine: `draft|rejected → pending_review → approved|rejected`. Lecturers/admins approve or reject (reject requires a 1–500 char reason). The uploader is notified via the in-app bus.
- Review-hidden statuses (`draft`, `pending_review`, `rejected`) are hidden from non-uploader/non-owner/non-reviewer users in **every** read path — Prisma list/filter, raw-SQL v2 search, facets, and autocomplete — via the shared `REVIEW_HIDDEN_STATUSES` constant.

### Lecturer / admin approval queue
- `GET /api/documents/pending-review` paginated queue. Admins see everything pending; lecturers see only docs in courses they teach; others get 403.
- The web client's `/review-queue` page shows the queue with one-click Approve / Reject (with reason prompt) and links back to the document for full context.

### Search v2 — partial/prefix/fuzzy, facets, autocomplete, snippets, ranking
- Single source of truth: `search.service` behind a typed filter DSL.
- **Intelligent matching (refinement Phase 1):** queries are prefix-aware — a partial word like `lect` matches `lecture` (a `to_tsquery('english', 'tok:*')` built from the input). When the full-text pass returns nothing, the service falls back to a **trigram (`word_similarity`) fuzzy match** so typos still find results (`plankron` → `plankton`). The search haystack covers title, description, course code/title/lecturer, tags, **filename, category, uploader name, and extracted file text + smart-metadata keywords**.
- `GET /api/v2/documents/search` — ranked page with optional per-row `headline` snippets via Postgres `ts_headline` (sentinel-tagged so the client html-escapes safely before swapping in `<mark>`).
- `GET /api/v2/documents/search/facets` — counts grouped across course / materialType / semester / status / uploader, scoped to the current filter set, with id-bearing dims hydrated with display labels.
- `GET /api/v2/documents/autocomplete?q=…` — grouped suggestions over tags / courses / uploaders, scoped to docs the caller can already see (a tag or uploader name that exists only on a hidden doc never surfaces to outsiders).

### Upload intelligence — smart metadata suggestions
- `POST /api/v2/documents/suggest-metadata` (multipart) runs the real extractor chain (PDF/text/image), deduplicates against the user's quota, then matches keywords against existing `Tag` / `Category` rows (exact **and** substring). Suggestions appear as clickable, apply-on-click chips in the upload card, with a confidence indicator (`from file metadata` vs `from filename`).
- **Filename intelligence (refinement Phase 3):** a pure parser derives **material type** (exam / problem-set / lecture-notes / slides / syllabus / cheat-sheet / review-notes / …), **semester**, and **academic year** from the filename — so even Office files we can't read inside still pre-fill the form. Extraction failures never block upload.

### Ranking & discovery (refinement Phase 2)
- Deterministic, configurable weighted score (`lib/ranking.ts`): engagement (views/downloads/favorites, ln-dampened) + recency half-life decay + a metadata-completeness quality signal. Engagement is read from **denormalised counter columns** on `documents` (maintained incrementally on each view/download/favorite), so ranking never runs a per-request `GROUP BY`.
- Browse sort options: **Most Relevant** (FTS rank first, so exact matches still win), **Most Recent**, **Trending**, **Most Viewed / Downloaded / Favorited**, plus Oldest / A–Z. Default is relevance. Browse cards show engagement counts.

### Prep Hub — study collections, progress & recommendations (refinement Phase 6)
- **Study collections** (`/prep-hub`): user-owned ordered groupings of existing documents (kinds: collection / exam-prep / revision / semester). Add/remove, reorder, per-item notes — items reference documents by FK, nothing is duplicated. Learning paths reuse the same model (`kind='learning_path'`, `is_official`) — schema in place, UI deferred.
- **Study progress:** mark documents Reviewing / Completed; "Reviewing" feeds the **Continue studying** lane.
- **Quick Access:** Recommended-for-you, Continue studying, Saved, Recently viewed.
- **Recommendations** (`GET /api/me/recommendations`): top-ranked documents in the user's interest courses (enrolments + courses of recently-viewed/favorited docs), excluding what they've already seen, reusing the Phase-2 ranking.

### Duplicate detection
- Upload pre-flight checks checksum-equivalent files already owned by the user and returns the existing doc instead of re-uploading.

### In-app notifications
- Polling-only bus: `notifications` table, unique on `(recipient_id, type, subject_type, subject_id)`. Producers (`comment.mention`, `comment.reply`, `comment.reaction`, `document.activity`, `document.approved`, `document.rejected`, `request.status`) call `notifications.service.notify(...)` which is fire-and-forget and no-ops on self-notify.
- `type` is part of the dedup key so distinct outcomes on the same subject — e.g. `document.rejected` then a later `document.approved` for the same uploader+document — both reach the recipient.
- The header bell polls `unread-count` every 30 s; the dropdown list only polls while open.

### Comments, mentions, replies, reactions
- Nested threads on every document. `@displayname` mentions resolve server-side; replies notify the parent author (reply > mention precedence in the producer).
- Comment reactions (Sprint-3 M6) fan out a `comment.reaction` notification to the comment author.

### Favorites & following
- Users can favorite documents. Favorites mirror review-hidden status (a favorited doc that gets re-drafted disappears for non-owners).
- New comments fan a `document.activity` ping to every favoriter except the actor / reply target / mentions.

### Request board
- Students post material requests; everyone can upvote. Authors can fulfil their own requests by linking a document.
- Status (`open|in_progress|fulfilled|closed`) is editable by request author, course lecturer, or admin. Status transitions notify the author via the bus.

### Analytics & dashboard intelligence
- Admin/lecturer analytics endpoints (30 s cached) power the `/admin/analytics` and `/course-analytics` pages — corpus + per-course stats, top-viewed/downloaded docs, active uploaders, top categories, duplicate groups. The admin Analytics page is tabbed: **Overview** and **Activity logs**.
- **Dashboard widgets (refinement Phase 8):** the home page surfaces Trending, Continue studying, recent uploads (Latest additions) and — for admins — a Platform Insights panel (engagement deltas, pending-review backlog, duplicate warnings, top categories, active uploaders) reusing the cached analytics.

### Activity & audit
- Generic `audit_logs(action, entity_type, entity_id, metadata)` event bus records auth, uploads, edits, deletes, versions, downloads, review transitions, comments, **favorites, reactions**, and request interactions. A role-scoped feed (`GET /api/activity`, `?mine=true` for own actions) powers the **Activity logs** tab inside admin Analytics (students/lecturers don't have a separate activity surface).

### Audit log, security, regression gate
- `audit_logs` records auth, uploads, edits, deletes, comments, requests, votes, downloads, review transitions.
- `pnpm regression` is the project-wide CI gate (see *Common commands*). The `regression:local` and `regression:gcs` wrappers exercise both storage drivers end-to-end.

## Roles & permissions (high level)

| Role     | Upload                                  | Review queue                  | Search visibility of review-hidden docs                |
| -------- | --------------------------------------- | ----------------------------- | ------------------------------------------------------ |
| student  | only to courses they're enrolled in; forced `status="draft"` | not allowed | their own drafts/pending/rejected only |
| lecturer | to any course they teach (no review gate for self-uploads) | only docs in their taught courses | their own + reviewable courses |
| admin    | anywhere                                | everything pending            | everything                                             |

Hidden statuses (`draft` / `pending_review` / `rejected`) are filtered out of lists, search, facets, and autocomplete for anyone who isn't the uploader/owner, a course lecturer, or an admin.

## Tech stack

- **Monorepo:** pnpm workspaces (`artifacts/*`, `lib/*`, `scripts/`).
- **API server:** Node 20 + Express 5 + TypeScript. `artifacts/api-server`.
- **Web client:** React 18 + Vite + Wouter + TanStack Query + Tailwind + shadcn/ui. `artifacts/web`.
- **Database:** PostgreSQL via Prisma 6 (`lib/db/prisma`). Migrations live in `lib/db/prisma/migrations/`.
- **API contract:** OpenAPI 3 spec in `artifacts/api-spec/`, codegen via Orval produces `@workspace/api-client-react` (React Query hooks + typed schemas).
- **Storage drivers:** `local` filesystem or `gcs` (Google Cloud Storage) — selected by `STORAGE_DRIVER` or auto-picked from env.
- **Tests:** Vitest (unit + DB-integration) for the API server; Playwright for end-to-end smoke.

## Repository structure

```
.
├── artifacts/
│   ├── api-server/         # Express 5 API (routes, services, repos, vitest tests)
│   ├── web/                # React + Vite client + Playwright e2e specs (tests/sprint2-smoke.spec.ts)
│   └── mockup-sandbox/     # Component preview server (canvas)
├── lib/
│   ├── api-spec/           # OpenAPI 3 spec + Orval config
│   ├── api-client-react/   # Codegen-emitted React Query hooks + types
│   ├── api-zod/            # Codegen-emitted Zod schemas
│   ├── db/                 # Prisma schema + migrations + generated client
│   └── storage/            # local + gcs storage drivers
├── scripts/                # repo-level scripts (regression matrix wrappers, etc.)
├── replit.md               # in-depth project notes (per-milestone changelog, baselines)
└── README.md
```

## Environment setup

- **Node** 20+, **pnpm** 9+.
- **PostgreSQL** reachable via `DATABASE_URL`. On Replit, the built-in Postgres add-on is wired automatically.
- **Required secrets:** `SESSION_SECRET`, `SIGNED_URL_SECRET` (any long random strings).
- **Storage driver:**
  - `STORAGE_DRIVER=local` writes under `STORAGE_LOCAL_ROOT` (default `.data/storage`).
  - `STORAGE_DRIVER=gcs` (or auto-pick when `DEFAULT_OBJECT_STORAGE_BUCKET_ID` + `PRIVATE_OBJECT_DIR` are present) uses Replit's object storage; `PUBLIC_OBJECT_SEARCH_PATHS` enumerates the public-bucket fallback paths.
- **Replit notes:** workflows for `api-server`, `web`, and the mockup sandbox are pre-configured; ports are auto-assigned via `$PORT`. The Replit secrets pane is the canonical home for `SESSION_SECRET` / `SIGNED_URL_SECRET` / storage env vars.

## Common commands

> **Windows / local dev:** invoke pnpm via `corepack pnpm …` (no global shim needed), and load `.env` first (the app reads `process.env` directly). The repo includes `dev.ps1` which loads `.env`, starts Postgres in Docker, and launches the API + web. The root `typecheck`/`regression` npm scripts call `pnpm` recursively (which fails under cmd.exe), so on Windows run the package-level scripts via `corepack pnpm --filter … run …`. See the local hybrid setup in the project notes.

```bash
# install
pnpm install --frozen-lockfile

# typecheck the whole monorepo
pnpm run typecheck

# run every package's tests (currently only api-server registers `test`)
pnpm -r --if-present run test

# seed the demo dataset (idempotent)
pnpm --filter @workspace/api-server run seed:demo

# verify the demo dataset is internally consistent
pnpm --filter @workspace/api-server run seed:demo:verify

# run services locally (use the configured Replit workflows in the workspace)
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/web run dev

# Playwright smoke (drives the running api-server + web workflows)
PLAYWRIGHT_BASE_URL=https://$REPLIT_DEV_DOMAIN \
  pnpm --filter @workspace/web exec playwright test --grep "sprint 2 smoke"

# full regression gate: typecheck → recursive test → reseed → Playwright smoke
pnpm regression

# storage-driver matrix wrappers (export STORAGE_DRIVER for the run)
pnpm regression:local
pnpm regression:gcs

# Prisma
pnpm --filter @workspace/db run migrate        # apply migrations (deploy)
pnpm --filter @workspace/db run migrate:dev    # author a new migration
pnpm --filter @workspace/db run generate       # regenerate the Prisma client

# OpenAPI codegen (run after editing artifacts/api-spec/spec/*.yaml)
pnpm --filter @workspace/api-spec run codegen
```

## Demo accounts

All demo accounts use password **`Demo1234!`**. Run `pnpm --filter @workspace/api-server run seed:demo` to restore the documented state.

| Role | Email | Highlights |
|------|-------|-----------|
| Admin | `admin@knowledgebank.demo` | Global analytics, user management, full-corpus visibility |
| Lecturer | `maya.cohen@knowledgebank.demo` | CS101/CS220, review queue, course analytics |
| Lecturer | `daniel.levi@knowledgebank.demo` | IS310/IS420, review queue |
| Student | `noa.student@knowledgebank.demo` | Browse, upload → review, favorites, requests |
| Student | `amir.student@knowledgebank.demo` | Approved + rejected submissions, IS310 |
| Student | `yael.student@knowledgebank.demo` | IS310/IS420, near-quota upload experience |
| Restricted student | `restricted.student@knowledgebank.demo` | CS101-only restricted-visibility docs |
| Pending lecturer | `pending.lecturer@knowledgebank.demo` | Account awaiting admin approval |
| Disabled | `disabled.user@knowledgebank.demo` | Login rejected — demonstrates disabled accounts |

For a step-by-step walkthrough of all major flows see **[DEMO.md](DEMO.md)**.

## Test baseline

Validated at refinement-phase completion:

| Surface                                  | Result                |
| ---------------------------------------- | --------------------- |
| `pnpm install --frozen-lockfile`         | clean (lockfile matches) |
| `pnpm run typecheck`                     | pass (all packages)   |
| `pnpm -r --if-present run test`          | 302 / 302 pass        |
| `pnpm --filter @workspace/api-server run seed:demo:verify` | 22 / 22 pass |
| `pnpm regression:local` (Playwright)     | 2 / 2 pass (Replit)   |
| `pnpm regression:gcs`   (Playwright)     | 2 / 2 pass (Replit)   |

The Playwright steps in `regression` / `regression:local` / `regression:gcs` target `$REPLIT_DEV_DOMAIN` and the `gcs` driver, so they run in the Replit environment, not on a local box. Locally, the meaningful gate is `typecheck` + `pnpm -r run test` + `seed:demo:verify` (all green above). Update these numbers in `README.md` *and* `replit.md` whenever the test count changes.

## Sprint 3 changelog

- **M0** — Regression gate (`pnpm regression`), driver-agnostic Playwright smoke, storage-driver baselines.
- **M1** — In-app notification bus + bell (polling, dedup on `recipient + type + subject`).
- **M2** — Review & approval workflow (state machine + audit + notifications + queue).
- **M3** — Enhanced search v2 (facets, autocomplete, ranked snippets) — sole search surface.
- **M4** — Metadata intelligence (extraction + suggestion chips, duplicate detection).
- **M5** — Analytics dashboards (admin overall + per-course).
- **M6** — Collaboration polish (reactions, favorites + `document.activity`).
- **M7** — Hardening & docs (feature-flag graduation, full validation matrix).
- **Completion + polish** — Student uploads routed through the review workflow; raw-SQL visibility parity for `draft`; notification dedup key restored to include `type`; README rewrite.

## Refinement phase changelog (post-Sprint-3)

A structured refinement pass turning the functional repo into a polished, intelligent platform (no architecture rewrite — all features extend the existing services):

- **P1 — Search foundation:** prefix/partial + trigram fuzzy fallback; haystack widened to filename/category/uploader/metadata.
- **P2 — Ranking & discovery:** denormalised engagement counters + configurable weighted score; relevance/recent/trending/viewed/downloaded/favorited sorts; engagement indicators.
- **P3 — Upload intelligence:** filename parser (material type / semester / year), fuzzy tag/category matching, apply-on-click suggestion chips.
- **P4 — Versioning & upload history:** `/uploads` page with per-document revision timeline (versioning core already existed).
- **P5 — Activity & audit:** favorite/reaction audit events; per-user "mine" filter; dashboard activity widget.
- **P6 — Prep Hub:** study collections (ordered items, notes, progress) + Quick Access + recommendations. New tables: `study_collections`, `study_collection_items`, `study_progress`.
- **P7 — Table & management UX:** wired bulk tag/category menus, clickable column-header sorting, sticky filter bar.
- **P8 — Dashboard intelligence:** Trending / Continue-studying widgets + admin Platform Insights.
- **P9 — UI polish:** keyboard focus rings, shared card grid, consistency.
- **Nav rework:** desktop "More" overflow menu; Activity logs moved into the admin Analytics tab; Prep Hub scoped to students/lecturers.
- **P10 — Docs & demo prep:** this update + demo seed now populates a Prep Hub collection/progress and syncs engagement counters.

## Known limitations / future work

- No websocket push or email digest for notifications (polling-only).
- No OCR for scanned PDFs — only digital text extraction.
- No semantic / vector search — full-text only (`pg_trgm` + tsvector).
- No multi-reviewer approval quorum.
- No scheduled analytics exports (CSV download is on-demand only).
