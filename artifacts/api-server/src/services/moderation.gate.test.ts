import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { createCollection } from "./collections.service";
import { hideCollection } from "../repositories/collections.repo";
import { getPublicCollection } from "./prep-hub.service";
import { likeCollection } from "./collection-engagement.service";
import { listComments, createComment } from "./collection-comments.service";

const SX = `_modgate_${Date.now().toString(36)}`;
let owner: AuthenticatedUser;
let student: AuthenticatedUser;
let admin: AuthenticatedUser;
let colId: string;

beforeAll(async () => {
  const o = await db.user.create({ data: { email: `o${SX}@demo`, passwordHash: "x", displayName: `O${SX}`, isActive: true } });
  const s = await db.user.create({ data: { email: `s${SX}@demo`, passwordHash: "x", displayName: `S${SX}`, isActive: true } });
  const a = await db.user.create({ data: { email: `a${SX}@demo`, passwordHash: "x", displayName: `A${SX}`, isActive: true } });
  owner = { id: o.id, roles: ["student"], enrollments: [] } as unknown as AuthenticatedUser;
  student = { id: s.id, roles: ["student"], enrollments: [] } as unknown as AuthenticatedUser;
  admin = { id: a.id, roles: ["admin"], enrollments: [] } as unknown as AuthenticatedUser;
  colId = (await createCollection(owner, { title: `Gate ${SX}`, visibility: "public" })).id;
  await createComment(colId, student, "before hide");
  await hideCollection(colId, admin.id, "spam");
});

afterAll(async () => {
  await db.studyCollectionComment.deleteMany({ where: { collectionId: colId } });
  await db.studyCollection.deleteMany({ where: { ownerId: owner.id } });
  await db.user.deleteMany({ where: { id: { in: [owner.id, student.id, admin.id] } } });
});

describe("hidden-collection gate", () => {
  it("getPublicCollection: 404 for a student, returned for an admin (with hiddenAt)", async () => {
    await expect(getPublicCollection(colId, student)).rejects.toThrow();
    const d = await getPublicCollection(colId, admin);
    expect(d.id).toBe(colId);
    expect(d.hiddenAt).toBeTruthy();
  });
  it("engagement on a hidden collection 404s", async () => {
    await expect(likeCollection(colId, student)).rejects.toThrow();
  });
  it("listComments: admin can read a hidden collection's comments; student 404; createComment 404", async () => {
    const list = await listComments(colId, admin);
    expect(list.length).toBeGreaterThanOrEqual(1);
    await expect(listComments(colId, student)).rejects.toThrow();
    await expect(createComment(colId, student, "after hide")).rejects.toThrow();
  });
});
