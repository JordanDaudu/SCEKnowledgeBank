import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import { listDiscoverable } from "./collections.repo";
import * as engagementRepo from "./collection-engagement.repo";

const SX = `_disc_${Date.now().toString(36)}`;
let ownerId: string;
let calcId: string;
let physId: string;
let popularId: string;

beforeAll(async () => {
  ownerId = (await db.user.create({ data: { email: `o${SX}@demo`, passwordHash: "x", displayName: `O${SX}`, isActive: true } })).id;
  calcId = (await db.studyCollection.create({ data: { ownerId, title: `Calculus Final ${SX}`, description: "integrals and derivatives", visibility: "public" } })).id;
  physId = (await db.studyCollection.create({ data: { ownerId, title: `Physics ${SX}`, description: "mechanics", visibility: "public" } })).id;
  popularId = (await db.studyCollection.create({ data: { ownerId, title: `Misc ${SX}`, description: "stuff", visibility: "public" } })).id;
  await db.studyCollection.create({ data: { ownerId, title: `Private Calculus ${SX}`, visibility: "private" } });
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
    expect(rows.every((r) => r.visibility === "public" || r.isOfficial)).toBe(true);
  });

  it("popular (q-less) orders the high-engagement collection above a fresh empty one", async () => {
    const rows = await listDiscoverable({ sort: "popular", limit: 50 });
    const ids = rows.map((r) => r.id);
    expect(ids.indexOf(popularId)).toBeLessThan(ids.indexOf(physId));
  });
});
