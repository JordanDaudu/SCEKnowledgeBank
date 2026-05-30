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
