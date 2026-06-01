# Course Membership Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let students self-manage enrolled courses and lecturers self-manage taught courses from the Profile page, with server-side course search and audit logging.

**Architecture:** Two new `enrollments.repo` functions (add/remove) + a new `enrollments.service` that derives `roleInCourse` from the user's global role (admin → 403), validates the course, and audits. Course search is an optional `q`/`limit` on the existing `GET /courses`. Three `/me/courses` endpoints live on the existing `profile` router. A `CourseMembership` React component fills the non-admin slot reserved on the Profile page in sub-project 1.

**Tech Stack:** TypeScript, Express, Prisma/Postgres, Zod, OpenAPI + orval, React, TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-01-course-membership-design.md`

**Environment note (Windows dev):** DB is Docker Postgres on `localhost:5433`. Load `.env` before any DB command:
`Get-Content .env | ForEach-Object { if ($_ -match '^\s*([^#=]+)=(.*)$') { Set-Item -Path "env:$($matches[1].Trim())" -Value $matches[2].Trim() } }`
No DB migration in this sub-project. After API source changes, restart the API from the package dir: `corepack pnpm --filter @workspace/api-server run build` then `... run start`.

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `artifacts/api-server/src/repositories/enrollments.repo.ts` | Modify | `addEnrollment`, `removeEnrollment`. |
| `artifacts/api-server/src/repositories/taxonomy.repo.ts` | Modify | `listAllCourses` gains optional `{q,limit}`. |
| `artifacts/api-server/src/services/taxonomy.service.ts` | Modify | `listCourses` forwards `{q,limit}`. |
| `artifacts/api-server/src/routes/taxonomy.ts` | Modify | `GET /courses` parses `q`/`limit`. |
| `artifacts/api-server/src/services/enrollments.service.ts` | Create | `listMyCourses`, `addMyCourse`, `removeMyCourse`, role derivation. |
| `artifacts/api-server/src/services/enrollments.service.test.ts` | Create | Service tests (real DB). |
| `artifacts/api-server/src/routes/profile.ts` | Modify | `GET/POST /me/courses`, `DELETE /me/courses/:courseId`. |
| `lib/api-spec/openapi.yaml` | Modify | `MyCourse` schema, 3 ops, `q`/`limit` on `listCourses`. |
| `lib/api-zod/*`, `lib/api-client-react/*` | Generated | New hooks via codegen. |
| `artifacts/web/src/components/profile/CourseMembership.tsx` | Create | Courses section UI. |
| `artifacts/web/src/pages/profile.tsx` | Modify | Render `CourseMembership` in the non-admin slot. |
| `artifacts/web/src/lib/activity-format.ts` | Modify | Labels for `user.course_added` / `user.course_removed`. |

---

### Task 1: Enrollment repo + service (TDD)

**Files:**
- Modify: `artifacts/api-server/src/repositories/enrollments.repo.ts`
- Create: `artifacts/api-server/src/services/enrollments.service.ts`
- Create: `artifacts/api-server/src/services/enrollments.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/services/enrollments.service.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { listMyCourses, addMyCourse, removeMyCourse } from "./enrollments.service";

const SX = `_enr_${Date.now().toString(36)}`;
let studentId: string;
let lecturerId: string;
let adminId: string;
let courseAId: string;
let courseBId: string;

function authed(id: string, primaryRole: string): AuthenticatedUser {
  return {
    id, email: `${id}@demo`, displayName: id, isActive: true,
    primaryRole, roles: [primaryRole], enrollments: [],
    username: null, avatarStoragePath: null, createdAt: new Date().toISOString(),
  };
}

beforeAll(async () => {
  const s = await db.user.create({ data: { email: `s${SX}@demo`, passwordHash: "x", displayName: "S" } });
  const l = await db.user.create({ data: { email: `l${SX}@demo`, passwordHash: "x", displayName: "L" } });
  const a = await db.user.create({ data: { email: `a${SX}@demo`, passwordHash: "x", displayName: "A" } });
  studentId = s.id; lecturerId = l.id; adminId = a.id;
  const ca = await db.course.create({ data: { code: `AA${SX}`.slice(0, 20), title: "Alpha", lecturerName: "X" } });
  const cb = await db.course.create({ data: { code: `BB${SX}`.slice(0, 20), title: "Beta", lecturerName: "Y" } });
  courseAId = ca.id; courseBId = cb.id;
});

afterAll(async () => {
  await db.courseEnrollment.deleteMany({ where: { userId: { in: [studentId, lecturerId, adminId] } } });
  await db.auditLog.deleteMany({ where: { actorUserId: { in: [studentId, lecturerId, adminId] } } });
  await db.course.deleteMany({ where: { id: { in: [courseAId, courseBId] } } });
  await db.user.deleteMany({ where: { id: { in: [studentId, lecturerId, adminId] } } });
});

describe("enrollments.service", () => {
  it("addMyCourse derives roleInCourse=student for a student + audits", async () => {
    const list = await addMyCourse(authed(studentId, "student"), courseAId);
    expect(list.find((c) => c.id === courseAId)?.roleInCourse).toBe("student");
    const row = await db.courseEnrollment.findFirst({ where: { userId: studentId, courseId: courseAId } });
    expect(row?.roleInCourse).toBe("student");
    const audit = await db.auditLog.findFirst({ where: { actorUserId: studentId, action: "user.course_added" } });
    expect(audit).not.toBeNull();
  });

  it("addMyCourse derives roleInCourse=lecturer for a lecturer", async () => {
    const list = await addMyCourse(authed(lecturerId, "lecturer"), courseAId);
    expect(list.find((c) => c.id === courseAId)?.roleInCourse).toBe("lecturer");
  });

  it("addMyCourse is idempotent", async () => {
    await addMyCourse(authed(studentId, "student"), courseBId);
    await addMyCourse(authed(studentId, "student"), courseBId);
    const n = await db.courseEnrollment.count({ where: { userId: studentId, courseId: courseBId } });
    expect(n).toBe(1);
  });

  it("addMyCourse rejects admins with 403", async () => {
    await expect(addMyCourse(authed(adminId, "admin"), courseAId)).rejects.toMatchObject({ status: 403 });
  });

  it("addMyCourse rejects an unknown course with 404", async () => {
    await expect(
      addMyCourse(authed(studentId, "student"), "00000000-0000-0000-0000-000000000000"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("listMyCourses returns joined details sorted by code", async () => {
    const list = await listMyCourses(authed(studentId, "student"));
    const codes = list.map((c) => c.code);
    expect(codes).toEqual([...codes].sort());
    expect(list.every((c) => c.title.length > 0)).toBe(true);
  });

  it("removeMyCourse deletes the enrollment + audits; non-enrollment is a no-op", async () => {
    await removeMyCourse(authed(studentId, "student"), courseAId);
    const row = await db.courseEnrollment.findFirst({ where: { userId: studentId, courseId: courseAId } });
    expect(row).toBeNull();
    // no-op remove (already gone) should not throw
    await expect(removeMyCourse(authed(studentId, "student"), courseAId)).resolves.toBeInstanceOf(Array);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (`.env` loaded): `corepack pnpm --filter @workspace/api-server exec vitest run src/services/enrollments.service.test.ts`
Expected: FAIL — `./enrollments.service` not found.

- [ ] **Step 3: Add the repo functions**

In `artifacts/api-server/src/repositories/enrollments.repo.ts`, append:

```typescript
export async function addEnrollment(
  userId: string,
  courseId: string,
  roleInCourse: string,
): Promise<void> {
  await db.courseEnrollment.createMany({
    data: [{ userId, courseId, roleInCourse }],
    skipDuplicates: true,
  });
}

export async function removeEnrollment(userId: string, courseId: string): Promise<number> {
  const res = await db.courseEnrollment.deleteMany({ where: { userId, courseId } });
  return res.count;
}
```

- [ ] **Step 4: Create the service**

Create `artifacts/api-server/src/services/enrollments.service.ts`:

```typescript
import * as enrollmentsRepo from "../repositories/enrollments.repo";
import * as taxonomyRepo from "../repositories/taxonomy.repo";
import * as taxonomyService from "./taxonomy.service";
import * as auditService from "./audit.service";
import { forbidden, notFound } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";

export interface MyCourse {
  id: string;
  code: string;
  title: string;
  lecturerName: string;
  roleInCourse: string;
}

/** Course role is derived from the user's global role — never client-supplied.
 *  A student can only ever create a student-enrollment; only a lecturer creates
 *  a lecturer-enrollment. Admins do not self-manage courses. */
function roleInCourseFor(user: AuthenticatedUser): "student" | "lecturer" {
  if (user.primaryRole === "student") return "student";
  if (user.primaryRole === "lecturer") return "lecturer";
  throw forbidden("Only students and lecturers can manage course membership.");
}

export async function listMyCourses(user: AuthenticatedUser): Promise<MyCourse[]> {
  const enrollments = await enrollmentsRepo.findEnrollmentsForUser(user.id);
  const courses = await taxonomyService.loadCourses(enrollments.map((e) => e.courseId));
  const out: MyCourse[] = [];
  for (const e of enrollments) {
    const c = courses.get(e.courseId);
    if (c) {
      out.push({ id: c.id, code: c.code, title: c.title, lecturerName: c.lecturerName, roleInCourse: e.roleInCourse });
    }
  }
  out.sort((a, b) => a.code.localeCompare(b.code));
  return out;
}

export async function addMyCourse(user: AuthenticatedUser, courseId: string): Promise<MyCourse[]> {
  const role = roleInCourseFor(user);
  if (!(await taxonomyRepo.courseExists(courseId))) throw notFound("Course not found");
  await enrollmentsRepo.addEnrollment(user.id, courseId, role);
  const codeMap = await taxonomyRepo.findCourseCodesByIds([courseId]);
  await auditService.record(user.id, "user.course_added", "course", courseId, {
    code: codeMap.get(courseId) ?? null,
    roleInCourse: role,
  });
  return listMyCourses(user);
}

export async function removeMyCourse(user: AuthenticatedUser, courseId: string): Promise<MyCourse[]> {
  roleInCourseFor(user); // admins are rejected; keeps behavior consistent with add
  const removed = await enrollmentsRepo.removeEnrollment(user.id, courseId);
  if (removed > 0) {
    const codeMap = await taxonomyRepo.findCourseCodesByIds([courseId]);
    await auditService.record(user.id, "user.course_removed", "course", courseId, {
      code: codeMap.get(courseId) ?? null,
    });
  }
  return listMyCourses(user);
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `corepack pnpm --filter @workspace/api-server exec vitest run src/services/enrollments.service.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```
git add artifacts/api-server/src/repositories/enrollments.repo.ts artifacts/api-server/src/services/enrollments.service.ts artifacts/api-server/src/services/enrollments.service.test.ts
git commit -m "feat(api): enrollments.service self-manage course membership (+repo, tests)"
```

---

### Task 2: Course search (q/limit on /courses)

**Files:**
- Modify: `artifacts/api-server/src/repositories/taxonomy.repo.ts:27-29`
- Modify: `artifacts/api-server/src/services/taxonomy.service.ts:22-30`
- Modify: `artifacts/api-server/src/routes/taxonomy.ts:7-13`
- Modify: `artifacts/api-server/src/services/enrollments.service.test.ts` (add a search test that exercises the repo through the service layer)

- [ ] **Step 1: Add a failing search test**

Append to `artifacts/api-server/src/services/enrollments.service.test.ts` (new `describe` at the end), importing the taxonomy service at the top (add `import { listCourses } from "./taxonomy.service";`):

```typescript
describe("taxonomy.listCourses search", () => {
  it("filters by case-insensitive q over code/title", async () => {
    const byTitle = await listCourses({ q: "alph" });
    expect(byTitle.some((c) => c.id === courseAId)).toBe(true);
    expect(byTitle.some((c) => c.id === courseBId)).toBe(false);
  });
  it("returns all courses when q is omitted", async () => {
    const all = await listCourses();
    expect(all.some((c) => c.id === courseAId)).toBe(true);
    expect(all.some((c) => c.id === courseBId)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm --filter @workspace/api-server exec vitest run src/services/enrollments.service.test.ts`
Expected: FAIL — `listCourses` does not accept an argument / TS error on `{ q }`.

- [ ] **Step 3: Add `{q,limit}` to the repo**

In `artifacts/api-server/src/repositories/taxonomy.repo.ts`, replace `listAllCourses`:

```typescript
export interface ListCoursesOptions {
  q?: string;
  limit?: number;
}

export async function listAllCourses(opts: ListCoursesOptions = {}): Promise<CourseRow[]> {
  const q = opts.q?.trim();
  return db.course.findMany({
    where: q
      ? {
          OR: [
            { code: { contains: q, mode: "insensitive" } },
            { title: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { code: "asc" },
    take: opts.limit ?? undefined,
  });
}
```

- [ ] **Step 4: Forward options from the service**

In `artifacts/api-server/src/services/taxonomy.service.ts`, replace `listCourses`:

```typescript
export async function listCourses(
  opts: { q?: string; limit?: number } = {},
): Promise<CourseDTO[]> {
  const rows = await taxonomyRepo.listAllCourses(opts);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    title: r.title,
    lecturerName: r.lecturerName,
  }));
}
```

- [ ] **Step 5: Parse `q`/`limit` on the route**

In `artifacts/api-server/src/routes/taxonomy.ts`, add `import { z } from "zod";` at the top, then replace the `/courses` handler:

```typescript
const CoursesQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

router.get("/courses", requireAuth, async (req, res, next) => {
  try {
    const { q, limit } = CoursesQuery.parse(req.query);
    res.json(await taxonomyService.listCourses({ q, limit }));
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 6: Run it to verify it passes**

Run: `corepack pnpm --filter @workspace/api-server exec vitest run src/services/enrollments.service.test.ts`
Expected: PASS (9 tests now).

- [ ] **Step 7: Commit**

```
git add artifacts/api-server/src/repositories/taxonomy.repo.ts artifacts/api-server/src/services/taxonomy.service.ts artifacts/api-server/src/routes/taxonomy.ts artifacts/api-server/src/services/enrollments.service.test.ts
git commit -m "feat(api): server-side course search (q/limit on /courses)"
```

---

### Task 3: Routes + OpenAPI + codegen

**Files:**
- Modify: `artifacts/api-server/src/routes/profile.ts`
- Modify: `lib/api-spec/openapi.yaml`

- [ ] **Step 1: Add the /me/courses routes to the profile router**

In `artifacts/api-server/src/routes/profile.ts`, add the import (with the other service imports):

```typescript
import * as enrollmentsService from "../services/enrollments.service";
```

Add these zod schemas near the existing ones (after `const AvatarParams = ...`):

```typescript
const CourseIdBody = z.object({ courseId: z.string().uuid() });
const CourseIdParams = z.object({ courseId: z.string().uuid() });
```

Add these handlers (before `export default router;`):

```typescript
router.get("/me/courses", requireAuth, async (req, res, next) => {
  try {
    res.json(await enrollmentsService.listMyCourses(req.authUser!));
  } catch (err) {
    next(err);
  }
});

router.post("/me/courses", requireAuth, async (req, res, next) => {
  try {
    const { courseId } = CourseIdBody.parse(req.body);
    res.json(await enrollmentsService.addMyCourse(req.authUser!, courseId));
  } catch (err) {
    next(err);
  }
});

router.delete("/me/courses/:courseId", requireAuth, async (req, res, next) => {
  try {
    const { courseId } = CourseIdParams.parse(req.params);
    res.json(await enrollmentsService.removeMyCourse(req.authUser!, courseId));
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 2: Add the `MyCourse` schema**

In `lib/api-spec/openapi.yaml` under `components.schemas`, add (next to `CurrentUser`):

```yaml
    MyCourse:
      type: object
      required: [id, code, title, lecturerName, roleInCourse]
      properties:
        id: { type: string, format: uuid }
        code: { type: string }
        title: { type: string }
        lecturerName: { type: string }
        roleInCourse: { type: string, enum: [student, lecturer] }
```

- [ ] **Step 3: Add `q`/`limit` to the `listCourses` operation**

In `lib/api-spec/openapi.yaml`, find the `/courses` GET (operationId `listCourses`) and add parameters. Replace its `get:` header block:

```yaml
  /courses:
    get:
      operationId: listCourses
      tags: [taxonomy]
      summary: List courses (optional case-insensitive search by code/title)
      parameters:
        - { in: query, name: q, required: false, schema: { type: string, minLength: 1, maxLength: 100 } }
        - { in: query, name: limit, required: false, schema: { type: integer, minimum: 1, maximum: 50 } }
      responses:
        "200":
          description: Courses
          content:
            application/json:
              schema: { type: array, items: { $ref: "#/components/schemas/Course" } }
```

(If the existing block differs in `tags`/`summary`/response ref, keep those exact values — only add the `parameters` array. The response schema ref must stay whatever it currently is, e.g. `Course`.)

- [ ] **Step 4: Add the three /me/courses operations**

In `lib/api-spec/openapi.yaml` under `paths:` (next to `/me/profile`), add:

```yaml
  /me/courses:
    get:
      operationId: listMyCourses
      tags: [profile]
      summary: List the current user's course memberships
      responses:
        "200":
          description: Courses
          content:
            application/json:
              schema: { type: array, items: { $ref: "#/components/schemas/MyCourse" } }
    post:
      operationId: addMyCourse
      tags: [profile]
      summary: Add the current user to a course (role derived from their global role)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [courseId]
              properties:
                courseId: { type: string, format: uuid }
      responses:
        "200":
          description: Updated course list
          content:
            application/json:
              schema: { type: array, items: { $ref: "#/components/schemas/MyCourse" } }
  /me/courses/{courseId}:
    parameters:
      - { in: path, name: courseId, required: true, schema: { type: string, format: uuid } }
    delete:
      operationId: removeMyCourse
      tags: [profile]
      summary: Remove the current user from a course
      responses:
        "200":
          description: Updated course list
          content:
            application/json:
              schema: { type: array, items: { $ref: "#/components/schemas/MyCourse" } }
```

- [ ] **Step 5: Regenerate the client + full typecheck**

Run:
```
corepack pnpm --filter @workspace/api-spec run codegen
corepack pnpm run typecheck
```
Expected: codegen adds `useListMyCourses`/`getListMyCoursesQueryKey`, `useAddMyCourse`, `useRemoveMyCourse`, and `useListCourses` now takes an optional params arg; full typecheck PASS.

> If `useListCourses()` existing call sites now error because params became required, pass `undefined` or `{}`; orval makes all-optional params optional, so existing `useListCourses()` calls should keep working — only fix call sites if the typecheck flags them.

- [ ] **Step 6: Rebuild + restart the API and smoke-test**

Restart the API (PowerShell, `.env` loaded): stop the process on 8080, `corepack pnpm --filter @workspace/api-server run build`, then `... run start` (background). Then:
```
$base='http://localhost:8080/api'
Invoke-RestMethod "$base/auth/login" -Method Post -ContentType 'application/json' -Body '{"email":"noa.student@knowledgebank.demo","password":"Demo1234!"}' -SessionVariable s | Out-Null
"search => " + (((Invoke-RestMethod "$base/courses?q=data" -WebSession $s) | ForEach-Object { $_.code }) -join ',')
$before = (Invoke-RestMethod "$base/me/courses" -WebSession $s).Count
$cid = (Invoke-RestMethod "$base/courses?q=IS420" -WebSession $s)[0].id
"add => " + ((Invoke-RestMethod "$base/me/courses" -Method Post -ContentType 'application/json' -Body "{`"courseId`":`"$cid`"}" -WebSession $s) | Where-Object { $_.id -eq $cid } | ForEach-Object { $_.code + ':' + $_.roleInCourse })
"remove => " + ((Invoke-RestMethod "$base/me/courses/$cid" -Method Delete -WebSession $s).Count) + " (was $before before add)"
```
Expected: search prints matching course code(s); add prints `IS420:student` (Noa is a student); remove returns the list back to the original size. Then verify audit:
```
docker exec sceknowledgebank-db-1 psql -U knowledge_bank -d knowledge_bank -c "SELECT action FROM audit_logs WHERE action IN ('user.course_added','user.course_removed') ORDER BY created_at DESC LIMIT 4;"
```
Expected: both actions present.

- [ ] **Step 7: Commit**

```
git add artifacts/api-server/src/routes/profile.ts lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react
git commit -m "feat(api): /me/courses endpoints + MyCourse schema + generated client"
```

---

### Task 4: Frontend — CourseMembership section

**Files:**
- Create: `artifacts/web/src/components/profile/CourseMembership.tsx`
- Modify: `artifacts/web/src/pages/profile.tsx`

- [ ] **Step 1: Create the component**

Create `artifacts/web/src/components/profile/CourseMembership.tsx`:

```tsx
import { useState } from "react";
import {
  useListMyCourses,
  getListMyCoursesQueryKey,
  useAddMyCourse,
  useRemoveMyCourse,
  useListCourses,
  getGetCurrentUserQueryKey,
  type CurrentUser,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { BookOpen, Plus, X } from "lucide-react";

export default function CourseMembership({ me }: { me: CurrentUser }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isLecturer = me.primaryRole === "lecturer";
  const heading = isLecturer ? "Taught courses" : "Enrolled courses";

  const { data: mine, isLoading } = useListMyCourses({
    query: { queryKey: getListMyCoursesQueryKey(), staleTime: 15_000 },
  });

  const [search, setSearch] = useState("");
  const debounced = useDebounce(search, 300);
  const searchParams = { q: debounced.trim() };
  const { data: results } = useListCourses(searchParams, {
    query: {
      queryKey: ["/api/courses", searchParams],
      enabled: debounced.trim().length > 0,
      staleTime: 10_000,
    },
  });

  const addMut = useAddMyCourse();
  const removeMut = useRemoveMyCourse();

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListMyCoursesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
  };

  const mineIds = new Set((mine ?? []).map((c) => c.id));
  const candidates = (results ?? []).filter((c) => !mineIds.has(c.id)).slice(0, 8);

  const add = (courseId: string) =>
    addMut.mutate({ data: { courseId } }, {
      onSuccess: () => { refresh(); setSearch(""); toast({ title: "Course added" }); },
      onError: () => toast({ variant: "destructive", title: "Could not add course" }),
    });

  const remove = (courseId: string) =>
    removeMut.mutate({ courseId }, {
      onSuccess: () => { refresh(); toast({ title: "Course removed" }); },
      onError: () => toast({ variant: "destructive", title: "Could not remove course" }),
    });

  return (
    <div className="space-y-3 border-t pt-6" data-testid="course-membership">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <BookOpen className="h-4 w-4 text-primary" />
        {heading}
      </h2>

      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : mine && mine.length > 0 ? (
        <ul className="space-y-1.5" data-testid="my-courses">
          {mine.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
              <span className="min-w-0 truncate text-sm">
                <span className="font-medium">{c.code}</span>
                <span className="text-muted-foreground"> — {c.title}</span>
              </span>
              <Button
                variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                disabled={removeMut.isPending}
                onClick={() => remove(c.id)}
                aria-label={`Remove ${c.code}`}
                data-testid="course-remove"
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="my-courses-empty">
          No courses yet. Search below to add one.
        </p>
      )}

      {/* Add course */}
      <div className="space-y-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search courses by code or title…"
          data-testid="course-search"
        />
        {debounced.trim().length > 0 && (
          <ul className="rounded-md border bg-popover" data-testid="course-results">
            {candidates.length > 0 ? (
              candidates.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={addMut.isPending}
                    onClick={() => add(c.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{c.code}</span>
                      <span className="text-muted-foreground"> — {c.title}</span>
                    </span>
                  </button>
                </li>
              ))
            ) : (
              <li className="px-3 py-2 text-sm text-muted-foreground">No matching courses.</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Render it in the Profile page**

In `artifacts/web/src/pages/profile.tsx`, add the import near the top:
```tsx
import CourseMembership from "@/components/profile/CourseMembership";
```
and replace the reserved slot line:
```tsx
          {!isAdmin && <div data-testid="profile-extensions" />}
```
with:
```tsx
          {!isAdmin && <CourseMembership me={me} />}
```

- [ ] **Step 3: Typecheck the web app**

Run: `corepack pnpm --filter @workspace/web run typecheck`
Expected: PASS.

> If `useListCourses(searchParams, {...})` errors because the generated query-key helper has a different name, use `getListCoursesQueryKey(searchParams)` for the `queryKey` instead of the inline array. Check the generated export and use whichever exists.

- [ ] **Step 4: Commit**

```
git add artifacts/web/src/components/profile/CourseMembership.tsx artifacts/web/src/pages/profile.tsx
git commit -m "feat(web): course membership section on the Profile page"
```

---

### Task 5: Audit labels + full verification

**Files:**
- Modify: `artifacts/web/src/lib/activity-format.ts`

- [ ] **Step 1: Add labels**

In `artifacts/web/src/lib/activity-format.ts`, add to `ACTION_LABELS` (after the profile-tamper entries from sub-project 1):
```typescript
  "user.course_added": "joined a course",
  "user.course_removed": "left a course",
```

- [ ] **Step 2: Full typecheck**

Run: `corepack pnpm run typecheck`
Expected: PASS across all packages.

- [ ] **Step 3: Run the api-server test suite**

Run (`.env` loaded): `corepack pnpm --filter @workspace/api-server run test`
Expected: all pass, including `enrollments.service.test.ts`.

- [ ] **Step 4: Manual UI check**

Both servers running (API rebuilt + restarted from package dir; web on :5173). Then:
1. Log in as `noa.student@knowledgebank.demo` → Profile → **Enrolled courses** lists her courses; search a code (e.g. `IS420`), click a result → it's added; click × → removed.
2. Log in as `maya.cohen@knowledgebank.demo` (lecturer) → Profile → heading reads **Taught courses**; add/remove works; added rows are `lecturer` role (verify in DB if desired).
3. Log in as `admin@knowledgebank.demo` → Profile shows **no** courses section.

- [ ] **Step 5: Final confirmation**

Report typecheck, test counts, and manual results. No commit (all committed in Tasks 1–5).

---

## Self-Review

**Spec coverage:**
- Student add/remove/search enrolled courses → Tasks 1 (service), 2 (search), 3 (routes), 4 (UI). ✓
- Lecturer add/remove/search taught courses → same, role derived `lecturer` → Task 1 `roleInCourseFor`. ✓
- Students/lecturers cannot create courses → no create endpoint added; only enrollment. ✓
- Role-based layout (Enrolled vs Taught; admin none) → Task 4 heading + `!isAdmin` gate. ✓
- `roleInCourse` server-derived; admin → 403 → Task 1 (`roleInCourseFor`) + tests. ✓
- Course search server-side → Task 2. ✓
- Audit course added/removed → Task 1 + Task 5 labels. ✓
- Backwards compatibility (optional `q`/`limit`, additive endpoints) → Tasks 2, 3. ✓

**Placeholder scan:** No TBD/placeholder; every code step has full code; commands have expected output. The two `>` notes are conditional fallbacks for generated-name drift, each with a concrete action — not placeholders.

**Type consistency:** `MyCourse` (`id, code, title, lecturerName, roleInCourse`) is identical across the service (Task 1), OpenAPI schema (Task 3), and UI consumption (Task 4). `roleInCourseFor` returns `"student" | "lecturer"`. `addMyCourse({ data: { courseId } })` matches the generated mutation var shape (JSON body op); `removeMyCourse({ courseId })` matches a path-param-only op. `listMyCourses`/`addMyCourse`/`removeMyCourse` names match between service, routes, and operationIds.
