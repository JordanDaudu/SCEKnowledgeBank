import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { createCollection } from "./collections.service";
import { listFollowed } from "./prep-hub.service";

const SX = `_phfol_${Date.now().toString(36)}`;
let viewer: AuthenticatedUser; // the follower
let owner: AuthenticatedUser; // owns the collections
let publicOldId: string;
let publicNewId: string;
let privateId: string;
let hiddenId: string;
let unfollowedId: string;

beforeAll(async () => {
  const v = await db.user.create({
    data: { email: `v${SX}@demo`, passwordHash: "x", displayName: `V${SX}`, isActive: true },
  });
  const o = await db.user.create({
    data: { email: `o${SX}@demo`, passwordHash: "x", displayName: `O${SX}`, isActive: true },
  });
  viewer = { id: v.id, roles: ["student"], enrollments: [] } as unknown as AuthenticatedUser;
  owner = { id: o.id, roles: ["student"], enrollments: [] } as unknown as AuthenticatedUser;

  publicOldId = (await createCollection(owner, { title: `Old ${SX}`, visibility: "public" })).id;
  publicNewId = (await createCollection(owner, { title: `New ${SX}`, visibility: "public" })).id;
  privateId = (await createCollection(owner, { title: `Priv ${SX}`, visibility: "private" })).id;
  hiddenId = (await createCollection(owner, { title: `Hid ${SX}`, visibility: "public" })).id;
  unfollowedId = (await createCollection(owner, { title: `Unf ${SX}`, visibility: "public" })).id;

  // Hide one collection AFTER it was followed.
  await db.studyCollection.update({ where: { id: hiddenId }, data: { hiddenAt: new Date() } });

  // viewer follows four of the five (not `unfollowedId`); control createdAt so
  // publicNewId is the most-recent follow.
  const base = Date.now();
  await db.studyCollectionFollower.createMany({
    data: [
      { collectionId: publicOldId, userId: v.id, createdAt: new Date(base - 60_000) },
      { collectionId: publicNewId, userId: v.id, createdAt: new Date(base - 10_000) },
      { collectionId: privateId, userId: v.id, createdAt: new Date(base - 30_000) },
      { collectionId: hiddenId, userId: v.id, createdAt: new Date(base - 20_000) },
    ],
  });
});

afterAll(async () => {
  await db.studyCollection.deleteMany({ where: { ownerId: owner.id } });
  await db.user.deleteMany({ where: { id: { in: [viewer.id, owner.id] } } });
});

describe("prep-hub.service listFollowed", () => {
  it("returns followed public collections, newest-followed first", async () => {
    const rows = await listFollowed(viewer);
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual([publicNewId, publicOldId]);
  });

  it("excludes private, hidden, and not-followed collections", async () => {
    const ids = (await listFollowed(viewer)).map((r) => r.id);
    expect(ids).not.toContain(privateId);
    expect(ids).not.toContain(hiddenId);
    expect(ids).not.toContain(unfollowedId);
  });

  it("marks every returned collection as followed", async () => {
    const rows = await listFollowed(viewer);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.isFollowing)).toBe(true);
  });
});
