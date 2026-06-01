# Account Deletion & Orphaned Files — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Self-service account soft-delete with 30-day recovery, deleted-identity masking, admin notification, an orphaned-files review workflow, and admin restore/purge (anonymize).

**Architecture:** `deletedAt` (exists) = recoverable tombstone; new `anonymizedAt` = purged. Soft-delete already disables login + hides the user (queries filter `deletedAt`). A new `account.service` handles delete/restore/purge + admin notify; an `orphaned-files.service` lists/reassigns documents owned by deleted users. Masking reuses the existing missing-user fallbacks. Admin surfaces extend the Users page and add an Orphaned-files page. Permanent removal = anonymize the row (scrub PII) — never a hard delete (FKs are Restrict).

**Tech Stack:** TypeScript, Express, Prisma/Postgres, Zod, OpenAPI + orval, React, TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-01-account-deletion-design.md`

**Environment (Windows dev):** DB Docker Postgres on `localhost:5433`. Load `.env` before DB commands:
`Get-Content .env | ForEach-Object { if ($_ -match '^\s*([^#=]+)=(.*)$') { Set-Item -Path "env:$($matches[1].Trim())" -Value $matches[2].Trim() } }`
After API source changes: stop port 8080, `corepack pnpm --filter @workspace/api-server run build`, then `... run start`. The `prisma generate` EPERM on Windows means a node process holds the engine — stop the API first.

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `lib/db/prisma/schema.prisma` | Modify | Add `User.anonymizedAt`. |
| `lib/db/prisma/migrations/20260601010000_account_anonymized/migration.sql` | Create | Add `anonymized_at` column. |
| `artifacts/api-server/src/services/documents.service.ts:164` | Modify | Mask uploader → "Original uploader removed". |
| `artifacts/api-server/src/services/comments.service.ts:67` | Modify | Mask author → "Original author removed". |
| `artifacts/api-server/src/repositories/collection-comments.repo.ts` | Modify | Select author `deletedAt`. |
| `artifacts/api-server/src/services/collection-comments.service.ts` | Modify | Mask deleted author. |
| `artifacts/api-server/src/repositories/users.repo.ts` | Modify | admin ids, deleted list, soft-delete/restore/anonymize. |
| `artifacts/api-server/src/repositories/documents.repo.ts` | Modify | `listByDeletedUploaders`. |
| `artifacts/api-server/src/services/account.service.ts` | Create | delete/restore/purge/list + admin notify. |
| `artifacts/api-server/src/services/account.service.test.ts` | Create | Service + masking tests. |
| `artifacts/api-server/src/services/orphaned-files.service.ts` | Create | list + reassign. |
| `artifacts/api-server/src/services/orphaned-files.service.test.ts` | Create | Service tests. |
| `artifacts/api-server/src/routes/profile.ts` | Modify | `DELETE /me`. |
| `artifacts/api-server/src/routes/users.ts` | Modify | admin deleted-users/restore/purge. |
| `artifacts/api-server/src/routes/admin-orphaned-files.ts` | Create | admin orphaned-files endpoints. |
| `artifacts/api-server/src/routes/index.ts` | Modify | mount the new router. |
| `lib/api-spec/openapi.yaml` | Modify | schemas + ops. |
| `lib/api-zod/*`, `lib/api-client-react/*` | Generated | codegen. |
| `artifacts/web/src/pages/profile.tsx` | Modify | Delete-account section. |
| `artifacts/web/src/components/profile/DeleteAccount.tsx` | Create | Confirm-and-delete. |
| `artifacts/web/src/pages/admin-users.tsx` | Modify | Deleted-accounts section. |
| `artifacts/web/src/pages/admin-orphaned-files.tsx` | Create | Orphaned-files review page. |
| `artifacts/web/src/App.tsx` | Modify | `/admin/orphaned-files` route. |
| `artifacts/web/src/components/layout.tsx` | Modify | admin nav entry. |
| `artifacts/web/src/lib/activity-format.ts` | Modify | audit labels. |
| `artifacts/web/src/components/notification-bell.tsx` | Modify | `account.deleted` label. |

---

### Task 1: Migration — `User.anonymizedAt`

**Files:**
- Modify: `lib/db/prisma/schema.prisma` (User model, near `deletedAt`)
- Create: `lib/db/prisma/migrations/20260601010000_account_anonymized/migration.sql`

- [ ] **Step 1: Add the column to the schema**

In `lib/db/prisma/schema.prisma`, in `model User`, add after the `deletedAt` line:
```prisma
  anonymizedAt  DateTime? @map("anonymized_at") @db.Timestamptz()
```

- [ ] **Step 2: Create the migration SQL**

Create `lib/db/prisma/migrations/20260601010000_account_anonymized/migration.sql`:
```sql
-- Account purge: mark an anonymized (PII-scrubbed) tombstone, distinct from soft-delete.
ALTER TABLE "users" ADD COLUMN "anonymized_at" TIMESTAMPTZ;
```

- [ ] **Step 3: Apply + regenerate**

Stop the API (frees the Prisma engine), then (`.env` loaded):
```
corepack pnpm --filter @workspace/db run migrate
corepack pnpm --filter @workspace/db run generate
```
Expected: migration `20260601010000_account_anonymized` applied; client regenerated.

- [ ] **Step 4: Commit**

```
git add lib/db/prisma/schema.prisma lib/db/prisma/migrations/20260601010000_account_anonymized/
git commit -m "feat(db): add User.anonymizedAt for account purge"
```

---

### Task 2: Identity masking (deleted users)

**Files:**
- Modify: `artifacts/api-server/src/services/documents.service.ts:164`
- Modify: `artifacts/api-server/src/services/comments.service.ts:67`
- Modify: `artifacts/api-server/src/repositories/collection-comments.repo.ts`
- Modify: `artifacts/api-server/src/services/collection-comments.service.ts`
- Create: `artifacts/api-server/src/services/account-masking.test.ts`

- [ ] **Step 1: Write the failing masking test**

Create `artifacts/api-server/src/services/account-masking.test.ts`:
```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { assembleDocuments } from "./documents.service";
import * as docsRepo from "../repositories/documents.repo";

const SX = `_mask_${Date.now().toString(36)}`;
let uploaderId: string;
let docId: string;

const admin: AuthenticatedUser = {
  id: "admin-mask", email: "a@x", displayName: "Adm", isActive: true,
  primaryRole: "admin", roles: ["admin"], enrollments: [],
  username: null, avatarStoragePath: null, createdAt: new Date().toISOString(),
};

beforeAll(async () => {
  const u = await db.user.create({ data: { email: `up${SX}@demo`, passwordHash: "x", displayName: "Will Bedeleted" } });
  uploaderId = u.id;
  const d = await db.document.create({
    data: {
      title: `Doc ${SX}`, description: "", materialType: "lecture-notes", visibility: "public",
      status: "published", uploaderId: u.id, ownerId: u.id, createdBy: u.id, updatedBy: u.id,
    },
  });
  docId = d.id;
  await db.user.update({ where: { id: u.id }, data: { deletedAt: new Date() } });
});

afterAll(async () => {
  await db.document.deleteMany({ where: { id: docId } });
  await db.user.deleteMany({ where: { id: uploaderId } });
});

describe("deleted-uploader masking", () => {
  it("renders 'Original uploader removed' for a soft-deleted uploader", async () => {
    const row = await docsRepo.findByIdAlive(docId);
    const [dto] = await assembleDocuments([row!], admin);
    expect(dto.uploader.displayName).toBe("Original uploader removed");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (`.env` loaded): `corepack pnpm --filter @workspace/api-server exec vitest run src/services/account-masking.test.ts`
Expected: FAIL — `displayName` is `"Unknown"`, not `"Original uploader removed"`.

- [ ] **Step 3: Mask the document uploader fallback**

In `artifacts/api-server/src/services/documents.service.ts`, change the uploader fallback `displayName` (line ~164) from `"Unknown"` to `"Original uploader removed"`:
```typescript
    const uploader = uploadersMap.get(d.uploaderId) ?? {
      id: d.uploaderId,
      email: "",
      displayName: "Original uploader removed",
      roles: [],
      isActive: false,
      status: "ACTIVE",
      createdAt: d.createdAt.toISOString(),
    };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `corepack pnpm --filter @workspace/api-server exec vitest run src/services/account-masking.test.ts`
Expected: PASS.

- [ ] **Step 5: Mask comment author + collection-comment author**

(a) `artifacts/api-server/src/services/comments.service.ts` — change the author fallback `displayName` (line ~67) from `"Unknown"` to `"Original author removed"`.

(b) `artifacts/api-server/src/repositories/collection-comments.repo.ts` — add `deletedAt` to the author select and the `CommentRow` type:
```typescript
export interface CommentRow {
  id: string;
  collectionId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; displayName: string; deletedAt: Date | null };
}
```
and in `withAuthor`:
```typescript
  author: { select: { id: true, displayName: true, deletedAt: true } },
```

(c) `artifacts/api-server/src/services/collection-comments.service.ts` — mask in `toDTO`:
```typescript
  return {
    id: row.id,
    collectionId: row.collectionId,
    author: {
      id: row.author.id,
      displayName: row.author.deletedAt ? "Original author removed" : row.author.displayName,
    },
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    editable: row.author.id === user.id,
  };
```

- [ ] **Step 6: Typecheck + commit**

Run: `corepack pnpm --filter @workspace/api-server run typecheck`
Expected: PASS.
```
git add artifacts/api-server/src/services/documents.service.ts artifacts/api-server/src/services/comments.service.ts artifacts/api-server/src/repositories/collection-comments.repo.ts artifacts/api-server/src/services/collection-comments.service.ts artifacts/api-server/src/services/account-masking.test.ts
git commit -m "feat(api): mask soft-deleted users as 'Original uploader/author removed'"
```

---

### Task 3: Repository additions

**Files:**
- Modify: `artifacts/api-server/src/repositories/users.repo.ts`
- Modify: `artifacts/api-server/src/repositories/documents.repo.ts`

(Verified via the service tests in Tasks 4–5 + typecheck.)

- [ ] **Step 1: Add user lifecycle + admin/deleted queries**

Append to `artifacts/api-server/src/repositories/users.repo.ts`:
```typescript
// ─── Account deletion (SP3) ───────────────────────────────────────

export async function findAdminUserIds(): Promise<string[]> {
  const rows = await db.user.findMany({
    where: { deletedAt: null, userRoles: { some: { role: { name: "admin" } } } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export interface DeletedUserRow {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date;
  deletedAt: Date | null;
  anonymizedAt: Date | null;
  roles: string[];
}

export async function listDeletedWithRoles(): Promise<DeletedUserRow[]> {
  const rows = await db.user.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
    select: {
      id: true, email: true, displayName: true, createdAt: true,
      deletedAt: true, anonymizedAt: true,
      userRoles: { select: { role: { select: { name: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id, email: r.email, displayName: r.displayName, createdAt: r.createdAt,
    deletedAt: r.deletedAt, anonymizedAt: r.anonymizedAt,
    roles: Array.from(new Set(r.userRoles.map((ur) => ur.role.name))),
  }));
}

export async function findLifecycleById(
  id: string,
): Promise<{ id: string; deletedAt: Date | null; anonymizedAt: Date | null } | null> {
  return db.user.findUnique({
    where: { id },
    select: { id: true, deletedAt: true, anonymizedAt: true },
  });
}

export async function softDeleteUser(id: string): Promise<void> {
  await db.user.update({ where: { id }, data: { deletedAt: new Date(), updatedAt: new Date() } });
}

export async function restoreUser(id: string): Promise<void> {
  await db.user.update({ where: { id }, data: { deletedAt: null, updatedAt: new Date() } });
}

export async function anonymizeUser(
  id: string,
  scrub: { email: string; passwordHash: string },
): Promise<void> {
  await db.user.update({
    where: { id },
    data: {
      email: scrub.email,
      username: null,
      displayName: "Removed user",
      passwordHash: scrub.passwordHash,
      avatarStoragePath: null,
      avatarMimeType: null,
      status: "DISABLED",
      anonymizedAt: new Date(),
      updatedAt: new Date(),
    },
  });
}
```

- [ ] **Step 2: Add the orphaned-files query**

Append to `artifacts/api-server/src/repositories/documents.repo.ts`:
```typescript
export interface OrphanedFileRow {
  id: string;
  title: string;
  materialType: string;
  createdAt: Date;
  uploaderId: string;
  courseCode: string | null;
}

/** Alive documents whose uploader OR owner is a soft-deleted user. */
export async function listByDeletedUploaders(limit: number): Promise<OrphanedFileRow[]> {
  const rows = await db.document.findMany({
    where: {
      deletedAt: null,
      OR: [
        { uploader: { deletedAt: { not: null } } },
        { owner: { deletedAt: { not: null } } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true, title: true, materialType: true, createdAt: true, uploaderId: true,
      course: { select: { code: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id, title: r.title, materialType: r.materialType, createdAt: r.createdAt,
    uploaderId: r.uploaderId, courseCode: r.course?.code ?? null,
  }));
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `corepack pnpm --filter @workspace/api-server run typecheck`
Expected: PASS.
```
git add artifacts/api-server/src/repositories/users.repo.ts artifacts/api-server/src/repositories/documents.repo.ts
git commit -m "feat(api): repo queries for account deletion + orphaned files"
```

---

### Task 4: `account.service` (delete / restore / purge / list) — TDD

**Files:**
- Create: `artifacts/api-server/src/services/account.service.ts`
- Create: `artifacts/api-server/src/services/account.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/services/account.service.test.ts`:
```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { deleteOwnAccount, restoreAccount, purgeAccount, listDeletedAccounts } from "./account.service";

const SX = `_acct_${Date.now().toString(36)}`;
let adminId: string;
let userId: string;

function authed(id: string, primaryRole: string): AuthenticatedUser {
  return {
    id, email: `${id}@demo`, displayName: id, isActive: true,
    primaryRole, roles: [primaryRole], enrollments: [],
    username: null, avatarStoragePath: null, createdAt: new Date().toISOString(),
  };
}

beforeAll(async () => {
  const adminRole = await db.role.findFirst({ where: { name: "admin" } })
    ?? await db.role.create({ data: { name: "admin", description: "Administrator" } });
  const a = await db.user.create({ data: { email: `adm${SX}@demo`, passwordHash: "x", displayName: "Adm", primaryRoleId: adminRole.id } });
  await db.userRole.create({ data: { userId: a.id, roleId: adminRole.id } });
  adminId = a.id;
  const u = await db.user.create({ data: { email: `u${SX}@demo`, passwordHash: "x", displayName: "U", username: `u${SX}`.slice(0, 30) } });
  userId = u.id;
});

afterAll(async () => {
  await db.notification.deleteMany({ where: { recipientId: adminId } });
  await db.auditLog.deleteMany({ where: { actorUserId: { in: [adminId, userId] } } });
  await db.userRole.deleteMany({ where: { userId: { in: [adminId, userId] } } });
  await db.user.deleteMany({ where: { id: { in: [adminId, userId] } } });
});

describe("account.service", () => {
  it("deleteOwnAccount soft-deletes, audits, and notifies admins", async () => {
    await deleteOwnAccount(authed(userId, "student"));
    const u = await db.user.findUnique({ where: { id: userId } });
    expect(u?.deletedAt).not.toBeNull();
    const audit = await db.auditLog.findFirst({ where: { actorUserId: userId, action: "account.deleted" } });
    expect(audit).not.toBeNull();
    const notif = await db.notification.findFirst({ where: { recipientId: adminId, type: "account.deleted" } });
    expect(notif).not.toBeNull();
  });

  it("listDeletedAccounts includes the user and marks purge eligibility", async () => {
    const list = await listDeletedAccounts();
    const row = list.find((r) => r.id === userId);
    expect(row).toBeTruthy();
    expect(row?.eligibleForPurge).toBe(false); // just deleted
  });

  it("purgeAccount rejects a not-yet-eligible (<30d) account", async () => {
    await expect(purgeAccount(authed(adminId, "admin"), userId)).rejects.toMatchObject({ status: 400 });
  });

  it("restoreAccount clears deletedAt", async () => {
    await restoreAccount(authed(adminId, "admin"), userId);
    const u = await db.user.findUnique({ where: { id: userId } });
    expect(u?.deletedAt).toBeNull();
  });

  it("purgeAccount scrubs PII once eligible (>30d)", async () => {
    // backdate the soft-delete beyond the 30-day window
    await db.user.update({ where: { id: userId }, data: { deletedAt: new Date(Date.now() - 31 * 86_400_000) } });
    await purgeAccount(authed(adminId, "admin"), userId);
    const u = await db.user.findUnique({ where: { id: userId } });
    expect(u?.anonymizedAt).not.toBeNull();
    expect(u?.displayName).toBe("Removed user");
    expect(u?.username).toBeNull();
  });

  it("restoreAccount is blocked after anonymization", async () => {
    await expect(restoreAccount(authed(adminId, "admin"), userId)).rejects.toMatchObject({ status: 409 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm --filter @workspace/api-server exec vitest run src/services/account.service.test.ts`
Expected: FAIL — `./account.service` not found.

- [ ] **Step 3: Implement the service**

Create `artifacts/api-server/src/services/account.service.ts`:
```typescript
import { randomBytes } from "node:crypto";
import * as usersRepo from "../repositories/users.repo";
import * as docsRepo from "../repositories/documents.repo";
import * as auditService from "./audit.service";
import * as notifications from "./notifications.service";
import { badRequest, conflict, notFound } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";

const PURGE_AFTER_DAYS = 30;

export async function deleteOwnAccount(user: AuthenticatedUser): Promise<void> {
  const lifecycle = await usersRepo.findLifecycleById(user.id);
  if (!lifecycle) throw notFound("Account not found");
  if (lifecycle.deletedAt) throw conflict("Account is already deleted");

  const fileCount = await docsRepo.countDocuments({ uploaderId: user.id });
  await usersRepo.softDeleteUser(user.id);
  await auditService.record(user.id, "account.deleted", "user", user.id, { fileCount });

  const adminIds = await usersRepo.findAdminUserIds();
  for (const adminId of adminIds) {
    await notifications.notify({
      recipientId: adminId,
      actorId: user.id,
      type: "account.deleted",
      subjectType: "user",
      subjectId: user.id,
      body: `${user.displayName} (${user.primaryRole}) deleted their account — ${fileCount} file(s) remain`,
      url: "/admin/orphaned-files",
    });
  }
}

export async function restoreAccount(
  _admin: AuthenticatedUser,
  userId: string,
): Promise<void> {
  const lifecycle = await usersRepo.findLifecycleById(userId);
  if (!lifecycle || !lifecycle.deletedAt) throw notFound("Deleted account not found");
  if (lifecycle.anonymizedAt) throw conflict("Account was permanently removed and cannot be restored");
  await usersRepo.restoreUser(userId);
  await auditService.record(_admin.id, "account.restored", "user", userId, {});
}

export async function purgeAccount(
  admin: AuthenticatedUser,
  userId: string,
): Promise<void> {
  const lifecycle = await usersRepo.findLifecycleById(userId);
  if (!lifecycle || !lifecycle.deletedAt) throw notFound("Deleted account not found");
  if (lifecycle.anonymizedAt) throw conflict("Account is already permanently removed");
  const ageMs = Date.now() - lifecycle.deletedAt.getTime();
  if (ageMs < PURGE_AFTER_DAYS * 86_400_000) {
    throw badRequest(`Account is not yet eligible for permanent removal (deleted < ${PURGE_AFTER_DAYS} days ago)`);
  }
  await usersRepo.anonymizeUser(userId, {
    email: `deleted+${userId}@removed.invalid`,
    passwordHash: randomBytes(24).toString("hex"),
  });
  await auditService.record(admin.id, "account.purged", "user", userId, {});
}

export interface DeletedAccountDTO {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  deletedAt: string | null;
  anonymizedAt: string | null;
  fileCount: number;
  eligibleForPurge: boolean;
}

export async function listDeletedAccounts(): Promise<DeletedAccountDTO[]> {
  const rows = await usersRepo.listDeletedWithRoles();
  const out: DeletedAccountDTO[] = [];
  for (const r of rows) {
    const fileCount = await docsRepo.countDocuments({ uploaderId: r.id });
    const eligibleForPurge =
      !r.anonymizedAt &&
      !!r.deletedAt &&
      Date.now() - r.deletedAt.getTime() >= PURGE_AFTER_DAYS * 86_400_000;
    out.push({
      id: r.id, email: r.email, displayName: r.displayName, roles: r.roles,
      deletedAt: r.deletedAt?.toISOString() ?? null,
      anonymizedAt: r.anonymizedAt?.toISOString() ?? null,
      fileCount, eligibleForPurge,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `corepack pnpm --filter @workspace/api-server exec vitest run src/services/account.service.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```
git add artifacts/api-server/src/services/account.service.ts artifacts/api-server/src/services/account.service.test.ts
git commit -m "feat(api): account.service delete/restore/purge/list with admin notify"
```

---

### Task 5: `orphaned-files.service` — TDD

**Files:**
- Create: `artifacts/api-server/src/services/orphaned-files.service.ts`
- Create: `artifacts/api-server/src/services/orphaned-files.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/services/orphaned-files.service.test.ts`:
```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { listOrphanedFiles, reassignDocument } from "./orphaned-files.service";

const SX = `_orph_${Date.now().toString(36)}`;
let deletedUserId: string;
let activeUserId: string;
let docId: string;

const admin: AuthenticatedUser = {
  id: "admin-orph", email: "a@x", displayName: "Adm", isActive: true,
  primaryRole: "admin", roles: ["admin"], enrollments: [],
  username: null, avatarStoragePath: null, createdAt: new Date().toISOString(),
};

beforeAll(async () => {
  const d = await db.user.create({ data: { email: `del${SX}@demo`, passwordHash: "x", displayName: "Del", deletedAt: new Date() } });
  const a = await db.user.create({ data: { email: `act${SX}@demo`, passwordHash: "x", displayName: "Act" } });
  deletedUserId = d.id; activeUserId = a.id;
  const doc = await db.document.create({
    data: { title: `Orphan ${SX}`, description: "", materialType: "lecture-notes", visibility: "public", status: "published", uploaderId: d.id, ownerId: d.id, createdBy: d.id, updatedBy: d.id },
  });
  docId = doc.id;
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { entityId: docId } });
  await db.document.deleteMany({ where: { id: docId } });
  await db.user.deleteMany({ where: { id: { in: [deletedUserId, activeUserId] } } });
});

describe("orphaned-files.service", () => {
  it("lists documents whose uploader is deleted", async () => {
    const list = await listOrphanedFiles();
    expect(list.some((f) => f.id === docId)).toBe(true);
  });

  it("reassignDocument moves uploader+owner to an active user and audits", async () => {
    await reassignDocument(admin, docId, activeUserId);
    const doc = await db.document.findUnique({ where: { id: docId } });
    expect(doc?.uploaderId).toBe(activeUserId);
    expect(doc?.ownerId).toBe(activeUserId);
    const audit = await db.auditLog.findFirst({ where: { action: "document.reassign", entityId: docId } });
    expect(audit).not.toBeNull();
    // now no longer orphaned
    const list = await listOrphanedFiles();
    expect(list.some((f) => f.id === docId)).toBe(false);
  });

  it("reassignDocument rejects a missing/deleted target", async () => {
    await expect(reassignDocument(admin, docId, "00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm --filter @workspace/api-server exec vitest run src/services/orphaned-files.service.test.ts`
Expected: FAIL — `./orphaned-files.service` not found.

- [ ] **Step 3: Implement the service**

Create `artifacts/api-server/src/services/orphaned-files.service.ts`:
```typescript
import * as docsRepo from "../repositories/documents.repo";
import * as usersRepo from "../repositories/users.repo";
import * as auditService from "./audit.service";
import { notFound } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";

export interface OrphanedFileDTO {
  id: string;
  title: string;
  materialType: string;
  courseCode: string | null;
  createdAt: string;
}

export async function listOrphanedFiles(): Promise<OrphanedFileDTO[]> {
  const rows = await docsRepo.listByDeletedUploaders(200);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    materialType: r.materialType,
    courseCode: r.courseCode,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function reassignDocument(
  admin: AuthenticatedUser,
  documentId: string,
  newOwnerId: string,
): Promise<void> {
  const doc = await docsRepo.findByIdAlive(documentId);
  if (!doc) throw notFound("Document not found");
  const target = await usersRepo.findById(newOwnerId); // active (deletedAt:null) only
  if (!target) throw notFound("Target user not found");
  await docsRepo.updateDocumentById(documentId, { uploaderId: newOwnerId, ownerId: newOwnerId });
  await auditService.record(admin.id, "document.reassign", "document", documentId, {
    from: doc.uploaderId,
    to: newOwnerId,
  });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `corepack pnpm --filter @workspace/api-server exec vitest run src/services/orphaned-files.service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```
git add artifacts/api-server/src/services/orphaned-files.service.ts artifacts/api-server/src/services/orphaned-files.service.test.ts
git commit -m "feat(api): orphaned-files.service list + reassign"
```

---

### Task 6: Routes + OpenAPI + codegen

**Files:**
- Modify: `artifacts/api-server/src/routes/profile.ts` (DELETE /me)
- Modify: `artifacts/api-server/src/routes/users.ts` (admin deleted-users/restore/purge)
- Create: `artifacts/api-server/src/routes/admin-orphaned-files.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: `lib/api-spec/openapi.yaml`

- [ ] **Step 1: `DELETE /me` (self-delete) on the profile router**

In `artifacts/api-server/src/routes/profile.ts`, add the import:
```typescript
import * as accountService from "../services/account.service";
```
and add a handler (before `export default router;`):
```typescript
router.delete("/me", requireAuth, async (req, res, next) => {
  try {
    await accountService.deleteOwnAccount(req.authUser!);
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie("kb.sid");
      res.status(204).end();
    });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 2: Admin deleted-users / restore / purge on the users router**

In `artifacts/api-server/src/routes/users.ts`, add the import:
```typescript
import * as accountService from "../services/account.service";
```
and add (before `export default router;`):
```typescript
router.get("/admin/deleted-users", requireRole("admin"), async (_req, res, next) => {
  try {
    res.json(await accountService.listDeletedAccounts());
  } catch (err) {
    next(err);
  }
});

router.post("/admin/users/:userId/restore", requireRole("admin"), async (req, res, next) => {
  try {
    const { userId } = AdminUserIdParam.parse(req.params);
    await accountService.restoreAccount(req.authUser!, userId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.post("/admin/users/:userId/purge", requireRole("admin"), async (req, res, next) => {
  try {
    const { userId } = AdminUserIdParam.parse(req.params);
    await accountService.purgeAccount(req.authUser!, userId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
```
(`AdminUserIdParam` already exists in this file.)

- [ ] **Step 3: Create the admin orphaned-files router**

Create `artifacts/api-server/src/routes/admin-orphaned-files.ts`:
```typescript
import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireRole } from "../middlewares/auth";
import * as orphanedFilesService from "../services/orphaned-files.service";
import * as documentsService from "../services/documents.service";

const router: IRouter = Router();

const DocIdParam = z.object({ documentId: z.string().uuid() });
const ReassignBody = z.object({ newOwnerId: z.string().uuid() });

router.get("/admin/orphaned-files", requireRole("admin"), async (_req, res, next) => {
  try {
    res.json(await orphanedFilesService.listOrphanedFiles());
  } catch (err) {
    next(err);
  }
});

router.post("/admin/orphaned-files/:documentId/reassign", requireRole("admin"), async (req, res, next) => {
  try {
    const { documentId } = DocIdParam.parse(req.params);
    const { newOwnerId } = ReassignBody.parse(req.body);
    await orphanedFilesService.reassignDocument(req.authUser!, documentId, newOwnerId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.delete("/admin/orphaned-files/:documentId", requireRole("admin"), async (req, res, next) => {
  try {
    const { documentId } = DocIdParam.parse(req.params);
    await documentsService.deleteDocument(documentId, req.authUser!);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
```

- [ ] **Step 4: Mount the router**

In `artifacts/api-server/src/routes/index.ts`, add the import after `import profileRouter from "./profile";`:
```typescript
import adminOrphanedFilesRouter from "./admin-orphaned-files";
```
and mount after `router.use(profileRouter);`:
```typescript
router.use(adminOrphanedFilesRouter);
```

- [ ] **Step 5: OpenAPI schemas + operations**

In `lib/api-spec/openapi.yaml` under `components.schemas`, add:
```yaml
    DeletedAccount:
      type: object
      required: [id, email, displayName, roles, deletedAt, anonymizedAt, fileCount, eligibleForPurge]
      properties:
        id: { type: string, format: uuid }
        email: { type: string }
        displayName: { type: string }
        roles: { type: array, items: { type: string } }
        deletedAt: { type: string, format: date-time, nullable: true }
        anonymizedAt: { type: string, format: date-time, nullable: true }
        fileCount: { type: integer }
        eligibleForPurge: { type: boolean }
    OrphanedFile:
      type: object
      required: [id, title, materialType, courseCode, createdAt]
      properties:
        id: { type: string, format: uuid }
        title: { type: string }
        materialType: { type: string }
        courseCode: { type: string, nullable: true }
        createdAt: { type: string, format: date-time }
```
Add the `DELETE /me` op to the existing `/me` is not present; add a new path block under `paths:` (next to `/me/profile`):
```yaml
  /me:
    delete:
      operationId: deleteMyAccount
      tags: [profile]
      summary: Soft-delete the current user's own account
      responses:
        "204": { description: Account deleted }
```
Add admin ops under `paths:`:
```yaml
  /admin/deleted-users:
    get:
      operationId: listDeletedAccounts
      tags: [admin]
      summary: List soft-deleted accounts
      responses:
        "200":
          description: Deleted accounts
          content:
            application/json:
              schema: { type: array, items: { $ref: "#/components/schemas/DeletedAccount" } }
  /admin/users/{userId}/restore:
    parameters:
      - { in: path, name: userId, required: true, schema: { type: string, format: uuid } }
    post:
      operationId: restoreAccount
      tags: [admin]
      summary: Restore a soft-deleted account
      responses:
        "204": { description: Restored }
  /admin/users/{userId}/purge:
    parameters:
      - { in: path, name: userId, required: true, schema: { type: string, format: uuid } }
    post:
      operationId: purgeAccount
      tags: [admin]
      summary: Permanently anonymize a deleted account (eligible after 30 days)
      responses:
        "204": { description: Purged }
  /admin/orphaned-files:
    get:
      operationId: listOrphanedFiles
      tags: [admin]
      summary: List documents whose uploader/owner is a deleted user
      responses:
        "200":
          description: Orphaned files
          content:
            application/json:
              schema: { type: array, items: { $ref: "#/components/schemas/OrphanedFile" } }
  /admin/orphaned-files/{documentId}/reassign:
    parameters:
      - { in: path, name: documentId, required: true, schema: { type: string, format: uuid } }
    post:
      operationId: reassignOrphanedFile
      tags: [admin]
      summary: Reassign an orphaned document to an active user
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [newOwnerId]
              properties:
                newOwnerId: { type: string, format: uuid }
      responses:
        "204": { description: Reassigned }
  /admin/orphaned-files/{documentId}:
    parameters:
      - { in: path, name: documentId, required: true, schema: { type: string, format: uuid } }
    delete:
      operationId: deleteOrphanedFile
      tags: [admin]
      summary: Soft-delete an orphaned document
      responses:
        "204": { description: Deleted }
```

- [ ] **Step 6: Codegen + full typecheck**

Run:
```
corepack pnpm --filter @workspace/api-spec run codegen
corepack pnpm run typecheck
```
Expected: codegen adds `useDeleteMyAccount`, `useListDeletedAccounts`, `useRestoreAccount`, `usePurgeAccount`, `useListOrphanedFiles`, `useReassignOrphanedFile`, `useDeleteOrphanedFile`; full typecheck PASS.

- [ ] **Step 7: Rebuild + restart API + smoke**

Stop 8080, `corepack pnpm --filter @workspace/api-server run build`, then `... run start` (background, `.env`). Then create a throwaway student, delete it, confirm admin sees it:
```
$base='http://localhost:8080/api'
# register a throwaway student (auto-login)
$reg = Invoke-RestMethod "$base/auth/register" -Method Post -ContentType 'application/json' -Body '{"fullName":"Temp Del","email":"tempdel@x.com","password":"Demo1234!","confirmPassword":"Demo1234!","role":"student"}' -SessionVariable t
# self-delete
"delete => " + (Invoke-WebRequest "$base/me" -Method Delete -WebSession $t -SkipHttpErrorCheck).StatusCode
# admin sees the deleted account
Invoke-RestMethod "$base/auth/login" -Method Post -ContentType 'application/json' -Body '{"email":"admin@knowledgebank.demo","password":"Demo1234!"}' -SessionVariable s | Out-Null
"deleted-users contains temp => " + ((Invoke-RestMethod "$base/admin/deleted-users" -WebSession $s) | Where-Object { $_.email -eq 'tempdel@x.com' } | ForEach-Object { $_.displayName + ' files=' + $_.fileCount })
```
Expected: delete → 204; deleted-users list contains "Temp Del files=0". (Leave it; or restore via the API to clean up.)

- [ ] **Step 8: Commit**

```
git add artifacts/api-server/src/routes/profile.ts artifacts/api-server/src/routes/users.ts artifacts/api-server/src/routes/admin-orphaned-files.ts artifacts/api-server/src/routes/index.ts lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react
git commit -m "feat(api): account deletion + orphaned-files endpoints + generated client"
```

---

### Task 7: Frontend — delete section, admin deleted-accounts, orphaned-files page

**Files:**
- Create: `artifacts/web/src/components/profile/DeleteAccount.tsx`
- Modify: `artifacts/web/src/pages/profile.tsx`
- Modify: `artifacts/web/src/pages/admin-users.tsx`
- Create: `artifacts/web/src/pages/admin-orphaned-files.tsx`
- Modify: `artifacts/web/src/App.tsx`
- Modify: `artifacts/web/src/components/layout.tsx`

- [ ] **Step 1: DeleteAccount component**

Create `artifacts/web/src/components/profile/DeleteAccount.tsx`:
```tsx
import { useState } from "react";
import { apiUrl } from "@/lib/api-url";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Loader2 } from "lucide-react";

export default function DeleteAccount() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const doDelete = async () => {
    setBusy(true);
    try {
      const res = await fetch(apiUrl("/api/me"), { method: "DELETE", credentials: "include" });
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message ?? "Could not delete account");
      }
      window.location.href = "/login";
    } catch (err) {
      toast({ variant: "destructive", title: "Delete failed", description: (err as Error).message });
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 border-t border-destructive/30 pt-6" data-testid="delete-account">
      <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
      <p className="text-sm text-muted-foreground">
        Deleting your account disables login immediately. Your uploaded files remain, shown as
        "Original uploader removed". An admin can restore your account within 30 days.
      </p>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); setConfirm(""); }}>
        <DialogTrigger asChild>
          <Button variant="destructive" size="sm" className="gap-1.5" data-testid="delete-account-open">
            <Trash2 className="h-4 w-4" /> Delete account
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete your account?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This disables your login. Type <span className="font-mono font-semibold">DELETE</span> to confirm.
          </p>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" data-testid="delete-account-confirm" />
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={confirm !== "DELETE" || busy}
              onClick={doDelete}
              data-testid="delete-account-confirm-btn"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete my account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Render DeleteAccount on the Profile page**

In `artifacts/web/src/pages/profile.tsx`, add the import:
```tsx
import DeleteAccount from "@/components/profile/DeleteAccount";
```
and change the non-admin block to include it after `CourseMembership`:
```tsx
          {!isAdmin && (
            <>
              <CourseMembership me={me} />
              <DeleteAccount />
            </>
          )}
```

- [ ] **Step 3: Admin "Deleted accounts" section**

In `artifacts/web/src/pages/admin-users.tsx`, add to the imports from `@workspace/api-client-react`:
```tsx
  useListDeletedAccounts,
  getListDeletedAccountsQueryKey,
  useRestoreAccount,
  usePurgeAccount,
```
Add near the other hooks in the component:
```tsx
  const { data: deleted } = useListDeletedAccounts({
    query: { queryKey: getListDeletedAccountsQueryKey() },
  });
  const restoreMut = useRestoreAccount();
  const purgeMut = usePurgeAccount();
  const refreshDeleted = () => queryClient.invalidateQueries({ queryKey: getListDeletedAccountsQueryKey() });
```
(`queryClient` already exists on this page; if not, add `const queryClient = useQueryClient();` and import it.)
Then add a section at the end of the page's JSX (before the closing container):
```tsx
      <section aria-label="Deleted accounts" className="mt-8">
        <h2 className="mb-3 font-serif text-xl font-bold text-foreground">Deleted accounts</h2>
        {deleted && deleted.length > 0 ? (
          <div className="space-y-2" data-testid="deleted-accounts">
            {deleted.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {u.displayName}{" "}
                    <span className="text-muted-foreground">· {u.email}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {u.roles.join(", ")} · {u.fileCount} file(s) ·{" "}
                    {u.anonymizedAt ? "permanently removed" : `deleted ${u.deletedAt ? new Date(u.deletedAt).toLocaleDateString() : ""}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  {!u.anonymizedAt && (
                    <Button
                      variant="outline" size="sm"
                      disabled={restoreMut.isPending}
                      onClick={() => restoreMut.mutate({ userId: u.id }, { onSuccess: refreshDeleted })}
                      data-testid="account-restore"
                    >
                      Restore
                    </Button>
                  )}
                  {!u.anonymizedAt && (
                    <Button
                      variant="destructive" size="sm"
                      disabled={!u.eligibleForPurge || purgeMut.isPending}
                      title={u.eligibleForPurge ? "Permanently remove (anonymize)" : "Eligible 30 days after deletion"}
                      onClick={() => purgeMut.mutate({ userId: u.id }, { onSuccess: refreshDeleted })}
                      data-testid="account-purge"
                    >
                      Purge
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No deleted accounts.</p>
        )}
      </section>
```

- [ ] **Step 4: Orphaned-files admin page**

Create `artifacts/web/src/pages/admin-orphaned-files.tsx`:
```tsx
import { useState } from "react";
import {
  useListOrphanedFiles,
  getListOrphanedFilesQueryKey,
  useReassignOrphanedFile,
  useDeleteOrphanedFile,
  useSearchUsers,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { FileWarning } from "lucide-react";

function Reassign({ documentId, onDone }: { documentId: string; onDone: () => void }) {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const debounced = useDebounce(q, 300);
  const { data: users } = useSearchUsers(
    { q: debounced.trim(), limit: 6 },
    { query: { enabled: debounced.trim().length > 0 } },
  );
  const reassignMut = useReassignOrphanedFile();
  return (
    <div className="space-y-1">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Reassign to…" className="h-8" />
      {debounced.trim().length > 0 && users && users.length > 0 && (
        <ul className="rounded-md border bg-popover">
          {users.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                disabled={reassignMut.isPending}
                onClick={() =>
                  reassignMut.mutate(
                    { documentId, data: { newOwnerId: u.id } },
                    { onSuccess: () => { onDone(); toast({ title: `Reassigned to ${u.displayName}` }); } },
                  )
                }
              >
                {u.displayName} · {u.email}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AdminOrphanedFiles() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: files, isLoading } = useListOrphanedFiles({
    query: { queryKey: getListOrphanedFilesQueryKey() },
  });
  const deleteMut = useDeleteOrphanedFile();
  const refresh = () => queryClient.invalidateQueries({ queryKey: getListOrphanedFilesQueryKey() });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-2.5">
        <div className="rounded-lg bg-primary/10 p-1.5"><FileWarning className="h-5 w-5 text-primary" /></div>
        <h1 className="font-serif text-3xl font-bold text-foreground">Orphaned files</h1>
      </div>
      <p className="text-muted-foreground">
        Documents whose uploader's account was deleted. Keep them as-is, reassign to an active user, or delete.
      </p>
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : files && files.length > 0 ? (
        <ul className="space-y-3" data-testid="orphaned-files">
          {files.map((f) => (
            <li key={f.id}>
              <Card>
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">
                      {f.title}
                      {f.courseCode ? <span className="text-muted-foreground"> · {f.courseCode}</span> : null}
                    </span>
                    <Button
                      variant="destructive" size="sm"
                      disabled={deleteMut.isPending}
                      onClick={() => deleteMut.mutate({ documentId: f.id }, { onSuccess: () => { refresh(); toast({ title: "File deleted" }); } })}
                      data-testid="orphan-delete"
                    >
                      Delete
                    </Button>
                  </div>
                  <Reassign documentId={f.id} onDone={refresh} />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed bg-card py-16 text-center">
          <p className="text-muted-foreground">No orphaned files.</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Route + admin nav**

In `artifacts/web/src/App.tsx`, add the import:
```tsx
import AdminOrphanedFiles from "@/pages/admin-orphaned-files";
```
and a route (next to the other `/admin/*` routes):
```tsx
      <Route path="/admin/orphaned-files">
        <AuthGuard requireRole="admin">
          <Layout>
            <AdminOrphanedFiles />
          </Layout>
        </AuthGuard>
      </Route>
```
In `artifacts/web/src/components/layout.tsx`, add `FileWarning` to the `lucide-react` import, and add to the admin section of `moreNav` (the `isAdmin ? [ ... ]` array, after the Prep Hub Moderation entry):
```tsx
              { href: "/admin/orphaned-files", icon: FileWarning, label: "Orphaned Files" },
```

- [ ] **Step 6: Typecheck web**

Run: `corepack pnpm --filter @workspace/web run typecheck`
Expected: PASS.

> If `useSearchUsers` has a different generated name (it maps from operationId `searchUsers`), use that exact name + its query-key helper. Verify with a quick grep of `lib/api-client-react/src/generated/api.ts` if the typecheck flags it.

- [ ] **Step 7: Commit**

```
git add artifacts/web/src/components/profile/DeleteAccount.tsx artifacts/web/src/pages/profile.tsx artifacts/web/src/pages/admin-users.tsx artifacts/web/src/pages/admin-orphaned-files.tsx artifacts/web/src/App.tsx artifacts/web/src/components/layout.tsx
git commit -m "feat(web): delete account, admin deleted-accounts + orphaned-files review"
```

---

### Task 8: Audit/notification labels + full verification

**Files:**
- Modify: `artifacts/web/src/lib/activity-format.ts`
- Modify: `artifacts/web/src/components/notification-bell.tsx`

- [ ] **Step 1: Audit labels**

In `artifacts/web/src/lib/activity-format.ts`, add to `ACTION_LABELS` (after the course entries):
```typescript
  "account.deleted": "deleted their account",
  "account.restored": "restored an account",
  "account.purged": "permanently removed an account",
  "document.reassign": "reassigned a document",
```

- [ ] **Step 2: Notification label**

In `artifacts/web/src/components/notification-bell.tsx`, find the `typeLabel` mapping and add a case so `account.deleted` renders a friendly label (e.g. "Account deleted"). If the file maps a record, add:
```typescript
  "account.deleted": "Account deleted",
```
(Match the existing structure — if it's a `switch`, add a `case "account.deleted": return "Account deleted";`.)

- [ ] **Step 3: Full typecheck**

Run: `corepack pnpm run typecheck`
Expected: PASS across all packages.

- [ ] **Step 4: Full api-server test suite**

Run (`.env` loaded): `corepack pnpm --filter @workspace/api-server run test`
Expected: all pass, including `account-masking`, `account.service`, `orphaned-files.service`.

- [ ] **Step 5: Manual UI check**

Both servers running (API rebuilt + restarted; web :5173):
1. Register a throwaway student in the browser → Profile → Danger zone → Delete account (type DELETE) → redirected to /login; logging back in fails.
2. As admin → Users page → "Deleted accounts" shows the account with file count; Restore works; Purge is disabled (< 30 days).
3. Upload a doc as the throwaway *before* deleting (optional), then as admin open **Orphaned Files** → the doc appears; Reassign to an active user removes it from the list; or Delete.
4. Open any document the deleted user uploaded → uploader shows **"Original uploader removed"**.

- [ ] **Step 6: Final confirmation**

Report typecheck, test counts, and manual results. No commit (all committed in Tasks 1–8).

---

## Self-Review

**Spec coverage:**
- Self-service soft delete (login disabled, hidden, files kept) → Tasks 4 (service), 6 (`DELETE /me`), 7 (UI). ✓
- 30-day recovery via admin restore → Tasks 4 (`restoreAccount`), 6 (route), 7 (admin section). ✓
- Permanent removal = anonymize after 30 days → Task 4 (`purgeAccount` + guard), 6 (route), 7 (Purge button gated by `eligibleForPurge`). ✓
- "Original uploader removed" + author masking → Task 2. ✓
- Admin notification (username/role/file count/timestamp) → Task 4 (`deleteOwnAccount` notifies admins; audit carries fileCount; notification timestamp is `createdAt`). ✓
- Orphaned-files review: Keep/Reassign/Delete → Tasks 5 + 6 + 7 (Keep = inaction). ✓
- Audit entries (deleted/restored/purged/reassign) → Tasks 4, 5, 8 (labels). ✓
- Files remain searchable/downloadable + ownership preserved internally → soft-delete keeps rows + FKs; no document deletion in the account flow. ✓
- Backwards compatible → one additive column; masking only changes a fallback string. ✓

**Placeholder scan:** No TBD/placeholder; every code step is complete; commands have expected output. The two `>` notes are concrete fallbacks for generated-name drift.

**Type consistency:** `DeletedAccountDTO`/`DeletedAccount` fields match across service (Task 4), OpenAPI (Task 6), and admin UI (Task 7). `OrphanedFileDTO`/`OrphanedFile` likewise (service Task 5 / OpenAPI Task 6 / page Task 7). `reassignDocument(admin, documentId, newOwnerId)` matches the route body `{ newOwnerId }` and the generated mutation var `{ documentId, data: { newOwnerId } }`. `account.deleted/restored/purged` + `document.reassign` action strings match between services and labels. `PURGE_AFTER_DAYS = 30` is the single source for both `purgeAccount` and `eligibleForPurge`.
