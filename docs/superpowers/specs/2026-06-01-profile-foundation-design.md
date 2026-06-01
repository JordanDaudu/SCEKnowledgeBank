# Profile Foundation & Account Settings — design

**Date:** 2026-06-01
**Status:** Approved (pending spec review)
**Scope:** Sub-project **1 of 4** of the "User Profile Management + Approval Workflow" effort.
Later sub-projects (separate spec → plan → build): (2) Course membership management,
(3) Account deletion & orphaned files, (4) Upload permissions & approval overhaul.

## Problem / goal

There is no Profile page and no way for a user to manage their own account. Add a
dedicated Profile page for **personal account management only**, with an editable
**username** handle and a **profile avatar**, and read-only email / role / join date.
Harden the backend so a user can never change their own role or email (privilege
escalation), with an audit trail on any attempt.

The Profile page must NOT contain My Uploads, approval queues, moderation
dashboards, or file-management screens — those stay in their existing modules.

## Context (what already exists — integrate, don't duplicate)

- **User model** (`lib/db/prisma/schema.prisma`): has `displayName`, `email`
  (case-insensitive, partial-unique where `deletedAt IS NULL`), `passwordHash`,
  `primaryRoleId`, `status` (ACTIVE/PENDING_APPROVAL/DISABLED), `studentId`,
  `lecturerId`, `department`, `usedBytes`, `quotaBytes`, `createdAt`, `updatedAt`,
  `deletedAt`. **No `username`, no avatar fields.**
- **Roles**: `Role` + `UserRole` + `User.primaryRoleId`. `AuthenticatedUser`
  (`artifacts/api-server/src/middlewares/auth.ts`) exposes `primaryRole` + `roles[]`.
  Registration (`auth.service.ts`) sets the role server-side; the client may only
  pass `student`/`lecturer` (admin rejected at the schema). **No endpoint anywhere
  changes a user's role today** — role is already effectively immutable; this
  sub-project keeps it that way and adds tamper auditing.
- **Current-user DTO**: `GET /me` returns `displayName`, `email`, `primaryRole`,
  `roles`, `enrollments`, etc. (consumed by `useGetCurrentUser`).
- **Storage + image pipeline**: `getStorage()` adapter (local/gcs) with `put`;
  `sharp`-based image processing already used for document thumbnails
  (`documents/metadata.service.ts`). Reuse both for avatars.
- **Audit**: `audit.service.record(actorUserId, action, entityType, entityId, metadata)`
  — append-only, non-throwing. Admins view audit via Analytics → Activity logs
  (`/activity`); labels in `artifacts/web/src/lib/activity-format.ts`.
- **Nav / user menu**: `artifacts/web/src/components/layout.tsx` renders a letter
  badge from `displayName.charAt(0)`; there is no Profile link.

## Decisions (from brainstorming)

1. **`username` is a NEW unique handle alongside `displayName`.** `displayName`
   (full name) is unchanged and keeps driving comments, @mentions, nav name, and
   admin lists — no churn there, no regressions.
2. **Username is stored canonical-lowercase.** Input accepted case-insensitively,
   canonicalized to lowercase; this makes uniqueness case-insensitive by storage.
3. Avatar shown on the **Profile page + nav header** only for now; comment/mention
   avatars are deferred (YAGNI).
4. Avatars served via an **authenticated** endpoint (the whole app is auth-gated).
5. Profile page ships **without** the Delete Account button (added in sub-project 3)
   — no dangling stub.
6. Image cropping is **deferred** (your spec marks it optional).

## Non-goals (explicitly out of scope here)

Course add/remove (sub-project 2); account deletion / soft-delete flow / orphaned
files (sub-project 3); any upload or approval changes (sub-project 4);
comment/mention avatars; avatar cropping; password change; admin editing of other
users' profiles.

## Data model (one Prisma migration)

Add three nullable columns to `User`:

- `username String?` — canonical-lowercase handle.
- `avatarStoragePath String?` — storage key for the normalized avatar.
- `avatarMimeType String?` — always `image/webp` (we normalize), but stored for
  correctness/serving.

**Case-insensitive uniqueness, soft-delete-aware** — mirror the existing email
index. Prisma cannot express a partial unique index, so it goes in the migration
SQL (not `@@unique`):

```sql
CREATE UNIQUE INDEX users_username_unique
  ON users (username) WHERE deleted_at IS NULL;
```

(Username is already canonical-lowercase, so a plain column unique gives
case-insensitive uniqueness. Partial `WHERE deleted_at IS NULL` lets a freed
handle be reused after an account is deleted, consistent with email.)

**Backfill (same migration, before creating the index)** for existing rows where
`deleted_at IS NULL` and `username IS NULL`:

1. Seed from the email local-part, canonicalized:
   `regexp_replace(lower(split_part(email,'@',1)), '[^a-z0-9_]', '_', 'g')`.
2. Enforce min length 3 by right-padding short values (e.g. append `_u`) and cap
   at 30 chars.
3. De-duplicate with a window function: rows sharing a candidate get a numeric
   suffix by `row_number() OVER (PARTITION BY candidate ORDER BY created_at)`
   (rn>1 → append `_<rn>`), re-capping length to 30.

The migration is idempotent on re-run (only touches `username IS NULL`). Existing
data remains valid; `displayName`, email, roles, enrollments untouched.

## Username management

- **Validation (server-side, authoritative):** canonicalize to lowercase, then
  require `^[a-z0-9_]{3,30}$`; reject if in the reserved set; reject if taken
  (case-insensitive, excluding soft-deleted and excluding the caller's own current
  username so re-saving is a no-op).
- **Reserved names:** a constant array in a shared api-server module
  (`admin, administrator, system, support, root, api, me, null, undefined, anonymous,
  moderator, staff`), easily extended later.
- **Live availability:** `GET /me/username-available?username=<v>` (auth required)
  → `{ available: boolean, reason?: "invalid" | "reserved" | "taken" }`. Frontend
  debounces (~300ms) and shows inline status; the field's validity never relies on
  the frontend alone — the PATCH re-validates.
- **Change flow:** `PATCH /me/profile { username }` → validate → persist → audit
  `user.username_changed` with `{ from, to }`. Returns the updated CurrentUser DTO.

## Avatar management

- **Upload/replace:** `PUT /me/avatar` (multipart, field `file`). Validate input is
  `image/jpeg | image/png | image/webp` and ≤ 5 MB (reject with a clear message and
  a stable `errorCode` otherwise). Then normalize with `sharp`: resize cover to
  256×256 and encode **webp**; store via `getStorage().put` at
  `avatars/<userId>.webp`; set `avatarStoragePath` + `avatarMimeType='image/webp'`.
  Audit `user.avatar_changed { action: "set" }`.
- **Remove:** `DELETE /me/avatar` → clear the columns (best-effort delete of the
  stored object), audit `user.avatar_changed { action: "remove" }`.
- **Serve:** `GET /users/:id/avatar` (auth required; any authenticated user may
  fetch any user's avatar so it can render to others later). Streams the stored
  bytes with `Content-Type` and cache headers (`Cache-Control: private, max-age=300`
  + an ETag derived from the storage path). 404 when the user has no avatar →
  frontend falls back to the existing letter badge.
- **DTO:** `avatarUrl` is `"/api/users/<id>/avatar?v=<short-hash-of-storagePath>"`
  when an avatar exists, else `null`. The `v` param busts cache after replace.

## Profile page + navigation

- **Route:** new `/profile` (auth required, all roles) in `App.tsx`; a **Profile**
  link in the user-menu area of `layout.tsx` (desktop dropdown + mobile sheet).
- **Layout (role-aware), per spec section 7:**
  - **Student / Lecturer:** avatar (with upload/replace/remove), username (editable
    with live availability), email (read-only), role (read-only badge), joined date.
    A clearly-marked placeholder region reserved for **Courses** (sub-project 2) and
    **Delete Account** (sub-project 3) — rendered as nothing for now (no stub button).
  - **Admin:** avatar, username, email, role only.
- **States:** loading skeletons, save success toast, inline validation errors,
  avatar upload progress/error, disabled save while pending. Fully responsive
  (desktop/tablet/mobile), following the existing design system (shadcn/Tailwind).
- After any successful mutation, invalidate the `useGetCurrentUser` query so the
  nav + page reflect changes immediately.

## API / DTO changes & codegen

- Extend **CurrentUser** (`GET /me`) DTO with `username: string | null`,
  `avatarUrl: string | null`, `createdAt: string`.
- New endpoints (OpenAPI → orval regenerate):
  - `GET /me/username-available`
  - `PATCH /me/profile`
  - `PUT /me/avatar` (multipart), `DELETE /me/avatar`
  - `GET /users/:id/avatar`
- All write endpoints derive the target user from **`req.authUser.id`** — never a
  client-supplied id.

## Security — role & email immutability (hard requirement)

- `PATCH /me/profile` accepts **only** `username`. Implementation:
  1. **Tamper detection first:** if the request body contains any forbidden key,
     respond `403` with a proper authorization error **and** write an audit entry
     capturing actor, the attempted key/value, and timestamp. The action is chosen
     by key: `role`/`roles`/`primaryRole`/`primaryRoleId`/`roleId` →
     `user.role_change_attempt`; `email` → `user.email_change_attempt`; any other
     forbidden key (`status`, `id`, `userId`) → `user.profile_tamper_attempt`.
  2. Otherwise strict-validate the allowed `{ username }` shape (Zod `.strict()`),
     `400` on anything malformed.
- Authorization for all profile reads/writes uses the authenticated server-side
  identity and role; the client-provided role is never trusted. Existing admin
  tooling (approve/disable) is untouched; this sub-project adds **no** role-mutation
  path.

## Audit (reuse existing `audit.record`)

New action strings (entityType `user`, entityId = the user's id), with labels added
to `activity-format.ts`:

- `user.username_changed` — `{ from, to }`
- `user.avatar_changed` — `{ action: "set" | "remove" }`
- `user.role_change_attempt` — `{ attempted }` (security)
- `user.email_change_attempt` — `{ attempted }` (security)
- `user.profile_tamper_attempt` — `{ attempted }` (security; other forbidden keys)

No notifications in this sub-project.

## Testing

- **Service unit tests** (vitest, real DB): username canonicalization + validation
  (length, charset, reserved, case-insensitive uniqueness, self-rename no-op);
  availability endpoint reasons; profile update happy path + audit written.
- **Security tests:** `PATCH /me/profile` with `role`/`email`/`status` keys →
  `403` + the corresponding audit entry recorded; confirm the user's role/email are
  unchanged in the DB.
- **Avatar tests:** reject wrong mime / >5 MB; accept jpg/png/webp; verify
  normalized object stored and columns set; remove clears columns; `GET
  /users/:id/avatar` returns bytes for a user with an avatar and 404 otherwise.
- **Migration check:** backfill produces unique, valid usernames for the seeded
  demo users; re-running the seed/migration is idempotent.
- Full `pnpm typecheck` after codegen; web typecheck for the Profile page.

## Backwards compatibility

Additive columns (nullable) + one new index + new endpoints; no existing column or
endpoint changes. `displayName`-based features (comments, mentions, nav name, admin
lists) are untouched. Sprint-2/3 behavior is unaffected.
