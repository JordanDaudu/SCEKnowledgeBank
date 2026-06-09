/**
 * Reputation service — turns derived stats (reputation.repo) into scores,
 * levels, and badge views; awards badges idempotently; and builds the cached
 * leaderboard. The scoring formula lives entirely in `lib/reputation.ts`; this
 * layer only orchestrates and caches.
 *
 * The in-memory TTL cache mirrors analytics.service: process-local, slightly
 * stale is fine (worst case a ~60s-old leaderboard).
 */
import { db } from "@workspace/db";
import * as repo from "../repositories/reputation.repo";
import {
  scoreFromStats,
  levelForScore,
  earnedBadgeKeys,
  BADGES,
  type ReputationStats,
  type Level,
} from "../lib/reputation";

const DEFAULT_TTL_MS = 60_000;

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}
const cache = new Map<string, CacheEntry<unknown>>();

async function memoize<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;
  const value = await load();
  cache.set(key, { expiresAt: now + ttlMs, value });
  return value;
}

/** Test helper — clears the in-memory cache between cases. */
export function _resetCacheForTests(): void {
  cache.clear();
}

export interface BadgeView {
  key: string;
  name: string;
  description: string;
  icon: string;
}

function badgeView(key: string): BadgeView {
  const b = BADGES.find((x) => x.key === key)!;
  return { key: b.key, name: b.name, description: b.description, icon: b.icon };
}

export interface UserReputation {
  userId: string;
  score: number;
  level: Level;
  stats: ReputationStats;
  badges: BadgeView[];
  nextBadges: BadgeView[];
}

export async function getUserReputation(userId: string): Promise<UserReputation> {
  const stats = await repo.computeUserStats(userId);
  const score = scoreFromStats(stats);
  const earned = earnedBadgeKeys(stats);
  return {
    userId,
    score,
    level: levelForScore(score),
    stats,
    badges: earned.map(badgeView),
    nextBadges: BADGES.filter((b) => !earned.includes(b.key)).map((b) => badgeView(b.key)),
  };
}

/**
 * Insert any newly-earned badges for a user. Never deletes — badges are
 * permanent once earned. Idempotent via the unique (user_id, badge_key) index
 * + skipDuplicates, so it is safe to call repeatedly from event hooks.
 */
export async function evaluateBadges(userId: string): Promise<void> {
  const stats = await repo.computeUserStats(userId);
  const keys = earnedBadgeKeys(stats);
  if (keys.length === 0) return;
  await db.userBadge.createMany({
    data: keys.map((badgeKey) => ({ userId, badgeKey })),
    skipDuplicates: true,
  });
}

/** Group earned badge keys by user id. */
async function earnedBadgesByUser(userIds: string[]): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>();
  if (userIds.length === 0) return grouped;
  const rows = await db.userBadge.findMany({
    where: { userId: { in: userIds } },
    orderBy: { awardedAt: "asc" },
  });
  for (const b of rows) {
    const list = grouped.get(b.userId) ?? [];
    list.push(b.badgeKey);
    grouped.set(b.userId, list);
  }
  return grouped;
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

export interface Leaderboard {
  rows: LeaderboardRow[];
  generatedAt: string;
}

export async function getLeaderboard(
  opts: { limit?: number; ttlMs?: number } = {},
): Promise<Leaderboard> {
  const limit = Math.min(opts.limit ?? 50, 100);
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  return memoize(`lb:${limit}`, ttlMs, async () => {
    const candidates = await repo.fetchLeaderboardCandidates();
    const ids = candidates.map((c) => c.userId);
    const [statsMap, badgeMap] = await Promise.all([
      repo.computeStatsForUsers(ids),
      earnedBadgesByUser(ids),
    ]);
    const scored = candidates.map((c) => {
      const stats = statsMap.get(c.userId)!;
      const score = scoreFromStats(stats);
      const earned = badgeMap.get(c.userId) ?? [];
      return {
        userId: c.userId,
        displayName: c.displayName,
        username: c.username,
        avatarUrl: c.hasAvatar ? `/api/users/${c.userId}/avatar` : null,
        score,
        level: levelForScore(score),
        topBadges: earned.slice(0, 3).map(badgeView),
      };
    });
    scored.sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));
    const rows: LeaderboardRow[] = scored
      .slice(0, limit)
      .map((r, i) => ({ rank: i + 1, ...r }));
    return { rows, generatedAt: new Date().toISOString() };
  });
}

export interface AuthorReputation {
  score: number;
  level: Level;
  topBadge: BadgeView | null;
}

/**
 * Batched reputation for author-credibility chips (documents, comments).
 * One stats query + one badge query for the whole id set — no N+1.
 */
export async function reputationForUsers(
  userIds: string[],
): Promise<Map<string, AuthorReputation>> {
  const out = new Map<string, AuthorReputation>();
  if (userIds.length === 0) return out;
  const [statsMap, badgeMap] = await Promise.all([
    repo.computeStatsForUsers(userIds),
    earnedBadgesByUser(userIds),
  ]);
  for (const id of userIds) {
    const stats = statsMap.get(id) ?? null;
    const score = stats ? scoreFromStats(stats) : 0;
    const earned = badgeMap.get(id) ?? [];
    out.set(id, {
      score,
      level: levelForScore(score),
      topBadge: earned.length > 0 ? badgeView(earned[0]) : null,
    });
  }
  return out;
}
