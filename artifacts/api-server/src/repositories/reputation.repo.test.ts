import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import {
  computeStatsForUsers,
  countLiveUploadsByUsers,
  fetchLeaderboardCandidates,
} from "./reputation.repo";

const SX = `_rep_${Date.now().toString(36)}`;
let authorId: string;
let otherId: string;
let approvedAuthorId: string;
let docId: string;
let approvedDocId: string;

beforeAll(async () => {
  const author = await db.user.create({
    data: { email: `a${SX}@demo`, passwordHash: "x", displayName: `A${SX}` },
  });
  const other = await db.user.create({
    data: { email: `o${SX}@demo`, passwordHash: "x", displayName: `O${SX}` },
  });
  // A student-style contributor whose upload was approved through review
  // (status `approved`, not `published`).
  const approvedAuthor = await db.user.create({
    data: { email: `s${SX}@demo`, passwordHash: "x", displayName: `S${SX}` },
  });
  authorId = author.id;
  otherId = other.id;
  approvedAuthorId = approvedAuthor.id;

  const doc = await db.document.create({
    data: { title: `D${SX}`, uploaderId: authorId, ownerId: authorId, status: "published" },
  });
  docId = doc.id;

  const approvedDoc = await db.document.create({
    data: { title: `S${SX}`, uploaderId: approvedAuthorId, ownerId: approvedAuthorId, status: "approved" },
  });
  approvedDocId = approvedDoc.id;

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
  await db.document.deleteMany({ where: { id: { in: [docId, approvedDocId] } } });
  await db.user.deleteMany({ where: { id: { in: [authorId, otherId, approvedAuthorId] } } });
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

  it("counts approved uploads too (student uploads reviewed → approved)", async () => {
    const map = await computeStatsForUsers([approvedAuthorId]);
    expect(map.get(approvedAuthorId)!.publishedUploads).toBe(1);
  });

  it("returns an empty map for no ids", async () => {
    expect((await computeStatsForUsers([])).size).toBe(0);
  });
});

describe("countLiveUploadsByUsers", () => {
  it("counts published + approved uploads; zero for non-uploaders", async () => {
    const counts = await countLiveUploadsByUsers([authorId, approvedAuthorId, otherId]);
    expect(counts.get(authorId)).toBe(1);
    expect(counts.get(approvedAuthorId)).toBe(1);
    expect(counts.get(otherId)).toBe(0);
  });
});

describe("fetchLeaderboardCandidates", () => {
  it("includes users with a published OR approved upload, not just lecturers", async () => {
    const candidates = await fetchLeaderboardCandidates();
    const ids = candidates.map((c) => c.userId);
    expect(ids).toContain(authorId); // published upload
    expect(ids).toContain(approvedAuthorId); // approved (student) upload
    expect(ids).not.toContain(otherId); // no uploads
    // Candidates now carry roles so the service can derive "verified".
    expect(Array.isArray(candidates.find((c) => c.userId === authorId)?.roles)).toBe(true);
  });
});
