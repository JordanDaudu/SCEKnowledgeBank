import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import { computeStatsForUsers, fetchLeaderboardCandidates } from "./reputation.repo";

const SX = `_rep_${Date.now().toString(36)}`;
let authorId: string;
let otherId: string;
let docId: string;

beforeAll(async () => {
  const author = await db.user.create({
    data: { email: `a${SX}@demo`, passwordHash: "x", displayName: `A${SX}` },
  });
  const other = await db.user.create({
    data: { email: `o${SX}@demo`, passwordHash: "x", displayName: `O${SX}` },
  });
  authorId = author.id;
  otherId = other.id;

  const doc = await db.document.create({
    data: { title: `D${SX}`, uploaderId: authorId, ownerId: authorId, status: "published" },
  });
  docId = doc.id;

  // A favorite by the OTHER user — counts.
  await db.documentFavorite.create({ data: { userId: otherId, documentId: docId } });
  // A self-favorite — must NOT count.
  await db.documentFavorite.create({ data: { userId: authorId, documentId: docId } });

  // A download by the OTHER user (counts) and a self-download (excluded).
  await db.auditLog.create({
    data: { actorUserId: otherId, action: "document.download", entityType: "document", entityId: docId },
  });
  await db.auditLog.create({
    data: { actorUserId: authorId, action: "document.download", entityType: "document", entityId: docId },
  });
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { entityId: docId } });
  await db.documentFavorite.deleteMany({ where: { documentId: docId } });
  await db.document.deleteMany({ where: { id: docId } });
  await db.user.deleteMany({ where: { id: { in: [authorId, otherId] } } });
});

describe("computeStatsForUsers", () => {
  it("counts published uploads, foreign favorites and downloads; excludes self-engagement", async () => {
    const map = await computeStatsForUsers([authorId, otherId]);
    const a = map.get(authorId)!;
    expect(a.publishedUploads).toBe(1);
    expect(a.favoritesReceived).toBe(1); // self-favorite excluded
    expect(a.downloadsReceived).toBe(1); // self-download excluded
    const o = map.get(otherId)!;
    expect(o.publishedUploads).toBe(0);
    expect(o.favoritesReceived).toBe(0);
  });

  it("returns an empty map for no ids", async () => {
    expect((await computeStatsForUsers([])).size).toBe(0);
  });
});

describe("fetchLeaderboardCandidates", () => {
  it("includes a user with a published upload", async () => {
    const ids = (await fetchLeaderboardCandidates()).map((c) => c.userId);
    expect(ids).toContain(authorId);
    expect(ids).not.toContain(otherId); // no uploads
  });
});
