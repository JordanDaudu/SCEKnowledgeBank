# Gamification & Contributor Reputation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a contributor reputation system — a quality-weighted points score, permanent badges, a leaderboard, and author-credibility chips — derived from current data with no hand-maintained score columns.

**Architecture:** Reputation is a *pure function of current state*, computed in raw SQL (like `analytics.repo.ts`) and cached in-process (like `analytics.service.ts`'s `memoize`). The only new persistent table is `user_badges` (earned achievements are permanent). Badge definitions live in code. No score backfill is needed; only a one-time badge-award pass.

**Tech Stack:** pnpm monorepo · Prisma + Postgres · Express 5 · Vitest (real-DB integration tests) · OpenAPI spec + orval-generated React Query clients · Vite + React + Radix + Tailwind + wouter.

**Reference spec:** `docs/superpowers/specs/2026-06-09-gamification-reputation-design.md`

**Conventions to follow (verified against the codebase):**
- Run all tooling via `corepack pnpm` (see windows-dev-setup); load `.env` for DB tests.
- Raw SQL repos use `db.$queryRaw` and return `bigint` columns cast with `Number(...)` (see `analytics.repo.ts`).
- DB tests create fixtures with a unique suffix `const SX = "_x_" + Date.now().toString(36)` and clean up in `afterAll` (see `collections.metadata.test.ts`).
- Audit rows for downloads: `audit_logs` with `action='document.download'`, `entity_type='document'`, `entity_id` = the document id as text, `user_id` = the actor (see `analytics.repo.ts:146-176`).
- After any API contract change, regenerate clients: `corepack pnpm --filter @workspace/api-spec run build` then the orval generate script (confirm the exact script names in `lib/api-spec/package.json` and `lib/api-client-react/package.json` before running).

---

## Task 1: `user_badges` table + Prisma model

**Files:**
- Modify: `lib/db/prisma/schema.prisma` (add model + `User.badges` relation)
- Create: `lib/db/prisma/migrations/<timestamp>_user_badges/migration.sql`

- [ ] **Step 1: Add the model to `schema.prisma`** (after the `UserRole` block or near other user-owned tables):

```prisma
model UserBadge {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  badgeKey  String   @map("badge_key")
  awardedAt DateTime @default(now()) @map("awarded_at") @db.Timestamptz()

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, badgeKey], map: "user_badges_user_key_unique")
  @@index([userId], map: "user_badges_user_idx")
  @@map("user_badges")
}
```

- [ ] **Step 2: Add the relation to the `User` model** — add this line alongside the other relation fields (e.g. after `collectionComments`):

```prisma
  badges            UserBadge[]
```

- [ ] **Step 3: Create the migration.** Make a new folder `lib/db/prisma/migrations/20260609120000_user_badges/` with `migration.sql`:

```sql
CREATE TABLE "user_badges" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "badge_key" TEXT NOT NULL,
  "awarded_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "user_badges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_badges_user_key_unique" ON "user_badges" ("user_id", "badge_key");
CREATE INDEX "user_badges_user_idx" ON "user_badges" ("user_id");

ALTER TABLE "user_badges"
  ADD CONSTRAINT "user_badges_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Generate the client and apply the migration locally.**

Run: `corepack pnpm --filter @workspace/db run generate` then apply migrations against the dev DB (`corepack pnpm --filter @workspace/db exec prisma migrate deploy`).
Expected: client regenerates with `db.userBadge`; migration applies cleanly.

- [ ] **Step 5: Typecheck.**

Run: `corepack pnpm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add lib/db/prisma/schema.prisma lib/db/prisma/migrations
git commit -m "feat(db): add user_badges table for reputation achievements"
```

---

## Task 2: Reputation config — weights, levels, badge catalog (pure, TDD)

**Files:**
- Create: `artifacts/api-server/src/lib/reputation.ts`
- Test: `artifacts/api-server/src/lib/reputation.test.ts`

This module is pure (no DB). It defines the weights, the score-from-stats function, the level mapping, and the badge catalog with predicates over a `ReputationStats` shape.

- [ ] **Step 1: Write the failing test** (`reputation.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import {
  scoreFromStats,
  levelForScore,
  earnedBadgeKeys,
  type ReputationStats,
} from "./reputation";

const ZERO: ReputationStats = {
  publishedUploads: 0,
  downloadsReceived: 0,
  favoritesReceived: 0,
  publicCollections: 0,
  followersReceived: 0,
  comments: 0,
  reactionsReceived: 0,
  requests: 0,
};

describe("scoreFromStats", () => {
  it("is zero for a user with no activity", () => {
    expect(scoreFromStats(ZERO)).toBe(0);
  });

  it("weights uploads (10) + downloads (2) + favorites (3)", () => {
    const s = scoreFromStats({ ...ZERO, publishedUploads: 2, downloadsReceived: 5, favoritesReceived: 3 });
    expect(s).toBe(2 * 10 + 5 * 2 + 3 * 3); // 39
  });

  it("counts comments, reactions, collections, followers, requests", () => {
    const s = scoreFromStats({
      ...ZERO, comments: 4, reactionsReceived: 6, publicCollections: 2, followersReceived: 3, requests: 5,
    });
    expect(s).toBe(4 * 2 + 6 * 1 + 2 * 5 + 3 * 2 + 5 * 1); // 35
  });
});

describe("levelForScore", () => {
  it("maps thresholds to named levels", () => {
    expect(levelForScore(0).key).toBe("novice");
    expect(levelForScore(50).key).toBe("contributor");
    expect(levelForScore(250).key).toBe("scholar");
    expect(levelForScore(1000).key).toBe("sage");
  });
});

describe("earnedBadgeKeys", () => {
  it("awards first_upload at 1 upload but not prolific until 10", () => {
    const keys = earnedBadgeKeys({ ...ZERO, publishedUploads: 1 });
    expect(keys).toContain("first_upload");
    expect(keys).not.toContain("prolific");
  });

  it("awards prolific at 10 uploads", () => {
    expect(earnedBadgeKeys({ ...ZERO, publishedUploads: 10 })).toContain("prolific");
  });

  it("awards popular at 100 downloads received", () => {
    expect(earnedBadgeKeys({ ...ZERO, downloadsReceived: 100 })).toContain("popular");
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `corepack pnpm --filter @workspace/api-server exec vitest run src/lib/reputation.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `reputation.ts`:**

```ts
/**
 * Reputation scoring config — pure, no DB. Weights, level thresholds, and the
 * badge catalog all read a single `ReputationStats` shape that the repo
 * computes from current state. Tune weights here; nothing else changes.
 */

export interface ReputationStats {
  publishedUploads: number;   // alive & published docs you uploaded
  downloadsReceived: number;  // downloads of your docs (excl. self)
  favoritesReceived: number;  // favorites of your docs (excl. self)
  publicCollections: number;  // your public/official, non-hidden collections
  followersReceived: number;  // followers across your collections
  comments: number;           // your alive comments
  reactionsReceived: number;  // reactions on your comments (excl. self)
  requests: number;           // your alive material requests
}

export const WEIGHTS = {
  publishedUploads: 10,
  downloadsReceived: 2,
  favoritesReceived: 3,
  publicCollections: 5,
  followersReceived: 2,
  comments: 2,
  reactionsReceived: 1,
  requests: 1,
} as const satisfies Record<keyof ReputationStats, number>;

export function scoreFromStats(s: ReputationStats): number {
  return (Object.keys(WEIGHTS) as (keyof ReputationStats)[]).reduce(
    (sum, k) => sum + s[k] * WEIGHTS[k],
    0,
  );
}

export interface Level {
  key: "novice" | "contributor" | "scholar" | "sage";
  label: string;
  minScore: number;
}

// Ordered low→high. levelForScore picks the highest whose minScore <= score.
export const LEVELS: Level[] = [
  { key: "novice", label: "Novice", minScore: 0 },
  { key: "contributor", label: "Contributor", minScore: 50 },
  { key: "scholar", label: "Scholar", minScore: 250 },
  { key: "sage", label: "Sage", minScore: 1000 },
];

export function levelForScore(score: number): Level {
  let current = LEVELS[0];
  for (const l of LEVELS) if (score >= l.minScore) current = l;
  return current;
}

export interface BadgeDef {
  key: string;
  name: string;
  description: string;
  icon: string; // lucide icon name for the web layer
  earned: (s: ReputationStats) => boolean;
}

export const BADGES: BadgeDef[] = [
  { key: "first_upload", name: "First Upload", description: "Shared your first document.", icon: "Upload", earned: (s) => s.publishedUploads >= 1 },
  { key: "prolific", name: "Prolific", description: "Uploaded 10 documents.", icon: "Files", earned: (s) => s.publishedUploads >= 10 },
  { key: "librarian", name: "Librarian", description: "Uploaded 50 documents.", icon: "Library", earned: (s) => s.publishedUploads >= 50 },
  { key: "popular", name: "Popular", description: "Your documents were downloaded 100 times.", icon: "Download", earned: (s) => s.downloadsReceived >= 100 },
  { key: "crowd_favorite", name: "Crowd Favorite", description: "Earned 50 favorites.", icon: "Star", earned: (s) => s.favoritesReceived >= 50 },
  { key: "trusted", name: "Trusted", description: "Reached Scholar level.", icon: "ShieldCheck", earned: (s) => scoreFromStats(s) >= 250 },
  { key: "conversationalist", name: "Conversationalist", description: "Posted 10 comments.", icon: "MessageSquare", earned: (s) => s.comments >= 10 },
  { key: "helpful", name: "Helpful", description: "Got 25 reactions on your comments.", icon: "ThumbsUp", earned: (s) => s.reactionsReceived >= 25 },
  { key: "curator", name: "Curator", description: "Created 3 public collections.", icon: "FolderHeart", earned: (s) => s.publicCollections >= 3 },
];

export function earnedBadgeKeys(s: ReputationStats): string[] {
  return BADGES.filter((b) => b.earned(s)).map((b) => b.key);
}
```

- [ ] **Step 4: Run to verify it passes.**

Run: `corepack pnpm --filter @workspace/api-server exec vitest run src/lib/reputation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add artifacts/api-server/src/lib/reputation.ts artifacts/api-server/src/lib/reputation.test.ts
git commit -m "feat(api): reputation weights, levels, and badge catalog"
```

---

## Task 3: Reputation repo — derived SQL (TDD, real DB)

**Files:**
- Create: `artifacts/api-server/src/repositories/reputation.repo.ts`
- Test: `artifacts/api-server/src/repositories/reputation.repo.test.ts`

Functions: `computeStatsForUsers(userIds: string[]): Promise<Map<string, ReputationStats>>`, `computeUserStats(userId): Promise<ReputationStats>` (thin wrapper), and `fetchLeaderboard({ window, limit })` returning ranked rows with the raw stat columns (the service turns stats→score so the formula stays in one place).

- [ ] **Step 1: Write the failing test.** Build a user with one published doc, one download by *another* user (audit row), one favorite by another user; assert the stats. Also build a second user with no activity and assert zero. (Use real DB; clean up in `afterAll`.)

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import { computeStatsForUsers } from "./reputation.repo";

const SX = `_rep_${Date.now().toString(36)}`;
let authorId: string;
let otherId: string;
let docId: string;

beforeAll(async () => {
  const author = await db.user.create({ data: { email: `a${SX}@demo`, passwordHash: "x", displayName: `A${SX}` } });
  const other = await db.user.create({ data: { email: `o${SX}@demo`, passwordHash: "x", displayName: `O${SX}` } });
  authorId = author.id;
  otherId = other.id;
  const doc = await db.document.create({
    data: { title: `D${SX}`, uploaderId: authorId, ownerId: authorId, createdById: authorId,
            status: "published", favoriteCount: 1 },
  });
  docId = doc.id;
  // A download by the OTHER user (counts) — mirror analytics.repo's audit shape.
  await db.auditLog.create({
    data: { userId: otherId, action: "document.download", entityType: "document", entityId: docId },
  });
  // A self-download (must NOT count).
  await db.auditLog.create({
    data: { userId: authorId, action: "document.download", entityType: "document", entityId: docId },
  });
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { entityId: docId } });
  await db.document.deleteMany({ where: { id: docId } });
  await db.user.deleteMany({ where: { id: { in: [authorId, otherId] } } });
});

describe("computeStatsForUsers", () => {
  it("counts published uploads, foreign downloads, favorites; excludes self-downloads", async () => {
    const map = await computeStatsForUsers([authorId, otherId]);
    const a = map.get(authorId)!;
    expect(a.publishedUploads).toBe(1);
    expect(a.downloadsReceived).toBe(1); // self-download excluded
    expect(a.favoritesReceived).toBe(1);
    const o = map.get(otherId)!;
    expect(o.publishedUploads).toBe(0);
  });
});
```

> **Implementer note:** confirm the exact Prisma field names for the audit model (`db.auditLog` create) and the `Document` required fields (`ownerId`/`createdById`) against the current schema before running — adjust the fixture if names differ. The query logic below is the contract; the fixture just feeds it.

- [ ] **Step 2: Run to verify it fails.**

Run: `corepack pnpm --filter @workspace/api-server exec vitest run src/repositories/reputation.repo.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `reputation.repo.ts`.** One batched query per stat, each grouped by the owning user and filtered to the requested id set, assembled into a `Map`. Each query counts only alive/published content and excludes self-engagement.

```ts
import { db } from "@workspace/db";
import type { ReputationStats } from "../lib/reputation";

const EMPTY = (): ReputationStats => ({
  publishedUploads: 0, downloadsReceived: 0, favoritesReceived: 0,
  publicCollections: 0, followersReceived: 0, comments: 0,
  reactionsReceived: 0, requests: 0,
});

export async function computeStatsForUsers(
  userIds: string[],
): Promise<Map<string, ReputationStats>> {
  const out = new Map<string, ReputationStats>();
  if (userIds.length === 0) return out;
  for (const id of userIds) out.set(id, EMPTY());

  // published uploads + favorites received (favorite_count is self-excluded at source)
  const docRows = await db.$queryRaw<Array<{ user_id: string; uploads: bigint; favs: bigint }>>`
    SELECT uploader_id::text AS user_id,
           COUNT(*)::bigint AS uploads,
           COALESCE(SUM(favorite_count), 0)::bigint AS favs
    FROM documents
    WHERE deleted_at IS NULL AND status = 'published'
      AND uploader_id = ANY(${userIds}::uuid[])
    GROUP BY uploader_id`;
  for (const r of docRows) {
    const s = out.get(r.user_id)!;
    s.publishedUploads = Number(r.uploads);
    s.favoritesReceived = Number(r.favs);
  }

  // downloads received on your alive docs, excluding self-downloads
  const dlRows = await db.$queryRaw<Array<{ user_id: string; downloads: bigint }>>`
    SELECT d.uploader_id::text AS user_id, COUNT(*)::bigint AS downloads
    FROM audit_logs a
    JOIN documents d ON d.id::text = a.entity_id
    WHERE a.action = 'document.download' AND a.entity_type = 'document'
      AND d.deleted_at IS NULL AND d.status = 'published'
      AND a.user_id <> d.uploader_id
      AND d.uploader_id = ANY(${userIds}::uuid[])
    GROUP BY d.uploader_id`;
  for (const r of dlRows) out.get(r.user_id)!.downloadsReceived = Number(r.downloads);

  // public/official non-hidden collections + followers
  const colRows = await db.$queryRaw<Array<{ user_id: string; cols: bigint; followers: bigint }>>`
    SELECT owner_id::text AS user_id,
           COUNT(*)::bigint AS cols,
           COALESCE(SUM(follower_count), 0)::bigint AS followers
    FROM study_collections
    WHERE deleted_at IS NULL AND hidden_at IS NULL
      AND (visibility = 'public' OR is_official = true)
      AND owner_id = ANY(${userIds}::uuid[])
    GROUP BY owner_id`;
  for (const r of colRows) {
    const s = out.get(r.user_id)!;
    s.publicCollections = Number(r.cols);
    s.followersReceived = Number(r.followers);
  }

  // comments authored (alive)
  const cmtRows = await db.$queryRaw<Array<{ user_id: string; comments: bigint }>>`
    SELECT author_id::text AS user_id, COUNT(*)::bigint AS comments
    FROM comments
    WHERE deleted_at IS NULL AND author_id = ANY(${userIds}::uuid[])
    GROUP BY author_id`;
  for (const r of cmtRows) out.get(r.user_id)!.comments = Number(r.comments);

  // reactions received on your comments, excluding self-reactions
  const reactRows = await db.$queryRaw<Array<{ user_id: string; reactions: bigint }>>`
    SELECT c.author_id::text AS user_id, COUNT(*)::bigint AS reactions
    FROM comment_reactions r
    JOIN comments c ON c.id = r.comment_id
    WHERE c.deleted_at IS NULL AND r.user_id <> c.author_id
      AND c.author_id = ANY(${userIds}::uuid[])
    GROUP BY c.author_id`;
  for (const r of reactRows) out.get(r.user_id)!.reactionsReceived = Number(r.reactions);

  // material requests authored (alive)
  const reqRows = await db.$queryRaw<Array<{ user_id: string; requests: bigint }>>`
    SELECT user_id::text AS user_id, COUNT(*)::bigint AS requests
    FROM material_requests
    WHERE deleted_at IS NULL AND user_id = ANY(${userIds}::uuid[])
    GROUP BY user_id`;
  for (const r of reqRows) out.get(r.user_id)!.requests = Number(r.requests);

  return out;
}

export async function computeUserStats(userId: string): Promise<ReputationStats> {
  return (await computeStatsForUsers([userId])).get(userId)!;
}

/** Active, non-deleted users ordered by derived score. Returns stats; the
 *  service computes the score so the formula stays in one place. */
export async function fetchLeaderboardCandidates(
  window: "all" | "month",
): Promise<Array<{ userId: string; displayName: string; username: string | null; hasAvatar: boolean }>> {
  // Candidate set = users with ANY scoring activity, gated to ACTIVE/non-deleted.
  const rows = await db.$queryRaw<
    Array<{ user_id: string; display_name: string; username: string | null; has_avatar: boolean }>
  >`
    SELECT u.id::text AS user_id, u.display_name, u.username,
           (u.avatar_storage_path IS NOT NULL) AS has_avatar
    FROM users u
    WHERE u.status = 'ACTIVE' AND u.deleted_at IS NULL AND u.anonymized_at IS NULL
      AND EXISTS (SELECT 1 FROM documents d WHERE d.uploader_id = u.id AND d.deleted_at IS NULL AND d.status = 'published')
  `;
  // window filtering of stats is applied by the service via computeStatsForUsers
  // over this candidate set (month = trailing 30d variant — see Task 4 note).
  return rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    username: r.username,
    hasAvatar: r.has_avatar,
  }));
}
```

> **Scope note for `month` window:** v1 ships the **all-time** leaderboard fully. For `window=month`, add a `sinceDays` param to `computeStatsForUsers` that wraps each count in `AND <timestamp_col> >= now() - interval '30 days'` (downloads use `a.created_at`, uploads/comments/requests use `created_at`, favorites/followers fall back to all-time since they have no per-event timestamp here — document this limitation in the endpoint response). If month-windowing risks scope creep, ship all-time only and stub `month` to return all-time with a flag; do NOT block the feature on it.

- [ ] **Step 4: Run to verify it passes.**

Run: `corepack pnpm --filter @workspace/api-server exec vitest run src/repositories/reputation.repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add artifacts/api-server/src/repositories/reputation.repo.ts artifacts/api-server/src/repositories/reputation.repo.test.ts
git commit -m "feat(api): derived reputation stat queries"
```

---

## Task 4: Reputation service — score, badges, leaderboard, cache (TDD)

**Files:**
- Create: `artifacts/api-server/src/services/reputation.service.ts`
- Test: `artifacts/api-server/src/services/reputation.service.test.ts`

Responsibilities: `getUserReputation(userId)` → `{ score, level, stats, badges, nextBadges }`; `evaluateBadges(userId)` → idempotently inserts newly-earned badge rows (skipDuplicates); `getLeaderboard({ window, limit })` → ranked DTOs, cached via a local `memoize` copied from `analytics.service.ts`; `reputationForUsers(userIds)` → `Map<id,{score,level,topBadge}>` for author chips (batched). Plus `_resetCacheForTests()`.

- [ ] **Step 1: Write the failing test** — focus on badge idempotency + permanence and score assembly:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import { evaluateBadges, getUserReputation } from "./reputation.service";

const SX = `_repsvc_${Date.now().toString(36)}`;
let userId: string;

beforeAll(async () => {
  const u = await db.user.create({ data: { email: `u${SX}@demo`, passwordHash: "x", displayName: `U${SX}` } });
  userId = u.id;
  await db.document.create({ data: { title: `D${SX}`, uploaderId: userId, ownerId: userId, createdById: userId, status: "published" } });
});

afterAll(async () => {
  await db.userBadge.deleteMany({ where: { userId } });
  await db.document.deleteMany({ where: { uploaderId: userId } });
  await db.user.deleteMany({ where: { id: userId } });
});

describe("evaluateBadges", () => {
  it("awards first_upload and is idempotent across repeated calls", async () => {
    await evaluateBadges(userId);
    await evaluateBadges(userId);
    const keys = (await db.userBadge.findMany({ where: { userId } })).map((b) => b.badgeKey);
    expect(keys).toContain("first_upload");
    expect(keys.filter((k) => k === "first_upload")).toHaveLength(1);
  });

  it("keeps an earned badge even after the qualifying content is gone (permanence)", async () => {
    await evaluateBadges(userId);
    await db.document.deleteMany({ where: { uploaderId: userId } });
    await evaluateBadges(userId); // re-eval: won't re-add, must not remove
    const keys = (await db.userBadge.findMany({ where: { userId } })).map((b) => b.badgeKey);
    expect(keys).toContain("first_upload");
  });
});

describe("getUserReputation", () => {
  it("returns score, level, and earned badges", async () => {
    const rep = await getUserReputation(userId);
    expect(rep.score).toBeGreaterThanOrEqual(0);
    expect(rep.level.key).toBeDefined();
    expect(Array.isArray(rep.badges)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `corepack pnpm --filter @workspace/api-server exec vitest run src/services/reputation.service.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `reputation.service.ts`:**

```ts
import { db } from "@workspace/db";
import * as repo from "../repositories/reputation.repo";
import {
  scoreFromStats, levelForScore, earnedBadgeKeys, BADGES,
  type ReputationStats, type Level,
} from "../lib/reputation";

const DEFAULT_TTL_MS = 60_000;
interface CacheEntry<T> { expiresAt: number; value: T; }
const cache = new Map<string, CacheEntry<unknown>>();
async function memoize<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;
  const value = await load();
  cache.set(key, { expiresAt: now + ttlMs, value });
  return value;
}
export function _resetCacheForTests(): void { cache.clear(); }

export interface BadgeView { key: string; name: string; description: string; icon: string; }
export interface UserReputation {
  userId: string;
  score: number;
  level: Level;
  stats: ReputationStats;
  badges: BadgeView[];
  nextBadges: BadgeView[];
}

function badgeView(key: string): BadgeView {
  const b = BADGES.find((x) => x.key === key)!;
  return { key: b.key, name: b.name, description: b.description, icon: b.icon };
}

export async function getUserReputation(userId: string): Promise<UserReputation> {
  const stats = await repo.computeUserStats(userId);
  const earned = earnedBadgeKeys(stats);
  return {
    userId,
    score: scoreFromStats(stats),
    level: levelForScore(scoreFromStats(stats)),
    stats,
    badges: earned.map(badgeView),
    nextBadges: BADGES.filter((b) => !earned.includes(b.key)).map((b) => badgeView(b.key)),
  };
}

/** Insert any newly-earned badges; never deletes. Idempotent via the unique
 *  (user_id, badge_key) index + skipDuplicates. */
export async function evaluateBadges(userId: string): Promise<void> {
  const stats = await repo.computeUserStats(userId);
  const keys = earnedBadgeKeys(stats);
  if (keys.length === 0) return;
  await db.userBadge.createMany({
    data: keys.map((badgeKey) => ({ userId, badgeKey })),
    skipDuplicates: true,
  });
}

export interface LeaderboardRow {
  rank: number;
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  score: number;
  level: Level;
  topBadges: BadgeView[];
}

export async function getLeaderboard(
  opts: { window?: "all" | "month"; limit?: number; ttlMs?: number } = {},
): Promise<{ rows: LeaderboardRow[]; window: "all" | "month"; generatedAt: string }> {
  const window = opts.window ?? "all";
  const limit = opts.limit ?? 50;
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  return memoize(`lb:${window}:${limit}`, ttlMs, async () => {
    const candidates = await repo.fetchLeaderboardCandidates(window);
    const statsMap = await repo.computeStatsForUsers(candidates.map((c) => c.userId));
    const earnedMap = new Map(
      (await db.userBadge.findMany({ where: { userId: { in: candidates.map((c) => c.userId) } } }))
        .reduce((m, b) => { (m.get(b.userId) ?? m.set(b.userId, []).get(b.userId)!).push(b.badgeKey); return m; },
                new Map<string, string[]>()),
    );
    const scored = candidates.map((c) => {
      const stats = statsMap.get(c.userId)!;
      const score = scoreFromStats(stats);
      const earned = earnedMap.get(c.userId) ?? [];
      return {
        userId: c.userId, displayName: c.displayName, username: c.username,
        avatarUrl: c.hasAvatar ? `/api/users/${c.userId}/avatar` : null,
        score, level: levelForScore(score),
        topBadges: earned.slice(0, 3).map(badgeView),
      };
    });
    scored.sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));
    const rows: LeaderboardRow[] = scored.slice(0, limit).map((r, i) => ({ rank: i + 1, ...r }));
    return { rows, window, generatedAt: new Date().toISOString() };
  });
}

/** Batched reputation for author-credibility chips (no N+1). */
export async function reputationForUsers(
  userIds: string[],
): Promise<Map<string, { score: number; level: Level; topBadge: BadgeView | null }>> {
  const out = new Map<string, { score: number; level: Level; topBadge: BadgeView | null }>();
  if (userIds.length === 0) return out;
  const statsMap = await repo.computeStatsForUsers(userIds);
  const badges = await db.userBadge.findMany({ where: { userId: { in: userIds } }, orderBy: { awardedAt: "asc" } });
  const firstBadge = new Map<string, string>();
  for (const b of badges) if (!firstBadge.has(b.userId)) firstBadge.set(b.userId, b.badgeKey);
  for (const id of userIds) {
    const stats = statsMap.get(id) ?? null;
    const score = stats ? scoreFromStats(stats) : 0;
    const bk = firstBadge.get(id);
    out.set(id, { score, level: levelForScore(score), topBadge: bk ? badgeView(bk) : null });
  }
  return out;
}
```

> **Note:** the `earnedMap` reduce above is terse; if the implementer finds it hard to read, replace with a plain loop building `Map<string,string[]>`. Behavior: group badge keys by user.

- [ ] **Step 4: Run to verify it passes.**

Run: `corepack pnpm --filter @workspace/api-server exec vitest run src/services/reputation.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit.**

```bash
corepack pnpm run typecheck
git add artifacts/api-server/src/services/reputation.service.ts artifacts/api-server/src/services/reputation.service.test.ts
git commit -m "feat(api): reputation service — score, badges, leaderboard, batch chips"
```

---

## Task 5: Endpoints + OpenAPI + client regen

**Files:**
- Create: `artifacts/api-server/src/routes/leaderboard.ts`
- Modify: the app router registration (find where `routes/collections.ts` is mounted — likely `artifacts/api-server/src/app.ts` or a routes index — and mount the new router the same way)
- Modify: the OpenAPI source spec (find it via `lib/api-spec` — likely a TS or YAML builder) to add the two paths + schemas
- Regenerate: `@workspace/api-spec` build, then orval client in `lib/api-client-react`

- [ ] **Step 1: Implement the route** (`routes/leaderboard.ts`) following the existing route style (look at `routes/collections.ts` for the router/handler/`asyncHandler` and auth-middleware conventions, and copy them):

```ts
import { Router } from "express";
import * as reputation from "../services/reputation.service";
// import the same auth middleware + asyncHandler helper that routes/collections.ts uses

export const leaderboardRouter = Router();

// GET /leaderboard?window=all|month&limit=50
leaderboardRouter.get("/leaderboard", /* requireAuth, */ async (req, res) => {
  const window = req.query.window === "month" ? "month" : "all";
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  res.json(await reputation.getLeaderboard({ window, limit }));
});

// GET /users/:id/reputation
leaderboardRouter.get("/users/:id/reputation", /* requireAuth, */ async (req, res) => {
  res.json(await reputation.getUserReputation(req.params.id));
});
```

> **Implementer:** match the EXACT middleware/error-handling pattern of `routes/collections.ts` (e.g. `asyncHandler`, `requireAuth`). Do not invent a new pattern.

- [ ] **Step 2: Mount the router** where other routers are mounted (same file/line region as `collectionsRouter`). Verify by grepping for how `collections` router is imported and `app.use(...)`-ed, and mirror it.

- [ ] **Step 3: Add the paths + response schemas to the OpenAPI source** so the generated client gets typed hooks (`useGetLeaderboard`, `useGetUserReputation` or similar). Mirror an existing GET endpoint's schema definition in `lib/api-spec`.

- [ ] **Step 4: Regenerate the spec + client.**

Run (confirm exact script names first): `corepack pnpm --filter @workspace/api-spec run build` then the orval generate script in `lib/api-client-react`.
Expected: new hooks appear under `lib/api-client-react/src/generated`.

- [ ] **Step 5: Write a route smoke test** mirroring an existing route test (supertest or the project's harness — check how `routes/*.test.ts` are written) asserting `GET /api/leaderboard` returns 200 with `{ rows: [...] }`. Run it.

- [ ] **Step 6: Typecheck + commit.**

```bash
corepack pnpm run typecheck
git add artifacts/api-server/src lib/api-spec lib/api-client-react
git commit -m "feat(api): leaderboard + user reputation endpoints"
```

---

## Task 6: Badge-evaluation hooks

**Files (modify — confirm exact paths by grepping):**
- `artifacts/api-server/src/services/favorites.service.ts` — after a favorite is added, `await reputation.evaluateBadges(<document owner id>)` (best-effort; wrap in try/catch so it never breaks the favorite).
- The download path (grep `document.download` audit emit — likely `documents.service.ts` `streamDownload`) — after recording a download, evaluate the document owner.
- The comments service (`comment.create`) — evaluate the comment author.
- Upload completion (where a document becomes `published`) — evaluate the uploader.

- [ ] **Step 1:** For each hook site, import the service and add a non-blocking call:

```ts
import * as reputation from "./reputation.service";
// ...after the existing side effects, best-effort:
void reputation.evaluateBadges(ownerOrAuthorUserId).catch(() => { /* badges are non-critical */ });
```

- [ ] **Step 2:** Add/extend a test per hook OR one integration test: create a user, perform the action via the service, assert a `user_badges` row appears. Run the affected package tests.

Run: `corepack pnpm --filter @workspace/api-server exec vitest run`
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add artifacts/api-server/src/services
git commit -m "feat(api): award badges on upload/download/favorite/comment"
```

---

## Task 7: Author credibility in document & comment DTOs

**Files (modify — confirm exact assembly functions):**
- Document list/detail DTO assembly (grep for where the `author`/`uploader` object is built — likely `documents.service.ts` `assembleDocuments`).
- Comment DTO assembly.

- [ ] **Step 1:** In each list-assembly function, after collecting the rows, gather the distinct author/uploader ids, call `reputation.reputationForUsers(ids)` ONCE, and attach `{ reputationScore, level, topBadge }` to each author object. Add the fields to the DTO type + OpenAPI schema, regenerate client.

```ts
const repMap = await reputation.reputationForUsers(distinctAuthorIds);
// when building each item:
author: { ...authorBase, reputation: repMap.get(authorId) ?? null },
```

- [ ] **Step 2:** Extend an existing assembly test to assert the `reputation` field is present and batched (one call). Run the package tests.

- [ ] **Step 3: Typecheck, regen client, commit.**

```bash
corepack pnpm run typecheck
git add artifacts/api-server/src lib/api-spec lib/api-client-react
git commit -m "feat(api): expose author reputation on documents and comments"
```

---

## Task 8: Expose reputation on current-user / profile

**Files:**
- Modify: `artifacts/api-server/src/lib/current-user-dto.ts` (and/or `profile.service.ts`)

- [ ] **Step 1:** Add reputation to the profile response. Because `currentUserDto` is sync, expose reputation through the profile *service* path (which is async) rather than bloating `currentUserDto`; add a `reputation` block (`score`, `level`, `badges`) to the profile/`GET /users/:id` response via `getUserReputation`. Update the OpenAPI schema, regenerate client.

- [ ] **Step 2:** Test: profile endpoint returns a `reputation` object. Run.

- [ ] **Step 3: Commit.**

```bash
git add artifacts/api-server/src lib/api-spec lib/api-client-react
git commit -m "feat(api): include reputation in profile response"
```

---

## Task 9: Web — reusable reputation components

**Files:**
- Create: `artifacts/web/src/components/reputation/BadgeChip.tsx`, `ReputationBadge.tsx`, `BadgeShelf.tsx`

Follow existing component conventions (Radix + Tailwind + the green design tokens; see `components/collections/CollectionCard.tsx` and the existing `Badge`/`Tooltip` UI primitives).

- [ ] **Step 1: `BadgeChip.tsx`** — renders one badge: a lucide icon (map `icon` string → component), name, and a tooltip with the description. Greyed variant for locked badges (`earned?: boolean`, default true) with optional progress text.

- [ ] **Step 2: `ReputationBadge.tsx`** — compact inline chip showing the level label + score (+ optional top badge icon), for use next to author names. Small + subtle.

- [ ] **Step 3: `BadgeShelf.tsx`** — grid of `BadgeChip`s: earned bright, locked greyed; takes `earned: BadgeView[]` and `locked: BadgeView[]`.

- [ ] **Step 4:** Web typecheck.

Run: `corepack pnpm --filter @workspace/web run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add artifacts/web/src/components/reputation
git commit -m "feat(web): reputation badge + level UI components"
```

---

## Task 10: Web — leaderboard page + nav

**Files:**
- Create: `artifacts/web/src/pages/leaderboard.tsx`
- Modify: the router (where `wouter` routes are declared — mirror an existing page route) and the nav "More" dropdown (per the post-Phase-9 nav rework).

- [ ] **Step 1:** Build the page: use the generated `useGetLeaderboard` hook; **All-time / This month** tabs (Radix Tabs, as used elsewhere); a top-3 podium and a ranked table/list showing rank, avatar, name, level (`ReputationBadge`), score, and top badges. Loading skeletons + empty state, matching existing pages.

- [ ] **Step 2:** Register `/leaderboard` in the router and add a "Leaderboard" item to the "More" dropdown (and the mobile sheet).

- [ ] **Step 3:** Web typecheck. Run: `corepack pnpm --filter @workspace/web run typecheck` → PASS.

- [ ] **Step 4: Commit.**

```bash
git add artifacts/web/src
git commit -m "feat(web): contributor leaderboard page + nav entry"
```

---

## Task 11: Web — profile reputation + badge shelf

**Files:**
- Modify: `artifacts/web/src/pages/profile.tsx`

- [ ] **Step 1:** On the profile page, render the user's score + level (`ReputationBadge` large), their rank if available, and a `BadgeShelf` (earned + locked-with-progress) using the profile endpoint's new `reputation` block.

- [ ] **Step 2:** Web typecheck → PASS.

- [ ] **Step 3: Commit.**

```bash
git add artifacts/web/src/pages/profile.tsx
git commit -m "feat(web): reputation + badges on profile"
```

---

## Task 12: Web — home widget + author chips

**Files:**
- Create: `artifacts/web/src/components/reputation/ReputationHomeWidget.tsx`
- Modify: `artifacts/web/src/pages/home.tsx`; document card + document-detail author area; comment author area.

- [ ] **Step 1:** Home widget — a compact "Your reputation" card (score, level, next badge progress) + a small "Top contributors" list (top 3 from the leaderboard hook). Add to `home.tsx` reusing the existing widget layout.

- [ ] **Step 2:** Add `ReputationBadge` next to the uploader name on document cards + document detail, and next to comment authors, reading the `author.reputation` field added in Task 7. Keep it subtle so it doesn't crowd the cards (per the restrained Phase-9 polish ethos).

- [ ] **Step 3:** Web typecheck → PASS.

- [ ] **Step 4: Commit.**

```bash
git add artifacts/web/src
git commit -m "feat(web): home reputation widget + author credibility chips"
```

---

## Task 13: Seed showcase + one-time badge backfill

**Files:**
- Create: `artifacts/api-server/src/scripts/backfill-badges.ts`
- Modify: `artifacts/api-server/src/scripts/seed-demo.ts`

- [ ] **Step 1: Backfill script** — iterate all `ACTIVE` user ids, call `evaluateBadges(id)` for each (batched in chunks). This grants historical achievements. Make it runnable via a package script and (optionally) invoked at the end of the seed.

```ts
import { db } from "@workspace/db";
import { evaluateBadges } from "../services/reputation.service";

export async function backfillBadges(): Promise<number> {
  const users = await db.user.findMany({ where: { status: "ACTIVE", deletedAt: null }, select: { id: true } });
  for (const u of users) await evaluateBadges(u.id);
  return users.length;
}

// allow `tsx backfill-badges.ts` direct run
if (import.meta.url === `file://${process.argv[1]}`) {
  backfillBadges().then((n) => { console.log(`Backfilled badges for ${n} users`); process.exit(0); });
}
```

- [ ] **Step 2:** In `seed-demo.ts`, after data is seeded, call `backfillBadges()` so the demo shows varied scores + badges (the seed already creates uploads/favorites/collections/official paths, which now produce reputation automatically — no extra fixtures needed).

- [ ] **Step 3:** Run the seed verify (`seed:demo:verify`) and confirm it still passes; spot-check the leaderboard endpoint returns ranked users.

- [ ] **Step 4: Commit.**

```bash
git add artifacts/api-server/src/scripts
git commit -m "feat(api): badge backfill + reputation in demo seed"
```

---

## Task 14: Final validation

- [ ] **Step 1:** Full typecheck. Run: `corepack pnpm run typecheck` → PASS (all packages).
- [ ] **Step 2:** Full API test suite. Run: `corepack pnpm --filter @workspace/api-server exec vitest run` → all green.
- [ ] **Step 3:** Web typecheck. Run: `corepack pnpm --filter @workspace/web run typecheck` → PASS.
- [ ] **Step 4:** Manual UI check — leaderboard ranks users, profile shows badges, author chips render, home widget shows your score.
- [ ] **Step 5:** Confirm the CI typecheck gate (`cloudbuild.yaml` + GitHub Actions) will pass by running `pnpm run typecheck` once more clean.
- [ ] **Step 6: Final commit** (if anything pending) and push the branch for a PR (do NOT merge to main without review — main auto-deploys).

---

## Notes / deferred (from spec)

- `month` leaderboard window: ship all-time fully; month is best-effort (see Task 3 note). Don't block on it.
- Optional cached `reputation_score` column on `users`: out of scope for v1; only add if author-chip read latency becomes a problem.
- Badge revocation on moderation, streak badges, and badge-earn notifications: deferred.
