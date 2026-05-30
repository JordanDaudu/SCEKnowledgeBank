import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { createCollection, listMyCollections, assembleDetail } from "./collections.service";
import * as engagementRepo from "../repositories/collection-engagement.repo";
import * as collectionsRepo from "../repositories/collections.repo";

const SX = `_engdto_${Date.now().toString(36)}`;
let user: AuthenticatedUser;
let rater: AuthenticatedUser;
let colId: string;

beforeAll(async () => {
  const u = await db.user.create({ data: { email: `u${SX}@demo`, passwordHash: "x", displayName: `U${SX}`, isActive: true } });
  const r = await db.user.create({ data: { email: `r${SX}@demo`, passwordHash: "x", displayName: `R${SX}`, isActive: true } });
  user = { id: u.id, roles: ["student"], enrollments: [] } as unknown as AuthenticatedUser;
  rater = { id: r.id, roles: ["student"], enrollments: [] } as unknown as AuthenticatedUser;
  colId = (await createCollection(user, { title: `C${SX}`, visibility: "public" })).id;
  await engagementRepo.likeCollection(colId, user.id);
  await engagementRepo.setRating(colId, user.id, 4);
  await engagementRepo.setRating(colId, rater.id, 5);
  await engagementRepo.recordView(colId, rater.id);
});

afterAll(async () => {
  await db.studyCollectionView.deleteMany({ where: { collectionId: colId } });
  await db.studyCollectionRating.deleteMany({ where: { collectionId: colId } });
  await db.studyCollectionLike.deleteMany({ where: { collectionId: colId } });
  await db.studyCollection.deleteMany({ where: { id: colId } });
  await db.user.deleteMany({ where: { id: { in: [user.id, rater.id] } } });
});

describe("collection engagement DTO", () => {
  it("summary exposes counts + viewer state", async () => {
    const mine = (await listMyCollections(user)).find((c) => c.id === colId)!;
    expect(mine.likeCount).toBe(1);
    expect(mine.isLiked).toBe(true);
    expect(mine.ratingCount).toBe(2);
    expect(mine.ratingAverage).toBe(4.5);
    expect(mine.myRating).toBe(4);
    expect(mine.viewCount).toBe(1);
  });

  it("detail adds uniqueViewCount", async () => {
    const row = await collectionsRepo.findCollectionById(colId);
    const detail = await assembleDetail(row!, rater);
    expect(detail.uniqueViewCount).toBe(1);
    expect(detail.myRating).toBe(5);
    expect(detail.isLiked).toBe(false);
  });
});
