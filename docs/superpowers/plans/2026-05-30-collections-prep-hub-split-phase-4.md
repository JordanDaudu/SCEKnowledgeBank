# Collections / Prep Hub Split — Phase 4 Implementation Plan (Admin Moderation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins reversible moderation over public study collections — hide/unhide a collection (removing it from every public surface while the owner keeps it), remove any collection comment, and a lean admin moderation list — all audited.

**Architecture:** Add a reversible `hiddenAt`/`hiddenBy`/`hiddenReason` flag to `study_collections`; tighten the public gate (`hiddenAt IS NULL`) in the three discovery queries + the service `isPublic` helpers, with one role exception (admins may still *view* a hidden collection to moderate it). A new admin-only `moderation.service` (gated by a new `requireAdmin` middleware) performs hide/unhide/remove-comment/list and records audit events; the web gets inline admin controls, a moderation list page, and an owner "hidden" banner.

**Tech Stack:** TypeScript, Express, Prisma + PostgreSQL, Zod, Vitest; React + Vite + wouter + TanStack Query; OpenAPI + orval codegen.

**Reference spec:** `docs/superpowers/specs/2026-05-30-collections-prep-hub-split-phase-4-design.md`

This plan has three parts, executed in order:

- **Part A — Data + gate** (schema, migration, repo hidden flag + gate tightening + DTO)
- **Part B — Moderation backend** (read-side gate in services, requireAdmin + moderation.service, routes, OpenAPI)
- **Part C — Frontend** (inline admin controls, moderation page, owner banner)

---

## Conventions & prerequisites (read once)

- **Working dir for backend:** `artifacts/api-server` unless stated. Codegen: repo root or `lib/api-spec`.
- **`corepack pnpm` from PowerShell**, not Git Bash (Bash mangles the corepack path). `node`/`git`/`docker` fine in Bash.
- **DB-backed tests:** from `artifacts/api-server`, Bash: `set -a && . ../../.env && set +a` then `corepack pnpm vitest run <file>`. Postgres is up (docker `sceknowledgebank-db-1`, port 5433).
- **Migrations:** `prisma migrate dev` is unreliable here — hand-author the migration folder + SQL and apply with `prisma migrate deploy` (DATABASE_URL loaded). `prisma generate` may EPERM on the engine DLL if a server holds it; the JS/TS client still regenerates (acceptable).
- **Test user shape:** `{ id, roles, enrollments } as unknown as AuthenticatedUser` (a bare `as AuthenticatedUser` fails tsc). Admins = `roles: ["admin"]`.
- **DB test hygiene:** unique `SX` suffix, direct `db` row creation, `afterAll` cleanup (children before parents). Follow `src/repositories/collections.discovery.test.ts`.
- **Commit after every task.** Never `--no-verify`. Append: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

# PART A — Data + Gate

Outcome: `study_collections` has the reversible hidden flag; the repo can hide/unhide/list-for-moderation/count; the three discovery queries exclude hidden collections; the DTOs expose `hiddenAt`/`hiddenReason`.

---

### Task A1: Prisma schema — hidden flag

**Files:**
- Modify: `lib/db/prisma/schema.prisma` (model `StudyCollection`)

- [ ] **Step 1: Add the fields + index**

In `model StudyCollection`, after the Phase-3 discovery fields (`followerCount Int @default(0) @map("follower_count")`), add:

```prisma
  // ─── Moderation (Phase 4) ─────────────────────────────────────
  // Reversible "hidden" flag. When set, the collection is removed from
  // every public surface (discovery/search/trending/recommend/public
  // view) but preserved for the owner (shown with a moderator banner).
  // hiddenBy is a plain uuid (no FK, matching parentDocumentId).
  hiddenAt     DateTime? @map("hidden_at") @db.Timestamptz()
  hiddenBy     String?   @map("hidden_by") @db.Uuid
  hiddenReason String?   @map("hidden_reason")
```

Add an index alongside the model's other `@@index` lines:
```prisma
  @@index([hiddenAt], map: "study_collections_hidden_at_idx")
```

- [ ] **Step 2: Validate** (repo root, PowerShell with a DATABASE_URL set, or any dummy value):

`corepack pnpm --filter @workspace/db exec prisma validate` → "valid 🚀".

- [ ] **Step 3: Commit**

```bash
git add lib/db/prisma/schema.prisma
git commit -m "feat(db): collection moderation hidden flag (hiddenAt/hiddenBy/hiddenReason)"
```

---

### Task A2: Migration — apply the hidden flag

**Files:**
- Create: `lib/db/prisma/migrations/20260530150000_collection_moderation/migration.sql`

- [ ] **Step 1: Create the migration file** with EXACTLY:

```sql
-- Collection Moderation (Phase 4): reversible hidden flag on study_collections.
ALTER TABLE "study_collections" ADD COLUMN "hidden_at" TIMESTAMPTZ;
ALTER TABLE "study_collections" ADD COLUMN "hidden_by" UUID;
ALTER TABLE "study_collections" ADD COLUMN "hidden_reason" TEXT;
CREATE INDEX IF NOT EXISTS "study_collections_hidden_at_idx"
  ON "study_collections" ("hidden_at");
```

- [ ] **Step 2: Apply + regenerate** (repo root, PowerShell, DATABASE_URL loaded from `.env`):

```
corepack pnpm --filter @workspace/db exec prisma migrate deploy
corepack pnpm --filter @workspace/db exec prisma generate
```
Expected: migration `20260530150000_collection_moderation` applied; client regenerated. (If `migrate deploy` reports drift/checksum errors, STOP and report BLOCKED — do not reset the DB. If `generate` EPERMs on the DLL, that's acceptable; the JS/TS client still updates.)

- [ ] **Step 3: Sanity-check** (Bash):
```bash
docker exec sceknowledgebank-db-1 psql -U knowledge_bank -d knowledge_bank -c "SELECT column_name FROM information_schema.columns WHERE table_name='study_collections' AND column_name IN ('hidden_at','hidden_by','hidden_reason');"
```
Expected: 3 rows.

- [ ] **Step 4: Commit**
```bash
git add lib/db/prisma/migrations
git commit -m "feat(db): migrate collection moderation hidden flag"
```

---

### Task A3: Repo hidden flag + gate tightening + DTO exposure

**Files:**
- Modify: `artifacts/api-server/src/repositories/collections.repo.ts`
- Modify: `artifacts/api-server/src/services/collections.service.ts` (DTO + `toSummary`)
- Test: `artifacts/api-server/src/repositories/collections.moderation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/repositories/collections.moderation.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import {
  hideCollection,
  unhideCollection,
  listDiscoverable,
  listForModeration,
  countHiddenCollections,
} from "./collections.repo";

const SX = `_mod_${Date.now().toString(36)}`;
let ownerId: string;
let adminId: string;
let colId: string;

beforeAll(async () => {
  ownerId = (await db.user.create({ data: { email: `o${SX}@demo`, passwordHash: "x", displayName: `O${SX}`, isActive: true } })).id;
  adminId = (await db.user.create({ data: { email: `ad${SX}@demo`, passwordHash: "x", displayName: `AD${SX}`, isActive: true } })).id;
  colId = (await db.studyCollection.create({ data: { ownerId, title: `Mod ${SX}`, visibility: "public" } })).id;
});

afterAll(async () => {
  await db.studyCollection.deleteMany({ where: { ownerId } });
  await db.user.deleteMany({ where: { id: { in: [ownerId, adminId] } } });
});

describe("collections.repo moderation", () => {
  it("hide removes from discovery + counts; moderation list still sees it; unhide restores", async () => {
    // visible before hide
    let ids = (await listDiscoverable({ sort: "new", limit: 100 })).map((r) => r.id);
    expect(ids).toContain(colId);

    await hideCollection(colId, adminId, "spam");
    const row = await db.studyCollection.findUniqueOrThrow({ where: { id: colId } });
    expect(row.hiddenAt).not.toBeNull();
    expect(row.hiddenBy).toBe(adminId);
    expect(row.hiddenReason).toBe("spam");

    // gone from public discovery
    ids = (await listDiscoverable({ sort: "new", limit: 100 })).map((r) => r.id);
    expect(ids).not.toContain(colId);

    // moderation list (includeHidden) still sees it; excludeHidden does not
    expect((await listForModeration({ includeHidden: true, limit: 100 })).map((r) => r.id)).toContain(colId);
    expect((await listForModeration({ includeHidden: false, limit: 100 })).map((r) => r.id)).not.toContain(colId);
    expect(await countHiddenCollections()).toBeGreaterThanOrEqual(1);

    await unhideCollection(colId);
    const after = await db.studyCollection.findUniqueOrThrow({ where: { id: colId } });
    expect(after.hiddenAt).toBeNull();
    ids = (await listDiscoverable({ sort: "new", limit: 100 })).map((r) => r.id);
    expect(ids).toContain(colId);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

`set -a && . ../../.env && set +a && corepack pnpm vitest run src/repositories/collections.moderation.test.ts`
Expected: FAIL — `hideCollection`/`unhideCollection`/`listForModeration`/`countHiddenCollections` not exported.

- [ ] **Step 3: Extend `CollectionRow`**

In `collections.repo.ts`, add to the `CollectionRow` interface (after `updatedAt: Date;`):
```ts
  hiddenAt: Date | null;
  hiddenBy: string | null;
  hiddenReason: string | null;
```

- [ ] **Step 4: Tighten the three discovery queries**

In `listDiscoverable`, add `hiddenAt IS NULL` to the `where` array (after the visibility line):
```ts
    Prisma.sql`sc.hidden_at IS NULL`,
```
In `listTrending`, change the final `WHERE` from
`WHERE sc.deleted_at IS NULL AND (sc.visibility = 'public' OR sc.is_official = true)`
to
`WHERE sc.deleted_at IS NULL AND (sc.visibility = 'public' OR sc.is_official = true) AND sc.hidden_at IS NULL`.
In `recommendCollections`, add to the Prisma `where` object (alongside `deletedAt: null`):
```ts
      hiddenAt: null,
```

- [ ] **Step 5: Add the moderation repo functions**

Append to `collections.repo.ts`:
```ts
// ─── Moderation (Phase 4) ─────────────────────────────────────────

/** Hide a collection from all public surfaces (reversible). */
export async function hideCollection(
  id: string,
  adminId: string,
  reason: string | null,
): Promise<void> {
  await db.studyCollection.update({
    where: { id },
    data: { hiddenAt: new Date(), hiddenBy: adminId, hiddenReason: reason, updatedAt: new Date() },
  });
}

/** Reverse a hide. */
export async function unhideCollection(id: string): Promise<void> {
  await db.studyCollection.update({
    where: { id },
    data: { hiddenAt: null, hiddenBy: null, hiddenReason: null, updatedAt: new Date() },
  });
}

/** Public/official collections for the admin moderation list. When
 *  `includeHidden` is false, hidden ones are excluded. Newest first. */
export async function listForModeration(opts: {
  includeHidden: boolean;
  limit: number;
}): Promise<Array<CollectionRow & { itemCount: number }>> {
  const rows = await db.studyCollection.findMany({
    where: {
      deletedAt: null,
      OR: [{ visibility: "public" }, { isOfficial: true }],
      ...(opts.includeHidden ? {} : { hiddenAt: null }),
    },
    orderBy: [{ createdAt: "desc" }],
    take: opts.limit,
    include: { _count: { select: { items: true } } },
  });
  return rows.map(({ _count, ...r }) => ({ ...r, itemCount: _count.items }));
}

export async function countPublicCollections(): Promise<number> {
  return db.studyCollection.count({
    where: { deletedAt: null, OR: [{ visibility: "public" }, { isOfficial: true }] },
  });
}

export async function countHiddenCollections(): Promise<number> {
  return db.studyCollection.count({
    where: { deletedAt: null, hiddenAt: { not: null } },
  });
}
```

- [ ] **Step 6: Expose `hiddenAt`/`hiddenReason` in the DTO**

In `collections.service.ts`, add to the `CollectionSummaryDTO` interface (after `commentCount: number;`):
```ts
  hiddenAt?: string;
  hiddenReason?: string;
```
In `toSummary`'s returned object (after `commentCount: c.commentCount,`):
```ts
    hiddenAt: c.hiddenAt?.toISOString(),
    hiddenReason: c.hiddenReason ?? undefined,
```

- [ ] **Step 7: Run the test + typecheck**

`corepack pnpm vitest run src/repositories/collections.moderation.test.ts` → PASS.
`corepack pnpm --filter @workspace/api-server run typecheck` → exit 0.
Regression: `corepack pnpm vitest run src/repositories/collections.discovery.test.ts src/repositories/collections.trending.test.ts` → still PASS.

- [ ] **Step 8: Commit**
```bash
git add src/repositories/collections.repo.ts src/services/collections.service.ts src/repositories/collections.moderation.test.ts
git commit -m "feat(collections): hidden flag repo ops + gate tightening + DTO exposure"
```

---

# PART B — Moderation Backend

Outcome: hidden collections are gated in the service read paths (with the admin-view exception); an admin-only `moderation.service` performs hide/unhide/remove-comment/list with audit; routes are exposed and the OpenAPI clients regenerated.

---

### Task B1: Read-side hidden gate in the public services

**Files:**
- Modify: `artifacts/api-server/src/services/prep-hub.service.ts`
- Modify: `artifacts/api-server/src/services/collection-engagement.service.ts`
- Modify: `artifacts/api-server/src/services/collection-comments.service.ts`
- Test: `artifacts/api-server/src/services/moderation.gate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/moderation.gate.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { createCollection } from "./collections.service";
import { hideCollection } from "../repositories/collections.repo";
import { getPublicCollection } from "./prep-hub.service";
import { likeCollection } from "./collection-engagement.service";
import { listComments, createComment } from "./collection-comments.service";

const SX = `_modgate_${Date.now().toString(36)}`;
let owner: AuthenticatedUser;
let student: AuthenticatedUser;
let admin: AuthenticatedUser;
let colId: string;

beforeAll(async () => {
  const o = await db.user.create({ data: { email: `o${SX}@demo`, passwordHash: "x", displayName: `O${SX}`, isActive: true } });
  const s = await db.user.create({ data: { email: `s${SX}@demo`, passwordHash: "x", displayName: `S${SX}`, isActive: true } });
  const a = await db.user.create({ data: { email: `a${SX}@demo`, passwordHash: "x", displayName: `A${SX}`, isActive: true } });
  owner = { id: o.id, roles: ["student"], enrollments: [] } as unknown as AuthenticatedUser;
  student = { id: s.id, roles: ["student"], enrollments: [] } as unknown as AuthenticatedUser;
  admin = { id: a.id, roles: ["admin"], enrollments: [] } as unknown as AuthenticatedUser;
  colId = (await createCollection(owner, { title: `Gate ${SX}`, visibility: "public" })).id;
  await createComment(colId, student, "before hide"); // a comment to view later
  await hideCollection(colId, admin.id, "spam");
});

afterAll(async () => {
  await db.studyCollectionComment.deleteMany({ where: { collectionId: colId } });
  await db.studyCollection.deleteMany({ where: { ownerId: owner.id } });
  await db.user.deleteMany({ where: { id: { in: [owner.id, student.id, admin.id] } } });
});

describe("hidden-collection gate", () => {
  it("getPublicCollection: 404 for a student, returned for an admin (with hiddenAt)", async () => {
    await expect(getPublicCollection(colId, student)).rejects.toThrow();
    const d = await getPublicCollection(colId, admin);
    expect(d.id).toBe(colId);
    expect(d.hiddenAt).toBeTruthy();
  });
  it("engagement on a hidden collection 404s", async () => {
    await expect(likeCollection(colId, student)).rejects.toThrow();
  });
  it("listComments: admin can read a hidden collection's comments; student 404; createComment 404", async () => {
    const list = await listComments(colId, admin);
    expect(list.length).toBeGreaterThanOrEqual(1);
    await expect(listComments(colId, student)).rejects.toThrow();
    await expect(createComment(colId, student, "after hide")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

`corepack pnpm vitest run src/services/moderation.gate.test.ts`
Expected: FAIL — hidden collections still pass the current gates (admin-view exception + hidden block not yet implemented).

- [ ] **Step 3: `prep-hub.service.ts` — admin-view exception + skip view-recording when hidden**

Add the import (with the other imports):
```ts
import * as permissions from "./permissions.service";
```
Replace the body of `getPublicCollection` with:
```ts
export async function getPublicCollection(
  id: string,
  user: AuthenticatedUser,
): Promise<CollectionDetailDTO> {
  const c = await collectionsRepo.findCollectionById(id);
  // Private collections must never appear in Prep Hub — 404 (not 403) so we
  // don't reveal existence.
  if (!c || !isPublic(c)) throw notFound("Collection not found");
  // Hidden collections are visible only to admins (to review/unhide them).
  if (c.hiddenAt && !permissions.isAdmin(user)) throw notFound("Collection not found");
  // Don't count a moderator's review as a public view.
  if (!c.hiddenAt) await engagement.recordView(c.id, user);
  return collectionsService.assembleDetail(c, user);
}
```
(`isPublic` here stays unchanged — visibility/official only; the hidden check is explicit so the admin exception is clear.)

- [ ] **Step 4: `collection-engagement.service.ts` — block engagement on hidden**

In its `loadEngageable` (the helper used by like/unlike/rate/clearRating), change the guard so a hidden collection 404s. Its current check is `if (!c || !isPublic(c)) throw notFound(...)`; change to:
```ts
  if (!c || !isPublic(c) || c.hiddenAt) throw notFound("Collection not found");
```

- [ ] **Step 5: `collection-comments.service.ts` — admin-viewable list, hidden-blocked writes**

Add the import:
```ts
import * as permissions from "./permissions.service";
```
Add a viewable loader and tighten the engageable loader. Replace the existing `loadEngageable` with these two:
```ts
/** Writable target: public/official AND not hidden (404 otherwise, any role). */
async function loadEngageable(
  id: string,
): Promise<collectionsRepo.CollectionRow> {
  const c = await collectionsRepo.findCollectionById(id);
  if (!c || !isPublic(c) || c.hiddenAt) throw notFound("Collection not found");
  return c;
}

/** Readable target: public/official; hidden ones are visible only to admins. */
async function loadViewable(
  id: string,
  user: AuthenticatedUser,
): Promise<collectionsRepo.CollectionRow> {
  const c = await collectionsRepo.findCollectionById(id);
  if (!c || !isPublic(c)) throw notFound("Collection not found");
  if (c.hiddenAt && !permissions.isAdmin(user)) throw notFound("Collection not found");
  return c;
}
```
In `listComments`, change the gate call from `await loadEngageable(id);` to `await loadViewable(id, user);`. Leave `createComment` using `loadEngageable(id)` (writes blocked on hidden).

- [ ] **Step 6: Run the test + typecheck**

`corepack pnpm vitest run src/services/moderation.gate.test.ts` → PASS (3 tests).
`corepack pnpm --filter @workspace/api-server run typecheck` → exit 0.
Regression: `corepack pnpm vitest run src/services/collection-comments.service.test.ts src/services/collection-engagement.service.test.ts src/services/prep-hub.service.test.ts` → still PASS.

- [ ] **Step 7: Commit**
```bash
git add src/services/prep-hub.service.ts src/services/collection-engagement.service.ts src/services/collection-comments.service.ts src/services/moderation.gate.test.ts
git commit -m "feat(prep-hub): hidden-collection gate (admin-view exception; block engagement/writes)"
```

---

### Task B2: `requireAdmin` middleware + `moderation.service`

**Files:**
- Create: `artifacts/api-server/src/middlewares/require-admin.ts`
- Create: `artifacts/api-server/src/services/moderation.service.ts`
- Test: `artifacts/api-server/src/services/moderation.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/moderation.service.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { createCollection } from "./collections.service";
import { createComment } from "./collection-comments.service";
import { hideCollection, unhideCollection, removeComment, listModeration } from "./moderation.service";

const SX = `_modsvc_${Date.now().toString(36)}`;
let owner: AuthenticatedUser;
let commenter: AuthenticatedUser;
let admin: AuthenticatedUser;
let colId: string;

beforeAll(async () => {
  const o = await db.user.create({ data: { email: `o${SX}@demo`, passwordHash: "x", displayName: `O${SX}`, isActive: true } });
  const c = await db.user.create({ data: { email: `c${SX}@demo`, passwordHash: "x", displayName: `C${SX}`, isActive: true } });
  const a = await db.user.create({ data: { email: `a${SX}@demo`, passwordHash: "x", displayName: `A${SX}`, isActive: true } });
  owner = { id: o.id, roles: ["student"], enrollments: [] } as unknown as AuthenticatedUser;
  commenter = { id: c.id, roles: ["student"], enrollments: [] } as unknown as AuthenticatedUser;
  admin = { id: a.id, roles: ["admin"], enrollments: [] } as unknown as AuthenticatedUser;
  colId = (await createCollection(owner, { title: `ModSvc ${SX}`, visibility: "public" })).id;
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { actorUserId: admin.id } });
  await db.studyCollectionComment.deleteMany({ where: { collectionId: colId } });
  await db.studyCollection.deleteMany({ where: { ownerId: owner.id } });
  await db.user.deleteMany({ where: { id: { in: [owner.id, commenter.id, admin.id] } } });
});

describe("moderation.service", () => {
  it("non-admins are forbidden from every op", async () => {
    await expect(hideCollection(owner, colId, "x")).rejects.toThrow();
    await expect(unhideCollection(owner, colId)).rejects.toThrow();
    await expect(listModeration(owner, {})).rejects.toThrow();
  });

  it("admin hide/unhide sets+clears the flag and audits", async () => {
    const hidden = await hideCollection(admin, colId, "off-topic");
    expect(hidden.hiddenAt).toBeTruthy();
    expect(hidden.hiddenReason).toBe("off-topic");
    const auditRow = await db.auditLog.findFirst({ where: { actorUserId: admin.id, action: "collection.hidden", entityId: colId } });
    expect(auditRow).not.toBeNull();
    const shown = await unhideCollection(admin, colId);
    expect(shown.hiddenAt).toBeUndefined();
  });

  it("admin removeComment soft-deletes any comment + decrements commentCount + audits", async () => {
    const cm = await createComment(colId, commenter, "to be removed");
    const before = (await db.studyCollection.findUniqueOrThrow({ where: { id: colId }, select: { commentCount: true } })).commentCount;
    await removeComment(admin, cm.id);
    const after = (await db.studyCollection.findUniqueOrThrow({ where: { id: colId }, select: { commentCount: true } })).commentCount;
    expect(after).toBe(before - 1);
    const deleted = await db.studyCollectionComment.findUniqueOrThrow({ where: { id: cm.id } });
    expect(deleted.deletedAt).not.toBeNull();
    const auditRow = await db.auditLog.findFirst({ where: { actorUserId: admin.id, action: "collection.comment.removed", entityId: cm.id } });
    expect(auditRow).not.toBeNull();
  });

  it("listModeration returns collections + stats for an admin", async () => {
    const res = await listModeration(admin, {});
    expect(Array.isArray(res.collections)).toBe(true);
    expect(typeof res.stats.totalPublic).toBe("number");
    expect(typeof res.stats.totalHidden).toBe("number");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

`corepack pnpm vitest run src/services/moderation.service.test.ts`
Expected: FAIL — module `./moderation.service` not found.

- [ ] **Step 3: Create the middleware**

Create `src/middlewares/require-admin.ts`:
```ts
import type { RequestHandler } from "express";
import * as permissions from "../services/permissions.service";
import { forbidden } from "../lib/errors";

/** Admin-only gate (mirrors requireCollectionsAccess). */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!permissions.isAdmin(req.authUser)) {
    return next(forbidden("This action requires an administrator account"));
  }
  next();
};
```

- [ ] **Step 4: Create the service**

Create `src/services/moderation.service.ts`:
```ts
/**
 * Phase 4 — admin moderation of public collections. Hide/unhide (reversible),
 * remove any comment, and a lean moderation list. Every action is audited.
 * Admin-only: each function re-checks isAdmin (defensive, in addition to the
 * route's requireAdmin) and never touches private collections.
 */
import * as collectionsRepo from "../repositories/collections.repo";
import * as commentsRepo from "../repositories/collection-comments.repo";
import * as collectionsService from "./collections.service";
import * as permissions from "./permissions.service";
import * as audit from "./audit.service";
import { forbidden, notFound } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";
import type {
  CollectionDetailDTO,
  CollectionSummaryDTO,
} from "./collections.service";

function isPublic(c: collectionsRepo.CollectionRow): boolean {
  return c.visibility === "public" || c.isOfficial;
}

function requireAdmin(user: AuthenticatedUser): void {
  if (!permissions.isAdmin(user)) throw forbidden("Administrators only");
}

/** Load a public/official collection that an admin may moderate, else 404. */
async function loadModeratable(
  id: string,
): Promise<collectionsRepo.CollectionRow> {
  const c = await collectionsRepo.findCollectionById(id);
  if (!c || !isPublic(c)) throw notFound("Collection not found");
  return c;
}

export async function hideCollection(
  user: AuthenticatedUser,
  id: string,
  reason?: string,
): Promise<CollectionDetailDTO> {
  requireAdmin(user);
  await loadModeratable(id);
  await collectionsRepo.hideCollection(id, user.id, reason?.trim() || null);
  await audit.record(user.id, "collection.hidden", "study_collection", id, {
    reason: reason?.trim() || null,
  });
  const fresh = await collectionsRepo.findCollectionById(id);
  if (!fresh) throw notFound("Collection not found");
  return collectionsService.assembleDetail(fresh, user);
}

export async function unhideCollection(
  user: AuthenticatedUser,
  id: string,
): Promise<CollectionDetailDTO> {
  requireAdmin(user);
  await loadModeratable(id);
  await collectionsRepo.unhideCollection(id);
  await audit.record(user.id, "collection.unhidden", "study_collection", id);
  const fresh = await collectionsRepo.findCollectionById(id);
  if (!fresh) throw notFound("Collection not found");
  return collectionsService.assembleDetail(fresh, user);
}

export async function removeComment(
  user: AuthenticatedUser,
  commentId: string,
): Promise<void> {
  requireAdmin(user);
  const existing = await commentsRepo.findCommentById(commentId);
  if (!existing) throw notFound("Comment not found");
  await commentsRepo.softDeleteComment(commentId);
  await audit.record(
    user.id,
    "collection.comment.removed",
    "study_collection_comment",
    commentId,
    { collectionId: existing.collectionId },
  );
}

export interface ModerationListDTO {
  collections: CollectionSummaryDTO[];
  stats: { totalPublic: number; totalHidden: number };
}

export async function listModeration(
  user: AuthenticatedUser,
  opts: { includeHidden?: boolean; limit?: number },
): Promise<ModerationListDTO> {
  requireAdmin(user);
  const rows = await collectionsRepo.listForModeration({
    includeHidden: opts.includeHidden ?? true,
    limit: Math.min(opts.limit ?? 50, 100),
  });
  const collections = await collectionsService.summarize(rows, user);
  const [totalPublic, totalHidden] = await Promise.all([
    collectionsRepo.countPublicCollections(),
    collectionsRepo.countHiddenCollections(),
  ]);
  return { collections, stats: { totalPublic, totalHidden } };
}
```

- [ ] **Step 5: Run the test + typecheck**

`corepack pnpm vitest run src/services/moderation.service.test.ts` → PASS (4 tests).
`corepack pnpm --filter @workspace/api-server run typecheck` → exit 0.

- [ ] **Step 6: Commit**
```bash
git add src/middlewares/require-admin.ts src/services/moderation.service.ts src/services/moderation.service.test.ts
git commit -m "feat(moderation): requireAdmin middleware + moderation service (hide/unhide/remove-comment/list)"
```

---

### Task B3: Routes — `/api/admin/collections/*`

**Files:**
- Create: `artifacts/api-server/src/routes/moderation.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

- [ ] **Step 1: Create the router**

Create `src/routes/moderation.ts`:
```ts
import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/require-admin";
import * as moderation from "../services/moderation.service";

const router: IRouter = Router();

const IdParams = z.object({ id: z.string().uuid() });
const CommentIdParams = z.object({ commentId: z.string().uuid() });
const HideBody = z.object({ reason: z.string().max(500).optional() });
const ListQuery = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
});

router.get(
  "/admin/collections/moderation",
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { limit } = ListQuery.parse(req.query);
      res.json(await moderation.listModeration(req.authUser!, { limit }));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/admin/collections/:id/hide",
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      const { reason } = HideBody.parse(req.body);
      res.json(await moderation.hideCollection(req.authUser!, id, reason));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/admin/collections/:id/unhide",
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      res.json(await moderation.unhideCollection(req.authUser!, id));
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/admin/collections/comments/:commentId",
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { commentId } = CommentIdParams.parse(req.params);
      await moderation.removeComment(req.authUser!, commentId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

export default router;
```

> `listModeration` always includes hidden collections (that's the point of the moderation list); the web filters client-side. No `includeHidden` query param (avoids the `z.coerce.boolean` "false"→true trap).

- [ ] **Step 2: Register the router**

In `src/routes/index.ts`, add `import moderationRouter from "./moderation";` and `router.use(moderationRouter);` (next to the other prep-hub/collections routers).

- [ ] **Step 3: Typecheck + build**
```
corepack pnpm --filter @workspace/api-server run typecheck
corepack pnpm --filter @workspace/api-server run build
```
Expected: exit 0.

- [ ] **Step 4: Commit**
```bash
git add src/routes/moderation.ts src/routes/index.ts
git commit -m "feat(routes): admin collection moderation routes (/api/admin/collections/*)"
```

---

### Task B4: OpenAPI spec + client regeneration

**Files:**
- Modify: `lib/api-spec/openapi.yaml`
- Regenerated (do not hand-edit): `lib/api-zod/src/generated/*`, `lib/api-client-react/src/generated/*`

- [ ] **Step 1: Add the moderation fields + schema**

In `openapi.yaml`:
- Add to `StudyCollectionSummary` properties: `hiddenAt` (string, date-time, nullable) and `hiddenReason` (string, nullable). (They flow into `StudyCollectionDetail` too.)
- Add a schema `CollectionModerationList`:
```yaml
    CollectionModerationList:
      type: object
      required: [collections, stats]
      properties:
        collections:
          type: array
          items: { $ref: "#/components/schemas/StudyCollectionSummary" }
        stats:
          type: object
          required: [totalPublic, totalHidden]
          properties:
            totalPublic: { type: integer }
            totalHidden: { type: integer }
```

- [ ] **Step 2: Add the four paths** (tag `moderation`, mirroring the existing path style):
- `GET /admin/collections/moderation` → `operationId: listCollectionModeration`, query `limit` (integer), 200 = `CollectionModerationList`.
- `POST /admin/collections/{id}/hide` → `operationId: hideCollection`, requestBody `{ reason?: string }`, 200 = `StudyCollectionDetail`.
- `POST /admin/collections/{id}/unhide` → `operationId: unhideCollection`, 200 = `StudyCollectionDetail`.
- `DELETE /admin/collections/comments/{commentId}` → `operationId: removeCollectionComment`, 204.

(Copy an existing `{id}` path-param block; add a `{commentId}` one.)

- [ ] **Step 3: Regenerate** (repo root, PowerShell):
```
corepack pnpm --filter @workspace/api-spec run codegen
```
Expected: orval rewrites both client packages; `typecheck:libs` passes. New hooks: `useListCollectionModeration`, `useHideCollection`, `useUnhideCollection`, `useRemoveCollectionComment`.

- [ ] **Step 4: Confirm hooks** (Bash):
```bash
grep -rl "useHideCollection\|useListCollectionModeration" lib/api-client-react/src/generated
```
Expected: at least one path.

- [ ] **Step 5: Commit**
```bash
git add lib/api-spec/openapi.yaml lib/api-zod/src/generated lib/api-client-react/src/generated
git commit -m "feat(api): openapi admin collection moderation paths; regen clients"
```

---

# PART C — Frontend

Outcome: admins get inline Hide/Unhide + comment-remove controls on the Prep Hub view, a moderation list page, and owners see a "hidden" banner. Acceptance per task = `corepack pnpm --filter @workspace/web run typecheck` exit 0 + the final manual smoke.

---

### Task C1: Inline admin moderation controls on the Prep Hub collection view

**Files:**
- Modify: `artifacts/web/src/pages/prep-hub-collection.tsx`
- Modify: `artifacts/web/src/components/collections/CollectionComments.tsx` (admin remove)

- [ ] **Step 1: Add admin Hide/Unhide + a hidden banner**

Read `prep-hub-collection.tsx` first. Using the current user (`useGetCurrentUser`) compute `isAdmin`. For admins:
- In the header, show **Hide** when `!collection.hiddenAt` and **Unhide** when `collection.hiddenAt`. Hide opens a small prompt/dialog for an optional reason → `useHideCollection({ id, data: { reason } })`; Unhide → `useUnhideCollection({ id })`. On success, invalidate the `getPublicCollection` query for this id (reuse the page's existing invalidation/`refresh`).
- When `collection.hiddenAt` is set, render a prominent banner: "Hidden from Prep Hub{collection.hiddenReason ? `: ${reason}` : ''}". (Admins are the only ones who can see this view while hidden.)
Match the page's existing styling; surface mutation errors via the existing toast/`handleError`.

- [ ] **Step 2: Admin "Remove" on each comment**

In `CollectionComments.tsx`, accept a prop `canModerate: boolean` (passed from the page as `isAdmin`). When `canModerate`, render a **Remove** button on every comment (not just the author's `editable` ones) → `useRemoveCollectionComment({ commentId })` with a confirm; invalidate the comments query + the collection query on success. (Keep the existing author edit/delete for non-admins.)

- [ ] **Step 3: Typecheck + commit**
```
corepack pnpm --filter @workspace/web run typecheck
```
```bash
git add artifacts/web/src/pages/prep-hub-collection.tsx artifacts/web/src/components/collections/CollectionComments.tsx
git commit -m "feat(web): inline admin hide/unhide + comment removal on Prep Hub view"
```

---

### Task C2: Admin moderation list page

**Files:**
- Create: `artifacts/web/src/pages/admin-prep-hub-moderation.tsx`
- Modify: `artifacts/web/src/App.tsx` (route)
- Modify: `artifacts/web/src/components/layout.tsx` (admin "More" nav entry)

- [ ] **Step 1: Build the page**

Create `admin-prep-hub-moderation.tsx`: fetch `useListCollectionModeration()` → `{ collections, stats }`. Render a stats header ("{stats.totalPublic} public · {stats.totalHidden} hidden"), an optional client-side filter toggle ("Show only hidden"), and a list/table of collections (title, owner/creator, engagement counts, a Hidden badge when `hiddenAt`), each with a **Hide/Unhide** action (`useHideCollection`/`useUnhideCollection`, invalidate the moderation query on success) and a link to `/prep-hub/:id`. Reuse existing UI primitives + `CollectionCard`/table styling.

- [ ] **Step 2: Register the route (admin-only) + nav**

In `App.tsx`, add a route `/admin/prep-hub-moderation` rendering `<Layout><AdminPrepHubModeration/></Layout>` guarded admin-only. Use the existing `AuthGuard` admin gating used by other `/admin/*` routes (e.g. analytics) — match how those routes restrict to admins (the inverse of the Phase-1 `blockAdmin` prop; if there's a `requireAdmin`/`requireRole` AuthGuard option, use it; otherwise mirror the analytics route's guard).
In `layout.tsx`, add a "Prep Hub Moderation" entry to the admin section of the "More" dropdown (admin-only, alongside Review/Admin/Analytics).

- [ ] **Step 3: Typecheck + commit**
```
corepack pnpm --filter @workspace/web run typecheck
```
```bash
git add artifacts/web/src/pages/admin-prep-hub-moderation.tsx artifacts/web/src/App.tsx artifacts/web/src/components/layout.tsx
git commit -m "feat(web): admin Prep Hub moderation list page + nav"
```

---

### Task C3: Owner "hidden by moderator" banner

**Files:**
- Modify: `artifacts/web/src/pages/collection-manage.tsx`

- [ ] **Step 1: Show the banner**

Read `collection-manage.tsx`. The owner detail comes from `useGetCollection(id)`; when `collection.hiddenAt` is set, render a read-only warning banner near the top: "This collection was hidden from Prep Hub by a moderator{collection.hiddenReason ? `: ${reason}` : ''}. It's still in your workspace; contact an administrator if you think this is a mistake." The owner has no unhide control (admin-only). Match existing banner/alert styling.

- [ ] **Step 2: Typecheck + commit**
```
corepack pnpm --filter @workspace/web run typecheck
```
```bash
git add artifacts/web/src/pages/collection-manage.tsx
git commit -m "feat(web): owner banner when a collection is hidden by a moderator"
```

---

## Final verification (run after all parts)

- [ ] **Backend tests** (from `artifacts/api-server`, `.env` loaded): `corepack pnpm vitest run` → all pass (existing + new moderation tests).
- [ ] **Full typecheck** (repo root): `corepack pnpm run typecheck` → exit 0.
- [ ] **Manual smoke** (rebuild API + restart per windows-dev-setup): as **admin**, open a public collection in Prep Hub → Hide it with a reason; confirm it disappears from discovery/search/trending and a **student** gets a 404 opening it directly; as the **owner**, see the "hidden by a moderator" banner in the workspace; as **admin**, open the moderation page (stats + list), Unhide it (it returns to discovery), and Remove a comment (it disappears, commentCount drops). Confirm a non-admin hitting `/api/admin/collections/:id/hide` gets 403.

---

## Self-review notes (coverage vs. spec)

- §4 data model (hiddenAt/hiddenBy/hiddenReason + index) → A1, A2. §5 gate (3 discovery queries) + §6.2 repo ops + DTO exposure → A3. §5 view exception + engagement/comment gate → B1. §6.1 requireAdmin + §6.3 moderation.service → B2. §6.4 routes → B3. §6.5 OpenAPI/regen → B4. §7.1 inline controls → C1. §7.2 moderation page → C2. §7.3 owner banner → C3. §8 testing → tests in A3, B1, B2 + final smoke.
- The single role exception (admins view hidden, others 404) lives only in `getPublicCollection` + comments `loadViewable` — both explicitly tested (B1).
- No task hard-deletes user collections, touches private collections, or changes ranking/Phase-1–3 behavior for non-admins beyond hidden exclusion (spec §2 non-goals preserved).
```
