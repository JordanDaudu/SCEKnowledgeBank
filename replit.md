# Knowledge Bank

A scholarly document repository for university communities — upload, browse, search, preview, download, discuss, and request academic materials with role-based access (student / lecturer / admin).

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/web run dev` — run the web frontend
- `pnpm --filter @workspace/db run generate` — generate a new SQL migration from the Prisma schema
- `pnpm --filter @workspace/db run migrate` — apply pending SQL migrations (creates `pg_trgm` first)
- `pnpm --filter @workspace/api-server run seed` — populate the rich Sprint-2 demo dataset (aliased to `seed:demo`; idempotent)
- `pnpm --filter @workspace/api-server run seed:demo:verify` — assert the demo dataset is healthy (counts, FK integrity, FTS hits)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-server run test` — vitest unit + service tests
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod from OpenAPI
- `pnpm --filter @workspace/db run push` — quick dev push of the schema (skips migrations; prefer `generate` + `migrate`)

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
- **Idempotent seed** uses deterministic upserts by natural keys so demos can be re-run safely.

## Product

- Login with quick-login chips for the three demo roles.
- Browse / search / filter documents (course code, lecturer, tags, material type, semester, year, full-text on title+description).
- Document detail with inline preview (signed URL), download, threaded comments, edit/delete for uploader+admin.
- Upload (lecturer/admin only) with multi-file batch, mime allowlist, size limit (413 on overflow). Duplicate filenames are accepted: the exact uploaded name is preserved on `documentFiles.originalFilename`, and a separate `displayFilename` is suffixed (`notes (2).pdf`, `notes (3).pdf`, …) so the user can tell them apart in lists.
- Material requests board with voting (toggle). Status changes (e.g. fulfill) are open to the request author, lecturers, and admins; editing the request title/description is restricted to the author or an admin. RBAC is enforced server-side in `requests.service.updateRequest`.
- Document versions panel on the detail page: lists every version (newest first) with uploader + change note, "Upload new version" for the doc's editor, and "Restore" on older versions. Restoring promotes the old blob to a new version row (history preserved) without re-billing the uploader's quota.
- Admin: user list with role management.

## User preferences

- **No emojis in UI.**

## Gotchas

- Demo emails (e.g. `admin@knowledgebank.demo`) use the `.demo` fake TLD — the `LoginRequest` schema validates `minLength` only, not `format: email`, so non-routable emails are accepted by design.
- After editing `lib/api-spec/openapi.yaml` always run `pnpm --filter @workspace/api-spec run codegen` and restart the api-server.
- The api-server uses `pnpm run build && pnpm run start` for `dev` (esbuild bundle), so code changes require a workflow restart.
- Default `.data/storage` is ephemeral on container rebuilds — switch to S3 for persistence.
