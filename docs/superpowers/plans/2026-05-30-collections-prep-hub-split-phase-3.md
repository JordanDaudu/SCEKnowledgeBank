# Collections / Prep Hub Split — Phase 3 Implementation Plan (Discovery & Ranking)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make public study collections discoverable — a Postgres full-text-search stack on collections, a configurable weighted ranking score (40% relevance / 20% rating / 15% likes / 15% saves / 10% views), a trailing-window "trending" signal, and a 7-section discovery homepage with a search bar.

**Architecture:** Mirror the existing document FTS stack on `study_collections` (a trigger-maintained `search_text` haystack + a `GENERATED … STORED search_vector tsvector` + GIN index). Ranking weights live in a `lib/collection-ranking.ts` constants module; the score is computed in raw SQL in `collections.repo.ts` over the Phase-2 denormalized columns + a new denormalized `followerCount`. `prep-hub.service.ts` + `routes/prep-hub.ts` gain a `q` (search) param and the sort keys `popular|recent|rating|views|new|trending|exam`; the web Prep Hub page becomes a sectioned homepage with search.

**Tech Stack:** TypeScript, Express, Prisma + PostgreSQL (FTS: tsvector/GIN/triggers, `to_tsquery`/`ts_rank`), Zod, Vitest; React + Vite + wouter + TanStack Query; OpenAPI + orval codegen.

**Reference spec:** `docs/superpowers/specs/2026-05-30-collections-prep-hub-split-phase-3-design.md`

This plan has three parts, executed in order:

- **Part A — Data foundation** (schema, FTS migration, ranking constants, followerCount maintenance)
- **Part B — Search, ranking, sorts, trending** (repo SQL, service, routes, OpenAPI regen)
- **Part C — Frontend** (search bar + sectioned discovery homepage)

---

## Conventions & prerequisites (read once)

- **Working dir for backend commands:** `artifacts/api-server` unless stated. Codegen: repo root or `lib/api-spec`.
- **All commands use `corepack pnpm`** (no global pnpm). **Run `corepack pnpm` from PowerShell, not Git Bash** (Git Bash mangles the corepack path). Plain `node`/`git`/`docker` are fine in Bash.
- **DB-backed tests need `DATABASE_URL`.** From `artifacts/api-server`, Git Bash: `set -a && . ../../.env && set +a` then `corepack pnpm vitest run <file>`. Postgres is up (docker `sceknowledgebank-db-1`, port 5433).
- **Migrations:** this DB now tracks via `_prisma_migrations` (baselined). `prisma migrate dev` is unreliable here (no TTY); **hand-author the migration folder + SQL and apply with `prisma migrate deploy`** (the proven path — see Task A2). `prisma generate` may EPERM on the engine DLL if a server holds it; the JS/TS client still regenerates (harmless).
- **`AuthenticatedUser`** test shape: `{ id, roles, enrollments } as unknown as AuthenticatedUser` (tsc rejects a bare `as AuthenticatedUser` — it needs more fields; the `as unknown as` cast is the established test pattern).
- **DB test hygiene:** follow `src/repositories/collection-engagement.repo.test.ts` / `documents.fts.test.ts` — unique `SX` suffix, direct `db` row creation, `afterAll` cleanup (children before parents).
- **Raw-SQL pattern** (from `documents.repo.ts`): build `Prisma.sql` fragments, get ordered ids via `db.$queryRaw`, then fetch full rows by id and re-sort to the id order. Numeric constants interpolated into SQL arithmetic must be cast (e.g. `${w}::float8`).
- **Commit after every task.** Never `--no-verify`. Append to each commit message: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

# PART A — Data Foundation

Outcome: `study_collections` has a trigger-maintained FTS haystack + `search_vector` + GIN index and a denormalized `follower_count`; the ranking constants module exists; follow/unfollow maintain `follower_count`.

---

### Task A1: Prisma schema — `searchText` + `followerCount`

**Files:**
- Modify: `lib/db/prisma/schema.prisma` (model `StudyCollection`)

- [ ] **Step 1: Add the two fields**

In `model StudyCollection`, after the Phase-2 counter columns (`commentCount Int @default(0) @map("comment_count")`), add:

```prisma
  // ─── Discovery (Phase 3) ──────────────────────────────────────
  // FTS haystack, written ONLY by DB triggers (never by the app).
  // The companion `search_vector tsvector GENERATED … STORED` column +
  // its GIN index are added in raw SQL in the migration and are NOT
  // mapped here (DB-managed; mirrors documents.search_vector).
  searchText    String? @map("search_text")
  // Denormalised save count (= study_collection_followers rows),
  // maintained transactionally on follow/unfollow. Used by ranking SQL
  // so "saves" is a column read, not a per-row subquery.
  followerCount Int     @default(0) @map("follower_count")
```

- [ ] **Step 2: Validate**

Run (repo root, PowerShell): `corepack pnpm --filter @workspace/db exec prisma validate`
Expected: "The schema at prisma\schema.prisma is valid 🚀"

- [ ] **Step 3: Commit**

```bash
git add lib/db/prisma/schema.prisma
git commit -m "feat(db): collection search_text haystack + denormalized follower_count"
```

---

### Task A2: Migration — FTS stack + follower_count backfill + event indexes

**Files:**
- Create: `lib/db/prisma/migrations/20260530140000_collection_discovery/migration.sql`

> Hand-author this migration (the `prisma migrate dev` flow is unreliable on this box). The two `ADD COLUMN`s plus all raw SQL go in one file; then apply with `migrate deploy`.

- [ ] **Step 1: Create the migration folder + file**

Create `lib/db/prisma/migrations/20260530140000_collection_discovery/migration.sql` with EXACTLY:

```sql
-- Collection Discovery (Phase 3): FTS stack + denormalised follower_count
-- + trailing-window trending indexes. Mirrors the document FTS stack
-- (migrations 20260520160000 / 170000) for study_collections.

-- ─── Columns ──────────────────────────────────────────────────────
ALTER TABLE "study_collections" ADD COLUMN "search_text" TEXT;
ALTER TABLE "study_collections" ADD COLUMN "follower_count" INTEGER NOT NULL DEFAULT 0;

-- Generated tsvector + GIN index (english config, matches read-time tsquery).
ALTER TABLE "study_collections"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("search_text", ''))) STORED;
CREATE INDEX IF NOT EXISTS "study_collections_search_vector_gin_idx"
  ON "study_collections" USING gin ("search_vector");

-- ─── Haystack aggregator ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION kb_compute_collection_search_text(p_id uuid)
RETURNS text LANGUAGE sql STABLE AS $fn$
  SELECT
    coalesce(sc.title, '') || ' ' ||
    coalesce(sc.description, '') || ' ' ||
    coalesce(sc.exam_name, '') || ' ' ||
    coalesce(co.code, '') || ' ' ||
    coalesce(co.title, '') || ' ' ||
    coalesce(co.lecturer_name, '') || ' ' ||
    coalesce(cat.name, '') || ' ' ||
    coalesce((
      SELECT string_agg(t.name, ' ')
      FROM study_collection_tags sct
      JOIN tags t ON t.id = sct.tag_id
      WHERE sct.collection_id = sc.id
    ), '') || ' ' ||
    coalesce(u.display_name, '')
  FROM study_collections sc
  LEFT JOIN courses co ON co.id = sc.course_id
  LEFT JOIN categories cat ON cat.id = sc.category_id
  LEFT JOIN users u ON u.id = sc.owner_id
  WHERE sc.id = p_id;
$fn$;

CREATE OR REPLACE FUNCTION kb_refresh_collection_search_text(p_id uuid)
RETURNS void LANGUAGE sql AS $fn$
  UPDATE study_collections
  SET search_text = kb_compute_collection_search_text(p_id)
  WHERE id = p_id;
$fn$;

-- ─── BEFORE INSERT/UPDATE on study_collections ────────────────────
CREATE OR REPLACE FUNCTION kb_collections_search_text_biut()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.search_text :=
    coalesce(NEW.title, '') || ' ' ||
    coalesce(NEW.description, '') || ' ' ||
    coalesce(NEW.exam_name, '') || ' ' ||
    coalesce((
      SELECT coalesce(co.code, '') || ' ' || coalesce(co.title, '') || ' ' ||
             coalesce(co.lecturer_name, '')
      FROM courses co WHERE co.id = NEW.course_id
    ), '') || ' ' ||
    coalesce((SELECT cat.name FROM categories cat WHERE cat.id = NEW.category_id), '') || ' ' ||
    coalesce((
      SELECT string_agg(t.name, ' ')
      FROM study_collection_tags sct
      JOIN tags t ON t.id = sct.tag_id
      WHERE sct.collection_id = NEW.id
    ), '') || ' ' ||
    coalesce((SELECT u.display_name FROM users u WHERE u.id = NEW.owner_id), '');
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER collections_search_text_biut
  BEFORE INSERT OR UPDATE OF title, description, exam_name, course_id, category_id, owner_id
  ON study_collections
  FOR EACH ROW EXECUTE FUNCTION kb_collections_search_text_biut();

-- ─── study_collection_tags (INSERT/DELETE/UPDATE) ─────────────────
CREATE OR REPLACE FUNCTION kb_collection_tags_search_text_aiud()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM kb_refresh_collection_search_text(OLD.collection_id);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.collection_id IS DISTINCT FROM NEW.collection_id THEN
      PERFORM kb_refresh_collection_search_text(OLD.collection_id);
    END IF;
    PERFORM kb_refresh_collection_search_text(NEW.collection_id);
    RETURN NEW;
  ELSE
    PERFORM kb_refresh_collection_search_text(NEW.collection_id);
    RETURN NEW;
  END IF;
END;
$fn$;

CREATE TRIGGER collection_tags_search_text_ai
  AFTER INSERT ON study_collection_tags
  FOR EACH ROW EXECUTE FUNCTION kb_collection_tags_search_text_aiud();
CREATE TRIGGER collection_tags_search_text_au
  AFTER UPDATE ON study_collection_tags
  FOR EACH ROW EXECUTE FUNCTION kb_collection_tags_search_text_aiud();
CREATE TRIGGER collection_tags_search_text_ad
  AFTER DELETE ON study_collection_tags
  FOR EACH ROW EXECUTE FUNCTION kb_collection_tags_search_text_aiud();

-- ─── tags / courses / categories / users name propagation ─────────
CREATE OR REPLACE FUNCTION kb_collections_search_text_on_tag_name()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE study_collections sc
  SET search_text = kb_compute_collection_search_text(sc.id)
  WHERE EXISTS (
    SELECT 1 FROM study_collection_tags sct
    WHERE sct.collection_id = sc.id AND sct.tag_id = NEW.id
  );
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER tags_collections_search_text_au
  AFTER UPDATE OF name ON tags
  FOR EACH ROW EXECUTE FUNCTION kb_collections_search_text_on_tag_name();

CREATE OR REPLACE FUNCTION kb_collections_search_text_on_course()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE study_collections sc
  SET search_text = kb_compute_collection_search_text(sc.id)
  WHERE sc.course_id = NEW.id;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER courses_collections_search_text_au
  AFTER UPDATE OF code, title, lecturer_name ON courses
  FOR EACH ROW EXECUTE FUNCTION kb_collections_search_text_on_course();

CREATE OR REPLACE FUNCTION kb_collections_search_text_on_category()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE study_collections sc
  SET search_text = kb_compute_collection_search_text(sc.id)
  WHERE sc.category_id = NEW.id;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER categories_collections_search_text_au
  AFTER UPDATE OF name ON categories
  FOR EACH ROW EXECUTE FUNCTION kb_collections_search_text_on_category();

CREATE OR REPLACE FUNCTION kb_collections_search_text_on_owner()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE study_collections sc
  SET search_text = kb_compute_collection_search_text(sc.id)
  WHERE sc.owner_id = NEW.id;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER users_collections_search_text_au
  AFTER UPDATE OF display_name ON users
  FOR EACH ROW EXECUTE FUNCTION kb_collections_search_text_on_owner();

-- ─── Backfills ────────────────────────────────────────────────────
UPDATE study_collections SET search_text = kb_compute_collection_search_text(id);
UPDATE study_collections sc
SET follower_count = (
  SELECT count(*) FROM study_collection_followers f WHERE f.collection_id = sc.id
);

-- ─── Trailing-window trending indexes ─────────────────────────────
CREATE INDEX IF NOT EXISTS "study_collection_likes_created_idx"
  ON "study_collection_likes" ("created_at");
CREATE INDEX IF NOT EXISTS "study_collection_followers_created_idx"
  ON "study_collection_followers" ("created_at");
CREATE INDEX IF NOT EXISTS "study_collection_views_viewed_idx"
  ON "study_collection_views" ("viewed_at");
-- comments already have (collection_id, created_at); add a plain created_at
-- for the cross-collection window scan.
CREATE INDEX IF NOT EXISTS "study_collection_comments_created_idx"
  ON "study_collection_comments" ("created_at");
```

- [ ] **Step 2: Apply + regenerate the client** (repo root, PowerShell, `.env` loaded via `.\dev.ps1`-style or set DATABASE_URL):

```
corepack pnpm --filter @workspace/db exec prisma migrate deploy
corepack pnpm --filter @workspace/db exec prisma generate
```
Expected: migration `20260530140000_collection_discovery` applied; client regenerated (search_text/followerCount now on the model). If `generate` EPERMs on the DLL, stop any running API server and retry; if it still EPERMs but the `.d.ts` updated, that's acceptable.

- [ ] **Step 3: Sanity-check** (Bash):

```bash
docker exec sceknowledgebank-db-1 psql -U knowledge_bank -d knowledge_bank -c "SELECT column_name FROM information_schema.columns WHERE table_name='study_collections' AND column_name IN ('search_text','search_vector','follower_count'); SELECT count(*) AS triggers FROM pg_trigger WHERE tgname LIKE '%collection%search_text%' OR tgname LIKE '%collections_search_text%';"
```
Expected: 3 columns; several triggers.

- [ ] **Step 4: Commit**

```bash
git add lib/db/prisma/migrations
git commit -m "feat(db): migrate collection FTS stack + follower_count backfill + trending indexes"
```

---

### Task A3: Ranking constants module

**Files:**
- Create: `artifacts/api-server/src/lib/collection-ranking.ts`

- [ ] **Step 1: Create the module**

```ts
/**
 * Phase 3 — collection ranking policy. Pure constants (no DB); the scoring
 * math lives in collections.repo SQL. Tune weights/scales here. Mirrors the
 * lib/ranking.ts pattern for documents.
 */
export const COLLECTION_RANKING = {
  // Weighted blend for the combined discovery/search score (sums to 1.0).
  relevanceWeight: 0.4,
  ratingWeight: 0.2,
  likeWeight: 0.15,
  saveWeight: 0.15,
  viewWeight: 0.1,
  // Soft-cap scales for ln-normalising unbounded counts to ~[0,1]:
  //   norm(x) = LEAST(ln(1+x) / ln(1+SCALE), 1)
  likeScale: 50,
  saveScale: 50,
  viewScale: 500,
  // Bayesian prior for the Highest-Rated section.
  ratingPriorMean: 3.5,
  ratingPriorWeight: 5,
  // Trending: trailing window (days) + per-event weights.
  trendingWindowDays: 7,
  trendingViewWeight: 1,
  trendingLikeWeight: 3,
  trendingFollowWeight: 4,
  trendingCommentWeight: 2,
} as const;
```

- [ ] **Step 2: Typecheck + commit**

```
corepack pnpm --filter @workspace/api-server run typecheck
```
```bash
git add artifacts/api-server/src/lib/collection-ranking.ts
git commit -m "feat(collections): ranking constants module"
```

---

### Task A4: Maintain `followerCount` on follow/unfollow

**Files:**
- Modify: `artifacts/api-server/src/repositories/collections.repo.ts` (`followCollection`, `unfollowCollection`)
- Test: `artifacts/api-server/src/repositories/collections.follower-count.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/repositories/collections.follower-count.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import { followCollection, unfollowCollection } from "./collections.repo";

const SX = `_folcnt_${Date.now().toString(36)}`;
let ownerId: string;
let u1: string;
let u2: string;
let colId: string;

async function fc(id: string) {
  return (await db.studyCollection.findUniqueOrThrow({ where: { id }, select: { followerCount: true } })).followerCount;
}

beforeAll(async () => {
  ownerId = (await db.user.create({ data: { email: `o${SX}@demo`, passwordHash: "x", displayName: `O${SX}`, isActive: true } })).id;
  u1 = (await db.user.create({ data: { email: `a${SX}@demo`, passwordHash: "x", displayName: `A${SX}`, isActive: true } })).id;
  u2 = (await db.user.create({ data: { email: `b${SX}@demo`, passwordHash: "x", displayName: `B${SX}`, isActive: true } })).id;
  colId = (await db.studyCollection.create({ data: { ownerId, title: `C${SX}`, visibility: "public" } })).id;
});

afterAll(async () => {
  await db.studyCollectionFollower.deleteMany({ where: { collectionId: colId } });
  await db.studyCollection.deleteMany({ where: { id: colId } });
  await db.user.deleteMany({ where: { id: { in: [ownerId, u1, u2] } } });
});

describe("collections.repo follower_count maintenance", () => {
  it("follow/unfollow maintains follower_count and is idempotent", async () => {
    expect(await followCollection(colId, u1)).toBe(true);
    expect(await followCollection(colId, u1)).toBe(false); // repeat → no-op
    expect(await fc(colId)).toBe(1);
    await followCollection(colId, u2);
    expect(await fc(colId)).toBe(2);
    expect(await unfollowCollection(colId, u1)).toBe(true);
    expect(await fc(colId)).toBe(1);
    expect(await unfollowCollection(colId, u1)).toBe(false); // repeat → no-op
    expect(await fc(colId)).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

`set -a && . ../../.env && set +a && corepack pnpm vitest run src/repositories/collections.follower-count.test.ts`
Expected: FAIL — `follower_count` stays 0 (not yet maintained).

- [ ] **Step 3: Wrap follow/unfollow in a counter transaction**

In `collections.repo.ts`, replace the existing `followCollection` and `unfollowCollection` bodies with versions that bump the counter in the same transaction (keep the same signatures + return semantics):

```ts
/** Follow a collection. Idempotent on (collection, user); on a real insert
 *  bumps follower_count in the same transaction. Returns true iff inserted. */
export async function followCollection(
  collectionId: string,
  userId: string,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const r = await tx.studyCollectionFollower.createMany({
      data: [{ collectionId, userId }],
      skipDuplicates: true,
    });
    if (r.count > 0) {
      await tx.studyCollection.update({
        where: { id: collectionId },
        data: { followerCount: { increment: 1 } },
      });
    }
    return r.count > 0;
  });
}

/** Unfollow a collection. Returns true iff a follow row was removed (then
 *  decrements follower_count). */
export async function unfollowCollection(
  collectionId: string,
  userId: string,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const r = await tx.studyCollectionFollower.deleteMany({
      where: { collectionId, userId },
    });
    if (r.count > 0) {
      await tx.studyCollection.update({
        where: { id: collectionId },
        data: { followerCount: { decrement: 1 } },
      });
    }
    return r.count > 0;
  });
}
```

(The `prep-hub.service` already calls `recomputePopularity` after follow/unfollow — that stays; `popularityScore` is independent of `follower_count`.)

- [ ] **Step 4: Run the test to confirm it passes**

`corepack pnpm vitest run src/repositories/collections.follower-count.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/repositories/collections.repo.ts src/repositories/collections.follower-count.test.ts
git commit -m "feat(collections): maintain denormalized follower_count on follow/unfollow"
```

---

# PART B — Search, Ranking, Sorts, Trending

Outcome: the repo supports FTS search ranked by the combined score, all sort variants, and a trailing-window trending query; the service threads `q`/`sort` + exposes trending; routes + OpenAPI updated.

---

### Task B1: Repo — FTS search + combined-score discovery (raw SQL)

**Files:**
- Modify: `artifacts/api-server/src/repositories/collections.repo.ts`
- Test: `artifacts/api-server/src/repositories/collections.discovery.test.ts`

> The current `listDiscoverable` uses Prisma `findMany` (popular/recent only). Replace it with a raw-SQL id-query that supports FTS + the combined score + all sorts, then fetch full rows by id (with `_count.items`) and re-sort — the established `documents.repo` pattern.

- [ ] **Step 1: Write the failing test**

Create `src/repositories/collections.discovery.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import { listDiscoverable } from "./collections.repo";
import * as engagementRepo from "./collection-engagement.repo";

const SX = `_disc_${Date.now().toString(36)}`;
let ownerId: string;
let liker: string;
let calcId: string; // strong text match for "calculus"
let physId: string; // unrelated
let popularId: string; // high engagement, weak text

beforeAll(async () => {
  ownerId = (await db.user.create({ data: { email: `o${SX}@demo`, passwordHash: "x", displayName: `O${SX}`, isActive: true } })).id;
  liker = (await db.user.create({ data: { email: `l${SX}@demo`, passwordHash: "x", displayName: `L${SX}`, isActive: true } })).id;
  calcId = (await db.studyCollection.create({ data: { ownerId, title: `Calculus Final ${SX}`, description: "integrals and derivatives", visibility: "public" } })).id;
  physId = (await db.studyCollection.create({ data: { ownerId, title: `Physics ${SX}`, description: "mechanics", visibility: "public" } })).id;
  popularId = (await db.studyCollection.create({ data: { ownerId, title: `Misc ${SX}`, description: "stuff", visibility: "public" } })).id;
  await db.studyCollection.create({ data: { ownerId, title: `Private Calculus ${SX}`, visibility: "private" } });
  // give popularId engagement
  for (let i = 0; i < 5; i++) {
    const u = await db.user.create({ data: { email: `e${i}${SX}@demo`, passwordHash: "x", displayName: `E${i}${SX}`, isActive: true } });
    await engagementRepo.likeCollection(popularId, u.id);
    await engagementRepo.recordView(popularId, u.id);
  }
});

afterAll(async () => {
  await db.studyCollectionView.deleteMany({ where: { collectionId: popularId } });
  await db.studyCollectionLike.deleteMany({ where: { collectionId: popularId } });
  await db.studyCollection.deleteMany({ where: { ownerId } });
  await db.user.deleteMany({ where: { email: { contains: SX } } });
});

describe("collections.repo discovery", () => {
  it("FTS search matches title/description and excludes private + non-matches", async () => {
    const rows = await listDiscoverable({ sort: "popular", q: "calculus", limit: 50 });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(calcId);
    expect(ids).not.toContain(physId);
    // private calculus collection never appears
    expect(rows.every((r) => r.visibility === "public" || r.isOfficial)).toBe(true);
  });

  it("popular (q-less) orders the high-engagement collection above a fresh empty one", async () => {
    const rows = await listDiscoverable({ sort: "popular", limit: 50 });
    const ids = rows.map((r) => r.id);
    expect(ids.indexOf(popularId)).toBeLessThan(ids.indexOf(physId));
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

`corepack pnpm vitest run src/repositories/collections.discovery.test.ts`
Expected: FAIL — `listDiscoverable` doesn't accept `q` / isn't FTS-ranked.

- [ ] **Step 3: Add SQL helpers + rewrite `listDiscoverable`**

In `collections.repo.ts`, add the import for the constants and `Prisma` (already imported). Add helpers near the top of the discovery section, then rewrite `listDiscoverable`. Replace the existing `DiscoverSort` type and `listDiscoverable` function with:

```ts
import { COLLECTION_RANKING as CR } from "../lib/collection-ranking";

export type DiscoverSort =
  | "popular" | "recent" | "new" | "rating" | "views" | "trending" | "exam";

/** Prefix-aware tsquery from raw user input (mirrors documents prefixTsQuery). */
function collectionTsQuery(q: string): Prisma.Sql {
  const tokens = q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `${t}:*`);
  if (tokens.length === 0) return Prisma.sql`to_tsquery('english', '')`;
  return Prisma.sql`to_tsquery('english', ${tokens.join(" & ")})`;
}

function normSql(col: Prisma.Sql, scale: number): Prisma.Sql {
  return Prisma.sql`LEAST(ln(1 + ${col}) / ln(1 + ${scale}::float8), 1.0)`;
}

/** Combined discovery/search score. `rel` is the [0,1] relevance term (0 when
 *  there is no query). Reads the Phase-2 denormalised columns. */
function combinedScoreSql(rel: Prisma.Sql): Prisma.Sql {
  const rating = Prisma.sql`(CASE WHEN sc.rating_count > 0 THEN (sc.rating_sum::float8 / sc.rating_count / 5.0) ELSE 0 END)`;
  return Prisma.sql`(
    ${CR.relevanceWeight}::float8 * ${rel}
    + ${CR.ratingWeight}::float8 * ${rating}
    + ${CR.likeWeight}::float8 * ${normSql(Prisma.sql`sc.like_count`, CR.likeScale)}
    + ${CR.saveWeight}::float8 * ${normSql(Prisma.sql`sc.follower_count`, CR.saveScale)}
    + ${CR.viewWeight}::float8 * ${normSql(Prisma.sql`sc.view_count`, CR.viewScale)}
  )`;
}

/** Bayesian-shrunk average rating, for the Highest-Rated sort. */
function bayesRatingSql(): Prisma.Sql {
  return Prisma.sql`((sc.rating_sum + ${CR.ratingPriorMean}::float8 * ${CR.ratingPriorWeight}::float8) / (sc.rating_count + ${CR.ratingPriorWeight}::float8))`;
}

/** Collections discoverable by other users: public OR official, not deleted.
 *  Optional FTS (`q`) and course scope. Sorted per `sort`. */
export async function listDiscoverable(opts: {
  sort: DiscoverSort;
  q?: string;
  courseId?: string;
  limit: number;
}): Promise<Array<CollectionRow & { itemCount: number }>> {
  const where: Prisma.Sql[] = [
    Prisma.sql`sc.deleted_at IS NULL`,
    Prisma.sql`(sc.visibility = 'public' OR sc.is_official = true)`,
  ];
  if (opts.courseId) where.push(Prisma.sql`sc.course_id = ${opts.courseId}::uuid`);

  const q = opts.q?.trim();
  const hasQ = !!q && collectionTsQueryHasTokens(q);
  if (hasQ) where.push(Prisma.sql`sc.search_vector @@ ${collectionTsQuery(q!)}`);
  if (opts.sort === "exam") where.push(Prisma.sql`sc.exam_date IS NOT NULL AND sc.exam_date > now()`);

  const rel = hasQ
    ? Prisma.sql`(ts_rank(sc.search_vector, ${collectionTsQuery(q!)}) / (ts_rank(sc.search_vector, ${collectionTsQuery(q!)}) + 1))`
    : Prisma.sql`0`;

  const recent = Prisma.sql`sc.created_at DESC`;
  let orderBy: Prisma.Sql;
  if (hasQ) {
    orderBy = Prisma.sql`${combinedScoreSql(rel)} DESC, ${recent}`;
  } else {
    switch (opts.sort) {
      case "recent":
      case "new":
        orderBy = recent;
        break;
      case "rating":
        orderBy = Prisma.sql`${bayesRatingSql()} DESC, sc.rating_count DESC, ${recent}`;
        break;
      case "views":
        orderBy = Prisma.sql`sc.view_count DESC, ${recent}`;
        break;
      case "exam":
        orderBy = Prisma.sql`sc.exam_date ASC`;
        break;
      case "popular":
      default:
        orderBy = Prisma.sql`${combinedScoreSql(Prisma.sql`0`)} DESC, ${recent}`;
        break;
    }
  }

  const idRows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT sc.id
    FROM study_collections sc
    WHERE ${Prisma.join(where, " AND ")}
    ORDER BY ${orderBy}
    LIMIT ${opts.limit}
  `);
  return fetchCollectionsByIdOrder(idRows.map((r) => r.id));
}

/** True if the query yields at least one search token (else FTS matches nothing). */
function collectionTsQueryHasTokens(q: string): boolean {
  return q.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).length > 0;
}

/** Fetch full collection rows for the given ids, preserving id order, with itemCount. */
async function fetchCollectionsByIdOrder(
  ids: string[],
): Promise<Array<CollectionRow & { itemCount: number }>> {
  if (ids.length === 0) return [];
  const rows = await db.studyCollection.findMany({
    where: { id: { in: ids } },
    include: { _count: { select: { items: true } } },
  });
  const byId = new Map(rows.map((r) => {
    const { _count, ...rest } = r;
    return [r.id, { ...rest, itemCount: _count.items } as CollectionRow & { itemCount: number }];
  }));
  return ids.map((id) => byId.get(id)).filter((r): r is CollectionRow & { itemCount: number } => !!r);
}
```

> Note: `recommendCollections` still uses its own `findMany` and is unchanged. The `CollectionRow` interface is unchanged — `searchText`/`followerCount`/`search_vector` are read in SQL or simply carried on the fetched row.

- [ ] **Step 4: Run the test to confirm it passes**

`corepack pnpm vitest run src/repositories/collections.discovery.test.ts` → PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

```
corepack pnpm --filter @workspace/api-server run typecheck
```
```bash
git add src/repositories/collections.repo.ts src/repositories/collections.discovery.test.ts
git commit -m "feat(collections): FTS search + combined-score discovery (raw SQL)"
```

---

### Task B2: Repo — sort variants + trailing-window trending

**Files:**
- Modify: `artifacts/api-server/src/repositories/collections.repo.ts` (add `listTrending`)
- Test: `artifacts/api-server/src/repositories/collections.trending.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/repositories/collections.trending.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import { listTrending } from "./collections.repo";

const SX = `_trend_${Date.now().toString(36)}`;
let ownerId: string;
let hotId: string;
let coldId: string;
let staleId: string;

beforeAll(async () => {
  ownerId = (await db.user.create({ data: { email: `o${SX}@demo`, passwordHash: "x", displayName: `O${SX}`, isActive: true } })).id;
  hotId = (await db.studyCollection.create({ data: { ownerId, title: `Hot ${SX}`, visibility: "public" } })).id;
  coldId = (await db.studyCollection.create({ data: { ownerId, title: `Cold ${SX}`, visibility: "public" } })).id;
  staleId = (await db.studyCollection.create({ data: { ownerId, title: `Stale ${SX}`, visibility: "public" } })).id;
  // hot: recent views; stale: views dated 30 days ago (outside window)
  for (let i = 0; i < 4; i++) {
    const u = await db.user.create({ data: { email: `h${i}${SX}@demo`, passwordHash: "x", displayName: `H${i}${SX}`, isActive: true } });
    await db.studyCollectionView.create({ data: { collectionId: hotId, userId: u.id } });
    await db.studyCollectionView.create({ data: { collectionId: staleId, userId: u.id, viewedAt: new Date(Date.now() - 30 * 864e5) } });
  }
});

afterAll(async () => {
  await db.studyCollectionView.deleteMany({ where: { collectionId: { in: [hotId, coldId, staleId] } } });
  await db.studyCollection.deleteMany({ where: { ownerId } });
  await db.user.deleteMany({ where: { email: { contains: SX } } });
});

describe("collections.repo trending", () => {
  it("ranks recent-activity collections; excludes zero-activity and out-of-window", async () => {
    const since = new Date(Date.now() - 7 * 864e5);
    const rows = await listTrending({ since, limit: 50 });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(hotId);
    expect(ids).not.toContain(coldId); // no activity at all
    expect(ids).not.toContain(staleId); // activity is 30d old, outside window
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

`corepack pnpm vitest run src/repositories/collections.trending.test.ts`
Expected: FAIL — `listTrending` not exported.

- [ ] **Step 3: Implement `listTrending`**

Add to `collections.repo.ts` (after `listDiscoverable`):

```ts
/** Trailing-window trending: weighted count of recent engagement events per
 *  visible collection, since `since`. Collections with no in-window activity
 *  are excluded. */
export async function listTrending(opts: {
  since: Date;
  limit: number;
}): Promise<Array<CollectionRow & { itemCount: number }>> {
  const idRows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH activity AS (
      SELECT collection_id, ${CR.trendingViewWeight}::float8 * count(*) AS score
      FROM study_collection_views WHERE viewed_at >= ${opts.since} GROUP BY collection_id
      UNION ALL
      SELECT collection_id, ${CR.trendingLikeWeight}::float8 * count(*)
      FROM study_collection_likes WHERE created_at >= ${opts.since} GROUP BY collection_id
      UNION ALL
      SELECT collection_id, ${CR.trendingFollowWeight}::float8 * count(*)
      FROM study_collection_followers WHERE created_at >= ${opts.since} GROUP BY collection_id
      UNION ALL
      SELECT collection_id, ${CR.trendingCommentWeight}::float8 * count(*)
      FROM study_collection_comments WHERE created_at >= ${opts.since} AND deleted_at IS NULL GROUP BY collection_id
    )
    SELECT sc.id
    FROM study_collections sc
    JOIN (SELECT collection_id, sum(score) AS score FROM activity GROUP BY collection_id) a
      ON a.collection_id = sc.id
    WHERE sc.deleted_at IS NULL AND (sc.visibility = 'public' OR sc.is_official = true)
    ORDER BY a.score DESC, sc.created_at DESC
    LIMIT ${opts.limit}
  `);
  return fetchCollectionsByIdOrder(idRows.map((r) => r.id));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

`corepack pnpm vitest run src/repositories/collections.trending.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/repositories/collections.repo.ts src/repositories/collections.trending.test.ts
git commit -m "feat(collections): trailing-window trending query"
```

---

### Task B3: Service — thread `q`/`sort`, add `listTrending`

**Files:**
- Modify: `artifacts/api-server/src/services/prep-hub.service.ts`
- Test: `artifacts/api-server/src/services/prep-hub.discovery.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/prep-hub.discovery.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { createCollection } from "./collections.service";
import { listDiscoverable, listTrending } from "./prep-hub.service";

const SX = `_phdisc_${Date.now().toString(36)}`;
let user: AuthenticatedUser;
let calcId: string;

beforeAll(async () => {
  const u = await db.user.create({ data: { email: `u${SX}@demo`, passwordHash: "x", displayName: `U${SX}`, isActive: true } });
  user = { id: u.id, roles: ["student"], enrollments: [] } as unknown as AuthenticatedUser;
  calcId = (await createCollection(user, { title: `Calculus ${SX}`, visibility: "public" })).id;
  await createCollection(user, { title: `Physics ${SX}`, visibility: "public" });
});

afterAll(async () => {
  await db.studyCollection.deleteMany({ where: { ownerId: user.id } });
  await db.user.deleteMany({ where: { id: user.id } });
});

describe("prep-hub.service discovery", () => {
  it("listDiscoverable threads q into FTS search", async () => {
    const rows = await listDiscoverable(user, { sort: "popular", q: "calculus", limit: 50 });
    expect(rows.map((r) => r.id)).toContain(calcId);
    expect(rows.every((r) => r.visibility === "public")).toBe(true);
  });
  it("listTrending returns summaries (no throw on empty activity)", async () => {
    const rows = await listTrending(user, 10);
    expect(Array.isArray(rows)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

`corepack pnpm vitest run src/services/prep-hub.discovery.test.ts`
Expected: FAIL — `listDiscoverable` has no `q`; `listTrending` not exported.

- [ ] **Step 3: Update the service**

In `prep-hub.service.ts`, add the import:
```ts
import { COLLECTION_RANKING } from "../lib/collection-ranking";
```
Replace `listDiscoverable` with a version that accepts `q` + the wider sort, and add `listTrending`:

```ts
export async function listDiscoverable(
  user: AuthenticatedUser,
  opts: {
    sort?: collectionsRepo.DiscoverSort;
    q?: string;
    courseId?: string;
    limit?: number;
  },
): Promise<CollectionSummaryDTO[]> {
  const rows = await collectionsRepo.listDiscoverable({
    sort: opts.sort ?? "popular",
    q: opts.q?.trim() || undefined,
    courseId: opts.courseId,
    limit: Math.min(opts.limit ?? 24, 50),
  });
  return collectionsService.summarize(rows, user);
}

export async function listTrending(
  user: AuthenticatedUser,
  limit = 12,
): Promise<CollectionSummaryDTO[]> {
  const since = new Date(Date.now() - COLLECTION_RANKING.trendingWindowDays * 86_400_000);
  const rows = await collectionsRepo.listTrending({ since, limit: Math.min(limit, 50) });
  return collectionsService.summarize(rows, user);
}
```

> `new Date(Date.now() - …)` here is fine — this is runtime service code, not a workflow script.

- [ ] **Step 4: Run the test + regression**

`corepack pnpm vitest run src/services/prep-hub.discovery.test.ts` → PASS.
`corepack pnpm vitest run src/services/prep-hub.service.test.ts` → still PASS.

- [ ] **Step 5: Typecheck + commit**

```
corepack pnpm --filter @workspace/api-server run typecheck
```
```bash
git add src/services/prep-hub.service.ts src/services/prep-hub.discovery.test.ts
git commit -m "feat(prep-hub): thread q/sort into discovery + add trending"
```

---

### Task B4: Routes — `q` + expanded `sort` + `/prep-hub/trending`

**Files:**
- Modify: `artifacts/api-server/src/routes/prep-hub.ts`

- [ ] **Step 1: Widen the discover query + add the trending route**

In `routes/prep-hub.ts`, replace the `DiscoverQuery` schema with:
```ts
const DiscoverQuery = z.object({
  sort: z.enum(["popular", "recent", "new", "rating", "views", "trending", "exam"]).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  courseId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});
```
Update the existing `GET /prep-hub/collections` handler to pass `q` through:
```ts
router.get("/prep-hub/collections", requireAuth, async (req, res, next) => {
  try {
    const query = DiscoverQuery.parse(req.query);
    res.json(
      await prepHubService.listDiscoverable(req.authUser!, {
        sort: query.sort,
        q: query.q,
        courseId: query.courseId,
        limit: query.limit,
      }),
    );
  } catch (err) {
    next(err);
  }
});
```
Add a trending route (after the discover route):
```ts
const TrendingQuery = z.object({
  limit: z.coerce.number().int().positive().max(50).optional(),
});

router.get("/prep-hub/trending", requireAuth, async (req, res, next) => {
  try {
    const { limit } = TrendingQuery.parse(req.query);
    res.json(await prepHubService.listTrending(req.authUser!, limit));
  } catch (err) {
    next(err);
  }
});
```

> Place `GET /prep-hub/trending` so it does not get shadowed by `GET /prep-hub/collections/:id` — `trending` is a sibling path segment, no conflict.

- [ ] **Step 2: Typecheck + build**

```
corepack pnpm --filter @workspace/api-server run typecheck
corepack pnpm --filter @workspace/api-server run build
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/routes/prep-hub.ts
git commit -m "feat(routes): prep-hub q/sort search params + trending route"
```

---

### Task B5: OpenAPI spec + client regeneration

**Files:**
- Modify: `lib/api-spec/openapi.yaml`
- Regenerated (do not hand-edit): `lib/api-zod/src/generated/*`, `lib/api-client-react/src/generated/*`

- [ ] **Step 1: Update the discover operation + add trending**

In `openapi.yaml`, find the `GET /prep-hub/collections` operation (`operationId: listDiscoverableCollections`). Add query parameters: `q` (string), and widen the existing `sort` enum to `[popular, recent, new, rating, views, trending, exam]`. Mirror the existing parameter style.

Add a new path `GET /prep-hub/trending` → `operationId: listTrendingCollections`, query param `limit` (integer), tag `prep-hub`, response `200` = `array` of `StudyCollectionSummary` (copy the discover response style).

- [ ] **Step 2: Regenerate the clients** (repo root, PowerShell):

```
corepack pnpm --filter @workspace/api-spec run codegen
```
Expected: orval rewrites both client packages; `typecheck:libs` passes. New/updated hooks: `useListDiscoverableCollections` (now accepts `q`/widened `sort`), `useListTrendingCollections`.

- [ ] **Step 3: Confirm generated hooks** (Bash):

```bash
grep -rl "useListTrendingCollections" lib/api-client-react/src/generated
```
Expected: at least one path printed.

- [ ] **Step 4: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-zod/src/generated lib/api-client-react/src/generated
git commit -m "feat(api): openapi prep-hub q/sort + trending; regen clients"
```

---

# PART C — Frontend (sectioned discovery homepage + search)

Outcome: the Prep Hub page has a search bar (ranked results) and a sectioned discovery homepage. Acceptance per task = `corepack pnpm --filter @workspace/web run typecheck` exits 0 + the final manual smoke.

---

### Task C1: Search bar + ranked results on the Prep Hub page

**Files:**
- Modify: `artifacts/web/src/pages/prep-hub.tsx`

- [ ] **Step 1: Add a debounced search box + results view**

Read `prep-hub.tsx` first. Add a search input near the top (reuse the Browse page's debounced-search pattern + the same `<mark>` headline-highlight helper if the discovery cards show a snippet; otherwise just filter to the ranked list). State: `const [q, setQ] = useState("")` with a ~300ms debounce to `debouncedQ`.

When `debouncedQ` is non-empty: render a single **"Search results"** grid from `useListDiscoverableCollections({ q: debouncedQ })` (ranked by the server's combined score), reusing `CollectionCard`. When empty: render the sectioned homepage (Task C2). Show loading + empty ("No collections match …") states like Browse.

- [ ] **Step 2: Typecheck + commit**

```
corepack pnpm --filter @workspace/web run typecheck
```
```bash
git add artifacts/web/src/pages/prep-hub.tsx
git commit -m "feat(web): Prep Hub search bar with ranked results"
```

---

### Task C2: Sectioned discovery homepage

**Files:**
- Modify: `artifacts/web/src/pages/prep-hub.tsx`
- (Optional) Create: `artifacts/web/src/components/collections/DiscoverySection.tsx`

- [ ] **Step 1: Render the 7 sections**

When there is no active search query, render these labeled sections (each a grid/lane reusing `CollectionCard`; hide a section when its list is empty):

- **Trending** — `useListTrendingCollections()`.
- **Popular** — `useListDiscoverableCollections({ sort: "popular" })`.
- **Highest Rated** — `useListDiscoverableCollections({ sort: "rating" })`.
- **Most Viewed** — `useListDiscoverableCollections({ sort: "views" })`.
- **New** — `useListDiscoverableCollections({ sort: "new" })`.
- **Upcoming Exams** — `useListDiscoverableCollections({ sort: "exam" })`.
- **For You / Your Courses** — `useListRecommendedCollections()` (existing).

If a section block grows repetitive, extract a small `DiscoverySection.tsx` component taking `{ title: string; collections: StudyCollectionSummary[]; emptyHidden?: boolean }` and map over a section config array. Keep the existing Quick-Access lanes if present, or fold them into these sections (avoid duplicating the same collection list twice — your judgment).

- [ ] **Step 2: Typecheck + commit**

```
corepack pnpm --filter @workspace/web run typecheck
```
```bash
git add artifacts/web/src/pages/prep-hub.tsx artifacts/web/src/components/collections
git commit -m "feat(web): sectioned Prep Hub discovery homepage"
```

---

## Final verification (run after all parts)

- [ ] **Backend tests** (from `artifacts/api-server`, `.env` loaded): `corepack pnpm vitest run` → all pass (existing suite + the new discovery/trending/follower-count tests).
- [ ] **Full typecheck** (repo root): `corepack pnpm run typecheck` → exit 0.
- [ ] **Manual smoke** (rebuild API + restart per windows-dev-setup): as a student, search "calculus" in Prep Hub → ranked results; clear search → the homepage shows Trending / Popular / Highest Rated / Most Viewed / New / Upcoming Exams / For-your-courses, each hiding when empty. Confirm a strongly-engaged public collection ranks high in Popular, and a collection with a future exam date appears under Upcoming Exams.

---

## Self-review notes (coverage vs. spec)

- §4 data model (search_text/search_vector/GIN/triggers, follower_count, event indexes) → A1, A2. §5.1 constants → A3. §4.1 follower_count maintenance → A4. §5.2 combined score + §6.1 FTS/sorts → B1. §5.4 trending → B2. §6.2 service → B3. §6.3 routes → B4. §6.4 OpenAPI/regen → B5. §7 frontend (search + sections) → C1, C2. §8 testing → tests in A4, B1, B2, B3 + final smoke.
- §5.3 section→ordering: popular/search (B1 combined score), rating (B1 Bayesian), views/new/exam (B1), trending (B2), For-your-courses (existing recommended, used in C2). All covered.
- No task changes `popularityScore`, Phase-2 engagement writes, or access control (read-path only) — preserved.
- Out of scope (admin moderation, runtime-tunable weights, caching, trigram fallback) — not implemented (spec §11).
```
