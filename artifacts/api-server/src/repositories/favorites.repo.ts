import { db } from "@workspace/db";

export interface FavoriteRow {
  id: string;
  userId: string;
  documentId: string;
  createdAt: Date;
}

export async function insertIfAbsent(
  userId: string,
  documentId: string,
): Promise<boolean> {
  const r = await db.documentFavorite.createMany({
    data: [{ userId, documentId }],
    skipDuplicates: true,
  });
  return r.count > 0;
}

export async function deleteOne(
  userId: string,
  documentId: string,
): Promise<boolean> {
  const r = await db.documentFavorite.deleteMany({
    where: { userId, documentId },
  });
  return r.count > 0;
}

export async function isFavorited(
  userId: string,
  documentId: string,
): Promise<boolean> {
  const r = await db.documentFavorite.findFirst({
    where: { userId, documentId },
    select: { id: true },
  });
  return !!r;
}

/**
 * Returns the document ids the user has favorited, newest-first.
 */
export async function listDocumentIdsForUser(
  userId: string,
  limit = 100,
): Promise<string[]> {
  const rows = await db.documentFavorite.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { documentId: true },
    take: limit,
  });
  return rows.map((r) => r.documentId);
}

/**
 * Returns the user ids that have favorited a given document.
 * Used by the comment producer to fan out `document.activity`
 * notifications to subscribers.
 */
export async function listSubscribersForDocument(
  documentId: string,
): Promise<string[]> {
  const rows = await db.documentFavorite.findMany({
    where: { documentId },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}
