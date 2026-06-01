# Upload Permissions & Approval Overhaul — design

**Date:** 2026-06-01
**Status:** Approved (proceeding to plan + build)
**Scope:** Sub-project **4 of 4** (final) of the "User Profile Management + Approval
Workflow" effort. Builds on SP1–SP3.

## Problem / goal

Today uploads are gated by course membership, students are forced to `draft`, and there
is no admin-approval stage for sensitive file types. Per spec §10–17:

1. **Open uploads** — any authenticated user may upload to any course; course
   membership affects *approval routing only*.
2. **Student → lecturer approval** — a student upload goes straight to the course's
   lecturers for approval; on approval a normal file publishes, a **restricted-type**
   file goes to **admin approval**.
3. **Lecturer uploads** — normal files auto-publish; restricted-type files go straight
   to admin approval.
4. **Restricted file types** — a configurable extension list (`zip,rar,7z,exe,msi,bat,
   cmd,apk,iso`) always requires admin approval, regardless of uploader.
5. **Admin approval queue** + notifications + audit for the new stage.

## Context (current pipeline — integrate, don't duplicate)

- **State machine** (`documents.service.ts`): `draft → pending_review →
  approved/rejected`; `rejected → pending_review`; lecturer/admin direct →
  `published`. CAS via `updateDocumentByIdIfStatus(id, expectedStatus, patch)`.
  `REVIEW_HIDDEN_STATUSES = ["draft","pending_review","rejected"]`
  (`permissions.service.ts:47`) — these are hidden from the public; `approved`/
  `published` are visible.
- **Upload status decision** (`documents.service.ts:851–863, 1043`): students forced to
  `draft` + `courseId` required; lecturer/admin default `published`. Route auto-submit
  path (`documents.ts:368–388`) turns fresh student drafts into `pending_review`.
- **Permissions** (`permissions.service.ts`): `canUpload` (admin/lecturer, or student
  with ≥1 enrollment); `canUploadToCourse` (admin any; lecturer must teach; student
  must be enrolled); `canReview` = admin OR course-lecturer; `listPendingReview` scoped
  to lecturer courses (admin sees all).
- **MIME allowlist** (`env.ts` `ALLOWED_MIME_TYPES`): blocks anything not listed —
  currently **blocks** `exe/msi/apk/iso/rar/7z` (so they can't be uploaded at all).
- **Notifications**: `document.approved` / `document.rejected` to the uploader
  (`documents.service.ts`); `notify()` is single-recipient. `findAdminUserIds()` exists
  (SP3). No "course lecturers" query yet.
- **Review UI**: `review-queue.tsx` (lecturers/admin) calls approve/reject. Tests:
  `documents.review.test.ts`, `documents.studentUpload.test.ts`, the Sprint-2 smoke.

## Decisions

1. **"Restricted File" = file TYPE** (extension list), distinct from `visibility`
   (`public/restricted/private`, viewing-only, unchanged).
2. **No migration** — restricted-ness is recomputed from the file's `originalFilename`
   at upload and at approval time (config drift is acceptable; avoids schema/DTO churn).
3. **Restricted extensions bypass the MIME allowlist** — accept a file if its MIME is in
   the allowlist OR its extension is in the restricted set (allowed-but-gated).
4. **Student uploads auto-submit** straight to `pending_review` (the draft/"submit
   later" checkbox is removed). Students still pick a course (required), but **any**
   course.
5. **New status `pending_admin_approval`**, added to `REVIEW_HIDDEN_STATUSES`.
6. Admins notified via the existing `findAdminUserIds`; course lecturers via a new
   `findCourseLecturerIds(courseId)` (from `course_enrollments.roleInCourse='lecturer'`).

## Non-goals

DB schema changes; approve-with-note (the reject reason already carries the reviewer
comment); automatic/cron processing; quota changes; per-upload mixed handling (each
file is already its own Document and routes independently).

## Architecture

### Restricted file types (`lib/restricted-files.ts`, new) + env

- `env.ts`: `restrictedFileExtensions` from `RESTRICTED_FILE_EXTENSIONS`
  (csv, default `zip,rar,7z,exe,msi,bat,cmd,apk,iso`).
- Pure: `isRestrictedFilename(name: string): boolean` — lowercase extension after the
  last `.`, membership test against the configured set. Unit-tested.

### Permissions (`permissions.service.ts`)

- `canUpload(user)` → `true` for any authenticated user.
- `canUploadToCourse(user, courseId)` → `true` for any authenticated user (any course).
- Add `"pending_admin_approval"` to `REVIEW_HIDDEN_STATUSES` (so `canView` hides it
  from the public; uploader/owner + reviewers/admin still see it).
- `canReview` unchanged (admin or course-lecturer) — used for the lecturer stage.

### Upload (`documents.service.ts` `uploadDocuments`)

- Acceptance per file: `env.allowedMimeTypes.includes(mime) || isRestrictedFilename(name)`
  (replaces the allowlist-only check; keeps the content-sniff check for allowlisted
  MIME types).
- Status decision per file (`restricted = isRestrictedFilename(file.originalname)`):
  - **Student** (`isStudent`): `status = "pending_review"`; require `courseId` (any
    course). After insert, notify the course's lecturers (`document.review_requested`).
  - **Lecturer**: `restricted ? "pending_admin_approval" : "published"`; if restricted,
    notify admins (`document.admin_review_requested`).
  - **Admin**: `"published"`.
- Remove the forced-`draft` student override and the route auto-submit detour; the
  status is decided directly at insert. The `autoSubmitForReview` field/flow is removed
  (or left dormant — the web stops sending it).

### Review service (`documents.service.ts`)

- `approveDocument(id, user)` (CAS `pending_review` → …): `canReview` required. Load the
  doc's original filename; if restricted → CAS to `pending_admin_approval`, notify
  admins, audit `document.approve {to:"pending_admin_approval"}`. Else → `approved`,
  notify uploader (`document.approved`), audit `document.approve`.
- `adminApproveDocument(id, user)` (NEW; admin only; CAS `pending_admin_approval` →
  `approved`): notify uploader (`document.approved`); audit `document.admin_approve`.
- `rejectDocument(id, reason, user)` (generalized): load doc; if `pending_review` →
  require `canReview`, CAS `pending_review`→`rejected`, audit `document.reject`; if
  `pending_admin_approval` → require `isAdmin`, CAS →`rejected`, audit
  `document.admin_reject`; else `400`. Notify uploader (`document.rejected`, body=reason).
- `listPendingAdminApproval(user, opts)` (NEW; admin only) → docs with status
  `pending_admin_approval` (paged, oldest-first), assembled like the review queue.

### Repository (`documents.repo.ts`, `enrollments.repo.ts`)

- `documents.repo`: add `listPendingAdminApproval`/`countPendingAdminApproval` (mirror
  the pending-review queries, `status = "pending_admin_approval"`, no course scope —
  admin-only). Add `findOriginalFilename(documentId)` (the current file's name) for the
  approve-time restricted check. Reuse `updateDocumentByIdIfStatus`.
- `enrollments.repo`: add `findCourseLecturerIds(courseId)` → userIds where
  `roleInCourse='lecturer'`.

### Routes (`documents.ts`)

- `GET /documents/pending-admin-approval` (auth; service enforces admin).
- `POST /documents/:id/admin-approve` (auth; service enforces admin) → `adminApproveDocument`.
- Existing `POST /documents/:id/reject` now also handles the admin stage (service-side).
- Upload route gate: keep `requireAuth` + `canUpload` (now any authenticated); update the
  forbidden copy. OpenAPI: new ops + regenerate client.

### Notifications

- `document.review_requested` → each course lecturer (student upload entered review).
- `document.admin_review_requested` → each admin (doc entered admin approval).
- `document.approved` / `document.rejected` → uploader (final outcomes; existing).
- Labels added to `activity-format.ts` + notification bell.

### Frontend

- `upload.tsx`: show **all** courses (remove enrolled-only filter); remove the
  auto-submit checkbox and the enrolled-only copy; keep a note that uploads need
  approval and that restricted types (zip/exe/…) require admin approval. Stop sending
  `autoSubmitForReview`.
- `review-queue.tsx`: unchanged (lecturer/admin pending-review).
- New `admin-approvals.tsx` (route `/admin/approvals`, admin nav) — pending-admin
  queue with Approve / Reject(reason), reusing the review-queue component patterns and
  the generated hooks.

### Audit (§17)

`document.approve`, `document.admin_approve`, `document.reject`, `document.admin_reject`
(+ existing `document.upload`). Labels in `activity-format.ts`.

## Data flow

```
Upload (student, course C) → status=pending_review → notify lecturers(C)
  lecturer/admin Approve:
    normal    → approved (notify uploader)            [visible]
    restricted→ pending_admin_approval (notify admins)
       admin Admin-approve → approved (notify uploader) [visible]
       admin Reject        → rejected (notify uploader)
    Reject (lecturer)      → rejected (notify uploader)
Upload (lecturer): normal → published; restricted → pending_admin_approval (notify admins)
Upload (admin): published
```

## Error handling

- Approve/reject use CAS; a lost race (count 0) → `400`/`409` (existing pattern), no
  double-notify.
- `adminApproveDocument`/admin-reject by a non-admin → `403`.
- `rejectDocument` from an invalid status → `400`.
- A student upload to a course with **no lecturers** lands in `pending_review` and is
  cleared by any admin (admins see all pending-review) — documented, not an error.
- Restricted file whose MIME also fails content-sniff for a spoofed allowlisted type is
  still accepted (extension-gated); content-sniff only applies to allowlisted MIME.

## Testing

- **`restricted-files`** pure unit test (extension match, case-insensitive, dotfiles).
- **`documents.service`**: upload status by role × type (student→pending_review any
  course; lecturer normal→published, restricted→pending_admin_approval; admin→
  published); `approveDocument` of a restricted doc → `pending_admin_approval` (not
  approved) and of a normal doc → `approved`; `adminApproveDocument` → approved (admin
  only); reject from `pending_review` (reviewer) and `pending_admin_approval` (admin);
  open-upload (student uploads to a non-enrolled course succeeds).
- **Notifications**: course lecturers notified on student upload; admins on
  pending-admin entry.
- **Update** `documents.studentUpload.test.ts` (forced-draft/enrollment gate → new
  behavior) and any `documents.review.test.ts` assertions affected (its docs are
  non-restricted, so approve→approved still holds).
- Full `pnpm typecheck` after codegen; web typecheck; keep the Sprint-2 smoke green;
  live smoke of the full chain.

## Backwards compatibility

No schema change. `visibility` semantics unchanged. The lecturer review flow and its
tests stay green for normal files (approve→approved). New behavior is additive
(`pending_admin_approval` stage, open uploads, restricted routing). Existing
`document.approved/rejected` notifications and audit actions are preserved; new ones are
added.
