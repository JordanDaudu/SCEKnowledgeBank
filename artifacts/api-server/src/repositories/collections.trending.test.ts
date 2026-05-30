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
    expect(ids).not.toContain(coldId);
    expect(ids).not.toContain(staleId);
  });
});
