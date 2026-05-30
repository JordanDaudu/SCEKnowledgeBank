import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import {
  createComment,
  listComments,
  findCommentById,
  updateCommentBody,
  softDeleteComment,
} from "./collection-comments.repo";

const SX = `_ccmt_${Date.now().toString(36)}`;
let authorId: string;
let colId: string;

async function commentCount(id: string) {
  return (
    await db.studyCollection.findUniqueOrThrow({
      where: { id },
      select: { commentCount: true },
    })
  ).commentCount;
}

beforeAll(async () => {
  const a = await db.user.create({ data: { email: `a${SX}@demo`, passwordHash: "x", displayName: `A${SX}`, isActive: true } });
  authorId = a.id;
  colId = (await db.studyCollection.create({ data: { ownerId: authorId, title: `C${SX}`, visibility: "public" } })).id;
});

afterAll(async () => {
  await db.studyCollectionComment.deleteMany({ where: { collectionId: colId } });
  await db.studyCollection.deleteMany({ where: { id: colId } });
  await db.user.deleteMany({ where: { id: authorId } });
});

describe("collection-comments.repo", () => {
  it("create increments commentCount and returns the row with author", async () => {
    const c = await createComment(colId, authorId, "hello");
    expect(c.body).toBe("hello");
    expect(c.author.displayName).toBe(`A${SX}`);
    expect(await commentCount(colId)).toBe(1);
  });

  it("list returns non-deleted, oldest-first", async () => {
    await createComment(colId, authorId, "second");
    const list = await listComments(colId);
    expect(list.map((c) => c.body)).toEqual(["hello", "second"]);
  });

  it("edit updates body; soft-delete hides it and decrements commentCount", async () => {
    const c = await createComment(colId, authorId, "third");
    await updateCommentBody(c.id, "third-edited");
    expect((await findCommentById(c.id))?.body).toBe("third-edited");
    expect(await commentCount(colId)).toBe(3);
    await softDeleteComment(c.id);
    expect(await commentCount(colId)).toBe(2);
    expect((await listComments(colId)).some((x) => x.id === c.id)).toBe(false);
  });
});
