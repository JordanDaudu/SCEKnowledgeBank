# Knowledge Bank

A scholarly document repository for university communities — upload, browse, search, preview, download, discuss, and request academic materials with role-based access (student / lecturer / admin).

## Sprint-3 changelog

| Milestone | What shipped |
| --------- | ------------ |
| M0 | Regression gate (`pnpm regression`), driver-agnostic Playwright smoke spec, storage-driver matrix baselines. |
| M1 | In-app notification bus + bell (polling-only, idempotent on `(recipient, type, subjectType, subjectId)`). |
| M2 | Review & approval workflow (state machine on `documents.status`, reviewer queue, per-DTO `canSubmitForReview`/`canReview` flags). |
| M3 | v2 search surface — ranked snippets, facets, typed autocomplete (tags/courses/uploaders). |
| M4 | Smart-metadata extractor chain (language + keywords on `document_files`), duplicate-check & suggest-metadata upload pre-flight. |
| M5 | Workspace analytics — admin overview at `/admin/analytics`, course-scoped view at `/courses/:courseId/analytics`. |
| M6 | Collaboration & UX polish — comment reactions, document favorites + "Following" feed, request status transitions, mention-picker keyboard nav. |
| M7 | Hardening — graduated `FEATURE_NOTIFICATIONS` + `FEATURE_REVIEW` flags, retired legacy `GET /documents/suggestions` and the `q` parameter on `GET /documents`, quieted per-request 2xx access logs, refreshed docs. |
| Completion | Student uploads through the M2 review workflow (gated to enrolled courses, forced `status=draft`, optional `autoSubmitForReview` on `POST /documents/upload`); student-facing upload UX (filtered course list, amber review notice, auto-submit checkbox, single-file title field + suggestion-apply); request-board status dropdown opened to the request author; regression gate now runs every package's tests via `pnpm -r --if-present run test` and ships `regression:local` / `regression:gcs` matrix scripts. |
| Polish (pass 1) | Restrained semantic visual system: `StatusBadge` rewritten with amber/emerald/rose/slate per-status color tokens; `DocumentCards` uses sage course-tag + warm material-tag CSS utilities; request-board cards gain status-colored left border accent + redesigned vote column; analytics `StatTile` gets per-metric colored icon tiles (amber pending-review highlight); home hero gradient + per-action `iconClass`; `hover-elevate` CSS utility defined in `index.css`. `seed-demo` now prunes non-demo material requests (smoke-test artifacts) on every run. |
| Polish (pass 2) | Login: role-colored icon tiles (sky=student, forest green=lecturer, amber=admin) replacing generic outline buttons; dual-tone background gradient; improved tagline. Browse Library: `Library` icon accent in header, improved subtitle, results count with `font-semibold` number, animated "refreshing…" label. `FacetChips`: uppercase tracking section labels, semantic per-dimension active colors (emerald for course, status-semantic for review states), `secondary` variant for inactive chips. `BrowseStates`: colored icon backgrounds on empty/no-results/error states (`Search` icon for no-results), polished numbered pagination replacing simple prev/next. `RecentlyViewedStrip`: card-style container with border, colored Clock icon bg, hover-elevate chips. `BrowseFilters` `FilterChip`: primary-tinted pill with `×` replacing secondary `Badge`. Review Queue: `ShieldCheck` amber icon tile header, subtitle, polished "Queue is clear" empty state with emerald checkmark, `course-tag` CSS class on course codes. Upload: numbered step circles (①②③) in card headers, `HardDrive` icon tile on quota card, stronger dropzone border with icon bg + file-type hint, step-3 "Review & Upload" section with live file count + `size="lg"` submit button, tag chips replaced with custom toggle buttons. |

## Refinement phase changelog (post-Sprint-3)

Structured refinement — extend existing services, no architecture rewrite.

| Phase | What shipped |
| ----- | ------------ |
| P1 Search foundation | Prefix-aware tsquery (`tok:*`) + trigram `word_similarity` fuzzy fallback in `search.service`; FTS haystack widened to filename / category / uploader / smart-metadata (migration `20260528000000`). |
| P2 Ranking & discovery | Denormalised `view_count`/`download_count`/`favorite_count` on `documents` (migration `20260528100000`, maintained incrementally); `lib/ranking.ts` weighted score; sorts relevance/recent/trending/viewed/downloaded/favorited; engagement counts in DTO. |
| P3 Upload intelligence | `documents/filename-intel.ts` (material type / semester / year from filename); fuzzy tag/category match; `suggest-metadata` response + UI extended. |
| P4 Versioning & upload history | `/uploads` Upload History page + per-document revision timeline; `currentVersion` on DTO. (Versioning core pre-existed.) |
| P5 Activity & audit | `document.favorite`/`unfavorite` + `comment.reaction` audit events (insert-only); `listActivity` `mine` filter; home activity widget. |
| P6 Prep Hub | New tables `study_collections` / `study_collection_items` / `study_progress` (migration `20260528200000`); collections CRUD + items/reorder/notes + progress + `/me/continue-studying`; `/prep-hub` + collection detail UI; recommendations (`/me/recommendations`) reusing P2 ranking. |
| P7 Table & management UX | Wired bulk tag/category menus (latent bug), clickable column-header sorting, sticky filter bar. |
| P8 Dashboard intelligence | Trending + Continue-studying widgets; admin Platform Insights (reuses cached analytics overview). |
| P9 UI polish | Keyboard focus rings, shared `DocMiniGrid`, consistency. |
| Nav rework | Desktop "More" overflow menu; Activity logs moved into the admin Analytics page (Overview / Activity logs tabs); Prep Hub scoped to students/lecturers; home Recent-activity widget admin-only. |
| P10 Docs & demo | README/DEMO/replit updated; `seed-demo` now seeds a Prep Hub collection + study progress for Noa and backfills engagement counters from seeded events. |

Local-dev note: built/validated on Windows via `corepack pnpm` with `.env` loaded; the repo's `pnpm-workspace.yaml` was fixed to ship the win32-x64 native binaries and `lib/storage` was restored (it had been dropped from `origin/main`). `gcs` is a fail-fast stub locally. The `regression` Playwright + `regression:gcs` steps run on Replit, not on a local box.

### Endpoint inventory (post-M7)

Source of truth is `lib/api-spec/openapi.yaml`; the list below is a hand-curated index.

- **Auth:** `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`.
- **Users / admin:** `GET /users`, `GET /users/search`, `GET /users/pending-lecturers`, `POST /users/:id/approve`, `POST /users/:id/disable`, plus mirrored admin paths `GET /admin/users/pending-lecturers`, `POST /admin/users/:userId/approve`, `POST /admin/users/:userId/disable`.
- **Documents (list / detail / upload):** `GET /documents` (filters / sort / pagination — **no `q`**, full-text moved to v2 search), `POST /documents/upload` (multipart), `GET /documents/recent`, `GET /documents/:id`, `PATCH /documents/:id`, `DELETE /documents/:id`, `GET /documents/:id/thumbnail`, `GET /documents/:id/preview-token`, `GET /documents/:id/download-token`, `GET /documents/:id/preview`, `GET /documents/:id/download`.
- **Versions:** `GET /documents/:id/versions`, `POST /documents/:id/versions`, `POST /documents/:id/versions/:versionId/restore`.
- **Search (v2):** `GET /v2/documents/search`, `GET /v2/documents/search/facets`, `GET /v2/documents/autocomplete`, `GET /v2/documents/duplicate-check`, `POST /v2/documents/suggest-metadata`.
- **Review:** `GET /documents/pending-review`, `POST /documents/:id/submit-for-review`, `POST /documents/:id/approve`, `POST /documents/:id/reject`.
- **Comments + reactions:** `GET /documents/:id/comments`, `POST /documents/:id/comments`, `PATCH /comments/:commentId`, `DELETE /comments/:commentId`, `POST /comments/:commentId/reactions/:kind`, `DELETE /comments/:commentId/reactions/:kind`.
- **Favorites / following:** `POST /documents/:id/favorite`, `DELETE /documents/:id/favorite`, `GET /me/favorites`.
- **Material requests:** `GET /requests`, `POST /requests`, `PATCH /requests/:id`, `POST /requests/:id/vote` (toggle).
- **Notifications:** `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/:id/read`, `POST /notifications/read-all`.
- **Taxonomy:** `GET /courses`, `GET /tags`, `GET /categories`.
- **Quota:** `GET /storage/quota/me`.
- **Analytics:** `GET /admin/analytics/overview`, `GET /courses/:courseId/analytics`.

### Feature flag inventory (post-M7)

All Sprint-3 feature flags were graduated in M7. There are **no `FEATURE_*` env flags** in `lib/env.ts` or `import.meta.env.VITE_FEATURE_*` references in the web app today. New flags should be reintroduced only for genuinely-in-flight surfaces and documented here when added.

### M7 hardening sign-off — security scan

Run against `main` on 2026-05-27 via the in-repo scanners (`runDependencyAudit`, `runSastScan`, `runHoundDogScan`):

| Scanner | Critical | High | Moderate | Notes |
| ------- | -------- | ---- | -------- | ----- |
| `runDependencyAudit` (osv-scanner) | 0 | 0 in app code (8 in transitive deps) | 8 | All 8 highs are transitive: `fast-uri@3.1.0` x2, `lodash@4.17.23`, `path-to-regexp@8.3.0` (Express 5), `picomatch@2.3.1` + `@4.0.3`, `uuid@8.3.2` + `@9.0.1`. None exploitable in current request path; tracked as a separate "Patch known-vulnerable transitive dependencies" follow-up. |
| `runSastScan` (semgrep) | 0 | 0 | 1 | The single MEDIUM is `unsafe-dynamic-method` in `artifacts/mockup-sandbox/src/App.tsx` — dev-only canvas preview, loader keys come from a Vite glob over a controlled fixtures directory (not user input). Documented in `threat_model.md` "Scan Anchors". |
| `runHoundDogScan` (privacy / dataflow) | 0 | 0 | 0 | Clean. |

**Critical/High in application code: 0.**

### M7 hardening sign-off — load test

Targeted load test against the busiest new Sprint-3 endpoints, run on 2026-05-27 against a freshly-seeded demo DB with both workflows up (single api-server process, default `STORAGE_DRIVER` auto-pick, `LOG_LEVEL=info` so the new M7 access-log demotion is in effect). Test driver: `/tmp/loadtest.mjs` (Node 24 `fetch`, cookie-authenticated, warm-up shot before each run). All runs returned 0 errors.

| Endpoint | Auth | Concurrency × Total | RPS | p50 | p95 | p99 | Max |
| -------- | ---- | ------------------- | --- | --- | --- | --- | --- |
| `GET /v2/documents/search?q=algebra&pageSize=20` | admin | 16 × 200 | 240 | 52 ms | 184 ms | 252 ms | 256 ms |
| `GET /v2/documents/search?q=lecture&pageSize=20` | student | 16 × 200 | 268 | 54 ms | 103 ms | 141 ms | 153 ms |
| `GET /notifications?pageSize=20` | student | 32 × 400 | 451 | 63 ms | 112 ms | 146 ms | 159 ms |
| `GET /notifications/unread-count` | student | 64 × 800 | 477 | 127 ms | 172 ms | 198 ms | 239 ms |

The admin search run has the longest tail because the visibility predicate degenerates to "all rows" so `ts_headline` runs against the largest result set; even there p95 stays under 200 ms. Re-run with `node /tmp/loadtest.mjs` (recreate the script from `git log` if it has been cleaned up) against a fresh seed to refresh the baseline.

## Sprint-3 M4 — Smart metadata & document intelligence

Every uploaded `DocumentFile` is now passed through a pluggable extractor chain: the per-MIME byte extractor produces `extractedText`, then post-processors fill in `language` (en/es/fr/de/it/pt via stopword classifier) and `keywords` (top frequency terms, stopword + length filtered). Both fields are persisted on `document_files` and surfaced in the document detail metadata strip.

The upload form pre-flights each first-queued file against two helper endpoints:

- `GET /api/v2/documents/duplicate-check?checksum=…` — visibility-scoped sha256 lookup; renders an amber "Possible duplicate" banner linking to the original.
- `POST /api/v2/documents/suggest-metadata` (multipart) — runs the real extractor chain plus dedup, then matches keywords against existing `Tag` / `Category` rows (existing-only — no auto-create). Suggestions appear as clickable chips in the Metadata card.

Suggestion fetches are best-effort: a failed extract clears the panel without blocking the upload.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/web run dev` — run the web frontend
- `pnpm --filter @workspace/db run generate` — generate a new SQL migration from the Prisma schema
- `pnpm --filter @workspace/db run migrate` — apply pending SQL migrations (creates `pg_trgm` first)
- `pnpm --filter @workspace/api-server run seed` — populate the rich demo dataset (aliased to `seed:demo`; idempotent — safe to re-run against a live DB; also prunes any non-demo material requests, e.g. smoke-test artifacts)
- `pnpm --filter @workspace/api-server run seed:demo:verify` — assert the demo dataset is healthy (23 checks: user accounts, enrollments, courses, tags, document titles, file presence, comments, review-workflow statuses, favorites, reactions, material requests, Prep Hub collections, analytics FTS)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-server run test` — vitest unit + service tests
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod from OpenAPI
- `pnpm --filter @workspace/db run push` — quick dev push of the schema (skips migrations; prefer `generate` + `migrate`)
- `pnpm regression` — Sprint-3 regression gate: typecheck → `pnpm -r --if-present run test` (every workspace package — currently only api-server has a `test` script, but new packages get caught automatically) → reseed demo → Playwright `sprint 2 smoke` spec (lecturer upload→preview→comment + student request-board upvote). Reuses the running `api-server` and `web` workflows; baselines below.
- `pnpm regression:local` — same gate with `STORAGE_DRIVER=local` exported into the run.
- `pnpm regression:gcs`   — same gate with `STORAGE_DRIVER=gcs` exported into the run.

### Regression baselines

Run on a freshly-seeded demo DB, both workflows up.

| Driver                              | Wall   | Unit tests        | Seed verify      | Playwright smoke |
| ----------------------------------- | ------ | ----------------- | ---------------- | ---------------- |
| `local` (`STORAGE_DRIVER=local`)    | ~60 s  | 302 / 302 pass    | 23 / 23 pass     | 2/2 pass         |
| `gcs` (auto-pick, default in Replit)| ~55 s  | 302 / 302 pass    | 23 / 23 pass     | 2/2 pass         |

To switch drivers for a regression sweep, the wrapper scripts (`pnpm regression:local`, `pnpm regression:gcs`) export `STORAGE_DRIVER` into the vitest run. The Playwright leg drives the *running* `artifacts/api-server: API Server` workflow, so to make the end-to-end leg actually exercise the other driver you must additionally:

1. Set or unset `STORAGE_DRIVER` (use the Secrets pane → `development` scope, or `setEnvVars`). Unset = auto-pick `gcs` when `DEFAULT_OBJECT_STORAGE_BUCKET_ID` + `PRIVATE_OBJECT_DIR` are present; otherwise `local`.
2. Restart the `artifacts/api-server: API Server` workflow so the new env is read by `lib/env.ts`.
3. Run `pnpm regression` (or the matrix wrapper).

Known limitation: the GCS leg can only run when `DEFAULT_OBJECT_STORAGE_BUCKET_ID` + `PRIVATE_OBJECT_DIR` are set in the environment; otherwise `lib/env.ts` falls back to the local driver and the run silently mirrors `regression:local`.

The smoke spec is driver-agnostic: it uploads a unique-bytes PDF, drives the upload→detail→comment flow through the public API, and votes on a freshly-created request — so reruns against a warm DB stay green.

### Required env

- `DATABASE_URL` — Postgres connection string (auto-provisioned in Replit)
- `SESSION_SECRET` — **override in production** (dev default is hardcoded for convenience)
- `SIGNED_URL_SECRET` — **override in production** (used to HMAC preview/download tokens)
- See `.env.example` for the full list (upload size, storage driver, mime allowlist, etc.)

### Demo accounts (after seed)

All demo users share the password `Demo1234!`.

- `admin@knowledgebank.demo` (Admin User)
- `maya.cohen@knowledgebank.demo` (Dr. Maya Cohen — lecturer)
- `daniel.levi@knowledgebank.demo` (Prof. Daniel Levi — lecturer)
- `pending.lecturer@knowledgebank.demo` (pending lecturer)
- `noa.student@knowledgebank.demo`, `amir.student@knowledgebank.demo`, `yael.student@knowledgebank.demo` (students)
- `restricted.student@knowledgebank.demo` (student with restricted access)
- `disabled.user@knowledgebank.demo` (disabled account — cannot log in)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Web: React 19 + Vite 7 + Tailwind + shadcn/ui + TanStack Query
- API: Express 5, cookie-based sessions via `connect-pg-simple`
- DB: PostgreSQL + Prisma ORM
- Validation: Zod (`zod/v4`), Prisma-generated TS types
- API codegen: Orval (OpenAPI → typed hooks + Zod schemas)
- File storage: pluggable driver (`local` default at `.data/storage`, S3 stub ready)
- Build: esbuild (CJS bundle)

## Where things live

- API contract: `lib/api-spec/openapi.yaml` (source of truth — re-run codegen after edits)
- DB schema: `lib/db/prisma/schema.prisma` (Prisma is the only ORM — migrations live under `lib/db/prisma/migrations/`)
- Generated TS hooks: `lib/api-client-react/src/generated/api.ts`
- Generated Zod schemas: `lib/api-zod/src/generated/api.ts`
- API routes: `artifacts/api-server/src/routes/`
- API libs (auth, storage, signed URLs, audit, errors): `artifacts/api-server/src/lib/`
- Seed scripts: `artifacts/api-server/src/scripts/seed-demo.ts` (default `seed`), `seed-demo.verify.ts` (post-seed integrity check)
- Web pages: `artifacts/web/src/pages/`

## Architecture decisions

- **Cookie sessions, not JWT.** Sessions persisted in Postgres (`session` table) via `connect-pg-simple`; the web app uses `credentials: include` and never sees raw tokens.
- **Signed-URL HMAC tokens** for `/preview` and `/download`. Token payload binds `{documentId, action, userId, exp}`; the streaming endpoints verify the HMAC and TTL. Treat tokens as short-lived bearer credentials (TTL via `SIGNED_URL_TTL_SECONDS`, default 5 min). A request without a token, or with an expired/tampered one, returns **401** — never 200 with empty bytes.
- **Race-safe voting on material requests.** The vote insert is gated by a unique index on `(user_id, request_id)` and uses `ON CONFLICT DO NOTHING`; the repository returns a boolean and the service surfaces a clean 409 on duplicates, even under concurrent calls. There is no read-then-write window where two requests can both succeed.
- **Zod-validated environment.** `artifacts/api-server/src/lib/env.ts` parses `process.env` once at boot; missing/short secrets in production fail fast with a readable error. All callers import from `env` rather than touching `process.env` directly.
- **Shared material-type constant.** `artifacts/web/src/lib/material-types.ts` is the single source of truth for the dropdown values; the upload form, browse filters, and document-detail edit modal all consume it (no inline arrays).
- **Course-aware visibility model.** `public` docs visible to any authenticated user; `restricted` docs visible only to admins and users enrolled in the document's course (no uploader/owner bypass — losing the enrollment loses read access); `private` docs visible only to uploader, owner, or admin. The same predicate (`permissions.service`) gates list queries, search suggestions, detail fetch, comments, recently-viewed, signed-URL issuance, and material-request visibility/voting/creation.
- **Storage abstraction.** All file IO goes through `getStorage()` (`put`, `getStream`). Local driver is default; an S3 driver can be added without route changes.
- **One API-URL helper on the web.** The server returns relative signed URLs (`/api/documents/:id/preview?token=...`). The web app resolves them through `artifacts/web/src/lib/api-url.ts` which prefixes `VITE_API_BASE` when set, so the iframe `src`, the download `window.open`, and the upload XHR all hit the API origin even when the web and API are served from different hosts. There are no hardcoded `/api/...` strings in pages.
- **Soft deletes** for documents and comments (`deletedAt`); nested comment threads are reassembled in-app from a flat parent-id list. Deleting a document releases the summed bytes of all its versions from the uploader's `users.usedBytes` in the same transaction (`softDeleteDocumentAndReleaseQuota`), so the `/storage/quota/me` snapshot reflects the freed space immediately. **TODO (sprint-3):** background reaper to hard-delete blobs after a grace period and reconcile the counter against actual object-storage usage.
- **Linear document versioning (US-5).** Each row in `document_files` is a version; `version_number` is monotonic per document (composite index `(document_id, version_number DESC)`). Restoring an older version inserts a *new* version row that reuses the same `storage_path` (the blob is shared, not copied) and is flagged `countTowardQuota: false` so the uploader's quota is never double-billed. Old versions are never overwritten, so download tokens against a historical `versionId` still work. **TODO (sprint-3):** diff/preview between versions, retention policies, cloud-storage cold-tier for old versions.
- **Centralised quota policy (US-10).** `services/quota.service.ts` is the single source of truth for "how much can this user upload". Per-user `users.quota_bytes` overrides win; otherwise role-based defaults apply (`DEFAULT_STUDENT_QUOTA_MB` = 1 GB, `DEFAULT_LECTURER_QUOTA_MB` = 10 GB, admin = sentinel ~8 EB). When a user has multiple roles, the most generous tier wins. Upload pipeline and new-version pipeline both gate through `quotaService.canFit`. **TODO (sprint-3):** per-course quotas, soft-warning thresholds, billing-tier integration.
- **Centralised policy permissions (US-34).** `services/permissions.service.ts` exposes the full vocabulary of can-do helpers (`canView`, `canEdit`, `canDelete`, `canComment`, `canModerateCommentOnDocument`, `canEditComment`, `canDeleteComment`, `canManageVersions`, `canUpload`, `canUploadToCourse`). Routes and services consult these — there are no inline ownership checks left in the comment or version paths. Comment edits are author-only on purpose; moderate-delete is allowed for admins and the course lecturer but moderate-edit is intentionally not (you cannot rewrite someone else's words).
- **Audit log** captures auth, uploads, edits, deletes, comments, requests, votes, and downloads (`audit_logs`).
- **In-app notifications (Sprint-3 M1, flag graduated in M7).** Polling-only bus: `notifications` table with a unique `(recipient, type, subjectType, subjectId)` key so producer hooks (`comment.mention`, `comment.reply` from `comments.service.createForDocument`, plus `document.approved` / `document.rejected` from the review workflow, plus `comment.reaction` and `document.activity` from M6) are idempotent. `notifications.service.notify(...)` is fire-and-forget, no-ops on self-notify, and swallows errors so a notify failure never breaks the originating write. Endpoints: `GET /api/notifications`, `GET /api/notifications/unread-count`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`. The web bell polls `unread-count` every 30 s; the dropdown list only polls while open. **TODO (later M):** websocket push, email digest, user preferences, batching.
- **Enhanced search & discovery (Sprint-3 M3, only search surface as of M7).** A dedicated `search.service` owns the v2 discovery surface behind a typed filter DSL (`SearchFilters` = legacy list filters + `uploaderId` + `status`). Three endpoints: `GET /api/v2/documents/search` returns `{items, total, page, pageSize}` with an optional per-row `headline` snippet rendered by Postgres `ts_headline` using sentinel markers (`[[KBMARK]]…[[/KBMARK]]`, NOT real `<mark>` tags) so the client html-escapes first and then swaps in `<mark>` — defends against html injection from arbitrary `search_text`. `GET /api/v2/documents/search/facets` returns counts grouped across course / materialType / semester / status / uploader for the current result set (active value INCLUDED in its own count — "drill-down" facets are a follow-up); id-bearing dims are hydrated with code+title / displayName so the UI labels chips without an extra round-trip. `GET /api/v2/documents/autocomplete?q=…` returns grouped suggestions over tags / courses / uploaders, scoped to documents the caller can already see (so we don't leak names that only attach to invisible docs). The legacy `GET /documents/suggestions` endpoint and the `q` parameter on `GET /documents` were retired in M7 — v2 search is the only full-text / autocomplete entry point. Web wiring: `browse.tsx` calls `useSearchDocumentsV2` (15 s staleTime, 30 s refetch) plus a *separate* lower-priority `useSearchDocumentsFacets` (60 s staleTime, no window-focus refetch) so results paint before facets; `FacetChips` toggles the matching filter on click and `SearchSuggestions` picks fill the corresponding filter (clearing the search bar) instead of stuffing the picked label into `q`. Snippet highlighting renders in both `DocumentCards` and `DocumentTable` via a shared `renderSnippetHtml` helper. The header search bar routes Enter → `/browse?q=…` and no longer renders an inline autocomplete dropdown.
- **Review & approval workflow (Sprint-3 M2, flag graduated in M7).** State machine on `documents.status` extends the legacy `draft|published|archived` set with `pending_review|approved|rejected`. Allowed transitions: `draft|rejected → pending_review` (`POST /api/documents/:id/submit-for-review`), `pending_review → approved` (`POST /api/documents/:id/approve`), `pending_review → rejected` (`POST /api/documents/:id/reject`, body `{reason}` — trimmed, 1–500 chars; required). Reviewer = admin OR lecturer of `doc.courseId`; submitter = uploader/owner OR canEdit; both flags are server-issued on every `Document` DTO (`canSubmitForReview`, `canReview`) so the UI never re-derives. Approve/reject stamp `reviewedBy` + `reviewedAt`, persist `reviewReason` on reject, audit-log the transition, and notify the uploader via the M1 bus (`document.approved` / `document.rejected`). Queue: `GET /api/documents/pending-review?page=&pageSize=` — admins see everything pending, lecturers see only pending docs in courses they teach, anyone else 403. Status-aware visibility: `draft`/`pending_review`/`rejected` docs are hidden from non-uploader/non-owner non-reviewers in list/filter/SQL paths (Prisma twin `permissions.visibleDocumentFilter` + raw-SQL twin `visibleDocumentFilterSql` both consume `REVIEW_HIDDEN_STATUSES`).
- **Quiet HTTP access logs (Sprint-3 M7).** `pino-http` is configured with a `customLogLevel` that demotes 2xx responses to `debug`; 4xx → `warn`, 5xx (and thrown errors) → `error`. With the default `LOG_LEVEL=info`, a normal dev or prod run no longer emits one access line per request, but failing requests still surface immediately. Override with `LOG_LEVEL=debug` to restore full per-request access logging.
- **Idempotent seed** uses deterministic upserts by natural keys so demos can be re-run safely.

## Product

- Login with quick-login chips for the three demo roles.
- Browse / search / filter documents (course code, lecturer, tags, material type, semester, year, full-text on title+description).
- Document detail with inline preview (signed URL), download, threaded comments, edit/delete for uploader+admin.
- Upload with multi-file batch, mime allowlist, size limit (413 on overflow). Duplicate filenames are accepted: the exact uploaded name is preserved on `documentFiles.originalFilename`, and a separate `displayFilename` is suffixed (`notes (2).pdf`, `notes (3).pdf`, …) so the user can tell them apart in lists. Lecturers and admins keep the legacy "upload-and-publish" path. Students (Sprint-3 completion) may upload too, but only to courses in their `enrollments[]`; the service force-sets `status=draft`, and an `autoSubmitForReview` flag on `POST /documents/upload` chains the upload into the M2 review workflow so the document lands in `pending_review` for a course lecturer (or admin) to approve or reject. Rejection reasons surface on the document detail page; approved student docs become publicly visible like any other document.
- Material requests board with voting (toggle). Status changes (e.g. fulfill) are open to the request author, lecturers, and admins; editing the request title/description is restricted to the author or an admin. RBAC is enforced server-side in `requests.service.updateRequest`.
- Document versions panel on the detail page: lists every version (newest first) with uploader + change note, "Upload new version" for the doc's editor, and "Restore" on older versions. Restoring promotes the old blob to a new version row (history preserved) without re-billing the uploader's quota.
- Admin: user list with role management.
- Analytics (Sprint-3 M5): admins get a workspace overview at `/admin/analytics` (totals, week-over-week views and downloads, top-viewed / top-downloaded docs over 30 days, active uploaders this week, 14-day daily upload chart, pending-review backlog). Lecturers get the same shape scoped to a course they teach at `/courses/:courseId/analytics`. Both are read-only, cached in-process for ~30s, and gated by `analytics.service` via the central `permissions.service` (students get 403).

## User preferences

- **No emojis in UI.**

## Gotchas

- Demo emails (e.g. `admin@knowledgebank.demo`) use the `.demo` fake TLD — the `LoginRequest` schema validates `minLength` only, not `format: email`, so non-routable emails are accepted by design.
- After editing `lib/api-spec/openapi.yaml` always run `pnpm --filter @workspace/api-spec run codegen` and restart the api-server.
- The api-server uses `pnpm run build && pnpm run start` for `dev` (esbuild bundle), so code changes require a workflow restart.
- Default `.data/storage` is ephemeral on container rebuilds — switch to S3 for persistence.
