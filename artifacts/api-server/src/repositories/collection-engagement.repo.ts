import { db } from "@workspace/db";

// ─── Likes ────────────────────────────────────────────────────────

/** Like a collection. Idempotent on (collection, user); on a real insert
 *  bumps likeCount in the same transaction. Returns true iff inserted. */
export async function likeCollection(
  collectionId: string,
  userId: string,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const r = await tx.studyCollectionLike.createMany({
      data: [{ collectionId, userId }],
      skipDuplicates: true,
    });
    if (r.count > 0) {
      await tx.studyCollection.update({
        where: { id: collectionId },
        data: { likeCount: { increment: 1 } },
      });
    }
    return r.count > 0;
  });
}

/** Unlike. Returns true iff a row was removed (then decrements likeCount). */
export async function unlikeCollection(
  collectionId: string,
  userId: string,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const r = await tx.studyCollectionLike.deleteMany({
      where: { collectionId, userId },
    });
    if (r.count > 0) {
      await tx.studyCollection.update({
        where: { id: collectionId },
        data: { likeCount: { decrement: 1 } },
      });
    }
    return r.count > 0;
  });
}

export async function isLiked(
  collectionId: string,
  userId: string,
): Promise<boolean> {
  const row = await db.studyCollectionLike.findUnique({
    where: { collectionId_userId: { collectionId, userId } },
    select: { id: true },
  });
  return !!row;
}

/** Collection ids (from a candidate set) the user has liked. */
export async function listLikedCollectionIds(
  userId: string,
  within: string[],
): Promise<Set<string>> {
  if (within.length === 0) return new Set();
  const rows = await db.studyCollectionLike.findMany({
    where: { userId, collectionId: { in: within } },
    select: { collectionId: true },
  });
  return new Set(rows.map((r) => r.collectionId));
}

// ─── Ratings ──────────────────────────────────────────────────────

/** Set the caller's rating (1..5). Upsert: a new rating bumps count+sum;
 *  changing an existing one adjusts sum by the delta. Validation of the
 *  range is the service's job. */
export async function setRating(
  collectionId: string,
  userId: string,
  value: number,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const existing = await tx.studyCollectionRating.findUnique({
      where: { collectionId_userId: { collectionId, userId } },
    });
    if (!existing) {
      await tx.studyCollectionRating.create({
        data: { collectionId, userId, value },
      });
      await tx.studyCollection.update({
        where: { id: collectionId },
        data: { ratingCount: { increment: 1 }, ratingSum: { increment: value } },
      });
    } else if (existing.value !== value) {
      await tx.studyCollectionRating.update({
        where: { id: existing.id },
        data: { value, updatedAt: new Date() },
      });
      await tx.studyCollection.update({
        where: { id: collectionId },
        data: { ratingSum: { increment: value - existing.value } },
      });
    }
  });
}

/** Clear the caller's rating. No-op if absent. */
export async function clearRating(
  collectionId: string,
  userId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const existing = await tx.studyCollectionRating.findUnique({
      where: { collectionId_userId: { collectionId, userId } },
    });
    if (existing) {
      await tx.studyCollectionRating.delete({ where: { id: existing.id } });
      await tx.studyCollection.update({
        where: { id: collectionId },
        data: {
          ratingCount: { decrement: 1 },
          ratingSum: { decrement: existing.value },
        },
      });
    }
  });
}

export async function getMyRating(
  collectionId: string,
  userId: string,
): Promise<number | undefined> {
  const row = await db.studyCollectionRating.findUnique({
    where: { collectionId_userId: { collectionId, userId } },
    select: { value: true },
  });
  return row?.value;
}

/** Map collectionId → the user's rating value, for a candidate set. */
export async function listMyRatings(
  userId: string,
  within: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (within.length === 0) return map;
  const rows = await db.studyCollectionRating.findMany({
    where: { userId, collectionId: { in: within } },
    select: { collectionId: true, value: true },
  });
  for (const r of rows) map.set(r.collectionId, r.value);
  return map;
}

// ─── Views ────────────────────────────────────────────────────────

/** Append a view event AND bump the denormalised total viewCount atomically. */
export async function recordView(
  collectionId: string,
  userId: string,
): Promise<void> {
  await db.$transaction([
    db.studyCollectionView.create({ data: { collectionId, userId } }),
    db.studyCollection.update({
      where: { id: collectionId },
      data: { viewCount: { increment: 1 } },
    }),
  ]);
}

/** Non-fatal recordView — a failed insert never breaks the originating read. */
export async function tryRecordView(
  collectionId: string,
  userId: string,
): Promise<void> {
  try {
    await recordView(collectionId, userId);
  } catch {
    // swallow — mirrors viewHistory.repo.tryRecordView
  }
}

/** Unique viewers of a single collection (COUNT DISTINCT user_id). */
export async function countUniqueViews(collectionId: string): Promise<number> {
  const rows = await db.studyCollectionView.findMany({
    where: { collectionId },
    distinct: ["userId"],
    select: { userId: true },
  });
  return rows.length;
}
