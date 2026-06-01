# Account Deletion & Orphaned Files — design

**Date:** 2026-06-01
**Status:** Approved (proceeding to plan + build)
**Scope:** Sub-project **3 of 4** of the "User Profile Management + Approval Workflow" effort.
Builds on SP1 (Profile Foundation) and SP2 (Course Membership). Remaining: (4) Upload
permissions & approval overhaul.

## Problem / goal

Users cannot delete their own account; there is no recovery window, no admin
restore/purge, and a deleted user's identity would still surface on their files.
Add self-service **soft delete** with a 30-day recovery window, mask deleted users on
public surfaces, notify admins, and give admins a review workflow for the deleted
user's files (orphaned files) plus restore/purge.

## Context (what already exists — integrate, don't duplicate)

- **`User.deletedAt`** exists; **all 11** `usersRepo` read queries filter
  `deletedAt: null`, and `loadAuthenticatedUser` returns null for a soft-deleted user
  — so **soft-delete already disables login and hides the user from lists**. Email and
  username unique indexes are partial (`WHERE deleted_at IS NULL`), so deleting frees
  them for reuse.
- **Uploader display**: `documentsService.assembleDocuments` resolves uploaders via
  `usersService.loadUserSummaries` (filtered `deletedAt: null`) and already falls back
  to `{ displayName: "Unknown", … }` when a user is missing (documents.service.ts
  ~161–169). Comment authors have the same fallback (comments.service.ts ~64–71).
- **Leak to fix**: `collection-comments.repo` selects `author { id, displayName }` via a
  direct Prisma join with **no `deletedAt` filter** — a soft-deleted author's name would
  still render.
- **FK `onDelete`**: `Document.uploaderId`/`ownerId`, `Comment.authorId`,
  `MaterialRequest.requestedBy`, `StudyCollectionComment.authorId` are **Restrict**;
  `createdBy`/`updatedBy`/`reviewedBy` and `auditLogs`/`notificationsActed` are
  **SetNull**; `studyCollections`, `courseEnrollments`, `favorites`, `progress`,
  `userRoles`, `notificationsReceived`, `requestVotes`, `reactions` are **Cascade**.
  → A true row delete is blocked while the user owns documents/comments/requests, so
  "permanent removal" is implemented as **anonymization** (below).
- **Notifications**: `notify()` is single-recipient (loop per admin). No "users by
  role" query exists. `audit.record(...)` and the Analytics → Activity view exist.
- **Documents**: `countDocuments({ uploaderId })` exists; `updateDocumentById(id, patch)`
  can set `ownerId`/`uploaderId` but there is no service-level reassign. A soft-delete
  document path (`document.delete`) already exists.
- **Admin surfaces to mirror/extend**: `admin-users.tsx` (+ `routes/users.ts`,
  `auth.service` approve/disable) and the moderation pattern in
  `admin-prep-hub-moderation.tsx` (+ `moderation.service`/`routes`). `GET /users/search`
  exists (the @mention picker) for choosing a reassignment target.
- The Profile page (SP1/SP2) reserves space below the courses section for the delete
  control.

## Decisions

1. **Lifecycle**: `deletedAt` set = soft-deleted (recoverable). `anonymizedAt` set =
   purged (PII scrubbed, unrecoverable). The user **row always persists** so ownership
   FKs stay intact ("ownership preserved internally"); files are never deleted by the
   account flow.
2. **Permanent removal = anonymization** of the tombstone (scrub email, username,
   displayName, passwordHash, avatar; set `status=DISABLED`, `anonymizedAt=now()`), not
   a row delete. Admin-triggered, allowed only once `deletedAt` is **older than 30 days**.
3. **Recovery** within 30 days is **admin restore** (clear `deletedAt`) — the user can't
   self-restore because login is disabled while deleted. Restore is blocked after
   anonymization.
4. **Masking** uses `"Original uploader removed"` (documents) / `"Original author
   removed"` (comments). Reviewer/requester/search-facets already hide deleted users.
5. **Orphaned-files "Keep" = inaction** (no orphan-review table); Reassign or Delete
   removes a file from the list naturally. Reassign transfers `uploaderId`+`ownerId`
   to an active user; **no storage-quota recompute** (noted simplification).
6. Self-delete is allowed for any authenticated user server-side; the **UI shows it for
   students/lecturers** (per spec §7 admin profile has no delete).

## Non-goals

Automatic cron purge (admin-triggered with a 30-day guard; a script can be added
later); quota recompute on reassign; bulk reassign; the upload/approval overhaul (SP4).

## Architecture

### Data model (one migration)

Add `anonymizedAt DateTime?` (`@map("anonymized_at")`) to `User`. No other schema
change.

### Identity masking (3 small edits)

- `documents.service.ts` assembleDocuments fallback `displayName: "Unknown"` →
  `"Original uploader removed"` (a shared constant). The same map feeds reviewer
  fallback — leave reviewer text as a generic `"Removed user"` (internal-only surface).
- `comments.service.ts` author fallback `"Unknown"` → `"Original author removed"`.
- `collection-comments`: add `deletedAt` to the author select and, in the mapping,
  replace `displayName` with `"Original author removed"` when the author is deleted.

### Backend — repositories

- `users.repo.findAdminUserIds(): Promise<string[]>` — users with role `admin`,
  `deletedAt: null` (join `userRoles → role`).
- `users.repo.listDeletedWithRoles(): Promise<UserWithRoles[]>` — `deletedAt: { not:
  null }`, ordered by `deletedAt` desc, including roles + `deletedAt`/`anonymizedAt`.
- `users.repo.softDeleteUser(id)`, `restoreUser(id)`, `anonymizeUser(id, scrub)` — the
  three lifecycle writes (`anonymizeUser` sets scrubbed fields + `anonymizedAt` +
  `status=DISABLED`).
- `documents.repo.listByDeletedUploaders({ limit })` — documents (alive) whose
  `uploaderId` or `ownerId` belongs to a `deletedAt != null` user. Reuse
  `updateDocumentById` for reassign.

### Backend — services

- `account.service.ts` (new):
  - `deleteOwnAccount(user)`: if already deleted → no-op/`409`; count docs
    (`countDocuments({ uploaderId: user.id })`); `softDeleteUser`; audit
    `account.deleted` ({ fileCount }); notify each admin (`findAdminUserIds`) with type
    `account.deleted`, body incl. name/role/fileCount, url `/admin/orphaned-files`.
  - `restoreAccount(admin, userId)`: load (incl. deleted); `409` if `anonymizedAt` set;
    `restoreUser`; audit `account.restored`.
  - `purgeAccount(admin, userId)`: require `deletedAt` set and `deletedAt < now-30d`
    (else `400`); `anonymizeUser` (email→`deleted+<id>@removed.invalid`,
    username→null, displayName→`"Removed user"`, passwordHash→random, avatar→null);
    audit `account.purged`.
  - `listDeletedAccounts()`: `listDeletedWithRoles` → DTO with `fileCount` +
    `eligibleForPurge` (deletedAt older than 30d) + `anonymizedAt`.
- `orphaned-files.service.ts` (new) (or fold into `documents.service`):
  - `listOrphanedFiles()`: `listByDeletedUploaders` → document summaries.
  - `reassignDocument(admin, documentId, newOwnerId)`: validate the target user is
    active (`findById`); `updateDocumentById(documentId, { uploaderId, ownerId })`;
    audit `document.reassign` ({ from, to }).
  - Delete reuses the existing `documentsService.deleteDocument` (audited
    `document.delete`).

### Backend — routes

- `DELETE /me` (auth) → `deleteOwnAccount`, then `req.session.destroy` + clear cookie
  → 204.
- Admin (requireAdmin): `GET /admin/deleted-users`, `POST /admin/users/:id/restore`,
  `POST /admin/users/:id/purge`, `GET /admin/orphaned-files`,
  `POST /admin/orphaned-files/:documentId/reassign` `{ newOwnerId }`,
  `DELETE /admin/orphaned-files/:documentId`.
- OpenAPI: schemas `DeletedAccount`, `OrphanedFile`; the ops above; regenerate client.

### Frontend

- **Profile** (`profile.tsx`): a "Danger zone" Delete-account section below
  `CourseMembership` (non-admin only) → confirm dialog (type `DELETE`) → `DELETE /me`
  → clear session + `window.location = /login`.
- **Admin Users** (`admin-users.tsx`): new "Deleted accounts" section listing deleted
  users (name/email/role/deletedAt/fileCount) with **Restore** and **Purge** (Purge
  disabled until eligible).
- **Orphaned files** (new `admin-orphaned-files.tsx`, route `/admin/orphaned-files`,
  admin nav entry): list orphaned documents with **Reassign** (search active users via
  `GET /users/search`) and **Delete**; "Keep" = leave it.

### Audit / notifications

- Audit actions: `account.deleted`, `account.restored`, `account.purged`,
  `document.reassign` (+ existing `document.delete`).
- Notification type: `account.deleted`. Labels added to `activity-format.ts` and the
  notification bell `typeLabel`.

## Data flow

```
Profile (student/lecturer) → DELETE /me
  → account.deleteOwnAccount: countDocs → softDeleteUser(deletedAt=now)
     → audit account.deleted → for each admin: notify(account.deleted)
  → session destroyed → next request unauthenticated (deletedAt filter)
Public doc views → assembleDocuments → uploader not in summaries (deletedAt filtered)
  → "Original uploader removed"
Admin Users → GET /admin/deleted-users → Restore (clear deletedAt) | Purge (>30d → anonymize)
Admin Orphaned files → GET /admin/orphaned-files → Reassign(newOwnerId) | Delete(soft)
```

## Error handling

- `DELETE /me` when already deleted → `409` (idempotent-safe message).
- `restoreAccount` on an anonymized user → `409` ("account permanently removed").
- `purgeAccount` before 30 days → `400` ("not yet eligible — deleted < 30 days ago").
- `reassignDocument` to a missing/deleted target → `404`/`400`.
- Admin routes require admin (`403` otherwise). All keyed on server-side ids.

## Testing

- **`account.service`** (vitest, real DB): `deleteOwnAccount` sets `deletedAt`, writes
  `account.deleted` audit with fileCount, and notifies each admin; `restoreAccount`
  clears `deletedAt`; restore blocked when `anonymizedAt` set (`409`); `purgeAccount`
  rejects < 30 days (`400`) and, for a >30-day tombstone, scrubs PII + sets
  `anonymizedAt`; `listDeletedAccounts` marks `eligibleForPurge` correctly.
- **Masking**: a document whose uploader is soft-deleted assembles with
  `uploader.displayName === "Original uploader removed"`.
- **Orphaned files**: `listOrphanedFiles` returns docs by deleted uploaders;
  `reassignDocument` updates uploader+owner and audits; target validation.
- **`findAdminUserIds`** returns admins only.
- Full `pnpm typecheck` after codegen; web typecheck; live smoke (delete → masked →
  admin sees deleted account + orphaned file → reassign/restore).

## Backwards compatibility

One additive nullable column; masking only changes a fallback string for
already-missing users; new endpoints + admin surfaces. No existing endpoint/behavior
changes. SP1/SP2/Sprint-2/3 unaffected. Migration is additive and idempotent.
