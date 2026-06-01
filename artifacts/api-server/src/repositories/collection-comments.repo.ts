import { db } from "@workspace/db";

export interface CommentRow {
  id: string;
  collectionId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; displayName: string; deletedAt: Date | null };
}

const withAuthor = {
  id: true,
  collectionId: true,
  body: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, displayName: true, deletedAt: true } },
} as const;

/** Create a comment AND increment the collection's commentCount atomically. */
export async function createComment(
  collectionId: string,
  authorId: string,
  body: string,
): Promise<CommentRow> {
  return db.$transaction(async (tx) => {
    const c = await tx.studyCollectionComment.create({
      data: { collectionId, authorId, body },
      select: withAuthor,
    });
    await tx.studyCollection.update({
      where: { id: collectionId },
      data: { commentCount: { increment: 1 } },
    });
    return c;
  });
}

/** Non-deleted comments for a collection, oldest-first. */
export async function listComments(collectionId: string): Promise<CommentRow[]> {
  return db.studyCollectionComment.findMany({
    where: { collectionId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: withAuthor,
  });
}

export async function findCommentById(id: string): Promise<CommentRow | null> {
  return db.studyCollectionComment.findFirst({
    where: { id, deletedAt: null },
    select: withAuthor,
  });
}

export async function updateCommentBody(id: string, body: string): Promise<void> {
  await db.studyCollectionComment.update({
    where: { id },
    data: { body, updatedAt: new Date() },
  });
}

/** Soft-delete a comment AND decrement commentCount atomically. */
export async function softDeleteComment(id: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const c = await tx.studyCollectionComment.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: { collectionId: true },
    });
    await tx.studyCollection.update({
      where: { id: c.collectionId },
      data: { commentCount: { decrement: 1 } },
    });
  });
}
