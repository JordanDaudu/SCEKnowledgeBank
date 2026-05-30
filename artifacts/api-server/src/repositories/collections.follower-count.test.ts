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
