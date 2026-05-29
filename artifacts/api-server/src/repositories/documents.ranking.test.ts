import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, Prisma } from "@workspace/db";
import * as viewHistory from "./viewHistory.repo";
import * as favorites from "./favorites.repo";
import {
  listDocuments,
  type DocumentListFilters,
} from "./documents.repo";

/**
 * Refinement Phase 2 — engagement counters + ranking sorts.
 *
 * Counters (view_count / download_count / favorite_count) are maintained
 * incrementally by the repo write paths; the ranked sorts read them so no
 * per-request GROUP BY is needed. Exercised against the real test DB under a
 * unique suffix, scoped by restrictDocumentIds so we only ever see our rows.
 */
const SUFFIX = `_rank_${Date.now().toString(36)}`;

interface Ctx {
  userId: string;
  courseId: string;
  docHot: string; // most viewed/favorited
  docMid: string;
  docCold: string; // no engagement
}
let ctx: Ctx;

async function mkDoc(title: string, userId: string, courseId: string) {
  return db.document.create({
    data: {
      title,
      description: "",
      uploaderId: userId,
      ownerId: userId,
      materialType: "lecture_notes",
      status: "published",
      visibility: "public",
      courseId,
    },
  });
}

async function setup(): Promise<Ctx> {
  const user = await db.user.create({
    data: {
      email: `rank-user${SUFFIX}@demo`,
      passwordHash: "x",
      displayName: `Rank Tester${SUFFIX}`,
      isActive: true,
    },
  });
  const course = await db.course.create({
    data: { code: `RANK${SUFFIX}`, title: `Ranking${SUFFIX}`, lecturerName: "Dr. R" },
  });
  const hot = await mkDoc(`Hot doc${SUFFIX}`, user.id, course.id);
  const mid = await mkDoc(`Mid doc${SUFFIX}`, user.id, course.id);
  const cold = await mkDoc(`Cold doc${SUFFIX}`, user.id, course.id);
  return {
    userId: user.id,
    courseId: course.id,
    docHot: hot.id,
    docMid: mid.id,
    docCold: cold.id,
  };
}

async function teardown(c: Ctx) {
  const ids = [c.docHot, c.docMid, c.docCold];
  await db.materialViewHistory.deleteMany({ where: { documentId: { in: ids } } });
  await db.documentFavorite.deleteMany({ where: { documentId: { in: ids } } });
  await db.document.deleteMany({ where: { id: { in: ids } } });
  await db.course.deleteMany({ where: { id: c.courseId } });
  await db.user.deleteMany({ where: { id: c.userId } });
}

beforeAll(async () => {
  ctx = await setup();
});
afterAll(async () => {
  if (ctx) await teardown(ctx);
});

async function counts(id: string) {
  const d = await db.document.findUniqueOrThrow({
    where: { id },
    select: { viewCount: true, favoriteCount: true, downloadCount: true },
  });
  return d;
}

describe("engagement counters — maintained incrementally", () => {
  it("recordView increments view_count", async () => {
    expect((await counts(ctx.docHot)).viewCount).toBe(0);
    await viewHistory.recordView(ctx.docHot, ctx.userId);
    await viewHistory.recordView(ctx.docHot, ctx.userId);
    expect((await counts(ctx.docHot)).viewCount).toBe(2);
  });

  it("favorite add/remove increments then decrements favorite_count", async () => {
    expect((await counts(ctx.docHot)).favoriteCount).toBe(0);
    await favorites.insertIfAbsent(ctx.userId, ctx.docHot);
    expect((await counts(ctx.docHot)).favoriteCount).toBe(1);
    // duplicate add does not double-count
    await favorites.insertIfAbsent(ctx.userId, ctx.docHot);
    expect((await counts(ctx.docHot)).favoriteCount).toBe(1);
    await favorites.deleteOne(ctx.userId, ctx.docHot);
    expect((await counts(ctx.docHot)).favoriteCount).toBe(0);
  });
});

describe("ranking sorts — read counters, no GROUP BY", () => {
  const filters = (): DocumentListFilters => ({
    visibility: undefined,
    restrictDocumentIds: [ctx.docHot, ctx.docMid, ctx.docCold],
  });

  it("sorts by most viewed", async () => {
    // hot already has 2 views from the earlier test; give mid 1.
    await viewHistory.recordView(ctx.docMid, ctx.userId);
    const rows = await listDocuments(filters(), {
      sort: "viewed",
      page: 1,
      pageSize: 20,
    });
    const ours = rows.map((r) => r.id).filter((id) =>
      [ctx.docHot, ctx.docMid, ctx.docCold].includes(id),
    );
    expect(ours[0]).toBe(ctx.docHot);
    expect(ours.indexOf(ctx.docMid)).toBeLessThan(ours.indexOf(ctx.docCold));
  });
});

void Prisma;
