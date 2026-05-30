import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { createCollection } from "./collections.service";
import {
  likeCollection,
  rateCollection,
  clearRating,
} from "./collection-engagement.service";

const SX = `_engsvc_${Date.now().toString(36)}`;
let owner: AuthenticatedUser;
let viewer: AuthenticatedUser;
let pubId: string;
let privId: string;

beforeAll(async () => {
  const o = await db.user.create({ data: { email: `o${SX}@demo`, passwordHash: "x", displayName: `O${SX}`, isActive: true } });
  const v = await db.user.create({ data: { email: `v${SX}@demo`, passwordHash: "x", displayName: `V${SX}`, isActive: true } });
  owner = { id: o.id, roles: ["student"], enrollments: [] } as unknown as AuthenticatedUser;
  viewer = { id: v.id, roles: ["student"], enrollments: [] } as unknown as AuthenticatedUser;
  pubId = (await createCollection(owner, { title: `Pub${SX}`, visibility: "public" })).id;
  privId = (await createCollection(owner, { title: `Priv${SX}`, visibility: "private" })).id;
});

afterAll(async () => {
  await db.studyCollectionRating.deleteMany({ where: { collectionId: { in: [pubId, privId] } } });
  await db.studyCollectionLike.deleteMany({ where: { collectionId: { in: [pubId, privId] } } });
  await db.studyCollection.deleteMany({ where: { id: { in: [pubId, privId] } } });
  await db.user.deleteMany({ where: { id: { in: [owner.id, viewer.id] } } });
});

describe("collection-engagement.service", () => {
  it("a non-owner likes + rates a public collection", async () => {
    const d = await likeCollection(pubId, viewer);
    expect(d.isLiked).toBe(true);
    expect(d.likeCount).toBe(1);
    const d2 = await rateCollection(pubId, viewer, 4);
    expect(d2.myRating).toBe(4);
    expect(d2.ratingAverage).toBe(4);
  });

  it("owner cannot like or rate their own collection", async () => {
    await expect(likeCollection(pubId, owner)).rejects.toThrow();
    await expect(rateCollection(pubId, owner, 5)).rejects.toThrow();
  });

  it("rating out of range is rejected", async () => {
    await expect(rateCollection(pubId, viewer, 0)).rejects.toThrow();
    await expect(rateCollection(pubId, viewer, 6)).rejects.toThrow();
  });

  it("engagement on a private collection 404s", async () => {
    await expect(likeCollection(privId, viewer)).rejects.toThrow();
    await expect(rateCollection(privId, viewer, 3)).rejects.toThrow();
  });

  it("clearRating removes the viewer's rating", async () => {
    await rateCollection(pubId, viewer, 5);
    const d = await clearRating(pubId, viewer);
    expect(d.myRating).toBeUndefined();
  });
});
