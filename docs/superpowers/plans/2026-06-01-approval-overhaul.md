# Upload Permissions & Approval Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open uploads to any authenticated user/any course; route student uploads to course lecturers, restricted-type files (configurable extension list) to a new admin-approval stage; add the admin queue, notifications, and audit.

**Architecture:** Restricted-ness is recomputed from the file's `originalFilename` (no DB column). A new status `pending_admin_approval` joins the review-hidden set. Upload decides status per file by role × restricted-type. `approveDocument` branches restricted → `pending_admin_approval`; a new admin-only `adminApproveDocument` finalizes; `rejectDocument` handles both stages. Notifications fan out to course lecturers / admins. The lecturer review queue is unchanged; a new admin queue page handles the admin stage.

**Tech Stack:** TypeScript, Express, Prisma/Postgres, Zod, OpenAPI + orval, React, TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-01-approval-overhaul-design.md`

**Environment (Windows dev):** load `.env` before DB commands; rebuild + restart the API from the package dir after source changes (stop 8080 → `... run build` → `... run start`).

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `artifacts/api-server/src/lib/env.ts` | Modify | `restrictedFileExtensions` env. |
| `artifacts/api-server/src/lib/restricted-files.ts` | Create | `isRestrictedFilename`. |
| `artifacts/api-server/src/lib/restricted-files.test.ts` | Create | Pure test. |
| `artifacts/api-server/src/services/permissions.service.ts` | Modify | Open `canUpload`/`canUploadToCourse`; add hidden status. |
| `artifacts/api-server/src/repositories/enrollments.repo.ts` | Modify | `findCourseLecturerIds`. |
| `artifacts/api-server/src/repositories/documents.repo.ts` | Modify | admin-queue queries + `findOriginalFilename`. |
| `artifacts/api-server/src/services/documents.service.ts` | Modify | upload status/notify; approve/admin-approve/reject; admin queue. |
| `artifacts/api-server/src/services/documents.approval.test.ts` | Create | Service tests. |
| `artifacts/api-server/src/services/documents.studentUpload.test.ts` | Modify | New upload behavior. |
| `artifacts/api-server/src/routes/documents.ts` | Modify | admin-queue + admin-approve routes; upload gate copy. |
| `lib/api-spec/openapi.yaml` | Modify | new ops. |
| `lib/api-zod/*`, `lib/api-client-react/*` | Generated | codegen. |
| `artifacts/web/src/pages/upload.tsx` | Modify | all courses; drop autosubmit. |
| `artifacts/web/src/pages/admin-approvals.tsx` | Create | admin approval queue. |
| `artifacts/web/src/App.tsx` | Modify | `/admin/approvals` route. |
| `artifacts/web/src/components/layout.tsx` | Modify | admin nav. |
| `artifacts/web/src/lib/activity-format.ts` | Modify | audit labels. |
| `artifacts/web/src/components/notification-bell.tsx` | Modify | notif labels. |

---

### Task 1: Restricted file types (config + pure helper) — TDD

**Files:**
- Modify: `artifacts/api-server/src/lib/env.ts`
- Create: `artifacts/api-server/src/lib/restricted-files.ts`, `artifacts/api-server/src/lib/restricted-files.test.ts`

- [ ] **Step 1: Add the env field**

In `artifacts/api-server/src/lib/env.ts`, add a default constant near `DEFAULT_ALLOWED_MIME_TYPES` (top):
```typescript
const DEFAULT_RESTRICTED_FILE_EXTENSIONS = "zip,rar,7z,exe,msi,bat,cmd,apk,iso";
```
In the schema object (next to `ALLOWED_MIME_TYPES: csvList.default(...)`, ~line 68):
```typescript
  RESTRICTED_FILE_EXTENSIONS: csvList.default(DEFAULT_RESTRICTED_FILE_EXTENSIONS),
```
In the exported `env` object (next to `allowedMimeTypes`, ~line 121):
```typescript
  restrictedFileExtensions: e.RESTRICTED_FILE_EXTENSIONS.map((x) => x.toLowerCase()),
```

- [ ] **Step 2: Write the failing test**

Create `artifacts/api-server/src/lib/restricted-files.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { isRestrictedFilename } from "./restricted-files";

describe("isRestrictedFilename", () => {
  it("flags restricted extensions (case-insensitive)", () => {
    expect(isRestrictedFilename("payload.exe")).toBe(true);
    expect(isRestrictedFilename("Archive.ZIP")).toBe(true);
    expect(isRestrictedFilename("rom.iso")).toBe(true);
    expect(isRestrictedFilename("app.apk")).toBe(true);
  });
  it("does not flag normal types", () => {
    expect(isRestrictedFilename("notes.pdf")).toBe(false);
    expect(isRestrictedFilename("slides.pptx")).toBe(false);
    expect(isRestrictedFilename("image.png")).toBe(false);
  });
  it("handles no-extension and dotfiles", () => {
    expect(isRestrictedFilename("README")).toBe(false);
    expect(isRestrictedFilename("archive.")).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run (`.env` loaded): `corepack pnpm --filter @workspace/api-server exec vitest run src/lib/restricted-files.test.ts`
Expected: FAIL — `./restricted-files` not found.

- [ ] **Step 4: Implement the helper**

Create `artifacts/api-server/src/lib/restricted-files.ts`:
```typescript
import { env } from "./env";

/**
 * A file is "restricted" (always requires admin approval) iff its extension is in
 * the configured restricted set. Recomputed on demand — no DB column.
 */
export function isRestrictedFilename(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return false;
  const ext = name.slice(dot + 1).toLowerCase();
  return env.restrictedFileExtensions.includes(ext);
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `corepack pnpm --filter @workspace/api-server exec vitest run src/lib/restricted-files.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```
git add artifacts/api-server/src/lib/env.ts artifacts/api-server/src/lib/restricted-files.ts artifacts/api-server/src/lib/restricted-files.test.ts
git commit -m "feat(api): configurable restricted file-type detection"
```

---

### Task 2: Permissions — open uploads + hidden status

**Files:**
- Modify: `artifacts/api-server/src/services/permissions.service.ts`

- [ ] **Step 1: Add the admin-approval status to the hidden set**

Replace line 47:
```typescript
const REVIEW_HIDDEN_STATUSES = ["draft", "pending_review", "rejected", "pending_admin_approval"] as const;
```

- [ ] **Step 2: Open `canUpload`**

Replace `canUpload` (lines 256–265):
```typescript
export function canUpload(user: AuthenticatedUser): boolean {
  // Uploads are open to any authenticated user (course membership now
  // affects approval routing only, not upload permission). Kept as a
  // function so the route/service call sites stay unchanged.
  return !!user;
}
```

- [ ] **Step 3: Open `canUploadToCourse`**

Replace `canUploadToCourse` (lines 280–295):
```typescript
export function canUploadToCourse(
  _user: AuthenticatedUser,
  _courseId: string | null | undefined,
): boolean {
  // Any authenticated user may upload to any course; the approval
  // workflow (lecturer → admin) governs visibility, not membership.
  return true;
}
```

- [ ] **Step 4: Typecheck**

Run: `corepack pnpm --filter @workspace/api-server run typecheck`
Expected: PASS (unused-var lint may warn on `_user`/`_courseId`; the leading underscore satisfies the convention used elsewhere).

- [ ] **Step 5: Commit**

```
git add artifacts/api-server/src/services/permissions.service.ts
git commit -m "feat(api): open uploads to any user/course; hide pending_admin_approval"
```

---

### Task 3: Repository additions

**Files:**
- Modify: `artifacts/api-server/src/repositories/enrollments.repo.ts`
- Modify: `artifacts/api-server/src/repositories/documents.repo.ts`

- [ ] **Step 1: Course lecturers query**

Append to `artifacts/api-server/src/repositories/enrollments.repo.ts`:
```typescript
/** User ids of all lecturers assigned to a course (roleInCourse='lecturer'). */
export async function findCourseLecturerIds(courseId: string): Promise<string[]> {
  const rows = await db.courseEnrollment.findMany({
    where: { courseId, roleInCourse: "lecturer" },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}
```

- [ ] **Step 2: Admin-queue queries + filename lookup**

Append to `artifacts/api-server/src/repositories/documents.repo.ts`:
```typescript
export async function countPendingAdminApproval(): Promise<number> {
  return db.document.count({
    where: { deletedAt: null, status: "pending_admin_approval" },
  });
}

export async function listPendingAdminApproval(
  options: { page: number; pageSize: number },
): Promise<DocumentRow[]> {
  return db.document.findMany({
    where: { deletedAt: null, status: "pending_admin_approval" },
    orderBy: [
      { submittedForReviewAt: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
    ],
    take: options.pageSize,
    skip: (options.page - 1) * options.pageSize,
  });
}

/** The current file's original filename for a document (for restricted-type checks). */
export async function findOriginalFilename(documentId: string): Promise<string | null> {
  const f = await db.documentFile.findFirst({
    where: { documentId },
    select: { originalFilename: true },
  });
  return f?.originalFilename ?? null;
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `corepack pnpm --filter @workspace/api-server run typecheck`
Expected: PASS.
```
git add artifacts/api-server/src/repositories/enrollments.repo.ts artifacts/api-server/src/repositories/documents.repo.ts
git commit -m "feat(api): repo queries for admin approval queue + course lecturers"
```

---

### Task 4: Upload — per-file status, restricted acceptance, notifications

**Files:**
- Modify: `artifacts/api-server/src/services/documents.service.ts`

- [ ] **Step 1: Import the helper + repos**

Ensure these imports exist at the top of `documents.service.ts` (add any missing):
```typescript
import { isRestrictedFilename } from "../lib/restricted-files";
import * as enrollmentsRepo from "../repositories/enrollments.repo";
import * as usersRepo from "../repositories/users.repo";
```

- [ ] **Step 2: Replace the student force-draft + course gate block**

Replace lines 846–879 (the `isStudent` force-draft block AND the `canUploadToCourse` gate block) with:
```typescript
  // Uploads are open (SP4): any authenticated user may upload to any
  // course. Students still must target a course so the review router can
  // find lecturer reviewers. Status is decided per-file below (by role ×
  // restricted-type), so we no longer force a single status here.
  const isStudent =
    !permissions.isAdmin(user) &&
    !user.roles.includes("lecturer") &&
    user.roles.includes("student");
  if (isStudent && !input.courseId) {
    throw badRequest("Please select a course for your upload so it can be reviewed.");
  }
```

- [ ] **Step 3: Replace the MIME acceptance check to allow restricted extensions**

Replace lines 927–938 (the `disallowed_mime` block) with:
```typescript
      const restricted = isRestrictedFilename(file.originalname);
      // Restricted extensions are allowed-but-gated (they route to admin
      // approval), so they bypass the MIME allowlist. Everything else must
      // be an allowlisted MIME type.
      if (
        !restricted &&
        env.allowedMimeTypes.length > 0 &&
        !env.allowedMimeTypes.includes(file.mimetype)
      ) {
        results.push({
          originalFilename: file.originalname,
          success: false,
          error: `Disallowed mime type: ${file.mimetype}`,
          errorCode: "disallowed_mime",
        });
        continue;
      }
```
(The following `mimeMatchesContent` check stays as-is — it only meaningfully constrains allowlisted types; restricted archives/binaries won't match a sniffable text/image signature, but `mimeMatchesContent` returns true for types it doesn't know how to sniff. Verify in Step 6 smoke that a `.zip`/`.exe` uploads.)

- [ ] **Step 4: Decide status per file at insert + notify**

Replace the insert `status` line (1043) `status: input.status ?? "published",` with:
```typescript
        status: isStudent
          ? "pending_review"
          : restricted && !permissions.isAdmin(user)
            ? "pending_admin_approval"
            : "published",
```
Then, immediately after the successful insert + `document.upload` audit (after line ~1099, inside the loop, after `auditService.record(... "document.upload" ...)`), add routing notifications:
```typescript
      // SP4 approval routing notifications.
      if (isStudent && input.courseId) {
        const lecturerIds = await enrollmentsRepo.findCourseLecturerIds(input.courseId);
        for (const lecturerId of lecturerIds) {
          await notificationsService.notify({
            recipientId: lecturerId,
            actorId: user.id,
            type: "document.review_requested",
            subjectType: "document",
            subjectId: docId,
            body: `New upload "${title}" awaiting your review.`,
            url: "/review-queue",
          });
        }
      } else if (restricted && !permissions.isAdmin(user)) {
        const adminIds = await usersRepo.findAdminUserIds();
        for (const adminId of adminIds) {
          await notificationsService.notify({
            recipientId: adminId,
            actorId: user.id,
            type: "document.admin_review_requested",
            subjectType: "document",
            subjectId: docId,
            body: `Restricted file "${title}" awaiting admin approval.`,
            url: "/admin/approvals",
          });
        }
      }
```

- [ ] **Step 5: Remove the route auto-submit detour (now dead)**

In `artifacts/api-server/src/routes/documents.ts`, delete the `if (body.autoSubmitForReview) { ... }` block (lines ~368–388) — student uploads now land in `pending_review` directly, so there is nothing to auto-submit. (Leave the `autoSubmitForReview` field in the body schema; it's simply ignored.)

- [ ] **Step 6: Typecheck (full upload test comes in Task 8)**

Run: `corepack pnpm --filter @workspace/api-server run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```
git add artifacts/api-server/src/services/documents.service.ts artifacts/api-server/src/routes/documents.ts
git commit -m "feat(api): open uploads + per-file approval routing + notifications"
```

---

### Task 5: Approval transitions (approve/admin-approve/reject) + admin queue — TDD

**Files:**
- Modify: `artifacts/api-server/src/services/documents.service.ts`
- Create: `artifacts/api-server/src/services/documents.approval.test.ts`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/services/documents.approval.test.ts`:
```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { uploadDocuments, approveDocument, adminApproveDocument, rejectDocument, listPendingAdminApproval } from "./documents.service";

const SX = `_appr_${Date.now().toString(36)}`;
let courseId: string;
let lecturerId: string;
let studentId: string;
let adminId: string;

function authed(id: string, role: string, enroll: { courseId: string; roleInCourse: string }[] = []): AuthenticatedUser {
  return {
    id, email: `${id}@demo`, displayName: id, isActive: true,
    primaryRole: role, roles: [role], enrollments: enroll,
    username: null, avatarStoragePath: null, createdAt: new Date().toISOString(),
  };
}
function file(name: string, mime: string, body = "data") {
  return { fieldname: "files", originalname: name, encoding: "7bit", mimetype: mime, size: body.length, buffer: Buffer.from(body), stream: null as never, destination: "", filename: name, path: "" } as Express.Multer.File;
}

beforeAll(async () => {
  const adminRole = (await db.role.findFirst({ where: { name: "admin" } })) ?? (await db.role.create({ data: { name: "admin" } }));
  const c = await db.course.create({ data: { code: `AP${SX}`.slice(0, 20), title: "Appr", lecturerName: "L" } });
  courseId = c.id;
  const l = await db.user.create({ data: { email: `l${SX}@demo`, passwordHash: "x", displayName: "L" } });
  const s = await db.user.create({ data: { email: `s${SX}@demo`, passwordHash: "x", displayName: "S" } });
  const a = await db.user.create({ data: { email: `a${SX}@demo`, passwordHash: "x", displayName: "A", primaryRoleId: adminRole.id } });
  await db.userRole.create({ data: { userId: a.id, roleId: adminRole.id } });
  lecturerId = l.id; studentId = s.id; adminId = a.id;
  await db.courseEnrollment.create({ data: { userId: l.id, courseId, roleInCourse: "lecturer" } });
});

afterAll(async () => {
  await db.document.deleteMany({ where: { uploaderId: { in: [lecturerId, studentId, adminId] } } });
  await db.notification.deleteMany({ where: { recipientId: { in: [lecturerId, adminId] } } });
  await db.auditLog.deleteMany({ where: { actorUserId: { in: [lecturerId, studentId, adminId] } } });
  await db.courseEnrollment.deleteMany({ where: { courseId } });
  await db.userRole.deleteMany({ where: { userId: adminId } });
  await db.user.deleteMany({ where: { id: { in: [lecturerId, studentId, adminId] } } });
  await db.course.deleteMany({ where: { id: courseId } });
});

const baseInput = { categoryId: undefined, materialType: "lecture-notes", description: "", tagIds: [] as string[] };

describe("approval overhaul", () => {
  it("student upload (any course, not enrolled) → pending_review + notifies lecturers", async () => {
    const [r] = await uploadDocuments({ ...baseInput, files: [file("notes.pdf", "application/pdf")], visibility: "public", courseId }, authed(studentId, "student"));
    expect(r.success).toBe(true);
    expect(r.document!.status).toBe("pending_review");
    const notif = await db.notification.findFirst({ where: { recipientId: lecturerId, type: "document.review_requested" } });
    expect(notif).not.toBeNull();
  });

  it("lecturer normal upload → published; restricted → pending_admin_approval + notifies admins", async () => {
    const [n] = await uploadDocuments({ ...baseInput, files: [file("deck.pdf", "application/pdf")], visibility: "public", courseId }, authed(lecturerId, "lecturer", [{ courseId, roleInCourse: "lecturer" }]));
    expect(n.document!.status).toBe("published");
    const [z] = await uploadDocuments({ ...baseInput, files: [file("bundle.zip", "application/zip")], visibility: "public", courseId }, authed(lecturerId, "lecturer", [{ courseId, roleInCourse: "lecturer" }]));
    expect(z.document!.status).toBe("pending_admin_approval");
    const notif = await db.notification.findFirst({ where: { recipientId: adminId, type: "document.admin_review_requested" } });
    expect(notif).not.toBeNull();
  });

  it("approve: normal student doc → approved; restricted → pending_admin_approval", async () => {
    const [normal] = await uploadDocuments({ ...baseInput, files: [file("hw.pdf", "application/pdf")], visibility: "public", courseId }, authed(studentId, "student"));
    const approved = await approveDocument(normal.document!.id, authed(lecturerId, "lecturer", [{ courseId, roleInCourse: "lecturer" }]));
    expect(approved.status).toBe("approved");

    const [restricted] = await uploadDocuments({ ...baseInput, files: [file("proj.zip", "application/zip")], visibility: "public", courseId }, authed(studentId, "student"));
    const afterLecturer = await approveDocument(restricted.document!.id, authed(lecturerId, "lecturer", [{ courseId, roleInCourse: "lecturer" }]));
    expect(afterLecturer.status).toBe("pending_admin_approval");
    const final = await adminApproveDocument(restricted.document!.id, authed(adminId, "admin"));
    expect(final.status).toBe("approved");
  });

  it("adminApproveDocument rejects non-admins", async () => {
    const [d] = await uploadDocuments({ ...baseInput, files: [file("x.zip", "application/zip")], visibility: "public", courseId }, authed(lecturerId, "lecturer", [{ courseId, roleInCourse: "lecturer" }]));
    await expect(adminApproveDocument(d.document!.id, authed(lecturerId, "lecturer", [{ courseId, roleInCourse: "lecturer" }]))).rejects.toMatchObject({ status: 403 });
  });

  it("reject works from pending_admin_approval (admin) and pending_review (lecturer)", async () => {
    const [d] = await uploadDocuments({ ...baseInput, files: [file("y.zip", "application/zip")], visibility: "public", courseId }, authed(lecturerId, "lecturer", [{ courseId, roleInCourse: "lecturer" }]));
    const rej = await rejectDocument(d.document!.id, "not allowed", authed(adminId, "admin"));
    expect(rej.status).toBe("rejected");

    const [s] = await uploadDocuments({ ...baseInput, files: [file("z.pdf", "application/pdf")], visibility: "public", courseId }, authed(studentId, "student"));
    const rej2 = await rejectDocument(s.document!.id, "needs work", authed(lecturerId, "lecturer", [{ courseId, roleInCourse: "lecturer" }]));
    expect(rej2.status).toBe("rejected");
  });

  it("listPendingAdminApproval is admin-only", async () => {
    await expect(listPendingAdminApproval(authed(lecturerId, "lecturer", [{ courseId, roleInCourse: "lecturer" }]), { page: 1, pageSize: 20 })).rejects.toMatchObject({ status: 403 });
    const page = await listPendingAdminApproval(authed(adminId, "admin"), { page: 1, pageSize: 20 });
    expect(Array.isArray(page.items)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (`.env` loaded): `corepack pnpm --filter @workspace/api-server exec vitest run src/services/documents.approval.test.ts`
Expected: FAIL — `adminApproveDocument` / `listPendingAdminApproval` not exported (and approve doesn't branch on restricted yet).

- [ ] **Step 3: Branch `approveDocument` on restricted type**

In `documents.service.ts`, replace the body of `approveDocument` from the `const affected = ...` block through the notify (lines 661–693) with:
```typescript
  const restricted = isRestrictedFilename(
    (await docsRepo.findOriginalFilename(id)) ?? "",
  );
  const nextStatus = restricted ? "pending_admin_approval" : "approved";
  const affected = await docsRepo.updateDocumentByIdIfStatus(id, "pending_review", {
    status: nextStatus,
    reviewedBy: user.id,
    reviewedAt: new Date(),
    reviewReason: null,
    updatedAt: new Date(),
    updatedBy: user.id,
  });
  if (affected === 0) {
    throw badRequest("Document is no longer pending review");
  }
  await auditService.record(user.id, "document.approve", "document", id, {
    to: nextStatus,
  });
  if (restricted) {
    const adminIds = await usersRepo.findAdminUserIds();
    for (const adminId of adminIds) {
      void notificationsService
        .notify({
          recipientId: adminId,
          actorId: user.id,
          type: "document.admin_review_requested",
          subjectType: "document",
          subjectId: id,
          body: `Restricted file "${doc.title}" awaiting admin approval.`,
          url: "/admin/approvals",
        })
        .catch(() => {});
    }
  } else {
    void notificationsService
      .notify({
        recipientId: doc.uploaderId,
        actorId: user.id,
        type: "document.approved",
        subjectType: "document",
        subjectId: id,
        body: `Your document "${doc.title}" was approved.`,
        url: `/documents/${id}`,
      })
      .catch(() => {});
  }
```

- [ ] **Step 4: Add `adminApproveDocument`**

Insert after `approveDocument` (before `rejectDocument`):
```typescript
export async function adminApproveDocument(
  id: string,
  user: AuthenticatedUser,
): Promise<DocumentDTO> {
  if (!permissions.isAdmin(user)) throw forbidden("Only admins can approve restricted files");
  const doc = await docsRepo.findByIdAlive(id);
  if (!doc) throw notFound("Document not found");
  if (doc.status !== "pending_admin_approval") {
    throw badRequest(
      `Only documents in 'pending_admin_approval' can be admin-approved (was '${doc.status}')`,
    );
  }
  const affected = await docsRepo.updateDocumentByIdIfStatus(id, "pending_admin_approval", {
    status: "approved",
    reviewedBy: user.id,
    reviewedAt: new Date(),
    reviewReason: null,
    updatedAt: new Date(),
    updatedBy: user.id,
  });
  if (affected === 0) throw badRequest("Document is no longer pending admin approval");
  await auditService.record(user.id, "document.admin_approve", "document", id);
  void notificationsService
    .notify({
      recipientId: doc.uploaderId,
      actorId: user.id,
      type: "document.approved",
      subjectType: "document",
      subjectId: id,
      body: `Your document "${doc.title}" was approved.`,
      url: `/documents/${id}`,
    })
    .catch(() => {});
  const updated = await docsRepo.findByIdAlive(id);
  if (!updated) throw notFound("Document not found");
  const [assembled] = await assembleDocuments([updated], user);
  return assembled;
}
```

- [ ] **Step 5: Generalize `rejectDocument` to both stages**

Replace the permission + status check + CAS + audit in `rejectDocument` (lines 715–738) with:
```typescript
  if (doc.status === "pending_review") {
    if (!permissions.canReview(doc, user)) throw forbidden("Cannot review this document");
  } else if (doc.status === "pending_admin_approval") {
    if (!permissions.isAdmin(user)) throw forbidden("Only admins can reject at admin approval");
  } else {
    throw badRequest(
      `Only documents in review can be rejected (was '${doc.status}')`,
    );
  }
  const fromStatus = doc.status;
  const affected = await docsRepo.updateDocumentByIdIfStatus(id, fromStatus, {
    status: "rejected",
    reviewedBy: user.id,
    reviewedAt: new Date(),
    reviewReason: trimmed,
    updatedAt: new Date(),
    updatedBy: user.id,
  });
  if (affected === 0) {
    throw badRequest("Document is no longer awaiting review");
  }
  await auditService.record(
    user.id,
    fromStatus === "pending_admin_approval" ? "document.admin_reject" : "document.reject",
    "document",
    id,
  );
```

- [ ] **Step 6: Add `listPendingAdminApproval`**

Insert after `listPendingReview`:
```typescript
export async function listPendingAdminApproval(
  user: AuthenticatedUser,
  opts: { page: number; pageSize: number },
): Promise<ListPendingReviewResult> {
  if (!permissions.isAdmin(user)) {
    throw forbidden("Only admins can access the admin approval queue");
  }
  const [total, rows] = await Promise.all([
    docsRepo.countPendingAdminApproval(),
    docsRepo.listPendingAdminApproval(opts),
  ]);
  const items = await assembleDocuments(rows, user);
  return { items, total, page: opts.page, pageSize: opts.pageSize };
}
```

- [ ] **Step 7: Run it to verify it passes**

Run: `corepack pnpm --filter @workspace/api-server exec vitest run src/services/documents.approval.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 8: Commit**

```
git add artifacts/api-server/src/services/documents.service.ts artifacts/api-server/src/services/documents.approval.test.ts
git commit -m "feat(api): admin-approval stage (approve/admin-approve/reject) + queue"
```

---

### Task 6: Routes + OpenAPI + codegen

**Files:**
- Modify: `artifacts/api-server/src/routes/documents.ts`
- Modify: `lib/api-spec/openapi.yaml`

- [ ] **Step 1: Add the admin-queue + admin-approve routes**

In `artifacts/api-server/src/routes/documents.ts`, add **before** the `/documents/pending-review` route (so neither is swallowed by `/documents/:id`; both are static so order among them is fine, but keep them grouped above `:id`):
```typescript
router.get("/documents/pending-admin-approval", requireAuth, async (req, res, next) => {
  try {
    const q = ListPendingReviewDocumentsQueryParams.parse(req.query);
    const result = await documentsService.listPendingAdminApproval(req.authUser!, {
      page: q.page,
      pageSize: q.pageSize,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/documents/:id/admin-approve", requireAuth, async (req, res, next) => {
  try {
    const { id } = ApproveDocumentParams.parse(req.params);
    const dto = await documentsService.adminApproveDocument(id, req.authUser!);
    res.json(dto);
  } catch (err) {
    next(err);
  }
});
```
(Reuses the existing `ListPendingReviewDocumentsQueryParams` + `ApproveDocumentParams` zod schemas.)

- [ ] **Step 2: Update the upload gate copy**

In the `/documents/upload` pre-handler (lines ~323–335), since `canUpload` is now always-true for authenticated users, simplify the forbidden message (it should never fire, but keep it accurate):
```typescript
  (req, res, next) => {
    if (!req.authUser) return next(forbidden("You must be signed in to upload."));
    next();
  },
```

- [ ] **Step 3: OpenAPI ops**

In `lib/api-spec/openapi.yaml`, add next to the review ops (after `/documents/{id}/reject`):
```yaml
  /documents/pending-admin-approval:
    get:
      operationId: listPendingAdminApprovalDocuments
      tags: [documents]
      summary: Admin approval queue — restricted-type docs awaiting admin sign-off
      parameters:
        - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
        - { in: query, name: pageSize, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
      responses:
        "200":
          description: Pending admin-approval page
          content:
            application/json:
              schema: { $ref: "#/components/schemas/DocumentPage" }
  /documents/{id}/admin-approve:
    post:
      operationId: adminApproveDocument
      tags: [documents]
      summary: Admin-approve a document in 'pending_admin_approval'
      parameters:
        - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
      responses:
        "200":
          description: Updated document
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Document" }
```

- [ ] **Step 4: Codegen + full typecheck**

Run:
```
corepack pnpm --filter @workspace/api-spec run codegen
corepack pnpm run typecheck
```
Expected: codegen adds `useListPendingAdminApprovalDocuments`/`getListPendingAdminApprovalDocumentsQueryKey` + `useAdminApproveDocument`; full typecheck PASS.

- [ ] **Step 5: Rebuild + restart + smoke**

Stop 8080 → `corepack pnpm --filter @workspace/api-server run build` → `... run start` (bg, `.env`). Then:
```
$base='http://localhost:8080/api'
# lecturer uploads a restricted zip → should land pending_admin_approval
Invoke-RestMethod "$base/auth/login" -Method Post -ContentType 'application/json' -Body '{"email":"maya.cohen@knowledgebank.demo","password":"Demo1234!"}' -SessionVariable m | Out-Null
$tmp = Join-Path $env:TEMP 'r.zip'; [System.IO.File]::WriteAllBytes($tmp, [byte[]](0x50,0x4b,0x03,0x04,0,0,0,0))
$cid = (Invoke-RestMethod "$base/courses?q=CS101" -WebSession $m)[0].id
$code = & curl.exe -s -o NUL -w "%{http_code}" -b (Join-Path $env:TEMP 'm.cj') "$base" 2>$null
# (use curl with cookie jar for multipart; or verify via admin queue:)
Invoke-RestMethod "$base/auth/login" -Method Post -ContentType 'application/json' -Body '{"email":"admin@knowledgebank.demo","password":"Demo1234!"}' -SessionVariable s | Out-Null
"admin queue => HTTP " + ((Invoke-WebRequest "$base/documents/pending-admin-approval" -WebSession $s).StatusCode)
```
Expected: the admin queue endpoint returns 200. (Full upload→approve chain is covered by the Task 5 service test + the Task 8 manual check.)

- [ ] **Step 6: Commit**

```
git add artifacts/api-server/src/routes/documents.ts lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react
git commit -m "feat(api): admin approval queue + admin-approve endpoints + client"
```

---

### Task 7: Frontend — open upload, admin approvals page

**Files:**
- Modify: `artifacts/web/src/pages/upload.tsx`
- Create: `artifacts/web/src/pages/admin-approvals.tsx`
- Modify: `artifacts/web/src/App.tsx`, `artifacts/web/src/components/layout.tsx`

- [ ] **Step 1: Open the upload course picker + drop autosubmit**

In `artifacts/web/src/pages/upload.tsx`:
(a) Replace the `courses` useMemo (the enrolled-only filter, ~lines 195–200) so all users see all courses:
```tsx
  const courses = allCourses;
```
(b) Remove the `autoSubmitForReview` state, the checkbox block (`data-testid="upload-autosubmit-row"`), and the `autoSubmitForReview` field in the upload `fields` object (set it to `undefined` or delete the key).
(c) Update the student notice copy: replace "You can only upload to courses you are enrolled in." with "Uploads go to the course's lecturers for review. Restricted file types (zip, exe, …) also require admin approval."

- [ ] **Step 2: Create the admin approvals page**

Create `artifacts/web/src/pages/admin-approvals.tsx`:
```tsx
import { useState } from "react";
import {
  useListPendingAdminApprovalDocuments,
  getListPendingAdminApprovalDocumentsQueryKey,
  useAdminApproveDocument,
  useRejectDocument,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, Loader2 } from "lucide-react";

export default function AdminApprovals() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const params = { page: 1, pageSize: 20 };
  const { data, isLoading } = useListPendingAdminApprovalDocuments(params, {
    query: { queryKey: getListPendingAdminApprovalDocumentsQueryKey(params) },
  });
  const approveMut = useAdminApproveDocument();
  const rejectMut = useRejectDocument();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getListPendingAdminApprovalDocumentsQueryKey(params) });

  const items = data?.items ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-2.5">
        <div className="rounded-lg bg-primary/10 p-1.5"><ShieldCheck className="h-5 w-5 text-primary" /></div>
        <h1 className="font-serif text-3xl font-bold text-foreground">Admin approvals</h1>
      </div>
      <p className="text-muted-foreground">Restricted-type files awaiting admin sign-off before they publish.</p>
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : items.length > 0 ? (
        <ul className="space-y-3" data-testid="admin-approvals">
          {items.map((d) => (
            <li key={d.id}>
              <Card>
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/documents/${d.id}`} className="min-w-0 truncate font-medium hover:text-primary">
                      {d.title}
                    </Link>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={approveMut.isPending}
                        onClick={() =>
                          approveMut.mutate({ id: d.id }, {
                            onSuccess: () => { refresh(); toast({ title: "Approved & published" }); },
                            onError: () => toast({ variant: "destructive", title: "Could not approve" }),
                          })
                        }
                        data-testid="admin-approve"
                      >
                        {approveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve"}
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => { setRejectingId(d.id); setReason(""); }} data-testid="admin-reject-open">
                        Reject
                      </Button>
                    </div>
                  </div>
                  {rejectingId === d.id && (
                    <div className="space-y-2">
                      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for rejection" data-testid="admin-reject-reason" />
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={!reason.trim() || rejectMut.isPending}
                        onClick={() =>
                          rejectMut.mutate({ id: d.id, data: { reason: reason.trim() } }, {
                            onSuccess: () => { setRejectingId(null); refresh(); toast({ title: "Rejected" }); },
                            onError: () => toast({ variant: "destructive", title: "Could not reject" }),
                          })
                        }
                        data-testid="admin-reject-confirm"
                      >
                        Confirm rejection
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed bg-card py-16 text-center">
          <p className="text-muted-foreground">Nothing awaiting admin approval.</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Route + admin nav**

In `artifacts/web/src/App.tsx`, import `AdminApprovals` and add (next to other `/admin/*` routes):
```tsx
      <Route path="/admin/approvals">
        <AuthGuard requireRole="admin">
          <Layout>
            <AdminApprovals />
          </Layout>
        </AuthGuard>
      </Route>
```
In `artifacts/web/src/components/layout.tsx`, add `ShieldCheck` to the imports (if not present) and add to the admin `moreNav` block (after "Review" / before "Orphaned Files"):
```tsx
              { href: "/admin/approvals", icon: ShieldCheck, label: "Admin Approvals" },
```

- [ ] **Step 4: Typecheck web**

Run: `corepack pnpm --filter @workspace/web run typecheck`
Expected: PASS.

> If `useListPendingAdminApprovalDocuments`/query-key names differ, grep the generated `api.ts` and use the exact exports.

- [ ] **Step 5: Commit**

```
git add artifacts/web/src/pages/upload.tsx artifacts/web/src/pages/admin-approvals.tsx artifacts/web/src/App.tsx artifacts/web/src/components/layout.tsx
git commit -m "feat(web): open upload course picker + admin approvals queue page"
```

---

### Task 8: Update existing tests, labels, full verification

**Files:**
- Modify: `artifacts/api-server/src/services/documents.studentUpload.test.ts`
- Modify: `artifacts/web/src/lib/activity-format.ts`, `artifacts/web/src/components/notification-bell.tsx`

- [ ] **Step 1: Update the student-upload test to the new behavior**

Open `artifacts/api-server/src/services/documents.studentUpload.test.ts` and update assertions to the SP4 contract:
- A student upload now lands in `status === "pending_review"` (not `"draft"`).
- A student uploading to a course they are **not** enrolled in now **succeeds** (no `403`) — uploads are open.
- A student upload with **no** `courseId` still fails (`400`, "select a course").
- Lecturer normal upload → `"published"`; lecturer restricted (e.g. `.zip`) → `"pending_admin_approval"`.
Remove assertions asserting forced-`draft` or enrollment-gated rejection. Keep the file/fixtures; only change expectations.

- [ ] **Step 2: Audit + notification labels**

In `artifacts/web/src/lib/activity-format.ts`, add to `ACTION_LABELS`:
```typescript
  "document.admin_approve": "admin-approved",
  "document.admin_reject": "admin-rejected",
```
In `artifacts/web/src/components/notification-bell.tsx` `typeLabel`, add cases:
```typescript
    case "document.review_requested":
      return "sent you a document to review";
    case "document.admin_review_requested":
      return "needs admin approval";
    case "document.approved":
      return "approved your document";
    case "document.rejected":
      return "rejected your document";
```

- [ ] **Step 3: Full typecheck**

Run: `corepack pnpm run typecheck`
Expected: PASS.

- [ ] **Step 4: Full api-server suite**

Run (`.env` loaded): `corepack pnpm --filter @workspace/api-server run test`
Expected: all pass, including `restricted-files`, `documents.approval`, and the updated `documents.studentUpload`. If `documents.review.test.ts` has an assertion that encodes old behavior (its docs are non-restricted, so approve→approved still holds; reject still works), fix only the assertions that changed.

- [ ] **Step 5: Keep the Sprint-2 smoke green**

Ensure both servers are up (API rebuilt + restarted, web :5173). Run the nav-gating + lecturer-upload smoke:
```
$env:PLAYWRIGHT_BASE_URL='http://localhost:5173'
corepack pnpm --filter @workspace/web exec playwright test sprint2-smoke.spec.ts --reporter=list
```
Expected: all pass (lecturer upload still publishes a normal file; nav gating unchanged).

- [ ] **Step 6: Manual chain check**

1. Log in as a **student** (`noa.student@…`) → Upload a normal PDF to **any** course (even one she's not enrolled in) → it succeeds and is not publicly visible yet.
2. Log in as that course's **lecturer** (`maya.cohen@…`) → Review queue shows it → Approve → it publishes.
3. As the student, upload a **.zip** → lecturer approves → it moves to **Admin approvals** (not published).
4. As **admin** → Admin Approvals → Approve → it publishes (uploader notified). Reject path works too.
5. As a **lecturer**, upload a **.zip** → goes straight to Admin Approvals.

- [ ] **Step 7: Commit**

```
git add artifacts/api-server/src/services/documents.studentUpload.test.ts artifacts/web/src/lib/activity-format.ts artifacts/web/src/components/notification-bell.tsx
git commit -m "test/web: update student-upload expectations + approval labels"
```

---

## Self-Review

**Spec coverage:**
- §10 open uploads → Task 2 (`canUpload`/`canUploadToCourse`) + Task 4 (remove gate) + Task 7 (web). ✓
- §11 student → lecturer → (restricted) admin → Tasks 4 (status), 5 (approve branch + admin-approve). ✓
- §12 lecturer normal auto-publish / restricted → admin → Task 4 (status) + 5. ✓
- §13 configurable restricted file types, always admin → Task 1 + the restricted branch. ✓
- §14 admin approval queue (approve/reject/notes, notify) → Tasks 5 (service), 6 (routes), 7 (UI). ✓
- §15 lecturer queue integration (no duplicate) → review-queue unchanged; restricted leaves it on approval. ✓
- §16 notifications (lecturer/admin/uploader) → Task 4 + 5 + 8 (labels). ✓
- §17 audit (approve/reject/admin) → Task 5 (`document.approve`/`admin_approve`/`reject`/`admin_reject`) + 8 (labels). ✓

**Placeholder scan:** Each code step has complete code; commands have expected output. The smoke in Task 6 Step 5 is a best-effort endpoint check (the authoritative upload→approve coverage is the Task 5 service test + Task 8 manual chain) — labeled as such, not a placeholder.

**Type consistency:** new status literal `"pending_admin_approval"` is identical in permissions (hidden set), repo queries, service transitions, and tests. `adminApproveDocument(id, user)` ↔ route `{ id }` ↔ generated `useAdminApproveDocument({ id })`. `listPendingAdminApproval` returns `ListPendingReviewResult` (`{items,total,page,pageSize}`) → OpenAPI `DocumentPage` (same shape as the review queue). `document.review_requested` / `document.admin_review_requested` notification types match between upload (Task 4), approve (Task 5), and the bell labels (Task 8). `isRestrictedFilename` is the single restricted-type oracle used at upload (Task 4) and approve (Task 5).
