import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import {
  createCollection,
  findCollectionById,
  updateCollection,
  setCollectionTags,
  listCollectionTagIds,
  listDiscoverable,
} from "./collections.repo";

const SX = `_colmeta_${Date.now().toString(36)}`;
let ownerId: string;
let categoryId: string;
let tagAId: string;
let tagBId: string;
let courseId: string;

beforeAll(async () => {
  const owner = await db.user.create({
    data: { email: `o${SX}@demo`, passwordHash: "x", displayName: `O${SX}`, isActive: true },
  });
  ownerId = owner.id;
  const cat = await db.category.create({ data: { name: `Cat${SX}`, slug: `cat${SX}` } });
  categoryId = cat.id;
  const t1 = await db.tag.create({ data: { name: `t1${SX}` } });
  const t2 = await db.tag.create({ data: { name: `t2${SX}` } });
  tagAId = t1.id;
  tagBId = t2.id;
  const course = await db.course.create({ data: { code: `C${SX}`, title: `Course${SX}`, lecturerName: `Dr${SX}` } });
  courseId = course.id;
});

afterAll(async () => {
  // study_collection_tags rows cascade-delete with their collection (FK
  // onDelete: Cascade), so deleting the collections clears them too.
  await db.studyCollection.deleteMany({ where: { ownerId } });
  await db.course.deleteMany({ where: { id: courseId } });
  await db.tag.deleteMany({ where: { id: { in: [tagAId, tagBId] } } });
  await db.category.deleteMany({ where: { id: categoryId } });
  await db.user.deleteMany({ where: { id: ownerId } });
});

describe("collections.repo metadata", () => {
  it("persists categoryId, examName, semester, academicYear on create", async () => {
    const c = await createCollection({
      ownerId,
      title: `C${SX}`,
      categoryId,
      examName: "Final",
      semester: "spring",
      academicYear: 2026,
    });
    const got = await findCollectionById(c.id);
    expect(got?.categoryId).toBe(categoryId);
    expect(got?.examName).toBe("Final");
    expect(got?.semester).toBe("spring");
    expect(got?.academicYear).toBe(2026);
  });

  it("replace-sets tags", async () => {
    const c = await createCollection({ ownerId, title: `T${SX}` });
    await setCollectionTags(c.id, [tagAId, tagBId]);
    expect((await listCollectionTagIds(c.id)).sort()).toEqual([tagAId, tagBId].sort());
    await setCollectionTags(c.id, [tagAId]);
    expect(await listCollectionTagIds(c.id)).toEqual([tagAId]);
  });

  it("listDiscoverable returns public collections (not private)", async () => {
    const pub = await createCollection({ ownerId, title: `Pub${SX}`, visibility: "public", courseId });
    const priv = await createCollection({ ownerId, title: `Priv${SX}`, visibility: "private", courseId });
    const ids = (await listDiscoverable({ sort: "recent", courseId, limit: 50 })).map((r) => r.id);
    expect(ids).toContain(pub.id);
    expect(ids).not.toContain(priv.id);
  });
});
