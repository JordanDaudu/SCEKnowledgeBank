import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { createCollection } from "./collections.service";
import { getPublicCollection, listDiscoverable } from "./prep-hub.service";

const SX = `_prephub_${Date.now().toString(36)}`;
let owner: AuthenticatedUser;
let viewer: AuthenticatedUser;
let courseId: string;
let publicId: string;
let privateId: string;

beforeAll(async () => {
  const o = await db.user.create({ data: { email: `po${SX}@demo`, passwordHash: "x", displayName: `PO${SX}`, isActive: true } });
  const v = await db.user.create({ data: { email: `pv${SX}@demo`, passwordHash: "x", displayName: `PV${SX}`, isActive: true } });
  owner = { id: o.id, roles: ["student"], enrollments: [] } as unknown as AuthenticatedUser;
  viewer = { id: v.id, roles: ["student"], enrollments: [] } as unknown as AuthenticatedUser;
  const course = await db.course.create({ data: { code: `C${SX}`, title: `Course${SX}`, lecturerName: `Dr${SX}` } });
  courseId = course.id;
  publicId = (await createCollection(owner, { title: `Pub${SX}`, visibility: "public", courseId })).id;
  privateId = (await createCollection(owner, { title: `Priv${SX}`, visibility: "private", courseId })).id;
});

afterAll(async () => {
  await db.studyCollection.deleteMany({ where: { ownerId: owner.id } });
  await db.course.deleteMany({ where: { id: courseId } });
  await db.user.deleteMany({ where: { id: { in: [owner.id, viewer.id] } } });
});

describe("prep-hub.service", () => {
  it("getPublicCollection returns a public collection to a non-owner", async () => {
    const d = await getPublicCollection(publicId, viewer);
    expect(d.id).toBe(publicId);
  });
  it("getPublicCollection 404s on a private collection (even for the owner)", async () => {
    await expect(getPublicCollection(privateId, viewer)).rejects.toThrow();
    await expect(getPublicCollection(privateId, owner)).rejects.toThrow();
  });
  it("listDiscoverable excludes private collections", async () => {
    const ids = (await listDiscoverable(viewer, { sort: "recent", courseId, limit: 50 })).map((c) => c.id);
    expect(ids).toContain(publicId);
    expect(ids).not.toContain(privateId);
  });
});
