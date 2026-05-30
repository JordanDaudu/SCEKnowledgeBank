import { db, Prisma } from "@workspace/db";

export interface CollectionRow {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  kind: string;
  isOfficial: boolean;
  courseId: string | null;
  categoryId: string | null;
  examName: string | null;
  semester: string | null;
  academicYear: number | null;
  visibility: string;
  popularityScore: number;
  examDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CollectionItemRow {
  id: string;
  collectionId: string;
  documentId: string;
  position: number;
  note: string | null;
  createdAt: Date;
}

export interface CreateCollectionInput {
  ownerId: string;
  title: string;
  description?: string;
  kind?: string;
  courseId?: string | null;
  categoryId?: string | null;
  examName?: string | null;
  semester?: string | null;
  academicYear?: number | null;
  visibility?: string;
  examDate?: Date | null;
}

export async function createCollection(
  input: CreateCollectionInput,
): Promise<CollectionRow> {
  return db.studyCollection.create({
    data: {
      ownerId: input.ownerId,
      title: input.title,
      description: input.description ?? "",
      kind: input.kind ?? "collection",
      courseId: input.courseId ?? null,
      categoryId: input.categoryId ?? null,
      examName: input.examName ?? null,
      semester: input.semester ?? null,
      academicYear: input.academicYear ?? null,
      visibility: input.visibility ?? "private",
      examDate: input.examDate ?? null,
    },
  });
}

export async function listCollectionsForOwner(
  ownerId: string,
): Promise<Array<CollectionRow & { itemCount: number }>> {
  const rows = await db.studyCollection.findMany({
    where: { ownerId, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { items: true } } },
  });
  return rows.map(({ _count, ...r }) => ({ ...r, itemCount: _count.items }));
}

export async function findCollectionById(
  id: string,
): Promise<CollectionRow | null> {
  return db.studyCollection.findFirst({ where: { id, deletedAt: null } });
}

export async function updateCollection(
  id: string,
  patch: Partial<
    Pick<
      CollectionRow,
      | "title" | "description" | "kind" | "visibility" | "courseId" | "examDate"
      | "categoryId" | "examName" | "semester" | "academicYear"
    >
  >,
): Promise<void> {
  await db.studyCollection.update({
    where: { id },
    data: { ...patch, updatedAt: new Date() },
  });
}

export async function softDeleteCollection(id: string): Promise<void> {
  await db.studyCollection.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

export async function listItems(
  collectionId: string,
): Promise<CollectionItemRow[]> {
  return db.studyCollectionItem.findMany({
    where: { collectionId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}

/** Append a document to a collection at the next position. Idempotent on the
 *  (collection, document) unique key — a re-add is a no-op returning false. */
export async function addItem(
  collectionId: string,
  documentId: string,
  note?: string,
): Promise<boolean> {
  const agg = await db.studyCollectionItem.aggregate({
    where: { collectionId },
    _max: { position: true },
  });
  const nextPos = (agg._max.position ?? -1) + 1;
  const r = await db.studyCollectionItem.createMany({
    data: [{ collectionId, documentId, position: nextPos, note: note ?? null }],
    skipDuplicates: true,
  });
  if (r.count > 0) await touch(collectionId);
  return r.count > 0;
}

export async function removeItem(
  collectionId: string,
  documentId: string,
): Promise<boolean> {
  const r = await db.studyCollectionItem.deleteMany({
    where: { collectionId, documentId },
  });
  if (r.count > 0) await touch(collectionId);
  return r.count > 0;
}

export async function updateItemNote(
  collectionId: string,
  documentId: string,
  note: string | null,
): Promise<void> {
  await db.studyCollectionItem.updateMany({
    where: { collectionId, documentId },
    data: { note },
  });
}

/** Set explicit positions from an ordered list of document ids. Documents not
 *  in `orderedDocumentIds` keep their existing position (sorted after). */
export async function reorderItems(
  collectionId: string,
  orderedDocumentIds: string[],
): Promise<void> {
  await db.$transaction(
    orderedDocumentIds.map((documentId, index) =>
      db.studyCollectionItem.updateMany({
        where: { collectionId, documentId },
        data: { position: index },
      }),
    ),
  );
  await touch(collectionId);
}

async function touch(collectionId: string): Promise<void> {
  await db.studyCollection.update({
    where: { id: collectionId },
    data: { updatedAt: new Date() },
  });
}

// ─── Followers (US-56) ────────────────────────────────────────────

/** Follow a collection. Idempotent on (collection, user) — returns true only
 *  when a new follow row was created. */
export async function followCollection(
  collectionId: string,
  userId: string,
): Promise<boolean> {
  const r = await db.studyCollectionFollower.createMany({
    data: [{ collectionId, userId }],
    skipDuplicates: true,
  });
  return r.count > 0;
}

/** Unfollow a collection. Returns true if a follow row was removed. */
export async function unfollowCollection(
  collectionId: string,
  userId: string,
): Promise<boolean> {
  const r = await db.studyCollectionFollower.deleteMany({
    where: { collectionId, userId },
  });
  return r.count > 0;
}

export async function isFollowing(
  collectionId: string,
  userId: string,
): Promise<boolean> {
  const row = await db.studyCollectionFollower.findUnique({
    where: { collectionId_userId: { collectionId, userId } },
    select: { id: true },
  });
  return !!row;
}

export async function countFollowers(collectionId: string): Promise<number> {
  return db.studyCollectionFollower.count({ where: { collectionId } });
}

/** Batch follower counts keyed by collection id (0 omitted). */
export async function countFollowersForCollections(
  collectionIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (collectionIds.length === 0) return map;
  const rows = await db.studyCollectionFollower.groupBy({
    by: ["collectionId"],
    where: { collectionId: { in: collectionIds } },
    _count: { _all: true },
  });
  for (const r of rows) map.set(r.collectionId, r._count._all);
  return map;
}

/** Collection ids the user follows (from a candidate set, or all). */
export async function listFollowedCollectionIds(
  userId: string,
  within?: string[],
): Promise<Set<string>> {
  const rows = await db.studyCollectionFollower.findMany({
    where: { userId, ...(within ? { collectionId: { in: within } } : {}) },
    select: { collectionId: true },
  });
  return new Set(rows.map((r) => r.collectionId));
}

export async function countItems(collectionId: string): Promise<number> {
  return db.studyCollectionItem.count({ where: { collectionId } });
}

export async function setPopularityScore(
  collectionId: string,
  score: number,
): Promise<void> {
  await db.studyCollection.update({
    where: { id: collectionId },
    data: { popularityScore: score },
  });
}

// ─── Per-collection completed-item counts (US-61 progress %) ──────

/** Map collectionId → number of its items the user has marked "completed". */
export async function countCompletedForCollections(
  userId: string,
  collectionIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (collectionIds.length === 0) return map;
  const rows = await db.$queryRaw<
    { collection_id: string; completed: bigint }[]
  >(Prisma.sql`
    SELECT sci.collection_id, COUNT(*) AS completed
    FROM study_collection_items sci
    JOIN study_progress sp
      ON sp.document_id = sci.document_id
     AND sp.user_id = ${userId}::uuid
     AND sp.status = 'completed'
    WHERE sci.collection_id IN (${Prisma.join(
      collectionIds.map((id) => Prisma.sql`${id}::uuid`),
    )})
    GROUP BY sci.collection_id
  `);
  for (const r of rows) map.set(r.collection_id, Number(r.completed));
  return map;
}

// ─── Discovery & recommendations (US-55 / US-62) ──────────────────

export type DiscoverSort = "popular" | "recent";

/** Collections discoverable by other users: public OR official, not deleted.
 *  Optionally course-scoped. Sorted by popularity or recency. */
export async function listDiscoverable(opts: {
  sort: DiscoverSort;
  courseId?: string;
  limit: number;
}): Promise<Array<CollectionRow & { itemCount: number }>> {
  const rows = await db.studyCollection.findMany({
    where: {
      deletedAt: null,
      OR: [{ visibility: "public" }, { isOfficial: true }],
      ...(opts.courseId ? { courseId: opts.courseId } : {}),
    },
    orderBy:
      opts.sort === "popular"
        ? [{ popularityScore: "desc" }, { updatedAt: "desc" }]
        : [{ updatedAt: "desc" }],
    take: opts.limit,
    include: { _count: { select: { items: true } } },
  });
  return rows.map(({ _count, ...r }) => ({ ...r, itemCount: _count.items }));
}

/** Recommend public/official collections in the given courses, excluding the
 *  viewer's own collections and any ids already known (e.g. followed). */
export async function recommendCollections(opts: {
  courseIds: string[];
  excludeOwnerId: string;
  excludeIds?: string[];
  limit: number;
}): Promise<Array<CollectionRow & { itemCount: number }>> {
  if (opts.courseIds.length === 0) return [];
  const rows = await db.studyCollection.findMany({
    where: {
      deletedAt: null,
      OR: [{ visibility: "public" }, { isOfficial: true }],
      courseId: { in: opts.courseIds },
      ownerId: { not: opts.excludeOwnerId },
      ...(opts.excludeIds && opts.excludeIds.length > 0
        ? { id: { notIn: opts.excludeIds } }
        : {}),
    },
    orderBy: [{ popularityScore: "desc" }, { updatedAt: "desc" }],
    take: opts.limit,
    include: { _count: { select: { items: true } } },
  });
  return rows.map(({ _count, ...r }) => ({ ...r, itemCount: _count.items }));
}

// ─── Tags (Phase 1 metadata) ──────────────────────────────────────

/** Replace-set a collection's tags to exactly `tagIds`. */
export async function setCollectionTags(
  collectionId: string,
  tagIds: string[],
): Promise<void> {
  const unique = Array.from(new Set(tagIds));
  await db.$transaction([
    db.studyCollectionTag.deleteMany({ where: { collectionId } }),
    ...(unique.length > 0
      ? [
          db.studyCollectionTag.createMany({
            data: unique.map((tagId) => ({ collectionId, tagId })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);
}

export async function listCollectionTagIds(
  collectionId: string,
): Promise<string[]> {
  const rows = await db.studyCollectionTag.findMany({
    where: { collectionId },
    select: { tagId: true },
  });
  return rows.map((r) => r.tagId);
}

/** Batch tag ids keyed by collection id (for summary enrichment). */
export async function listTagIdsForCollections(
  collectionIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (collectionIds.length === 0) return map;
  const rows = await db.studyCollectionTag.findMany({
    where: { collectionId: { in: collectionIds } },
    select: { collectionId: true, tagId: true },
  });
  for (const r of rows) {
    const list = map.get(r.collectionId) ?? [];
    list.push(r.tagId);
    map.set(r.collectionId, list);
  }
  return map;
}
