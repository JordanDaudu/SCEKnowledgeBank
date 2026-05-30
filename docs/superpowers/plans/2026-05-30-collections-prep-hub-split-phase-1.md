# Collections / Prep Hub Split — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the current single "Prep Hub" feature into two modules — **Collections** (create/manage; students + lecturers) and **Prep Hub** (discovery; all roles incl. admin read-only) — with the backend service split along the same seam, admin access inverted, visibility renamed `shared`→`public`, and collection metadata (subject/category, exam name, semester+year, tags) added.

**Architecture:** One Postgres/Prisma data layer (`collections.repo.ts`) shared by two services: `collections.service.ts` (`/api/collections/*`, owner-only CRUD + duplicate) and a new `prep-hub.service.ts` (`/api/prep-hub/*`, read + follow + recommend). The web app gets two nav items and two route trees: `/collections` (manage) and `/prep-hub` (discover). The OpenAPI spec drives generated `@workspace/api-zod` + `@workspace/api-client-react` clients (orval).

**Tech Stack:** TypeScript, Express, Prisma + PostgreSQL, Zod, Vitest; React + Vite + wouter + TanStack Query; OpenAPI + orval codegen.

**Reference spec:** `docs/superpowers/specs/2026-05-30-collections-prep-hub-split-phase-1-design.md`

This plan has three parts, each producing working, testable software and meant to be executed in order:

- **Part A — Data & metadata foundation** (Prisma migration, repo, visibility rename)
- **Part B — Backend module split, access control, duplicate, OpenAPI regen**
- **Part C — Frontend split** (nav, routes, pages)

---

## Conventions & prerequisites (read once)

- **Working dir for backend commands:** `artifacts/api-server` unless stated. For codegen: repo root or `lib/api-spec`.
- **All commands use `corepack pnpm`** (no global pnpm shim on this box).
- **DB-backed tests need `DATABASE_URL`.** Vitest has no env setup file, so before running any test that touches `@workspace/db`, load `.env` into the shell. From Git Bash: `set -a && . ../../.env && set +a` (paths relative to `artifacts/api-server`). From PowerShell, run inside a `.\dev.ps1`-loaded window. Postgres must be up (`docker compose up -d db`).
- **`AuthenticatedUser` shape** (from `src/middlewares/auth.ts`) used in service tests:
  ```ts
  { id: string; roles: string[]; enrollments: { courseId: string; roleInCourse: string }[]; /* + email/displayName, not needed here */ }
  ```
  Construct minimal test users as `{ id, roles, enrollments } as AuthenticatedUser`.
- **DB test hygiene:** follow `src/repositories/documents.fts.test.ts` — unique `SUFFIX`, create rows directly via `db`, clean up in `afterAll`.
- **Commit after every task** (the final step of each task). Never use `--no-verify`.

---

# PART A — Data & Metadata Foundation

Outcome: `study_collections` gains `categoryId`, `examName`, `semester`, `academicYear`; a new `study_collection_tags` join exists; all `shared` rows/literals become `public`; the repo reads/writes the new metadata and tag set.

---

### Task A1: Prisma schema — new collection fields + tags join

**Files:**
- Modify: `lib/db/prisma/schema.prisma` (StudyCollection model; new StudyCollectionTag model; inverse relations on Tag and Category)

- [ ] **Step 1: Add the new columns + relations to `StudyCollection`**

In `model StudyCollection`, add these fields alongside the existing ones (place after `courseId`):

```prisma
  // Subject — reuses the existing Category taxonomy (Phase 1 metadata).
  categoryId  String?   @map("category_id") @db.Uuid
  // Optional free-text exam name (e.g. "Calculus Final 2026").
  examName    String?   @map("exam_name")
  // fall | spring | summer (text, matches the document semester convention).
  semester    String?   @map("semester")
  academicYear Int?     @map("academic_year")
```

Add the relation + inverse to the model's relation block (after `course`):

```prisma
  category  Category?                 @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  tags      StudyCollectionTag[]
```

Add an index alongside the existing `@@index` lines:

```prisma
  @@index([categoryId], map: "study_collections_category_idx")
```

- [ ] **Step 2: Add the new `StudyCollectionTag` model**

Add this model near `StudyCollection`:

```prisma
model StudyCollectionTag {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  collectionId String   @map("collection_id") @db.Uuid
  tagId        String   @map("tag_id") @db.Uuid
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz()

  collection StudyCollection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  tag        Tag             @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@unique([collectionId, tagId], map: "study_collection_tags_unique")
  @@index([tagId], map: "study_collection_tags_tag_idx")
  @@map("study_collection_tags")
}
```

- [ ] **Step 3: Add inverse relations on `Tag` and `Category`**

In `model Tag`, add: `studyCollectionTags StudyCollectionTag[]`
In `model Category`, add: `studyCollections StudyCollection[]`

- [ ] **Step 4: Validate the schema**

Run (from repo root): `corepack pnpm --filter @workspace/db exec prisma validate`
Expected: "The schema at lib/db/prisma/schema.prisma is valid 🚀"

- [ ] **Step 5: Commit**

```bash
git add lib/db/prisma/schema.prisma
git commit -m "feat(db): add collection metadata fields + study_collection_tags model"
```

---

### Task A2: Migration — apply schema changes + backfill `shared`→`public`

**Files:**
- Create: `lib/db/prisma/migrations/<timestamp>_collections_metadata_visibility/migration.sql` (generated, then hand-edited)

- [ ] **Step 1: Generate the migration without applying**

From repo root (DB must be reachable; `.env` loaded):
```bash
corepack pnpm --filter @workspace/db exec prisma migrate dev --name collections_metadata_visibility --create-only
```
Expected: a new folder under `lib/db/prisma/migrations/` containing `migration.sql` with `ALTER TABLE "study_collections" ADD COLUMN ...`, `CREATE TABLE "study_collection_tags" ...`, and the new indexes. It does NOT apply yet (`--create-only`).

- [ ] **Step 2: Append the visibility backfill to the generated `migration.sql`**

Open the new `migration.sql` and add at the END:

```sql
-- Phase 1: rename the `shared` visibility value to `public`. A public
-- collection's materials are already platform-approved, so publishing needs
-- no approval step. `isOfficial` collections remain discoverable regardless.
UPDATE "study_collections" SET "visibility" = 'public' WHERE "visibility" = 'shared';
```

- [ ] **Step 3: Apply the migration + regenerate the Prisma client**

```bash
corepack pnpm --filter @workspace/db exec prisma migrate dev
corepack pnpm --filter @workspace/db exec prisma generate
```
Expected: migration applies cleanly; `@workspace/db` client regenerated with the new fields.

- [ ] **Step 4: Sanity-check the columns exist**

```bash
corepack pnpm --filter @workspace/db exec prisma db execute --stdin <<'SQL'
SELECT column_name FROM information_schema.columns
WHERE table_name='study_collections' AND column_name IN ('category_id','exam_name','semester','academic_year');
SQL
```
Expected: 4 rows returned.

- [ ] **Step 5: Commit**

```bash
git add lib/db/prisma/migrations
git commit -m "feat(db): migrate collection metadata columns + shared->public backfill"
```

---

### Task A3: Repo — visibility rename + metadata + tag set

**Files:**
- Modify: `artifacts/api-server/src/repositories/collections.repo.ts`
- Test: `artifacts/api-server/src/repositories/collections.metadata.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `src/repositories/collections.metadata.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import {
  createCollection,
  findCollectionById,
  updateCollection,
  setCollectionTags,
  listCollectionTagIds,
  listDiscoverable,
} from "./collections.repo";

const SX = `_colmeta_${Date.now().toString(36)}`;
let ownerId: string;
let categoryId: string;
let tagAId: string;
let tagBId: string;

beforeAll(async () => {
  const owner = await db.user.create({
    data: { email: `o${SX}@demo`, passwordHash: "x", displayName: `O${SX}`, isActive: true },
  });
  ownerId = owner.id;
  const cat = await db.category.create({ data: { name: `Cat${SX}` } });
  categoryId = cat.id;
  const t1 = await db.tag.create({ data: { name: `t1${SX}` } });
  const t2 = await db.tag.create({ data: { name: `t2${SX}` } });
  tagAId = t1.id;
  tagBId = t2.id;
});

afterAll(async () => {
  await db.studyCollection.deleteMany({ where: { ownerId } });
  await db.tag.deleteMany({ where: { id: { in: [tagAId, tagBId] } } });
  await db.category.deleteMany({ where: { id: categoryId } });
  await db.user.deleteMany({ where: { id: ownerId } });
});

describe("collections.repo metadata", () => {
  it("persists categoryId, examName, semester, academicYear on create", async () => {
    const c = await createCollection({
      ownerId,
      title: `C${SX}`,
      categoryId,
      examName: "Final",
      semester: "spring",
      academicYear: 2026,
    });
    const got = await findCollectionById(c.id);
    expect(got?.categoryId).toBe(categoryId);
    expect(got?.examName).toBe("Final");
    expect(got?.semester).toBe("spring");
    expect(got?.academicYear).toBe(2026);
  });

  it("replace-sets tags", async () => {
    const c = await createCollection({ ownerId, title: `T${SX}` });
    await setCollectionTags(c.id, [tagAId, tagBId]);
    expect((await listCollectionTagIds(c.id)).sort()).toEqual([tagAId, tagBId].sort());
    await setCollectionTags(c.id, [tagAId]);
    expect(await listCollectionTagIds(c.id)).toEqual([tagAId]);
  });

  it("listDiscoverable returns public collections (not private)", async () => {
    const pub = await createCollection({ ownerId, title: `Pub${SX}`, visibility: "public" });
    const priv = await createCollection({ ownerId, title: `Priv${SX}`, visibility: "private" });
    const ids = (await listDiscoverable({ sort: "recent", limit: 50 })).map((r) => r.id);
    expect(ids).toContain(pub.id);
    expect(ids).not.toContain(priv.id);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run (from `artifacts/api-server`, `.env` loaded): `corepack pnpm vitest run src/repositories/collections.metadata.test.ts`
Expected: FAIL — `setCollectionTags`/`listCollectionTagIds` are not exported, and `createCollection` ignores the new fields.

- [ ] **Step 3: Extend `CollectionRow`, `CreateCollectionInput`, and `createCollection`**

In `collections.repo.ts`, add to `CollectionRow` (after `courseId`):
```ts
  categoryId: string | null;
  examName: string | null;
  semester: string | null;
  academicYear: number | null;
```
Add to `CreateCollectionInput`:
```ts
  categoryId?: string | null;
  examName?: string | null;
  semester?: string | null;
  academicYear?: number | null;
```
In `createCollection`, extend the `data` object:
```ts
      categoryId: input.categoryId ?? null,
      examName: input.examName ?? null,
      semester: input.semester ?? null,
      academicYear: input.academicYear ?? null,
```

- [ ] **Step 4: Widen `updateCollection` to accept the new fields**

Change its `patch` type to:
```ts
export async function updateCollection(
  id: string,
  patch: Partial<
    Pick<
      CollectionRow,
      | "title" | "description" | "kind" | "visibility" | "courseId" | "examDate"
      | "categoryId" | "examName" | "semester" | "academicYear"
    >
  >,
): Promise<void> {
```
(The body is unchanged — it already spreads `patch`.)

- [ ] **Step 5: Add the tag helpers**

Append to `collections.repo.ts`:
```ts
// ─── Tags (Phase 1 metadata) ──────────────────────────────────────

/** Replace-set a collection's tags to exactly `tagIds`. */
export async function setCollectionTags(
  collectionId: string,
  tagIds: string[],
): Promise<void> {
  const unique = Array.from(new Set(tagIds));
  await db.$transaction([
    db.studyCollectionTag.deleteMany({ where: { collectionId } }),
    ...(unique.length > 0
      ? [
          db.studyCollectionTag.createMany({
            data: unique.map((tagId) => ({ collectionId, tagId })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);
}

export async function listCollectionTagIds(
  collectionId: string,
): Promise<string[]> {
  const rows = await db.studyCollectionTag.findMany({
    where: { collectionId },
    select: { tagId: true },
  });
  return rows.map((r) => r.tagId);
}

/** Batch tag ids keyed by collection id (for summary enrichment). */
export async function listTagIdsForCollections(
  collectionIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (collectionIds.length === 0) return map;
  const rows = await db.studyCollectionTag.findMany({
    where: { collectionId: { in: collectionIds } },
    select: { collectionId: true, tagId: true },
  });
  for (const r of rows) {
    const list = map.get(r.collectionId) ?? [];
    list.push(r.tagId);
    map.set(r.collectionId, list);
  }
  return map;
}
```

- [ ] **Step 6: Rename the `shared` visibility literal to `public` in repo queries**

In `listDiscoverable` and `recommendCollections`, replace `{ visibility: "shared" }` with `{ visibility: "public" }` (two occurrences).

- [ ] **Step 7: Run the test to confirm it passes**

Run: `corepack pnpm vitest run src/repositories/collections.metadata.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add src/repositories/collections.repo.ts src/repositories/collections.metadata.test.ts
git commit -m "feat(collections): repo metadata fields, tag set helpers, shared->public"
```

---

### Task A4: Service — accept/validate metadata; visibility `public`

**Files:**
- Modify: `artifacts/api-server/src/services/collections.service.ts`
- Test: `artifacts/api-server/src/services/collections.metadata.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/collections.metadata.service.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { createCollection, updateCollection, getCollection } from "./collections.service";
import { listCollectionTagIds } from "../repositories/collections.repo";

const SX = `_colsvc_${Date.now().toString(36)}`;
let user: AuthenticatedUser;
let categoryId: string;
let tagId: string;

beforeAll(async () => {
  const u = await db.user.create({
    data: { email: `u${SX}@demo`, passwordHash: "x", displayName: `U${SX}`, isActive: true },
  });
  user = { id: u.id, roles: ["student"], enrollments: [] } as AuthenticatedUser;
  categoryId = (await db.category.create({ data: { name: `Cat${SX}` } })).id;
  tagId = (await db.tag.create({ data: { name: `tag${SX}` } })).id;
});

afterAll(async () => {
  await db.studyCollection.deleteMany({ where: { ownerId: user.id } });
  await db.tag.deleteMany({ where: { id: tagId } });
  await db.category.deleteMany({ where: { id: categoryId } });
  await db.user.deleteMany({ where: { id: user.id } });
});

describe("collections.service metadata", () => {
  it("persists metadata + tags on create and exposes them on detail", async () => {
    const c = await createCollection(user, {
      title: `Meta${SX}`,
      categoryId,
      examName: "Midterm",
      semester: "fall",
      academicYear: 2026,
      tagIds: [tagId],
      visibility: "public",
    });
    const detail = await getCollection(c.id, user);
    expect(detail.categoryId).toBe(categoryId);
    expect(detail.examName).toBe("Midterm");
    expect(detail.semester).toBe("fall");
    expect(detail.academicYear).toBe(2026);
    expect(detail.tagIds).toEqual([tagId]);
    expect(detail.visibility).toBe("public");
  });

  it("rejects an invalid semester", async () => {
    await expect(
      createCollection(user, { title: `Bad${SX}`, semester: "winter" }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `corepack pnpm vitest run src/services/collections.metadata.service.test.ts`
Expected: FAIL — `createCollection` ignores `categoryId`/`tagIds`/etc.; DTO has no `tagIds`; `VISIBILITIES` rejects `public`.

- [ ] **Step 3: Update constants + DTO**

In `collections.service.ts`:
- Change `const VISIBILITIES = ["private", "shared"] as const;` → `const VISIBILITIES = ["private", "public"] as const;`
- Add `const SEMESTERS = ["fall", "spring", "summer"] as const;`
- In `loadVisible`, change `c.visibility === "shared"` → `c.visibility === "public"`.
- Add to `CollectionSummaryDTO` (after `courseId`):
  ```ts
  categoryId?: string;
  examName?: string;
  semester?: string;
  academicYear?: number;
  tagIds: string[];
  ```

- [ ] **Step 4: Populate the new DTO fields in `toSummary`**

`toSummary` currently takes `(c, extra)`. Add `tagIds` to `SummaryExtra`:
```ts
interface SummaryExtra {
  followerCount?: number;
  isFollowing?: boolean;
  completedCount?: number;
  tagIds?: string[];
}
```
In the returned object add:
```ts
    categoryId: c.categoryId ?? undefined,
    examName: c.examName ?? undefined,
    semester: c.semester ?? undefined,
    academicYear: c.academicYear ?? undefined,
    tagIds: extra.tagIds ?? [],
```

- [ ] **Step 5: Enrich `summarize` and `getCollection` with tag ids**

In `summarize`, add a batched tag fetch:
```ts
  const [followerCounts, followed, completed, tagMap] = await Promise.all([
    collectionsRepo.countFollowersForCollections(ids),
    collectionsRepo.listFollowedCollectionIds(user.id, ids),
    collectionsRepo.countCompletedForCollections(user.id, ids),
    collectionsRepo.listTagIdsForCollections(ids),
  ]);
```
and pass `tagIds: tagMap.get(r.id) ?? []` into each `toSummary(...)` call.

In `getCollection`, fetch tags for the single collection and pass them through:
```ts
  const tagIds = await collectionsRepo.listCollectionTagIds(id);
```
then add `tagIds` to the `extra` object passed to `toSummary`.

In `createCollection`'s final `return toSummary(...)`, pass `{ tagIds: ... }` — simplest is to read it back: after writing tags (next step), call `const tagIds = await collectionsRepo.listCollectionTagIds(created.id);` and include it.

- [ ] **Step 6: Validate + persist metadata in `createCollection`**

Extend the `input` type with `categoryId?, examName?, semester?, academicYear?, tagIds?: string[]`. After the existing visibility check, add:
```ts
  if (input.semester && !(SEMESTERS as readonly string[]).includes(input.semester)) {
    throw badRequest(`Unknown semester. Allowed: ${SEMESTERS.join(", ")}`);
  }
```
Pass the new fields into `collectionsRepo.createCollection({ ... })`:
```ts
    categoryId: input.categoryId ?? null,
    examName: input.examName?.trim() || null,
    semester: input.semester ?? null,
    academicYear: input.academicYear ?? null,
```
After items are added, write tags:
```ts
  if (input.tagIds && input.tagIds.length > 0) {
    await collectionsRepo.setCollectionTags(created.id, input.tagIds);
  }
  const tagIds = await collectionsRepo.listCollectionTagIds(created.id);
  return toSummary({ ...created, itemCount: documentIds.length }, { tagIds });
```

- [ ] **Step 7: Validate + persist metadata in `updateCollection`**

Extend the `patch` type with `categoryId?: string | null; examName?: string | null; semester?: string | null; academicYear?: number | null; tagIds?: string[]`. After the visibility branch add handling:
```ts
  if (patch.semester !== undefined) {
    if (patch.semester !== null && !(SEMESTERS as readonly string[]).includes(patch.semester)) {
      throw badRequest(`Unknown semester. Allowed: ${SEMESTERS.join(", ")}`);
    }
    data.semester = patch.semester;
  }
  if (patch.categoryId !== undefined) data.categoryId = patch.categoryId;
  if (patch.examName !== undefined) data.examName = patch.examName?.trim() || null;
  if (patch.academicYear !== undefined) data.academicYear = patch.academicYear;
```
After `await collectionsRepo.updateCollection(id, data);` add:
```ts
  if (patch.tagIds !== undefined) {
    await collectionsRepo.setCollectionTags(id, patch.tagIds);
  }
```

- [ ] **Step 8: Run the test to confirm it passes**

Run: `corepack pnpm vitest run src/services/collections.metadata.service.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Typecheck + commit**

```bash
corepack pnpm --filter @workspace/api-server run typecheck
git add src/services/collections.service.ts src/services/collections.metadata.service.test.ts
git commit -m "feat(collections): service validates+persists metadata & tags; visibility public"
```

---

# PART B — Backend Module Split, Access Control, Duplicate, OpenAPI

Outcome: discovery/follow/recommend live in `prep-hub.service.ts` under `/api/prep-hub/*`; collections routes are owner-only and blocked for admins; duplicate works; the OpenAPI clients are regenerated.

---

### Task B1: `canUseCollections` permission helper

**Files:**
- Modify: `artifacts/api-server/src/services/permissions.service.ts`
- Test: `artifacts/api-server/src/services/permissions.collections.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `src/services/permissions.collections.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canUseCollections } from "./permissions.service";
import type { AuthenticatedUser } from "../middlewares/auth";

const mk = (roles: string[]): AuthenticatedUser =>
  ({ id: "u1", roles, enrollments: [] } as AuthenticatedUser);

describe("canUseCollections", () => {
  it("allows students and lecturers", () => {
    expect(canUseCollections(mk(["student"]))).toBe(true);
    expect(canUseCollections(mk(["lecturer"]))).toBe(true);
  });
  it("denies admins", () => {
    expect(canUseCollections(mk(["admin"]))).toBe(false);
    expect(canUseCollections(mk(["admin", "lecturer"]))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `corepack pnpm vitest run src/services/permissions.collections.test.ts`
Expected: FAIL — `canUseCollections` not exported.

- [ ] **Step 3: Implement the helper**

In `permissions.service.ts`, after `isAdmin`, add:
```ts
/**
 * Collections (the personal workspace) are for students and lecturers only.
 * Admins have no Collections workspace — they get read-only Prep Hub plus
 * moderation (Phase 4). An admin who is ALSO a lecturer is still excluded:
 * the admin role is the dominant signal here.
 */
export function canUseCollections(u: AuthenticatedUser | undefined | null): boolean {
  if (!u || isAdmin(u)) return false;
  return u.roles.includes("student") || u.roles.includes("lecturer");
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `corepack pnpm vitest run src/services/permissions.collections.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/permissions.service.ts src/services/permissions.collections.test.ts
git commit -m "feat(permissions): add canUseCollections (students+lecturers, not admin)"
```

---

### Task B2: Create `prep-hub.service.ts`; move discovery/follow/recommend

**Files:**
- Create: `artifacts/api-server/src/services/prep-hub.service.ts`
- Modify: `artifacts/api-server/src/services/collections.service.ts` (remove moved fns; tighten `getCollection` to owner-only via a new `getOwnedCollection`)
- Test: `artifacts/api-server/src/services/prep-hub.service.test.ts`

> **Design note:** `collections.service` keeps DTO/summary helpers. To avoid duplication, EXPORT the helpers `prep-hub.service` needs from `collections.service`: `summarize`, `toSummary` are internal — instead expose a single reusable `buildDetail(id, user)` is overkill. Simplest: move the shared `summarize` + `getCollection` core into `collections.service` and have `prep-hub.service` import them. Concretely: export `summarize` and a new `assembleDetail(collectionRow, user)` from `collections.service`, and reuse them.

- [ ] **Step 1: Export the shared helpers from `collections.service.ts`**

Change `async function summarize(` to `export async function summarize(`.
Add a new exported function that builds a detail DTO from an already-loaded row (refactor `getCollection` to use it):

```ts
/** Build a full detail DTO for an already-authorized collection row. Shared
 *  by the owner manage view (collections) and the public view (prep-hub). */
export async function assembleDetail(
  c: collectionsRepo.CollectionRow,
  user: AuthenticatedUser,
): Promise<CollectionDetailDTO> {
  const itemRows = await collectionsRepo.listItems(c.id);
  const docIds = itemRows.map((i) => i.documentId);
  const docs = await docsRepo.findManyByIdsAlive(docIds);
  const visible = docs.filter((d) => permissions.canView(d, user));
  const dtos = await documentsService.assembleDocuments(visible, user);
  const dtoById = new Map(dtos.map((d) => [d.id, d]));
  const progress = await studyProgressRepo.getProgressForDocuments(user.id, docIds);
  const items: CollectionItemDTO[] = itemRows
    .filter((i) => dtoById.has(i.documentId))
    .map((i) => ({
      document: dtoById.get(i.documentId)!,
      note: i.note ?? undefined,
      position: i.position,
      progress: progress.get(i.documentId),
    }));
  const completedCount = items.filter((i) => i.progress === "completed").length;
  const [followerCount, following, tagIds] = await Promise.all([
    collectionsRepo.countFollowers(c.id),
    collectionsRepo.isFollowing(c.id, user.id),
    collectionsRepo.listCollectionTagIds(c.id),
  ]);
  const summary = toSummary(
    { ...c, itemCount: items.length },
    { followerCount, isFollowing: following, completedCount, tagIds },
  );
  return { ...summary, items };
}
```

Replace the body of `getCollection` with an owner-only load + `assembleDetail`:
```ts
export async function getCollection(
  id: string,
  user: AuthenticatedUser,
): Promise<CollectionDetailDTO> {
  const c = await loadOwned(id, user);
  return assembleDetail(c, user);
}
```

> Note: this intentionally changes manage-detail to **owner-only** (was view-able by anyone for shared/official). Public viewing now lives in prep-hub.

- [ ] **Step 2: Remove the discovery/follow/recommend functions from `collections.service.ts`**

Delete from `collections.service.ts`: `listDiscoverable`, `getRecommendedCollections`, `followCollection`, `unfollowCollection`, and the now-unused `loadVisible` (manage uses `loadOwned`; prep-hub does its own public check). Keep `recomputePopularity`, `summarize`, `toSummary`, `assembleDetail` — these are reused by prep-hub via import, so add `export` to `recomputePopularity` (and confirm `summarize` + `assembleDetail` are exported from Step 1).

- [ ] **Step 3: Write the new `prep-hub.service.ts`**

Create `src/services/prep-hub.service.ts`:

```ts
/**
 * Prep Hub — community discovery over PUBLIC study collections.
 *
 * Read + follow + recommend only. All write/management lives in
 * collections.service. Private collections are never exposed here — not even
 * to their owner (owners manage them in the Collections module).
 */
import * as collectionsRepo from "../repositories/collections.repo";
import * as collectionsService from "./collections.service";
import * as recommendationsService from "./recommendations.service";
import { notFound } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";
import type {
  CollectionSummaryDTO,
  CollectionDetailDTO,
} from "./collections.service";

/** A collection is in Prep Hub iff it is public or official (curated). */
function isPublic(c: collectionsRepo.CollectionRow): boolean {
  return c.visibility === "public" || c.isOfficial;
}

export async function listDiscoverable(
  user: AuthenticatedUser,
  opts: { sort?: collectionsRepo.DiscoverSort; courseId?: string; limit?: number },
): Promise<CollectionSummaryDTO[]> {
  const rows = await collectionsRepo.listDiscoverable({
    sort: opts.sort ?? "popular",
    courseId: opts.courseId,
    limit: Math.min(opts.limit ?? 24, 50),
  });
  return collectionsService.summarize(rows, user);
}

export async function getPublicCollection(
  id: string,
  user: AuthenticatedUser,
): Promise<CollectionDetailDTO> {
  const c = await collectionsRepo.findCollectionById(id);
  // Private collections must never appear in Prep Hub — 404 (not 403) so we
  // don't reveal existence.
  if (!c || !isPublic(c)) throw notFound("Collection not found");
  return collectionsService.assembleDetail(c, user);
}

export async function followCollection(
  id: string,
  user: AuthenticatedUser,
): Promise<CollectionDetailDTO> {
  const c = await collectionsRepo.findCollectionById(id);
  if (!c || !isPublic(c)) throw notFound("Collection not found");
  const created = await collectionsRepo.followCollection(id, user.id);
  if (created) await collectionsService.recomputePopularity(id);
  return collectionsService.assembleDetail(c, user);
}

export async function unfollowCollection(
  id: string,
  user: AuthenticatedUser,
): Promise<CollectionDetailDTO> {
  const c = await collectionsRepo.findCollectionById(id);
  if (!c || !isPublic(c)) throw notFound("Collection not found");
  const removed = await collectionsRepo.unfollowCollection(id, user.id);
  if (removed) await collectionsService.recomputePopularity(id);
  return collectionsService.assembleDetail(c, user);
}

export async function getRecommendedCollections(
  user: AuthenticatedUser,
  limit = 6,
): Promise<CollectionSummaryDTO[]> {
  const { courseIds } = await recommendationsService.getInterestCourseIds(user);
  if (courseIds.length === 0) return [];
  const followed = await collectionsRepo.listFollowedCollectionIds(user.id);
  const rows = await collectionsRepo.recommendCollections({
    courseIds,
    excludeOwnerId: user.id,
    excludeIds: Array.from(followed),
    limit,
  });
  return collectionsService.summarize(rows, user);
}
```

- [ ] **Step 4: Write the failing/asserting test**

Create `src/services/prep-hub.service.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { createCollection } from "./collections.service";
import { getPublicCollection, listDiscoverable } from "./prep-hub.service";

const SX = `_prephub_${Date.now().toString(36)}`;
let owner: AuthenticatedUser;
let viewer: AuthenticatedUser;
let publicId: string;
let privateId: string;

beforeAll(async () => {
  const o = await db.user.create({ data: { email: `po${SX}@demo`, passwordHash: "x", displayName: `PO${SX}`, isActive: true } });
  const v = await db.user.create({ data: { email: `pv${SX}@demo`, passwordHash: "x", displayName: `PV${SX}`, isActive: true } });
  owner = { id: o.id, roles: ["student"], enrollments: [] } as AuthenticatedUser;
  viewer = { id: v.id, roles: ["student"], enrollments: [] } as AuthenticatedUser;
  publicId = (await createCollection(owner, { title: `Pub${SX}`, visibility: "public" })).id;
  privateId = (await createCollection(owner, { title: `Priv${SX}`, visibility: "private" })).id;
});

afterAll(async () => {
  await db.studyCollection.deleteMany({ where: { ownerId: owner.id } });
  await db.user.deleteMany({ where: { id: { in: [owner.id, viewer.id] } } });
});

describe("prep-hub.service", () => {
  it("getPublicCollection returns a public collection to a non-owner", async () => {
    const d = await getPublicCollection(publicId, viewer);
    expect(d.id).toBe(publicId);
  });
  it("getPublicCollection 404s on a private collection (even-ish for owner)", async () => {
    await expect(getPublicCollection(privateId, viewer)).rejects.toThrow();
    await expect(getPublicCollection(privateId, owner)).rejects.toThrow();
  });
  it("listDiscoverable excludes private collections", async () => {
    const ids = (await listDiscoverable(viewer, { sort: "recent", limit: 50 })).map((c) => c.id);
    expect(ids).toContain(publicId);
    expect(ids).not.toContain(privateId);
  });
});
```

- [ ] **Step 5: Run the test**

Run: `corepack pnpm vitest run src/services/prep-hub.service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck + commit**

```bash
corepack pnpm --filter @workspace/api-server run typecheck
git add src/services/prep-hub.service.ts src/services/collections.service.ts src/services/prep-hub.service.test.ts
git commit -m "feat(prep-hub): extract discovery/follow/recommend into prep-hub.service"
```

---

### Task B3: Duplicate collection (service + repo)

**Files:**
- Modify: `artifacts/api-server/src/services/collections.service.ts`
- Test: `artifacts/api-server/src/services/collections.duplicate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/collections.duplicate.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { createCollection, duplicateCollection, getCollection } from "./collections.service";
import { listCollectionTagIds } from "../repositories/collections.repo";

const SX = `_dup_${Date.now().toString(36)}`;
let user: AuthenticatedUser;
let tagId: string;

beforeAll(async () => {
  const u = await db.user.create({ data: { email: `du${SX}@demo`, passwordHash: "x", displayName: `DU${SX}`, isActive: true } });
  user = { id: u.id, roles: ["student"], enrollments: [] } as AuthenticatedUser;
  tagId = (await db.tag.create({ data: { name: `dt${SX}` } })).id;
});
afterAll(async () => {
  await db.studyCollection.deleteMany({ where: { ownerId: user.id } });
  await db.tag.deleteMany({ where: { id: tagId } });
  await db.user.deleteMany({ where: { id: user.id } });
});

describe("duplicateCollection", () => {
  it("clones metadata + tags as a new PRIVATE collection owned by the caller", async () => {
    const src = await createCollection(user, {
      title: `Src${SX}`, examName: "Final", semester: "fall", academicYear: 2026,
      tagIds: [tagId], visibility: "public",
    });
    const copy = await duplicateCollection(src.id, user);
    expect(copy.id).not.toBe(src.id);
    expect(copy.visibility).toBe("private");
    expect(copy.title).toContain(`Src${SX}`);
    const detail = await getCollection(copy.id, user);
    expect(detail.examName).toBe("Final");
    expect(detail.semester).toBe("fall");
    expect(await listCollectionTagIds(copy.id)).toEqual([tagId]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `corepack pnpm vitest run src/services/collections.duplicate.test.ts`
Expected: FAIL — `duplicateCollection` not exported.

- [ ] **Step 3: Implement `duplicateCollection`**

Add to `collections.service.ts`:
```ts
/** Clone a collection's metadata, tags, and item list into a new PRIVATE
 *  collection owned by the caller. Owner-only. Followers are not copied. */
export async function duplicateCollection(
  id: string,
  user: AuthenticatedUser,
): Promise<CollectionSummaryDTO> {
  const src = await loadOwned(id, user);
  const items = await collectionsRepo.listItems(id);
  const tagIds = await collectionsRepo.listCollectionTagIds(id);
  const created = await collectionsRepo.createCollection({
    ownerId: user.id,
    title: `${src.title} (copy)`,
    description: src.description,
    kind: src.kind,
    courseId: src.courseId,
    visibility: "private",
    examDate: src.examDate,
    categoryId: src.categoryId,
    examName: src.examName,
    semester: src.semester,
    academicYear: src.academicYear,
  });
  for (const it of items) {
    await collectionsRepo.addItem(created.id, it.documentId, it.note ?? undefined);
  }
  if (tagIds.length > 0) await collectionsRepo.setCollectionTags(created.id, tagIds);
  await recomputePopularity(created.id);
  const newTagIds = await collectionsRepo.listCollectionTagIds(created.id);
  return toSummary({ ...created, itemCount: items.length }, { tagIds: newTagIds });
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `corepack pnpm vitest run src/services/collections.duplicate.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/services/collections.service.ts src/services/collections.duplicate.test.ts
git commit -m "feat(collections): duplicate collection (clone metadata+tags+items as private)"
```

---

### Task B4: Routes — `/api/prep-hub/*`, collections access gate, metadata + duplicate

**Files:**
- Create: `artifacts/api-server/src/routes/prep-hub.ts`
- Modify: `artifacts/api-server/src/routes/collections.ts`, `artifacts/api-server/src/routes/index.ts`

- [ ] **Step 1: Add the access-gate + metadata fields to `routes/collections.ts`**

At the top, import the permission helper and `forbidden`:
```ts
import * as permissions from "../services/permissions.service";
import { forbidden } from "../lib/errors";
```
Add a middleware after the `router` is created:
```ts
// Collections are a students+lecturers workspace. Admins are blocked here
// (they get read-only Prep Hub + moderation in Phase 4).
const requireCollectionsAccess: import("express").RequestHandler = (req, _res, next) => {
  if (!permissions.canUseCollections(req.authUser)) {
    return next(forbidden("Collections are not available for your account"));
  }
  next();
};
```
Add `requireCollectionsAccess` as a middleware on EVERY `/collections...` route (after `requireAuth`), e.g. `router.get("/collections", requireAuth, requireCollectionsAccess, async ...)`. Apply to: list, create, `:id`, patch, delete, items (add/remove/note), order, and the new duplicate. (Do NOT apply it to `/documents/:id/progress`, `/me/continue-studying`, `/me/recommendations` — those stay general.)

Update the Zod bodies to accept metadata and `public`:
```ts
const CreateBody = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  kind: z.string().optional(),
  courseId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  examName: z.string().optional(),
  semester: z.enum(["fall", "spring", "summer"]).optional(),
  academicYear: z.coerce.number().int().min(1900).max(2200).optional(),
  visibility: z.enum(["private", "public"]).optional(),
  examDate: z.coerce.date().optional(),
  documentIds: z.array(z.string().uuid()).optional(),
  tagIds: z.array(z.string().uuid()).optional(),
});
const UpdateBody = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  kind: z.string().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  examName: z.string().nullable().optional(),
  semester: z.enum(["fall", "spring", "summer"]).nullable().optional(),
  academicYear: z.coerce.number().int().min(1900).max(2200).nullable().optional(),
  visibility: z.enum(["private", "public"]).optional(),
  examDate: z.coerce.date().optional(),
  tagIds: z.array(z.string().uuid()).optional(),
});
```

- [ ] **Step 2: Remove the moved routes + add the duplicate route in `routes/collections.ts`**

Delete the route handlers for: `GET /collections/discover`, `POST /collections/:id/follow`, `DELETE /collections/:id/follow`, and `GET /me/recommended-collections`. Remove now-unused imports if any.

Add the duplicate route (near the other `:id` routes):
```ts
router.post(
  "/collections/:id/duplicate",
  requireAuth,
  requireCollectionsAccess,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      res.status(201).json(await collectionsService.duplicateCollection(id, req.authUser!));
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 3: Create `routes/prep-hub.ts`**

```ts
import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import * as permissions from "../services/permissions.service";
import { forbidden } from "../lib/errors";
import * as prepHubService from "../services/prep-hub.service";

const router: IRouter = Router();

const IdParams = z.object({ id: z.string().uuid() });
const DiscoverQuery = z.object({
  sort: z.enum(["popular", "recent"]).optional(),
  courseId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

// Following is a personal study affordance — students + lecturers only.
const requireFollowAccess: import("express").RequestHandler = (req, _res, next) => {
  if (!permissions.canUseCollections(req.authUser)) {
    return next(forbidden("Following is not available for your account"));
  }
  next();
};

router.get("/prep-hub/collections", requireAuth, async (req, res, next) => {
  try {
    const q = DiscoverQuery.parse(req.query);
    res.json(
      await prepHubService.listDiscoverable(req.authUser!, {
        sort: q.sort,
        courseId: q.courseId,
        limit: q.limit,
      }),
    );
  } catch (err) {
    next(err);
  }
});

router.get("/prep-hub/recommended", requireAuth, async (req, res, next) => {
  try {
    res.json(await prepHubService.getRecommendedCollections(req.authUser!));
  } catch (err) {
    next(err);
  }
});

router.get("/prep-hub/collections/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = IdParams.parse(req.params);
    res.json(await prepHubService.getPublicCollection(id, req.authUser!));
  } catch (err) {
    next(err);
  }
});

router.post(
  "/prep-hub/collections/:id/follow",
  requireAuth,
  requireFollowAccess,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      res.json(await prepHubService.followCollection(id, req.authUser!));
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/prep-hub/collections/:id/follow",
  requireAuth,
  requireFollowAccess,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      res.json(await prepHubService.unfollowCollection(id, req.authUser!));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
```

- [ ] **Step 4: Register the new router**

In `routes/index.ts`, add `import prepHubRouter from "./prep-hub";` and `router.use(prepHubRouter);` (after `collectionsRouter`).

- [ ] **Step 5: Typecheck + build**

Run: `corepack pnpm --filter @workspace/api-server run typecheck && corepack pnpm --filter @workspace/api-server run build`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/routes/collections.ts src/routes/prep-hub.ts src/routes/index.ts
git commit -m "feat(routes): /api/prep-hub/*, collections admin gate, metadata + duplicate"
```

---

### Task B5: OpenAPI spec + client regeneration

**Files:**
- Modify: `lib/api-spec/openapi.yaml`
- Regenerated (do not hand-edit): `lib/api-zod/src/generated/*`, `lib/api-client-react/src/generated/*`

- [ ] **Step 1: Add the new metadata fields to the collection schemas**

In `openapi.yaml`, find `StudyCollectionSummary` (component schema) and add properties: `categoryId` (string, uuid, nullable), `examName` (string, nullable), `semester` (string, enum fall/spring/summer, nullable), `academicYear` (integer, nullable), `tagIds` (array of string uuid). Change any `visibility` enum from `[private, shared]` to `[private, public]`. Update `CreateCollectionRequest` and `UpdateCollectionRequest` to include `categoryId`, `examName`, `semester`, `academicYear`, `tagIds` and the `private|public` visibility enum.

- [ ] **Step 2: Move discovery/follow/recommend paths under `/prep-hub` and add duplicate**

- Remove paths `/collections/discover`, `/collections/{id}/follow`, `/me/recommended-collections`.
- Add paths (mirroring the removed operationIds so the web hooks keep familiar names where possible):
  - `GET /prep-hub/collections` → `operationId: listDiscoverableCollections`, returns `array<StudyCollectionSummary>`, query `sort,courseId,limit`.
  - `GET /prep-hub/recommended` → `operationId: listRecommendedCollections`, returns `array<StudyCollectionSummary>`.
  - `GET /prep-hub/collections/{id}` → `operationId: getPublicCollection`, returns `StudyCollectionDetail`.
  - `POST /prep-hub/collections/{id}/follow` → `operationId: followCollection`, returns `StudyCollectionDetail`.
  - `DELETE /prep-hub/collections/{id}/follow` → `operationId: unfollowCollection`, returns `StudyCollectionDetail`.
- Add path `POST /collections/{id}/duplicate` → `operationId: duplicateCollection`, returns `StudyCollectionSummary` (201).
- Tag the new prep-hub operations `tags: [prep-hub]`.

> Mirror the exact YAML style of the existing `/collections` block (inline `schema: { $ref: ... }`, `parameters` with `$ref` to the shared `Id` path param if one exists — otherwise copy an existing path param definition verbatim).

- [ ] **Step 3: Regenerate the clients**

Run (repo root): `corepack pnpm --filter @workspace/api-spec run codegen`
Expected: orval rewrites `lib/api-zod` + `lib/api-client-react`; the trailing `typecheck:libs` passes. New hooks appear, e.g. `useListDiscoverableCollections`, `useGetPublicCollection`, `useFollowCollection`, `useDuplicateCollection`, `useListRecommendedCollections`.

- [ ] **Step 4: Confirm generated hooks exist**

Run: `grep -rl "useGetPublicCollection\|useDuplicateCollection" lib/api-client-react/src/generated`
Expected: at least one file path printed.

- [ ] **Step 5: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-zod/src/generated lib/api-client-react/src/generated
git commit -m "feat(api): openapi prep-hub paths + collection metadata + duplicate; regen clients"
```

---

# PART C — Frontend Split

Outcome: two nav items (role-gated), two route trees, a Collections workspace (list + create-with-metadata + manage/duplicate/share), and a discovery-only Prep Hub with a read-only public collection view.

> **Build/verify note:** after each task, run `corepack pnpm --filter @workspace/web run typecheck` (or `build`) to catch hook/type errors. There is no per-component unit-test convention for these pages; the acceptance check is typecheck + the manual smoke at the end of Part C. Where a Playwright smoke exists (`artifacts/web/tests/`), extend it as noted in Task C7.

---

### Task C1: Navigation — invert admin gating, add Collections

**Files:**
- Modify: `artifacts/web/src/components/layout.tsx`

- [ ] **Step 1: Update the icon import + `primaryNav`**

Add `FolderOpen` to the `lucide-react` import. Replace the `primaryNav` array (lines ~73-83) with:

```tsx
  const primaryNav: NavItem[] = user
    ? [
        { href: "/", icon: BookOpen, label: "Home" },
        { href: "/browse", icon: Search, label: "Browse" },
        // Collections = personal workspace, students + lecturers only.
        ...(!isAdmin
          ? [{ href: "/collections", icon: FolderOpen, label: "Collections" }]
          : []),
        // Prep Hub = community discovery, everyone incl. admins (read-only).
        { href: "/prep-hub", icon: GraduationCap, label: "Prep Hub" },
        { href: "/requests", icon: MessageSquare, label: "Requests" },
        { href: "/upload", icon: Upload, label: "Upload" },
      ]
    : [];
```

- [ ] **Step 2: Typecheck + commit**

```bash
corepack pnpm --filter @workspace/web run typecheck
git add artifacts/web/src/components/layout.tsx
git commit -m "feat(web): Collections nav (non-admin) + Prep Hub for all roles"
```

---

### Task C2: Routes — add Collections tree, keep Prep Hub tree

**Files:**
- Modify: `artifacts/web/src/App.tsx`
- Modify: `artifacts/web/src/components/auth-guard.tsx` (add a non-admin gate option)

- [ ] **Step 1: Add a `blockAdmin` option to `AuthGuard`**

In `auth-guard.tsx`, add an optional prop `blockAdmin?: boolean`. When true and the user has the `admin` role, render the existing "Access Denied" view (or `<Redirect to="/" />`). Keep current behavior otherwise.

- [ ] **Step 2: Register the Collections routes and the read-only Prep Hub detail in `App.tsx`**

Add imports for the new pages (created in C3–C6):
```tsx
import Collections from "@/pages/collections";
import CollectionManage from "@/pages/collection-manage";
import PrepHubCollection from "@/pages/prep-hub-collection";
```
Add routes (mirror the existing `/prep-hub` block style):
```tsx
<Route path="/collections">
  <AuthGuard blockAdmin>
    <Layout><Collections /></Layout>
  </AuthGuard>
</Route>
<Route path="/collections/:id">
  <AuthGuard blockAdmin>
    <Layout><CollectionManage /></Layout>
  </AuthGuard>
</Route>
```
Change the existing `/prep-hub/:id` route to render `PrepHubCollection` (the read-only community view) instead of the old `CollectionDetail`.

- [ ] **Step 3: Typecheck**

Run: `corepack pnpm --filter @workspace/web run typecheck`
Expected: FAILS only on missing page modules (created next). That's acceptable mid-task; do not commit yet.

> Commit C2 together with C3–C6 (they’re interdependent page modules). Proceed.

---

### Task C3: Collections page — my list + create-with-metadata

**Files:**
- Create: `artifacts/web/src/pages/collections.tsx`
- Reference (move code from): `artifacts/web/src/pages/prep-hub.tsx` (`CreateCollectionDialog`, `BundleCard`, `BundleGrid`)

- [ ] **Step 1: Build `collections.tsx`**

Create the page with: a header ("Collections" + "New collection" button), the **my-collections** grid via `useListMyCollections()`, and the `CreateCollectionDialog` relocated from `prep-hub.tsx`. Reuse `BundleCard`/`BundleGrid` (move them into a shared component file `artifacts/web/src/components/collections/CollectionCard.tsx` if you prefer; otherwise copy). Card links go to `/collections/:id` (manage).

Extend `CreateCollectionDialog` with the new metadata inputs, wired into the `useCreateCollection` payload:
- **Subject**: a category `<Select>` populated from the existing categories query (find the hook used elsewhere, e.g. `useListCategories`/taxonomy hook; reuse it) → sets `categoryId`.
- **Exam Name**: `<Input>` → `examName`.
- **Semester**: `<Select>` of `fall|spring|summer` → `semester`; plus an **Academic Year** `<Input type=number>` → `academicYear`.
- **Tags**: a multi-select against the tags taxonomy hook → `tagIds`.
- **Visibility**: `<Select>` `private|public` (label public as "Public — discoverable in Prep Hub").

Keep the existing material picker (search via `useSearchDocumentsV2`, add `documentIds`). On create success, navigate to `/collections/:id`.

- [ ] **Step 2: Typecheck**

Run: `corepack pnpm --filter @workspace/web run typecheck`
Expected: passes for this module (other new modules may still be missing).

---

### Task C4: Collection manage page (owner)

**Files:**
- Create: `artifacts/web/src/pages/collection-manage.tsx`
- Reference (evolve from): `artifacts/web/src/pages/collection-detail.tsx`

- [ ] **Step 1: Build `collection-manage.tsx`**

Start from the existing `collection-detail.tsx` and adapt for owner management using `useGetCollection(id)`:
- Header with title/kind + the metadata (subject/category name, exam name, semester+year, tags).
- Item list with reorder (up/down via `useReorderCollection`), remove (`useRemoveCollectionItem`), per-item note, and progress controls (existing).
- An **Edit metadata** affordance (modal or inline) calling `useUpdateCollection` with the new fields + visibility toggle (`private|public`).
- **Add materials** via the existing document search picker → `useAddCollectionItem`.
- **Duplicate** button → `useDuplicateCollection`, then navigate to the new `/collections/:newId`.
- **Share** button → copy `${location.origin}/prep-hub/${id}` to clipboard with a toast (only meaningful when public; show a hint if private).
- **Delete** → `useDeleteCollection`, navigate to `/collections`.
- Remove the follow button (following lives on the Prep Hub view, not the owner manage view).

- [ ] **Step 2: Typecheck**

Run: `corepack pnpm --filter @workspace/web run typecheck`
Expected: passes for this module.

---

### Task C5: Prep Hub page — discovery only

**Files:**
- Modify: `artifacts/web/src/pages/prep-hub.tsx`

- [ ] **Step 1: Strip creation from `prep-hub.tsx`**

Remove `CreateCollectionDialog` and the "New collection" entry point (those now live in Collections). Keep/repurpose: `DiscoverBundles` (now via `useListDiscoverableCollections` from the prep-hub namespace), the recommended section (`useListRecommendedCollections`), and the quick lanes. `BundleCard` links now point to `/prep-hub/:id` (community view). If `BundleCard`/`BundleGrid` were moved to a shared component in C3, import them here.

- [ ] **Step 2: Typecheck**

Run: `corepack pnpm --filter @workspace/web run typecheck`
Expected: passes for this module.

---

### Task C6: Prep Hub read-only collection view

**Files:**
- Create: `artifacts/web/src/pages/prep-hub-collection.tsx`

- [ ] **Step 1: Build `prep-hub-collection.tsx`**

Read-only community view via `useGetPublicCollection(id)`:
- Header: title, kind, creator, course/subject, exam, semester+year, tags, created/updated.
- Stats: item count, follower count, popularity (existing fields).
- **Follow/Unfollow** button via `useFollowCollection`/`useUnfollowCollection` (the prep-hub-namespaced hooks); hide it for admins (`user.roles.includes("admin")`).
- Ordered materials list, each linking to its original document (`/documents/:docId`) — no duplication, read-only (no reorder/remove).
- Engagement UI (likes/ratings/comments) is intentionally absent (Phase 2).

- [ ] **Step 2: Typecheck the whole web app**

Run: `corepack pnpm --filter @workspace/web run typecheck`
Expected: exit 0 (all new modules now exist; C2 imports resolve).

- [ ] **Step 3: Commit C2–C6 together**

```bash
git add artifacts/web/src/App.tsx artifacts/web/src/components/auth-guard.tsx \
  artifacts/web/src/pages/collections.tsx artifacts/web/src/pages/collection-manage.tsx \
  artifacts/web/src/pages/prep-hub.tsx artifacts/web/src/pages/prep-hub-collection.tsx \
  artifacts/web/src/components/collections
git commit -m "feat(web): split Collections (manage) and Prep Hub (discover) surfaces"
```

---

### Task C7: Gate `AddToCollection` for admins + smoke

**Files:**
- Modify: `artifacts/web/src/components/add-to-collection.tsx`
- Modify (extend): `artifacts/web/tests/sprint2-smoke.spec.ts` (or the nearest existing smoke spec)

- [ ] **Step 1: Hide `AddToCollection` from admins**

In `add-to-collection.tsx`, read the current user (`useGetCurrentUser`) and return `null` when `user?.roles?.includes("admin")` (admins have no Collections workspace to add to).

- [ ] **Step 2: Add a nav role smoke assertion**

In the existing web smoke spec, add a check that after logging in as a student/lecturer the nav shows both "Collections" and "Prep Hub", and (if an admin login is available in the smoke) that admin shows "Prep Hub" but not "Collections". Mirror the existing spec's login + locator style.

- [ ] **Step 3: Typecheck + commit**

```bash
corepack pnpm --filter @workspace/web run typecheck
git add artifacts/web/src/components/add-to-collection.tsx artifacts/web/tests
git commit -m "feat(web): hide AddToCollection from admins; nav role smoke"
```

---

## Final verification (run after all parts)

- [ ] **Backend tests** (from `artifacts/api-server`, `.env` loaded): `corepack pnpm vitest run` → all pass.
- [ ] **Full typecheck** (repo root): `corepack pnpm run typecheck` → exit 0.
- [ ] **Manual smoke** (`.\dev.ps1`, rebuild API): as a student — create a collection with metadata + materials, set it public, confirm it appears in Prep Hub; open it from Prep Hub (read-only) and follow it; duplicate it from the manage page (new copy is private). As an admin — confirm no Collections nav, Prep Hub visible, `/collections` is denied, no follow button on the Prep Hub view.

---

## Self-review notes (coverage vs. spec)

- §3 module boundaries → Tasks B2, B4, C1, C2. §4 data model → A1, A2, A3. §5 access control → B1, B4 (collections gate + owner-only `getCollection`), C1, C7. §6 backend split + duplicate → B2, B3, B4. §6.4 OpenAPI/regen → B5. §7 frontend → C1–C7. §9 migration → A2. §10 testing → tests in A3, A4, B1, B2, B3, C7 + final smoke.
- Out-of-scope items (likes/ratings/comments/views/FTS/ranking/trending/admin moderation) are not implemented here by design (spec §11).
