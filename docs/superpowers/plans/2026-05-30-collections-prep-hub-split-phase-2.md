# Collections / Prep Hub Split — Phase 2 Implementation Plan (Engagement)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add community **engagement** to public study collections — 1–5 star ratings, binary likes, total+unique views, and flat comments (with an owner notification) — surfaced on the Prep Hub read-only view, all as store-only signals that do not change ranking.

**Architecture:** Four new additive tables (`study_collection_likes/ratings/views/comments`) mirroring the existing engagement tables, plus five denormalized counter columns on `study_collections` maintained transactionally (like `documents.viewCount`). Two new focused service/repo pairs — `collection-engagement.*` (likes/ratings/views) and `collection-comments.*` — expose routes under the existing `/api/prep-hub/*` namespace. Counts ride along on the collection row, so list enrichment only batches the viewer's own like/rating state. The OpenAPI spec drives the regenerated `@workspace/api-zod` + `@workspace/api-client-react` clients (orval).

**Tech Stack:** TypeScript, Express, Prisma + PostgreSQL, Zod, Vitest; React + Vite + wouter + TanStack Query; OpenAPI + orval codegen.

**Reference spec:** `docs/superpowers/specs/2026-05-30-collections-prep-hub-split-phase-2-design.md`

This plan has three parts, each producing working, testable software, meant to be executed in order:

- **Part A — Data foundation** (Prisma schema, migration, two engagement repos)
- **Part B — Backend services, routes, OpenAPI regen**
- **Part C — Frontend engagement UI**

---

## Conventions & prerequisites (read once)

- **Working dir for backend commands:** `artifacts/api-server` unless stated. For codegen: repo root or `lib/api-spec`.
- **All commands use `corepack pnpm`** (no global pnpm shim on this box).
- **DB-backed tests need `DATABASE_URL`.** Vitest has no env setup file, so before running any test that touches `@workspace/db`, load `.env` into the shell. From Git Bash (paths relative to `artifacts/api-server`): `set -a && . ../../.env && set +a`. From PowerShell, run inside a `.\dev.ps1`-loaded window. Postgres must be up (`docker compose up -d db`).
- **`AuthenticatedUser` shape** (from `src/middlewares/auth.ts`): `{ id: string; roles: string[]; enrollments: { courseId: string; roleInCourse: string }[] }`. Construct minimal test users as `{ id, roles, enrollments } as AuthenticatedUser`.
- **DB test hygiene:** follow `src/repositories/collections.metadata.test.ts` — unique `SX` suffix, create rows directly via `db`, clean up in `afterAll` (delete child rows before parents).
- **Counter rule:** every counter mutation (`likeCount`, `ratingCount`, `ratingSum`, `viewCount`, `commentCount`) MUST share a `db.$transaction` with its event-row write so counts never drift.
- **`notify(...)` already self-skips** (`actorId === recipientId` → no-op) and is non-throwing — callers don't special-case self-comment or wrap in try/catch.
- **Write access middleware** is the existing `requireCollectionsAccess` from `src/middlewares/collections-access.ts` (students + lecturers; admins → 403).
- **Commit after every task** (the final step of each task). Never use `--no-verify`.

---

# PART A — Data Foundation

Outcome: the schema has four engagement tables + five counter columns; a migration is applied; two repos (`collection-engagement.repo.ts`, `collection-comments.repo.ts`) read/write the data and maintain counters transactionally, proven by integration tests.

---

### Task A1: Prisma schema — engagement tables + counters

**Files:**
- Modify: `lib/db/prisma/schema.prisma`

- [ ] **Step 1: Add the five counter columns to `StudyCollection`**

In `model StudyCollection`, after the `popularityScore` line, add:

```prisma
  // ─── Engagement counters (Phase 2) ────────────────────────────
  // Denormalised, maintained transactionally with each engagement
  // event row. Store-only in Phase 2 (ranking consumes them in P3).
  // ratingAverage is derived (ratingSum / ratingCount), never stored.
  likeCount    Int @default(0) @map("like_count")
  ratingCount  Int @default(0) @map("rating_count")
  ratingSum    Int @default(0) @map("rating_sum")
  viewCount    Int @default(0) @map("view_count")
  commentCount Int @default(0) @map("comment_count")
```

- [ ] **Step 2: Add the four inverse relations to `StudyCollection`**

In the relation block of `StudyCollection` (after `followers StudyCollectionFollower[]`), add:

```prisma
  likes     StudyCollectionLike[]
  ratings   StudyCollectionRating[]
  views     StudyCollectionView[]
  comments  StudyCollectionComment[]
```

- [ ] **Step 3: Add the four new models**

Add after `model StudyCollectionTag { ... }`:

```prisma
// ─── Collection engagement (Phase 2) ──────────────────────────────

model StudyCollectionLike {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  collectionId String   @map("collection_id") @db.Uuid
  userId       String   @map("user_id") @db.Uuid
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz()

  collection StudyCollection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  user       User            @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([collectionId, userId], map: "study_collection_likes_unique")
  @@index([userId], map: "study_collection_likes_user_idx")
  @@map("study_collection_likes")
}

model StudyCollectionRating {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  collectionId String   @map("collection_id") @db.Uuid
  userId       String   @map("user_id") @db.Uuid
  // 1..5, validated in the service.
  value        Int
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt    DateTime @default(now()) @map("updated_at") @db.Timestamptz()

  collection StudyCollection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  user       User            @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([collectionId, userId], map: "study_collection_ratings_unique")
  @@index([userId], map: "study_collection_ratings_user_idx")
  @@map("study_collection_ratings")
}

model StudyCollectionView {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  collectionId String   @map("collection_id") @db.Uuid
  userId       String   @map("user_id") @db.Uuid
  viewedAt     DateTime @default(now()) @map("viewed_at") @db.Timestamptz()

  collection StudyCollection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  user       User            @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([collectionId], map: "study_collection_views_collection_idx")
  @@index([userId, viewedAt], map: "study_collection_views_user_viewed_idx")
  @@map("study_collection_views")
}

model StudyCollectionComment {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  collectionId String    @map("collection_id") @db.Uuid
  authorId     String    @map("author_id") @db.Uuid
  body         String
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt    DateTime  @default(now()) @map("updated_at") @db.Timestamptz()
  deletedAt    DateTime? @map("deleted_at") @db.Timestamptz()

  collection StudyCollection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  author     User            @relation(fields: [authorId], references: [id], onDelete: Restrict)

  @@index([collectionId, createdAt], map: "study_collection_comments_collection_created_idx")
  @@index([authorId], map: "study_collection_comments_author_idx")
  @@map("study_collection_comments")
}
```

- [ ] **Step 4: Add the inverse relations on `User`**

In `model User`, in the relation block (after `studyProgress StudyProgress[]`), add:

```prisma
  collectionLikes    StudyCollectionLike[]
  collectionRatings  StudyCollectionRating[]
  collectionViews    StudyCollectionView[]
  collectionComments StudyCollectionComment[]
```

- [ ] **Step 5: Validate the schema**

Run (from repo root): `corepack pnpm --filter @workspace/db exec prisma validate`
Expected: "The schema at lib/db/prisma/schema.prisma is valid 🚀"

- [ ] **Step 6: Commit**

```bash
git add lib/db/prisma/schema.prisma
git commit -m "feat(db): collection engagement tables + denormalized counters"
```

---

### Task A2: Migration — apply schema changes

**Files:**
- Create: `lib/db/prisma/migrations/<timestamp>_collection_engagement/migration.sql` (generated)

- [ ] **Step 1: Generate + apply the migration**

From repo root (DB reachable; `.env` loaded):
```bash
corepack pnpm --filter @workspace/db exec prisma migrate dev --name collection_engagement
```
Expected: a new folder under `lib/db/prisma/migrations/` whose `migration.sql` contains `ALTER TABLE "study_collections" ADD COLUMN "like_count" ...` (×5) and `CREATE TABLE "study_collection_likes" / "_ratings" / "_views" / "_comments"` with their indexes; it applies cleanly.

- [ ] **Step 2: Regenerate the Prisma client**

```bash
corepack pnpm --filter @workspace/db exec prisma generate
```
Expected: `@workspace/db` client regenerated with the new models + fields.

- [ ] **Step 3: Sanity-check the columns + tables exist**

```bash
corepack pnpm --filter @workspace/db exec prisma db execute --stdin <<'SQL'
SELECT column_name FROM information_schema.columns
WHERE table_name='study_collections'
  AND column_name IN ('like_count','rating_count','rating_sum','view_count','comment_count');
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('study_collection_likes','study_collection_ratings','study_collection_views','study_collection_comments');
SQL
```
Expected: 5 column rows + 4 table rows.

- [ ] **Step 4: Commit**

```bash
git add lib/db/prisma/migrations
git commit -m "feat(db): migrate collection engagement tables + counter columns"
```

---

### Task A3: `collection-engagement.repo.ts` — likes, ratings, views

**Files:**
- Create: `artifacts/api-server/src/repositories/collection-engagement.repo.ts`
- Test: `artifacts/api-server/src/repositories/collection-engagement.repo.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `src/repositories/collection-engagement.repo.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import {
  likeCollection,
  unlikeCollection,
  isLiked,
  listLikedCollectionIds,
  setRating,
  clearRating,
  getMyRating,
  listMyRatings,
  recordView,
  countUniqueViews,
} from "./collection-engagement.repo";

const SX = `_eng_${Date.now().toString(36)}`;
let ownerId: string;
let u1: string;
let u2: string;
let colId: string;

async function counters(id: string) {
  const c = await db.studyCollection.findUniqueOrThrow({
    where: { id },
    select: { likeCount: true, ratingCount: true, ratingSum: true, viewCount: true },
  });
  return c;
}

beforeAll(async () => {
  const o = await db.user.create({ data: { email: `o${SX}@demo`, passwordHash: "x", displayName: `O${SX}`, isActive: true } });
  const a = await db.user.create({ data: { email: `a${SX}@demo`, passwordHash: "x", displayName: `A${SX}`, isActive: true } });
  const b = await db.user.create({ data: { email: `b${SX}@demo`, passwordHash: "x", displayName: `B${SX}`, isActive: true } });
  ownerId = o.id; u1 = a.id; u2 = b.id;
  colId = (await db.studyCollection.create({ data: { ownerId, title: `C${SX}`, visibility: "public" } })).id;
});

afterAll(async () => {
  await db.studyCollectionView.deleteMany({ where: { collectionId: colId } });
  await db.studyCollectionRating.deleteMany({ where: { collectionId: colId } });
  await db.studyCollectionLike.deleteMany({ where: { collectionId: colId } });
  await db.studyCollection.deleteMany({ where: { id: colId } });
  await db.user.deleteMany({ where: { id: { in: [ownerId, u1, u2] } } });
});

describe("collection-engagement.repo likes", () => {
  it("like is idempotent and maintains likeCount", async () => {
    expect(await likeCollection(colId, u1)).toBe(true);
    expect(await likeCollection(colId, u1)).toBe(false); // repeat → no-op
    expect((await counters(colId)).likeCount).toBe(1);
    expect(await isLiked(colId, u1)).toBe(true);
    await likeCollection(colId, u2);
    expect((await counters(colId)).likeCount).toBe(2);
    expect(await unlikeCollection(colId, u1)).toBe(true);
    expect((await counters(colId)).likeCount).toBe(1);
    expect((await listLikedCollectionIds(u2, [colId])).has(colId)).toBe(true);
  });
});

describe("collection-engagement.repo ratings", () => {
  it("upsert adjusts ratingSum/ratingCount; clear restores them", async () => {
    await setRating(colId, u1, 4);
    await setRating(colId, u2, 2);
    let c = await counters(colId);
    expect(c.ratingCount).toBe(2);
    expect(c.ratingSum).toBe(6);
    await setRating(colId, u1, 5); // change 4 → 5
    c = await counters(colId);
    expect(c.ratingCount).toBe(2);
    expect(c.ratingSum).toBe(7);
    expect(await getMyRating(colId, u1)).toBe(5);
    expect((await listMyRatings(u1, [colId])).get(colId)).toBe(5);
    await clearRating(colId, u1);
    c = await counters(colId);
    expect(c.ratingCount).toBe(1);
    expect(c.ratingSum).toBe(2);
    expect(await getMyRating(colId, u1)).toBeUndefined();
  });
});

describe("collection-engagement.repo views", () => {
  it("recordView bumps total viewCount and unique counts distinct users", async () => {
    await recordView(colId, u1);
    await recordView(colId, u1); // repeat → total +1, unique unchanged
    await recordView(colId, u2);
    expect((await counters(colId)).viewCount).toBe(3);
    expect(await countUniqueViews(colId)).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run (from `artifacts/api-server`, `.env` loaded): `corepack pnpm vitest run src/repositories/collection-engagement.repo.test.ts`
Expected: FAIL — module `./collection-engagement.repo` does not exist.

- [ ] **Step 3: Implement the repo**

Create `src/repositories/collection-engagement.repo.ts`:

```ts
import { db } from "@workspace/db";

// ─── Likes ────────────────────────────────────────────────────────

/** Like a collection. Idempotent on (collection, user); on a real insert
 *  bumps likeCount in the same transaction. Returns true iff inserted. */
export async function likeCollection(
  collectionId: string,
  userId: string,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const r = await tx.studyCollectionLike.createMany({
      data: [{ collectionId, userId }],
      skipDuplicates: true,
    });
    if (r.count > 0) {
      await tx.studyCollection.update({
        where: { id: collectionId },
        data: { likeCount: { increment: 1 } },
      });
    }
    return r.count > 0;
  });
}

/** Unlike. Returns true iff a row was removed (then decrements likeCount). */
export async function unlikeCollection(
  collectionId: string,
  userId: string,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const r = await tx.studyCollectionLike.deleteMany({
      where: { collectionId, userId },
    });
    if (r.count > 0) {
      await tx.studyCollection.update({
        where: { id: collectionId },
        data: { likeCount: { decrement: 1 } },
      });
    }
    return r.count > 0;
  });
}

export async function isLiked(
  collectionId: string,
  userId: string,
): Promise<boolean> {
  const row = await db.studyCollectionLike.findUnique({
    where: { collectionId_userId: { collectionId, userId } },
    select: { id: true },
  });
  return !!row;
}

/** Collection ids (from a candidate set) the user has liked. */
export async function listLikedCollectionIds(
  userId: string,
  within: string[],
): Promise<Set<string>> {
  if (within.length === 0) return new Set();
  const rows = await db.studyCollectionLike.findMany({
    where: { userId, collectionId: { in: within } },
    select: { collectionId: true },
  });
  return new Set(rows.map((r) => r.collectionId));
}

// ─── Ratings ──────────────────────────────────────────────────────

/** Set the caller's rating (1..5). Upsert: a new rating bumps count+sum;
 *  changing an existing one adjusts sum by the delta. Validation of the
 *  range is the service's job. */
export async function setRating(
  collectionId: string,
  userId: string,
  value: number,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const existing = await tx.studyCollectionRating.findUnique({
      where: { collectionId_userId: { collectionId, userId } },
    });
    if (!existing) {
      await tx.studyCollectionRating.create({
        data: { collectionId, userId, value },
      });
      await tx.studyCollection.update({
        where: { id: collectionId },
        data: { ratingCount: { increment: 1 }, ratingSum: { increment: value } },
      });
    } else if (existing.value !== value) {
      await tx.studyCollectionRating.update({
        where: { id: existing.id },
        data: { value, updatedAt: new Date() },
      });
      await tx.studyCollection.update({
        where: { id: collectionId },
        data: { ratingSum: { increment: value - existing.value } },
      });
    }
  });
}

/** Clear the caller's rating. No-op if absent. */
export async function clearRating(
  collectionId: string,
  userId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const existing = await tx.studyCollectionRating.findUnique({
      where: { collectionId_userId: { collectionId, userId } },
    });
    if (existing) {
      await tx.studyCollectionRating.delete({ where: { id: existing.id } });
      await tx.studyCollection.update({
        where: { id: collectionId },
        data: {
          ratingCount: { decrement: 1 },
          ratingSum: { decrement: existing.value },
        },
      });
    }
  });
}

export async function getMyRating(
  collectionId: string,
  userId: string,
): Promise<number | undefined> {
  const row = await db.studyCollectionRating.findUnique({
    where: { collectionId_userId: { collectionId, userId } },
    select: { value: true },
  });
  return row?.value;
}

/** Map collectionId → the user's rating value, for a candidate set. */
export async function listMyRatings(
  userId: string,
  within: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (within.length === 0) return map;
  const rows = await db.studyCollectionRating.findMany({
    where: { userId, collectionId: { in: within } },
    select: { collectionId: true, value: true },
  });
  for (const r of rows) map.set(r.collectionId, r.value);
  return map;
}

// ─── Views ────────────────────────────────────────────────────────

/** Append a view event AND bump the denormalised total viewCount atomically. */
export async function recordView(
  collectionId: string,
  userId: string,
): Promise<void> {
  await db.$transaction([
    db.studyCollectionView.create({ data: { collectionId, userId } }),
    db.studyCollection.update({
      where: { id: collectionId },
      data: { viewCount: { increment: 1 } },
    }),
  ]);
}

/** Non-fatal recordView — a failed insert never breaks the originating read. */
export async function tryRecordView(
  collectionId: string,
  userId: string,
): Promise<void> {
  try {
    await recordView(collectionId, userId);
  } catch {
    // swallow — mirrors viewHistory.repo.tryRecordView
  }
}

/** Unique viewers of a single collection (COUNT DISTINCT user_id). */
export async function countUniqueViews(collectionId: string): Promise<number> {
  const rows = await db.studyCollectionView.findMany({
    where: { collectionId },
    distinct: ["userId"],
    select: { userId: true },
  });
  return rows.length;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `corepack pnpm vitest run src/repositories/collection-engagement.repo.test.ts`
Expected: PASS (3 describes).

- [ ] **Step 5: Commit**

```bash
git add src/repositories/collection-engagement.repo.ts src/repositories/collection-engagement.repo.test.ts
git commit -m "feat(collections): engagement repo (likes/ratings/views) + counters"
```

---

### Task A4: `collection-comments.repo.ts`

**Files:**
- Create: `artifacts/api-server/src/repositories/collection-comments.repo.ts`
- Test: `artifacts/api-server/src/repositories/collection-comments.repo.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/repositories/collection-comments.repo.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import {
  createComment,
  listComments,
  findCommentById,
  updateCommentBody,
  softDeleteComment,
} from "./collection-comments.repo";

const SX = `_ccmt_${Date.now().toString(36)}`;
let authorId: string;
let colId: string;

async function commentCount(id: string) {
  return (
    await db.studyCollection.findUniqueOrThrow({
      where: { id },
      select: { commentCount: true },
    })
  ).commentCount;
}

beforeAll(async () => {
  const a = await db.user.create({ data: { email: `a${SX}@demo`, passwordHash: "x", displayName: `A${SX}`, isActive: true } });
  authorId = a.id;
  colId = (await db.studyCollection.create({ data: { ownerId: authorId, title: `C${SX}`, visibility: "public" } })).id;
});

afterAll(async () => {
  await db.studyCollectionComment.deleteMany({ where: { collectionId: colId } });
  await db.studyCollection.deleteMany({ where: { id: colId } });
  await db.user.deleteMany({ where: { id: authorId } });
});

describe("collection-comments.repo", () => {
  it("create increments commentCount and returns the row with author", async () => {
    const c = await createComment(colId, authorId, "hello");
    expect(c.body).toBe("hello");
    expect(c.author.displayName).toBe(`A${SX}`);
    expect(await commentCount(colId)).toBe(1);
  });

  it("list returns non-deleted, oldest-first", async () => {
    await createComment(colId, authorId, "second");
    const list = await listComments(colId);
    expect(list.map((c) => c.body)).toEqual(["hello", "second"]);
  });

  it("edit updates body; soft-delete hides it and decrements commentCount", async () => {
    const c = await createComment(colId, authorId, "third");
    await updateCommentBody(c.id, "third-edited");
    expect((await findCommentById(c.id))?.body).toBe("third-edited");
    expect(await commentCount(colId)).toBe(3);
    await softDeleteComment(c.id);
    expect(await commentCount(colId)).toBe(2);
    expect((await listComments(colId)).some((x) => x.id === c.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `corepack pnpm vitest run src/repositories/collection-comments.repo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the repo**

Create `src/repositories/collection-comments.repo.ts`:

```ts
import { db } from "@workspace/db";

export interface CommentRow {
  id: string;
  collectionId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; displayName: string };
}

const withAuthor = {
  id: true,
  collectionId: true,
  body: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, displayName: true } },
} as const;

/** Create a comment AND increment the collection's commentCount atomically. */
export async function createComment(
  collectionId: string,
  authorId: string,
  body: string,
): Promise<CommentRow> {
  return db.$transaction(async (tx) => {
    const c = await tx.studyCollectionComment.create({
      data: { collectionId, authorId, body },
      select: withAuthor,
    });
    await tx.studyCollection.update({
      where: { id: collectionId },
      data: { commentCount: { increment: 1 } },
    });
    return c;
  });
}

/** Non-deleted comments for a collection, oldest-first. */
export async function listComments(collectionId: string): Promise<CommentRow[]> {
  return db.studyCollectionComment.findMany({
    where: { collectionId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: withAuthor,
  });
}

export async function findCommentById(id: string): Promise<CommentRow | null> {
  return db.studyCollectionComment.findFirst({
    where: { id, deletedAt: null },
    select: withAuthor,
  });
}

export async function updateCommentBody(id: string, body: string): Promise<void> {
  await db.studyCollectionComment.update({
    where: { id },
    data: { body, updatedAt: new Date() },
  });
}

/** Soft-delete a comment AND decrement commentCount atomically. */
export async function softDeleteComment(id: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const c = await tx.studyCollectionComment.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: { collectionId: true },
    });
    await tx.studyCollection.update({
      where: { id: c.collectionId },
      data: { commentCount: { decrement: 1 } },
    });
  });
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `corepack pnpm vitest run src/repositories/collection-comments.repo.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/repositories/collection-comments.repo.ts src/repositories/collection-comments.repo.test.ts
git commit -m "feat(collections): comments repo (flat, soft-delete, commentCount)"
```

---

# PART B — Backend Services, Routes, OpenAPI

Outcome: DTOs carry engagement fields; two new services enforce access + self-engagement rules and assemble DTOs; routes are mounted under `/api/prep-hub/*`; `getPublicCollection` records a view; the OpenAPI clients are regenerated.

---

### Task B1: Extend the collection DTOs with engagement fields

**Files:**
- Modify: `artifacts/api-server/src/repositories/collections.repo.ts` (add counters to `CollectionRow`)
- Modify: `artifacts/api-server/src/services/collections.service.ts` (DTO + `toSummary` + `summarize` + `assembleDetail`)
- Test: `artifacts/api-server/src/services/collections.engagement-dto.test.ts`

- [ ] **Step 1: Add the counter fields to `CollectionRow`**

In `collections.repo.ts`, add to the `CollectionRow` interface (after `popularityScore: number;`):

```ts
  likeCount: number;
  ratingCount: number;
  ratingSum: number;
  viewCount: number;
  commentCount: number;
```

(No query changes needed — `findCollectionById`, `listCollectionsForOwner`, `listDiscoverable`, `recommendCollections`, and `createCollection` all return the full Prisma row, which now includes these columns.)

- [ ] **Step 2: Write the failing test**

Create `src/services/collections.engagement-dto.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { createCollection, listMyCollections, assembleDetail } from "./collections.service";
import * as engagementRepo from "../repositories/collection-engagement.repo";
import * as collectionsRepo from "../repositories/collections.repo";

const SX = `_engdto_${Date.now().toString(36)}`;
let user: AuthenticatedUser;
let rater: AuthenticatedUser;
let colId: string;

beforeAll(async () => {
  const u = await db.user.create({ data: { email: `u${SX}@demo`, passwordHash: "x", displayName: `U${SX}`, isActive: true } });
  const r = await db.user.create({ data: { email: `r${SX}@demo`, passwordHash: "x", displayName: `R${SX}`, isActive: true } });
  user = { id: u.id, roles: ["student"], enrollments: [] } as AuthenticatedUser;
  rater = { id: r.id, roles: ["student"], enrollments: [] } as AuthenticatedUser;
  colId = (await createCollection(user, { title: `C${SX}`, visibility: "public" })).id;
  await engagementRepo.likeCollection(colId, user.id);
  await engagementRepo.setRating(colId, user.id, 4);
  await engagementRepo.setRating(colId, rater.id, 5);
  await engagementRepo.recordView(colId, rater.id);
});

afterAll(async () => {
  await db.studyCollectionView.deleteMany({ where: { collectionId: colId } });
  await db.studyCollectionRating.deleteMany({ where: { collectionId: colId } });
  await db.studyCollectionLike.deleteMany({ where: { collectionId: colId } });
  await db.studyCollection.deleteMany({ where: { id: colId } });
  await db.user.deleteMany({ where: { id: { in: [user.id, rater.id] } } });
});

describe("collection engagement DTO", () => {
  it("summary exposes counts + viewer state", async () => {
    const mine = (await listMyCollections(user)).find((c) => c.id === colId)!;
    expect(mine.likeCount).toBe(1);
    expect(mine.isLiked).toBe(true);
    expect(mine.ratingCount).toBe(2);
    expect(mine.ratingAverage).toBe(4.5);
    expect(mine.myRating).toBe(4);
    expect(mine.viewCount).toBe(1);
  });

  it("detail adds uniqueViewCount", async () => {
    const row = await collectionsRepo.findCollectionById(colId);
    const detail = await assembleDetail(row!, rater);
    expect(detail.uniqueViewCount).toBe(1);
    expect(detail.myRating).toBe(5);
    expect(detail.isLiked).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `corepack pnpm vitest run src/services/collections.engagement-dto.test.ts`
Expected: FAIL — DTO has no `likeCount`/`isLiked`/`ratingAverage`/`myRating`/`viewCount`/`uniqueViewCount`.

- [ ] **Step 4: Extend the DTO interfaces in `collections.service.ts`**

Add an import at the top (with the other repo imports):
```ts
import * as engagementRepo from "../repositories/collection-engagement.repo";
```

Add to `CollectionSummaryDTO` (after `popularityScore: number;`):
```ts
  likeCount: number;
  isLiked: boolean;
  ratingCount: number;
  ratingAverage: number;
  myRating?: number;
  viewCount: number;
  commentCount: number;
```

Add to `CollectionDetailDTO` (alongside `items`):
```ts
  uniqueViewCount: number;
```

- [ ] **Step 5: Populate the fields in `toSummary`**

Extend `SummaryExtra`:
```ts
interface SummaryExtra {
  followerCount?: number;
  isFollowing?: boolean;
  completedCount?: number;
  tagIds?: string[];
  isLiked?: boolean;
  myRating?: number;
}
```

In the object returned by `toSummary`, add (after `popularityScore: c.popularityScore,`):
```ts
    likeCount: c.likeCount,
    isLiked: extra.isLiked ?? false,
    ratingCount: c.ratingCount,
    ratingAverage:
      c.ratingCount > 0
        ? Math.round((c.ratingSum / c.ratingCount) * 10) / 10
        : 0,
    myRating: extra.myRating,
    viewCount: c.viewCount,
    commentCount: c.commentCount,
```

- [ ] **Step 6: Batch the viewer state in `summarize`**

Replace the `Promise.all` block in `summarize` with:
```ts
  const [followerCounts, followed, completed, tagMap, liked, myRatings] =
    await Promise.all([
      collectionsRepo.countFollowersForCollections(ids),
      collectionsRepo.listFollowedCollectionIds(user.id, ids),
      collectionsRepo.countCompletedForCollections(user.id, ids),
      collectionsRepo.listTagIdsForCollections(ids),
      engagementRepo.listLikedCollectionIds(user.id, ids),
      engagementRepo.listMyRatings(user.id, ids),
    ]);
```
and add to each `toSummary(...)` extra object:
```ts
      isLiked: liked.has(r.id),
      myRating: myRatings.get(r.id),
```

- [ ] **Step 7: Populate detail fields in `assembleDetail`**

In `assembleDetail`, extend the `Promise.all` to also fetch like/rating/unique-view state:
```ts
  const [followerCount, following, tagIds, liked, myRating, uniqueViewCount] =
    await Promise.all([
      collectionsRepo.countFollowers(c.id),
      collectionsRepo.isFollowing(c.id, user.id),
      collectionsRepo.listCollectionTagIds(c.id),
      engagementRepo.isLiked(c.id, user.id),
      engagementRepo.getMyRating(c.id, user.id),
      engagementRepo.countUniqueViews(c.id),
    ]);
```
Pass `isLiked: liked, myRating` into the `toSummary(...)` extra, and change the return to:
```ts
  return { ...summary, items, uniqueViewCount };
```

- [ ] **Step 8: Run the test to confirm it passes + typecheck**

Run: `corepack pnpm vitest run src/services/collections.engagement-dto.test.ts`
Expected: PASS (2 tests).
Run: `corepack pnpm --filter @workspace/api-server run typecheck`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/repositories/collections.repo.ts src/services/collections.service.ts src/services/collections.engagement-dto.test.ts
git commit -m "feat(collections): expose engagement counts + viewer state in DTOs"
```

---

### Task B2: `collection-engagement.service.ts` — like / rate / view

**Files:**
- Create: `artifacts/api-server/src/services/collection-engagement.service.ts`
- Test: `artifacts/api-server/src/services/collection-engagement.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/collection-engagement.service.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { createCollection } from "./collections.service";
import {
  likeCollection,
  rateCollection,
  clearRating,
} from "./collection-engagement.service";

const SX = `_engsvc_${Date.now().toString(36)}`;
let owner: AuthenticatedUser;
let viewer: AuthenticatedUser;
let pubId: string;
let privId: string;

beforeAll(async () => {
  const o = await db.user.create({ data: { email: `o${SX}@demo`, passwordHash: "x", displayName: `O${SX}`, isActive: true } });
  const v = await db.user.create({ data: { email: `v${SX}@demo`, passwordHash: "x", displayName: `V${SX}`, isActive: true } });
  owner = { id: o.id, roles: ["student"], enrollments: [] } as AuthenticatedUser;
  viewer = { id: v.id, roles: ["student"], enrollments: [] } as AuthenticatedUser;
  pubId = (await createCollection(owner, { title: `Pub${SX}`, visibility: "public" })).id;
  privId = (await createCollection(owner, { title: `Priv${SX}`, visibility: "private" })).id;
});

afterAll(async () => {
  await db.studyCollectionRating.deleteMany({ where: { collectionId: { in: [pubId, privId] } } });
  await db.studyCollectionLike.deleteMany({ where: { collectionId: { in: [pubId, privId] } } });
  await db.studyCollection.deleteMany({ where: { id: { in: [pubId, privId] } } });
  await db.user.deleteMany({ where: { id: { in: [owner.id, viewer.id] } } });
});

describe("collection-engagement.service", () => {
  it("a non-owner likes + rates a public collection", async () => {
    const d = await likeCollection(pubId, viewer);
    expect(d.isLiked).toBe(true);
    expect(d.likeCount).toBe(1);
    const d2 = await rateCollection(pubId, viewer, 4);
    expect(d2.myRating).toBe(4);
    expect(d2.ratingAverage).toBe(4);
  });

  it("owner cannot like or rate their own collection", async () => {
    await expect(likeCollection(pubId, owner)).rejects.toThrow();
    await expect(rateCollection(pubId, owner, 5)).rejects.toThrow();
  });

  it("rating out of range is rejected", async () => {
    await expect(rateCollection(pubId, viewer, 0)).rejects.toThrow();
    await expect(rateCollection(pubId, viewer, 6)).rejects.toThrow();
  });

  it("engagement on a private collection 404s", async () => {
    await expect(likeCollection(privId, viewer)).rejects.toThrow();
    await expect(rateCollection(privId, viewer, 3)).rejects.toThrow();
  });

  it("clearRating removes the viewer's rating", async () => {
    await rateCollection(pubId, viewer, 5);
    const d = await clearRating(pubId, viewer);
    expect(d.myRating).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `corepack pnpm vitest run src/services/collection-engagement.service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `src/services/collection-engagement.service.ts`:

```ts
/**
 * Phase 2 — engagement (likes, ratings, views) on PUBLIC collections.
 *
 * Read/follow/recommend stay in prep-hub.service; collection CRUD stays in
 * collections.service. This module only writes the engagement event rows
 * (the repo maintains the denormalised counters) and returns a refreshed
 * detail DTO. Private collections are never engageable — 404, never 403.
 */
import * as collectionsRepo from "../repositories/collections.repo";
import * as engagementRepo from "../repositories/collection-engagement.repo";
import * as collectionsService from "./collections.service";
import { badRequest, notFound } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";
import type { CollectionDetailDTO } from "./collections.service";

/** A collection accepts engagement iff it is public or official. */
function isPublic(c: collectionsRepo.CollectionRow): boolean {
  return c.visibility === "public" || c.isOfficial;
}

/** Load a public collection or 404. Owners get a clean "can't engage with your
 *  own collection" 400 for actions that block self-engagement. */
async function loadEngageable(
  id: string,
): Promise<collectionsRepo.CollectionRow> {
  const c = await collectionsRepo.findCollectionById(id);
  if (!c || !isPublic(c)) throw notFound("Collection not found");
  return c;
}

async function refreshed(
  c: collectionsRepo.CollectionRow,
  user: AuthenticatedUser,
): Promise<CollectionDetailDTO> {
  const fresh = (await collectionsRepo.findCollectionById(c.id)) ?? c;
  return collectionsService.assembleDetail(fresh, user);
}

export async function likeCollection(
  id: string,
  user: AuthenticatedUser,
): Promise<CollectionDetailDTO> {
  const c = await loadEngageable(id);
  if (c.ownerId === user.id) throw badRequest("You can't like your own collection");
  await engagementRepo.likeCollection(id, user.id);
  return refreshed(c, user);
}

export async function unlikeCollection(
  id: string,
  user: AuthenticatedUser,
): Promise<CollectionDetailDTO> {
  const c = await loadEngageable(id);
  await engagementRepo.unlikeCollection(id, user.id);
  return refreshed(c, user);
}

export async function rateCollection(
  id: string,
  user: AuthenticatedUser,
  value: number,
): Promise<CollectionDetailDTO> {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw badRequest("Rating must be an integer from 1 to 5");
  }
  const c = await loadEngageable(id);
  if (c.ownerId === user.id) throw badRequest("You can't rate your own collection");
  await engagementRepo.setRating(id, user.id, value);
  return refreshed(c, user);
}

export async function clearRating(
  id: string,
  user: AuthenticatedUser,
): Promise<CollectionDetailDTO> {
  const c = await loadEngageable(id);
  await engagementRepo.clearRating(id, user.id);
  return refreshed(c, user);
}

/** Record a view (non-fatal). Called from prep-hub.getPublicCollection. */
export async function recordView(
  id: string,
  user: AuthenticatedUser,
): Promise<void> {
  await engagementRepo.tryRecordView(id, user.id);
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `corepack pnpm vitest run src/services/collection-engagement.service.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/collection-engagement.service.ts src/services/collection-engagement.service.test.ts
git commit -m "feat(collections): engagement service (like/rate/view, self-engagement guard)"
```

---

### Task B3: `collection-comments.service.ts` — comments + owner notification

**Files:**
- Create: `artifacts/api-server/src/services/collection-comments.service.ts`
- Test: `artifacts/api-server/src/services/collection-comments.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/collection-comments.service.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { createCollection } from "./collections.service";
import {
  listComments,
  createComment,
  editComment,
  deleteComment,
} from "./collection-comments.service";

const SX = `_cmtsvc_${Date.now().toString(36)}`;
let owner: AuthenticatedUser;
let commenter: AuthenticatedUser;
let pubId: string;
let privId: string;

afterAll(async () => {
  await db.notification.deleteMany({ where: { recipientId: owner.id } });
  await db.studyCollectionComment.deleteMany({ where: { collectionId: { in: [pubId, privId] } } });
  await db.studyCollection.deleteMany({ where: { id: { in: [pubId, privId] } } });
  await db.user.deleteMany({ where: { id: { in: [owner.id, commenter.id] } } });
});

beforeAll(async () => {
  const o = await db.user.create({ data: { email: `o${SX}@demo`, passwordHash: "x", displayName: `O${SX}`, isActive: true } });
  const c = await db.user.create({ data: { email: `c${SX}@demo`, passwordHash: "x", displayName: `C${SX}`, isActive: true } });
  owner = { id: o.id, roles: ["student"], enrollments: [] } as AuthenticatedUser;
  commenter = { id: c.id, roles: ["student"], enrollments: [] } as AuthenticatedUser;
  pubId = (await createCollection(owner, { title: `Pub${SX}`, visibility: "public" })).id;
  privId = (await createCollection(owner, { title: `Priv${SX}`, visibility: "private" })).id;
});

describe("collection-comments.service", () => {
  it("a non-owner comment notifies the owner", async () => {
    const dto = await createComment(pubId, commenter, "Great set!");
    expect(dto.body).toBe("Great set!");
    expect(dto.editable).toBe(true);
    const notif = await db.notification.findFirst({
      where: { recipientId: owner.id, type: "collection.comment", subjectId: pubId },
    });
    expect(notif).not.toBeNull();
    expect(notif?.url).toBe(`/prep-hub/${pubId}`);
  });

  it("a self-comment (owner) does NOT notify", async () => {
    await db.notification.deleteMany({ where: { recipientId: owner.id } });
    await createComment(pubId, owner, "owner note");
    const notif = await db.notification.findFirst({
      where: { recipientId: owner.id, type: "collection.comment" },
    });
    expect(notif).toBeNull();
  });

  it("editable flag is false for other viewers; list is oldest-first", async () => {
    const list = await listComments(pubId, owner);
    expect(list.length).toBe(2);
    expect(list[0].editable).toBe(false); // commenter's comment, viewed by owner
    expect(list[1].editable).toBe(true); // owner's own comment
  });

  it("only the author can edit/delete", async () => {
    const created = await createComment(pubId, commenter, "mine");
    await expect(editComment(created.id, owner, "hijack")).rejects.toThrow();
    await expect(deleteComment(created.id, owner)).rejects.toThrow();
    const edited = await editComment(created.id, commenter, "mine-edited");
    expect(edited.body).toBe("mine-edited");
    await deleteComment(created.id, commenter);
    expect((await listComments(pubId, owner)).some((x) => x.id === created.id)).toBe(false);
  });

  it("comments on a private collection 404", async () => {
    await expect(createComment(privId, commenter, "x")).rejects.toThrow();
    await expect(listComments(privId, commenter)).rejects.toThrow();
  });

  it("empty body is rejected", async () => {
    await expect(createComment(pubId, commenter, "   ")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `corepack pnpm vitest run src/services/collection-comments.service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `src/services/collection-comments.service.ts`:

```ts
/**
 * Phase 2 — flat comments on PUBLIC collections. Create / edit-own /
 * delete-own. A non-owner comment notifies the collection owner (the notify
 * bus self-skips when author === owner, so self-comments are silent).
 */
import * as collectionsRepo from "../repositories/collections.repo";
import * as commentsRepo from "../repositories/collection-comments.repo";
import * as notifications from "./notifications.service";
import { badRequest, forbidden, notFound } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";

export interface CollectionCommentDTO {
  id: string;
  collectionId: string;
  author: { id: string; displayName: string };
  body: string;
  createdAt: string;
  updatedAt: string;
  editable: boolean;
}

function isPublic(c: collectionsRepo.CollectionRow): boolean {
  return c.visibility === "public" || c.isOfficial;
}

async function loadEngageable(
  id: string,
): Promise<collectionsRepo.CollectionRow> {
  const c = await collectionsRepo.findCollectionById(id);
  if (!c || !isPublic(c)) throw notFound("Collection not found");
  return c;
}

function toDTO(
  row: commentsRepo.CommentRow,
  user: AuthenticatedUser,
): CollectionCommentDTO {
  return {
    id: row.id,
    collectionId: row.collectionId,
    author: row.author,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    editable: row.author.id === user.id,
  };
}

export async function listComments(
  id: string,
  user: AuthenticatedUser,
): Promise<CollectionCommentDTO[]> {
  await loadEngageable(id);
  const rows = await commentsRepo.listComments(id);
  return rows.map((r) => toDTO(r, user));
}

export async function createComment(
  id: string,
  user: AuthenticatedUser,
  body: string,
): Promise<CollectionCommentDTO> {
  const trimmed = body?.trim();
  if (!trimmed) throw badRequest("Comment cannot be empty");
  const c = await loadEngageable(id);
  const row = await commentsRepo.createComment(id, user.id, trimmed);
  // notify() self-skips when actorId === recipientId (owner self-comment).
  await notifications.notify({
    recipientId: c.ownerId,
    actorId: user.id,
    type: "collection.comment",
    subjectType: "study_collection",
    subjectId: c.id,
    body: `${row.author.displayName} commented on "${c.title}"`,
    url: `/prep-hub/${c.id}`,
  });
  return toDTO(row, user);
}

export async function editComment(
  commentId: string,
  user: AuthenticatedUser,
  body: string,
): Promise<CollectionCommentDTO> {
  const trimmed = body?.trim();
  if (!trimmed) throw badRequest("Comment cannot be empty");
  const existing = await commentsRepo.findCommentById(commentId);
  if (!existing) throw notFound("Comment not found");
  if (existing.author.id !== user.id) throw forbidden("Not your comment");
  await commentsRepo.updateCommentBody(commentId, trimmed);
  const updated = await commentsRepo.findCommentById(commentId);
  return toDTO(updated!, user);
}

export async function deleteComment(
  commentId: string,
  user: AuthenticatedUser,
): Promise<void> {
  const existing = await commentsRepo.findCommentById(commentId);
  if (!existing) throw notFound("Comment not found");
  if (existing.author.id !== user.id) throw forbidden("Not your comment");
  await commentsRepo.softDeleteComment(commentId);
}
```

- [ ] **Step 4: Run the test to confirm it passes + typecheck**

Run: `corepack pnpm vitest run src/services/collection-comments.service.test.ts`
Expected: PASS (6 tests).
Run: `corepack pnpm --filter @workspace/api-server run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/services/collection-comments.service.ts src/services/collection-comments.service.test.ts
git commit -m "feat(collections): comments service (CRUD-own + owner notification)"
```

---

### Task B4: Routes — engagement + comments under `/api/prep-hub/*`; record view

**Files:**
- Modify: `artifacts/api-server/src/routes/prep-hub.ts`
- Modify: `artifacts/api-server/src/services/prep-hub.service.ts` (record view on open)

- [ ] **Step 1: Record a view inside `getPublicCollection`**

In `prep-hub.service.ts`, add the import:
```ts
import * as engagement from "./collection-engagement.service";
```
In `getPublicCollection`, after the `isPublic` check and before `return collectionsService.assembleDetail(...)`, add:
```ts
  await engagement.recordView(c.id, user.id);
```
(`recordView` is non-fatal — a failed insert won't break the read.)

- [ ] **Step 2: Add the engagement + comment routes to `prep-hub.ts`**

Add imports at the top:
```ts
import * as engagementService from "../services/collection-engagement.service";
import * as commentsService from "../services/collection-comments.service";
```
Add Zod bodies near `DiscoverQuery`:
```ts
const RatingBody = z.object({ value: z.coerce.number().int().min(1).max(5) });
const CommentBody = z.object({ body: z.string().min(1) });
const CommentIdParams = z.object({ commentId: z.string().uuid() });
```
Add these routes before `export default router;`:
```ts
// ─── Engagement (Phase 2) ─────────────────────────────────────────

router.post(
  "/prep-hub/collections/:id/like",
  requireAuth,
  requireCollectionsAccess,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      res.json(await engagementService.likeCollection(id, req.authUser!));
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/prep-hub/collections/:id/like",
  requireAuth,
  requireCollectionsAccess,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      res.json(await engagementService.unlikeCollection(id, req.authUser!));
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  "/prep-hub/collections/:id/rating",
  requireAuth,
  requireCollectionsAccess,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      const { value } = RatingBody.parse(req.body);
      res.json(await engagementService.rateCollection(id, req.authUser!, value));
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/prep-hub/collections/:id/rating",
  requireAuth,
  requireCollectionsAccess,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      res.json(await engagementService.clearRating(id, req.authUser!));
    } catch (err) {
      next(err);
    }
  },
);

// ─── Comments (Phase 2) ───────────────────────────────────────────

router.get(
  "/prep-hub/collections/:id/comments",
  requireAuth,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      res.json(await commentsService.listComments(id, req.authUser!));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/prep-hub/collections/:id/comments",
  requireAuth,
  requireCollectionsAccess,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      const { body } = CommentBody.parse(req.body);
      res.status(201).json(await commentsService.createComment(id, req.authUser!, body));
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/prep-hub/collections/comments/:commentId",
  requireAuth,
  requireCollectionsAccess,
  async (req, res, next) => {
    try {
      const { commentId } = CommentIdParams.parse(req.params);
      const { body } = CommentBody.parse(req.body);
      res.json(await commentsService.editComment(commentId, req.authUser!, body));
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/prep-hub/collections/comments/:commentId",
  requireAuth,
  requireCollectionsAccess,
  async (req, res, next) => {
    try {
      const { commentId } = CommentIdParams.parse(req.params);
      await commentsService.deleteComment(commentId, req.authUser!);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
```

> Route-order note: `GET /prep-hub/collections/:id` matches a single trailing segment; `/prep-hub/collections/comments/:commentId` has an extra segment and a different method, so there is no collision with `:id="comments"`.

- [ ] **Step 3: Typecheck + build**

Run: `corepack pnpm --filter @workspace/api-server run typecheck && corepack pnpm --filter @workspace/api-server run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/routes/prep-hub.ts src/services/prep-hub.service.ts
git commit -m "feat(routes): prep-hub engagement + comment routes; record view on open"
```

---

### Task B5: OpenAPI spec + client regeneration

**Files:**
- Modify: `lib/api-spec/openapi.yaml`
- Regenerated (do not hand-edit): `lib/api-zod/src/generated/*`, `lib/api-client-react/src/generated/*`

- [ ] **Step 1: Add engagement fields to the collection schemas**

In `openapi.yaml`, in `StudyCollectionSummary` (the schema reused by detail), add properties:
- `likeCount` (integer), `isLiked` (boolean), `ratingCount` (integer), `ratingAverage` (number), `myRating` (integer, nullable), `viewCount` (integer), `commentCount` (integer).

In `StudyCollectionDetail` add: `uniqueViewCount` (integer).

Add a new schema `StudyCollectionComment`:
```yaml
    StudyCollectionComment:
      type: object
      required: [id, collectionId, author, body, createdAt, updatedAt, editable]
      properties:
        id: { type: string, format: uuid }
        collectionId: { type: string, format: uuid }
        author:
          type: object
          required: [id, displayName]
          properties:
            id: { type: string, format: uuid }
            displayName: { type: string }
        body: { type: string }
        createdAt: { type: string, format: date-time }
        updatedAt: { type: string, format: date-time }
        editable: { type: boolean }
```

- [ ] **Step 2: Add the new paths (tag `prep-hub`)**

Mirror the YAML style of the existing `/prep-hub/collections/{id}/follow` block (inline `schema: { $ref: ... }`, copy the `id` path-param definition). Add:

- `POST /prep-hub/collections/{id}/like` → `operationId: likeCollection`, returns `StudyCollectionDetail`.
- `DELETE /prep-hub/collections/{id}/like` → `operationId: unlikeCollection`, returns `StudyCollectionDetail`.
- `PUT /prep-hub/collections/{id}/rating` → `operationId: rateCollection`, requestBody `{ value: integer 1..5 }`, returns `StudyCollectionDetail`.
- `DELETE /prep-hub/collections/{id}/rating` → `operationId: clearCollectionRating`, returns `StudyCollectionDetail`.
- `GET /prep-hub/collections/{id}/comments` → `operationId: listCollectionComments`, returns `array<StudyCollectionComment>`.
- `POST /prep-hub/collections/{id}/comments` → `operationId: createCollectionComment`, requestBody `{ body: string }`, returns `StudyCollectionComment` (201).
- `PATCH /prep-hub/collections/comments/{commentId}` → `operationId: editCollectionComment`, requestBody `{ body: string }`, returns `StudyCollectionComment`.
- `DELETE /prep-hub/collections/comments/{commentId}` → `operationId: deleteCollectionComment`, returns 204.

- [ ] **Step 3: Regenerate the clients**

Run (repo root): `corepack pnpm --filter @workspace/api-spec run codegen`
Expected: orval rewrites `lib/api-zod` + `lib/api-client-react`; the trailing `typecheck:libs` passes. New hooks appear: `useLikeCollection`, `useUnlikeCollection`, `useRateCollection`, `useClearCollectionRating`, `useListCollectionComments`, `useCreateCollectionComment`, `useEditCollectionComment`, `useDeleteCollectionComment`.

- [ ] **Step 4: Confirm generated hooks exist**

Run: `grep -rl "useRateCollection\|useListCollectionComments" lib/api-client-react/src/generated`
Expected: at least one file path printed.

- [ ] **Step 5: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-zod/src/generated lib/api-client-react/src/generated
git commit -m "feat(api): openapi engagement + comment paths; regen clients"
```

---

# PART C — Frontend Engagement UI

Outcome: the Prep Hub read-only collection view shows a rating widget, like button, view count, and a comments section; discovery cards show light counts; engagement actions are hidden for admins and disabled for the owner. Per Phase-1 convention, the acceptance check for these tasks is `corepack pnpm --filter @workspace/web run typecheck` plus the manual smoke at the end — there is no per-component unit-test convention.

---

### Task C1: Rating + like + views on the Prep Hub collection view

**Files:**
- Modify: `artifacts/web/src/pages/prep-hub-collection.tsx`

- [ ] **Step 1: Add a star-rating control + like button + view count**

Using the data from `useGetPublicCollection(id)` (now carrying `likeCount`, `isLiked`, `ratingCount`, `ratingAverage`, `myRating`, `viewCount`, `uniqueViewCount`, `commentCount`):

- Read the current user via `useGetCurrentUser()`; compute `isAdmin = user?.roles?.includes("admin")` and `isOwner` (compare the collection's owner — if the DTO exposes `ownerId`; otherwise treat "can't determine owner" as non-owner and rely on the server's 400 guard, surfacing it as a toast).
- **Rating widget:** a 5-star row. Show `ratingAverage` (e.g. "4.5") and `ratingCount` ("(12)"). For students/lecturers who are not the owner, clicking a star calls `useRateCollection({ id, data: { value } })`; clicking the active star again calls `useClearCollectionRating({ id })`. For admins and the owner, render the stars read-only (no click handlers).
- **Like button:** a heart/thumb toggle showing `likeCount`. For students/lecturers non-owner, toggle `useLikeCollection`/`useUnlikeCollection({ id })`. Hidden for admins; disabled (read-only count) for the owner.
- **View count:** plain text — "{viewCount} views · {uniqueViewCount} unique".
- On each mutation's `onSuccess`, invalidate the `getPublicCollection` query key for this id so the counts refresh (follow the existing follow/unfollow invalidation pattern already in this file).

- [ ] **Step 2: Typecheck**

Run: `corepack pnpm --filter @workspace/web run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add artifacts/web/src/pages/prep-hub-collection.tsx
git commit -m "feat(web): rating/like/view widgets on Prep Hub collection view"
```

---

### Task C2: Comments section on the Prep Hub collection view

**Files:**
- Modify: `artifacts/web/src/pages/prep-hub-collection.tsx`
- (Optional) Create: `artifacts/web/src/components/collections/CollectionComments.tsx`

- [ ] **Step 1: Build the comments section**

Add a "Discussion" section below the materials list:
- Fetch with `useListCollectionComments({ id })`; render oldest-first: author displayName, relative timestamp (reuse the app's existing time-format helper used by document comments), and body.
- **Compose box** (textarea + submit) for students/lecturers (`!isAdmin`): submit via `useCreateCollectionComment({ id, data: { body } })`; clear on success and invalidate the comments query + the `getPublicCollection` query (to refresh `commentCount`).
- For each comment where `editable === true`: an inline **Edit** (textarea → `useEditCollectionComment({ commentId, data: { body } })`) and **Delete** (`useDeleteCollectionComment({ commentId })`, with a confirm) affordance; invalidate the comments query on success.
- Admins see the thread read-only (no compose box, no edit/delete).
- Empty state: "No comments yet."

If the section grows beyond ~120 lines, extract it into `components/collections/CollectionComments.tsx` taking `{ collectionId, canComment }` props.

- [ ] **Step 2: Typecheck**

Run: `corepack pnpm --filter @workspace/web run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add artifacts/web/src/pages/prep-hub-collection.tsx artifacts/web/src/components/collections
git commit -m "feat(web): comments section on Prep Hub collection view"
```

---

### Task C3: Engagement counts on discovery cards

**Files:**
- Modify: the shared collection card component used by `prep-hub.tsx` (e.g. `artifacts/web/src/components/collections/CollectionCard.tsx` — locate the component rendered in the discovery grid).

- [ ] **Step 1: Surface light counts on each card**

On the discovery `CollectionCard`, add a compact metadata row showing: rating average as stars (or "★ 4.5"), `likeCount`, and `commentCount`. These come from the existing summary DTO returned by `useListDiscoverableCollections`. Read-only — no actions on the card. Keep the styling consistent with the existing follower-count/item-count chips already on the card.

- [ ] **Step 2: Typecheck**

Run: `corepack pnpm --filter @workspace/web run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add artifacts/web/src/components/collections
git commit -m "feat(web): engagement counts on Prep Hub discovery cards"
```

---

## Final verification (run after all parts)

- [ ] **Backend tests** (from `artifacts/api-server`, `.env` loaded): `corepack pnpm vitest run` → all pass (existing suite + the new engagement/comment tests).
- [ ] **Full typecheck** (repo root): `corepack pnpm run typecheck` → exit 0.
- [ ] **Manual smoke** (`.\dev.ps1`, rebuild API): as **student A**, create a public collection. As **student B**, open it in Prep Hub → rate it 4★, like it, post a comment. Confirm: the average + like + comment counts update; the view count incremented on open; student A receives a "commented on" notification linking to `/prep-hub/:id`. As **student A** (owner), open your own collection in Prep Hub → the star control and like button are read-only/disabled, but you can post a comment (no self-notification). As an **admin**, open the collection → counts + comment thread are visible but there is no rating control, like button, or compose box; hitting a like/rating/comment endpoint returns 403.

---

## Self-review notes (coverage vs. spec)

- §4 data model → A1, A2. §6.1 engagement repo → A3. §6.3 comments repo → A4. §4.1 counters surfaced + §6 DTO enrichment → B1. §6.2 engagement service + §5 self-engagement/access (service layer) → B2. §6.3 comments service + §7 notifications → B3. §6.4 routes + view-on-open + §5 access middleware → B4. §6.5 OpenAPI/regen → B5. §8 frontend → C1 (rating/like/view), C2 (comments), C3 (cards). §10 testing → tests in A3, A4, B1, B2, B3 + final smoke.
- Store-only ranking (§2 non-goal): no task touches `popularityScore` or discovery `orderBy` — preserved.
- Out-of-scope (threaded replies, comment reactions, bookmarks-distinct-from-follow, ranking formula, admin moderation) are intentionally not implemented (spec §11).
```
