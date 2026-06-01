# Course Membership Management — design

**Date:** 2026-06-01
**Status:** Approved (proceeding to plan + build)
**Scope:** Sub-project **2 of 4** of the "User Profile Management + Approval Workflow" effort.
Builds on sub-project 1 (Profile Foundation). Remaining: (3) Account deletion &
orphaned files, (4) Upload permissions & approval overhaul.

## Problem / goal

Students and lecturers cannot manage their own course membership. Enrollment rows
are created only at registration or by the seed; there is no add/remove API or UI,
and `GET /courses` has no search. Let students self-manage **enrolled courses** and
lecturers self-manage **taught courses** from the Profile page (the slot reserved in
sub-project 1), with course search.

## Context (what already exists — integrate, don't duplicate)

- **`Course`** (`lib/db/prisma/schema.prisma`): `id, code (unique), title,
  lecturerName, lecturerUserId, …`. **`CourseEnrollment`**: `id, userId, courseId,
  roleInCourse ("student" | "lecturer"), createdAt`, unique `(userId, courseId)`.
- **`enrollments.repo.ts`**: `findEnrollmentsForUser`, `upsertEnrollments`
  (`createMany skipDuplicates`), `findEnrolledUserIds`. **No delete, no single-add.**
- **`taxonomy.service.listCourses()`** → `CourseDTO {id, code, title, lecturerName}`;
  route `GET /courses` (auth) returns all, **no search**. `loadCourses(ids)` returns
  a `Map<id, CourseDTO>` (reuse for joining).
- **`permissions.service`**: `enrolledCourseIds`, `lecturerCourseIds`,
  `isLecturerForCourse` all read `user.enrollments[].roleInCourse`. `canReview` /
  `canUploadToCourse` depend on lecturer-for-course. **`roleInCourse` is therefore
  security-sensitive** — it confers review/approval power (more so in SP4).
- **`AuthenticatedUser.enrollments`** is loaded per-request in
  `loadAuthenticatedUser`, so add/remove take effect on the next request.
- The Profile page (`artifacts/web/src/pages/profile.tsx`) reserves a non-admin slot
  (`data-testid="profile-extensions"`) for exactly this.
- Audit via `audit.service.record(...)`; labels in
  `artifacts/web/src/lib/activity-format.ts`.

## Decisions

1. **`roleInCourse` is derived server-side from the user's global `primaryRole`** —
   `student` → `"student"`, `lecturer` → `"lecturer"`. The client never sends a role.
   A student can never self-assign as a course lecturer (privilege escalation guard).
2. **Lecturer course assignment is self-service** (spec §6). Consequence: a lecturer
   self-grants approval rights for any course they add — intentional; surfaces in SP4.
3. **`admin` cannot self-manage courses** here — the mutation endpoints return 403 for
   admins, and the Profile page shows no courses section for admins (per §7).
4. **Course search is server-side** — an optional `q` (and `limit`) on the existing
   `GET /courses`, case-insensitive over code + title. Backwards-compatible.
5. **`GET /me/courses` returns joined course details** (`id, code, title,
   lecturerName, roleInCourse`) so the section can render code + title without a
   second round-trip.

## Non-goals

Course **creation** (stays admin/seed-only; students & lecturers cannot create);
editing **other** users' enrollments (admin tooling, not built here); the
upload-permission decoupling and approval changes (SP4); bulk enroll; CSV import.

## Architecture

### Backend — repository (`enrollments.repo.ts`)

Add two functions (reuse the existing `findEnrollmentsForUser` for reads):

- `addEnrollment(userId, courseId, roleInCourse)` — `createMany({ data: [...],
  skipDuplicates: true })` so re-adding is an idempotent no-op against the
  `(userId, courseId)` unique key.
- `removeEnrollment(userId, courseId)` — `deleteMany({ where: { userId, courseId } })`
  (returns count; 0 = nothing to remove).

### Backend — course search (`taxonomy.repo` + `taxonomy.service` + route)

- `taxonomy.repo.listAllCourses` gains an optional `{ q?, limit? }`: when `q` is
  present, filter `code`/`title` with `contains`, `mode: "insensitive"`, ordered by
  `code`, `take: limit` (default cap 50). No `q` → existing full list.
- `taxonomy.service.listCourses(opts?)` forwards the options.
- `GET /courses` parses optional `q` (1–100 chars) and `limit` (1–50) query params.

### Backend — service (`services/enrollments.service.ts`, new)

- `roleInCourseFor(user)`: returns `"student"` or `"lecturer"` from `user.primaryRole`;
  throws `forbidden` if the user is neither (admins).
- `listMyCourses(user)`: `findEnrollmentsForUser(user.id)` → `loadCourses(ids)` →
  `[{ id, code, title, lecturerName, roleInCourse }]`, ordered by code; drops any
  enrollment whose course row is missing.
- `addMyCourse(user, courseId)`: compute role via `roleInCourseFor`; verify the course
  exists (`taxonomyRepo.findCoursesByIds([courseId])`, else `notFound`); 
  `addEnrollment`; `audit.record(user.id, "user.course_added", "course", courseId,
  { code, roleInCourse })`; return `listMyCourses(user)`.
- `removeMyCourse(user, courseId)`: `removeEnrollment`; if a row was removed,
  `audit.record(user.id, "user.course_removed", "course", courseId, { code })`
  (look up code best-effort for metadata); return `listMyCourses(user)`.

### Backend — routes (added to the existing `profile` router)

- `GET /me/courses` → `listMyCourses`.
- `POST /me/courses` `{ courseId }` (uuid) → `addMyCourse` → 200 with updated list.
- `DELETE /me/courses/:courseId` → `removeMyCourse` → 200 with updated list.

All require auth; the target user is `req.authUser.id`.

### Backend — OpenAPI + codegen

- New schema `MyCourse` (`id, code, title, lecturerName, roleInCourse`).
- Ops: `listMyCourses` (200 → `MyCourse[]`), `addMyCourse` (body `{courseId}` → 200
  `MyCourse[]`), `removeMyCourse` (path `courseId` → 200 `MyCourse[]`).
- `listCourses`: add optional `q` + `limit` query params.
- Regenerate `lib/api-zod` + `lib/api-client-react`.

### Frontend — Profile page

- New component `artifacts/web/src/components/profile/CourseMembership.tsx`, rendered
  in the non-admin slot of `profile.tsx`, receiving the current user.
- Heading: **"Enrolled courses"** when `primaryRole === "student"`, **"Taught
  courses"** when `"lecturer"`.
- Current courses via `useListMyCourses` — each row shows `CODE — Title` with a remove
  (×) button (`useRemoveMyCourse`).
- **Add course**: a debounced search input → `useListCourses({ q })`; results exclude
  already-added course ids; clicking a result calls `useAddMyCourse`.
- After add/remove: invalidate `getListMyCoursesQueryKey()` and
  `getGetCurrentUserQueryKey()` (so enrollment-derived permissions refresh).
- Full loading / empty ("No courses yet") / error (toast) / success (toast) states;
  responsive; existing design system (Input, Button, Badge, Skeleton, toast).

## Data flow

```
Profile (student/lecturer)
  └─ GET /me/courses ──► enrollments.service.listMyCourses
                          └─ findEnrollmentsForUser + taxonomy.loadCourses
  └─ search input ──► GET /courses?q= ──► taxonomy.listCourses({q})
  └─ click result ──► POST /me/courses {courseId}
                       └─ roleInCourseFor(user) [student|lecturer; admin→403]
                       └─ verify course exists [else 404]
                       └─ addEnrollment (idempotent) + audit
  └─ click × ──► DELETE /me/courses/:courseId ──► removeEnrollment + audit
  (each mutation returns the fresh MyCourse[] and invalidates /me)
```

## Error handling

- `addMyCourse` / `removeMyCourse` by an admin → `403` (proper authz error).
- Unknown `courseId` on add → `404`.
- Remove of a course the user isn't enrolled in → `200` no-op (idempotent), no audit.
- Route validation: `courseId` must be a uuid (`400` otherwise); `q` 1–100, `limit`
  1–50.
- Frontend surfaces failures via destructive toast; the list reverts on next refetch.

## Testing

- **`enrollments.service` unit tests** (vitest, real DB):
  - `addMyCourse` as a student creates `roleInCourse="student"`; as a lecturer
    `"lecturer"`; idempotent re-add; admin → 403; unknown course → 404; audit written.
  - `removeMyCourse` deletes the row; removing a non-enrollment is a 200 no-op.
  - `listMyCourses` returns joined details and drops orphaned enrollments.
- **`taxonomy` search**: `listCourses({ q })` filters by code/title; no `q` → all.
- Full `pnpm typecheck` after codegen; web typecheck for the new component.
- Manual: as Noa (student) add/remove an enrolled course; as Dr. Cohen (lecturer)
  add/remove a taught course; confirm admin profile shows no courses section.

## Backwards compatibility

Additive repo functions, an optional `q`/`limit` on `GET /courses`, new `/me/courses`
endpoints, and one new schema — no existing column/endpoint/behavior changes.
Registration's `upsertEnrollments` path is untouched. SP1/SP2/Sprint-2/3 unaffected.
