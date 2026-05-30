import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { createCollection, duplicateCollection, getCollection } from "./collections.service";
import { listCollectionTagIds, addItem } from "../repositories/collections.repo";

const SX = `_dup_${Date.now().toString(36)}`;
let user: AuthenticatedUser;
let tagId: string;
let docId: string;

beforeAll(async () => {
  const u = await db.user.create({ data: { email: `du${SX}@demo`, passwordHash: "x", displayName: `DU${SX}`, isActive: true } });
  user = { id: u.id, roles: ["student"], enrollments: [] } as unknown as AuthenticatedUser;
  tagId = (await db.tag.create({ data: { name: `dt${SX}` } })).id;
  const doc = await db.document.create({
    data: {
      title: `DocDup${SX}`,
      description: "",
      uploaderId: u.id,
      ownerId: u.id,
      materialType: "lecture_notes",
      visibility: "public",
    },
  });
  docId = doc.id;
});
afterAll(async () => {
  await db.studyCollection.deleteMany({ where: { ownerId: user.id } });
  await db.document.deleteMany({ where: { id: docId } });
  await db.tag.deleteMany({ where: { id: tagId } });
  await db.user.deleteMany({ where: { id: user.id } });
});

describe("duplicateCollection", () => {
  it("clones metadata + tags as a new PRIVATE collection owned by the caller", async () => {
    const src = await createCollection(user, {
      title: `Src${SX}`, examName: "Final", semester: "fall", academicYear: 2026,
      tagIds: [tagId], visibility: "public",
    });
    await addItem(src.id, docId);
    const copy = await duplicateCollection(src.id, user);
    expect(copy.id).not.toBe(src.id);
    expect(copy.visibility).toBe("private");
    expect(copy.title).toContain(`Src${SX}`);
    const detail = await getCollection(copy.id, user);
    expect(detail.examName).toBe("Final");
    expect(detail.semester).toBe("fall");
    expect(await listCollectionTagIds(copy.id)).toEqual([tagId]);
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0].document.id).toBe(docId);
  });
});
