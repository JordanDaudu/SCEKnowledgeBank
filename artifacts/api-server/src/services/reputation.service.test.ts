import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import {
  evaluateBadges,
  getUserReputation,
  getLeaderboard,
  reputationForUsers,
  _resetCacheForTests,
} from "./reputation.service";

const SX = `_repsvc_${Date.now().toString(36)}`;
let userId: string;

beforeAll(async () => {
  const u = await db.user.create({
    data: { email: `u${SX}@demo`, passwordHash: "x", displayName: `U${SX}` },
  });
  userId = u.id;
  await db.document.create({
    data: { title: `D${SX}`, uploaderId: userId, ownerId: userId, status: "published" },
  });
  _resetCacheForTests();
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
  it("returns score, level, and badge arrays", async () => {
    const rep = await getUserReputation(userId);
    expect(rep.score).toBeGreaterThanOrEqual(0);
    expect(rep.level.key).toBeDefined();
    expect(Array.isArray(rep.badges)).toBe(true);
    expect(Array.isArray(rep.nextBadges)).toBe(true);
  });
});

describe("reputationForUsers", () => {
  it("returns a batched map keyed by user id", async () => {
    const map = await reputationForUsers([userId]);
    expect(map.get(userId)).toBeDefined();
    expect(map.get(userId)!.level.key).toBeDefined();
  });

  it("returns an empty map for no ids", async () => {
    expect((await reputationForUsers([])).size).toBe(0);
  });
});

describe("getLeaderboard", () => {
  it("returns ranked rows with sequential ranks", async () => {
    _resetCacheForTests();
    const lb = await getLeaderboard({ limit: 50 });
    expect(Array.isArray(lb.rows)).toBe(true);
    lb.rows.forEach((r, i) => expect(r.rank).toBe(i + 1));
  });
});
