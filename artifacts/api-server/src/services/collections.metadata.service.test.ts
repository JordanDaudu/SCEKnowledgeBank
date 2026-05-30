import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { createCollection, updateCollection, getCollection } from "./collections.service";
import { listCollectionTagIds } from "../repositories/collections.repo";

const SX = `_colsvc_${Date.now().toString(36)}`;
let user: AuthenticatedUser;
let categoryId: string;
let tagId: string;

beforeAll(async () => {
  const u = await db.user.create({
    data: { email: `u${SX}@demo`, passwordHash: "x", displayName: `U${SX}`, isActive: true },
  });
  user = { id: u.id, roles: ["student"], enrollments: [] } as unknown as AuthenticatedUser;
  categoryId = (await db.category.create({ data: { name: `Cat${SX}`, slug: `cat${SX}` } })).id;
  tagId = (await db.tag.create({ data: { name: `tag${SX}` } })).id;
});

afterAll(async () => {
  await db.studyCollection.deleteMany({ where: { ownerId: user.id } });
  await db.tag.deleteMany({ where: { id: tagId } });
  await db.category.deleteMany({ where: { id: categoryId } });
  await db.user.deleteMany({ where: { id: user.id } });
});

describe("collections.service metadata", () => {
  it("persists metadata + tags on create and exposes them on detail", async () => {
    const c = await createCollection(user, {
      title: `Meta${SX}`,
      categoryId,
      examName: "Midterm",
      semester: "fall",
      academicYear: 2026,
      tagIds: [tagId],
      visibility: "public",
    });
    const detail = await getCollection(c.id, user);
    expect(detail.categoryId).toBe(categoryId);
    expect(detail.examName).toBe("Midterm");
    expect(detail.semester).toBe("fall");
    expect(detail.academicYear).toBe(2026);
    expect(detail.tagIds).toEqual([tagId]);
    expect(detail.visibility).toBe("public");
  });

  it("rejects an invalid semester", async () => {
    await expect(
      createCollection(user, { title: `Bad${SX}`, semester: "winter" }),
    ).rejects.toThrow(/semester/i);
  });

  it("persists tags added via updateCollection and clears them on empty update", async () => {
    const c = await createCollection(user, { title: `UpdateTag${SX}` });
    await updateCollection(c.id, user, { tagIds: [tagId] });
    const afterAdd = await getCollection(c.id, user);
    expect(afterAdd.tagIds).toEqual([tagId]);

    await updateCollection(c.id, user, { tagIds: [] });
    const afterClear = await getCollection(c.id, user);
    expect(afterClear.tagIds).toEqual([]);
  });
});
