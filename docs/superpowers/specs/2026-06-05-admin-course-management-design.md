# Admin Course Management — Design

**Date:** 2026-06-05
**Status:** Approved

## Goal

Give admins the ability to add, edit, and remove courses from the app. Today
courses are a read-only taxonomy entity (`GET /courses` only); there is no way to
create or delete one outside of seed scripts.

## Scope

- **Add** a course (`code`, `title`, optional `lecturerName`).
- **Edit** an existing course (`code` / `title` / `lecturerName`).
- **Remove** a course, cascading to its attached content (recoverably).

Admin-only throughout (`requireRole("admin")`).

## Delete Semantics

Courses have no `deleted_at` column, and adding one would force course-visibility
filtering across listing, search, course-match, and analytics — a large surface
area. Instead:

- **The course row is hard-deleted.**
- **Heavy attached content is soft-deleted** so it stays recoverable, consistent
  with the app's existing soft-delete philosophy.

Cascade on removal:

| Entity | Action | Notes |
| --- | --- | --- |
| Documents in the course | Soft-delete via existing `softDeleteDocumentAndReleaseQuota` | Hidden everywhere, uploader quota freed, storage blobs kept. A later restore leaves them uncategorized (course link gone). |
| Material requests scoped to the course | Hard delete | Lightweight, no storage. |
| Study collections | Only **official / course-scoped** collections are un-scoped/removed | Users' personal collections that merely referenced the course are **left intact** (do not destroy unrelated user data). |
| Course enrollments | Removed | DB `onDelete: Cascade` handles automatically. |

Audit: one `course.delete` record for the course, plus the per-document
soft-delete audit records emitted by the existing path.

## API

All routes guarded by `requireRole("admin")`. New `courses.service.ts` +
repository functions. OpenAPI spec updated and the typed client regenerated.

- `POST /admin/courses` — body `{ code, title, lecturerName? }`. Returns the new
  course. `409` if `code` already exists.
- `PATCH /admin/courses/:courseId` — edit `code` / `title` / `lecturerName`.
  `409` on code collision, `404` if missing.
- `DELETE /admin/courses/:courseId` — runs the cascade above in a transaction.
  Returns `204`.
- `GET /admin/courses/:courseId/impact` — returns
  `{ documents, requests, collections }` counts so the confirm dialog can show
  what will be removed before the admin commits.
- Reuse existing `GET /courses` for the list.

### Validation

- `code`: trimmed, non-empty, unique (case-insensitive collision check).
- `title`: trimmed, non-empty.
- `lecturerName`: optional; defaults to empty string when omitted.

## Web UI

- New page `artifacts/web/src/pages/admin-courses.tsx`: a table of courses
  (code, title, lecturer, document count) with a search box, an **Add course**
  dialog, and per-row **Edit** and **Remove** actions. Follows the
  `admin-users.tsx` patterns (TanStack Query, Radix dialogs).
- **Remove** opens a type-to-confirm dialog showing the impact counts and
  requiring the admin to type the course `code` exactly before the destructive
  action is enabled.
- Wire the route in `App.tsx` under `AuthGuard requireRole="admin"`.
- Add a nav entry in `layout.tsx`:
  `{ href: "/admin/courses", icon: BookOpen, label: "Courses" }`.

## Testing

Service-level tests following existing `*.service.test.ts` patterns:

- Create rejects duplicate code.
- Create succeeds with/without `lecturerName`.
- Edit updates fields; rejects code collision.
- Delete cascade: documents soft-deleted + quota freed, requests removed,
  course-scoped collections handled, course row gone.
- Impact counts are accurate.

## Out of Scope (YAGNI)

- Soft-deleting the course row itself (no `deleted_at` on Course).
- Hard-deleting document storage blobs.
- Bulk course import/export.
- Lecturer-account linking (`lecturerUserId`) — remains untouched.
