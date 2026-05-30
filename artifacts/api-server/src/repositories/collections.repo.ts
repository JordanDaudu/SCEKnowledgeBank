import { db, Prisma } from "@workspace/db";
import { COLLECTION_RANKING as CR } from "../lib/collection-ranking";

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
  likeCount: number;
  ratingCount: number;
  ratingSum: number;
  viewCount: number;
  commentCount: number;
  examDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  hiddenAt: Date | null;
  hiddenBy: string | null;
  hiddenReason: string | null;
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

/** Bulk-insert items into a collection at sequential positions (0..n-1).
 *  Single createMany — atomic, used by duplicate. Idempotent on the
 *  (collection, document) unique key. */
export async function bulkAddItems(
  collectionId: string,
  items: { documentId: string; note?: string | null }[],
): Promise<void> {
  if (items.length === 0) return;
  await db.studyCollectionItem.createMany({
    data: items.map((it, index) => ({
      collectionId,
      documentId: it.documentId,
      position: index,
      note: it.note ?? null,
    })),
    skipDuplicates: true,
  });
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

/** Follow a collection. Idempotent on (collection, user); on a real insert
 *  bumps follower_count in the same transaction. Returns true iff inserted. */
export async function followCollection(
  collectionId: string,
  userId: string,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const r = await tx.studyCollectionFollower.createMany({
      data: [{ collectionId, userId }],
      skipDuplicates: true,
    });
    if (r.count > 0) {
      await tx.studyCollection.update({
        where: { id: collectionId },
        data: { followerCount: { increment: 1 } },
      });
    }
    return r.count > 0;
  });
}

/** Unfollow a collection. Returns true iff a follow row was removed (then
 *  decrements follower_count). */
export async function unfollowCollection(
  collectionId: string,
  userId: string,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const r = await tx.studyCollectionFollower.deleteMany({
      where: { collectionId, userId },
    });
    if (r.count > 0) {
      await tx.studyCollection.update({
        where: { id: collectionId },
        data: { followerCount: { decrement: 1 } },
      });
    }
    return r.count > 0;
  });
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

export type DiscoverSort =
  | "popular" | "recent" | "new" | "rating" | "views" | "trending" | "exam";

/** Prefix-aware tsquery from raw user input (mirrors documents prefixTsQuery). */
function collectionTsQuery(q: string): Prisma.Sql {
  const tokens = q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `${t}:*`);
  if (tokens.length === 0) return Prisma.sql`to_tsquery('english', '')`;
  return Prisma.sql`to_tsquery('english', ${tokens.join(" & ")})`;
}

/** True if the query yields at least one search token (else FTS matches nothing). */
function collectionTsQueryHasTokens(q: string): boolean {
  return q.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).length > 0;
}

function normSql(col: Prisma.Sql, scale: number): Prisma.Sql {
  return Prisma.sql`LEAST(ln(1 + ${col}) / ln(1 + ${scale}::float8), 1.0)`;
}

/** Combined discovery/search score. `rel` is the [0,1] relevance term (0 when
 *  there is no query). Reads the Phase-2 denormalised columns. */
function combinedScoreSql(rel: Prisma.Sql): Prisma.Sql {
  const rating = Prisma.sql`(CASE WHEN sc.rating_count > 0 THEN (sc.rating_sum::float8 / sc.rating_count / 5.0) ELSE 0 END)`;
  return Prisma.sql`(
    ${CR.relevanceWeight}::float8 * ${rel}
    + ${CR.ratingWeight}::float8 * ${rating}
    + ${CR.likeWeight}::float8 * ${normSql(Prisma.sql`sc.like_count`, CR.likeScale)}
    + ${CR.saveWeight}::float8 * ${normSql(Prisma.sql`sc.follower_count`, CR.saveScale)}
    + ${CR.viewWeight}::float8 * ${normSql(Prisma.sql`sc.view_count`, CR.viewScale)}
  )`;
}

/** Bayesian-shrunk average rating, for the Highest-Rated sort. */
function bayesRatingSql(): Prisma.Sql {
  return Prisma.sql`((sc.rating_sum + ${CR.ratingPriorMean}::float8 * ${CR.ratingPriorWeight}::float8) / (sc.rating_count + ${CR.ratingPriorWeight}::float8))`;
}

/** Fetch full collection rows for the given ids, preserving id order, with itemCount. */
async function fetchCollectionsByIdOrder(
  ids: string[],
): Promise<Array<CollectionRow & { itemCount: number }>> {
  if (ids.length === 0) return [];
  const rows = await db.studyCollection.findMany({
    where: { id: { in: ids } },
    include: { _count: { select: { items: true } } },
  });
  const byId = new Map(
    rows.map((r) => {
      const { _count, ...rest } = r;
      return [r.id, { ...rest, itemCount: _count.items } as CollectionRow & { itemCount: number }];
    }),
  );
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is CollectionRow & { itemCount: number } => !!r);
}

/** Trailing-window trending: weighted count of recent engagement events per
 *  visible collection, since `since`. Collections with no in-window activity
 *  are excluded. */
export async function listTrending(opts: {
  since: Date;
  limit: number;
}): Promise<Array<CollectionRow & { itemCount: number }>> {
  const idRows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH activity AS (
      SELECT collection_id, ${CR.trendingViewWeight}::float8 * count(*) AS score
      FROM study_collection_views WHERE viewed_at >= ${opts.since} GROUP BY collection_id
      UNION ALL
      SELECT collection_id, ${CR.trendingLikeWeight}::float8 * count(*)
      FROM study_collection_likes WHERE created_at >= ${opts.since} GROUP BY collection_id
      UNION ALL
      SELECT collection_id, ${CR.trendingFollowWeight}::float8 * count(*)
      FROM study_collection_followers WHERE created_at >= ${opts.since} GROUP BY collection_id
      UNION ALL
      SELECT collection_id, ${CR.trendingCommentWeight}::float8 * count(*)
      FROM study_collection_comments WHERE created_at >= ${opts.since} AND deleted_at IS NULL GROUP BY collection_id
    )
    SELECT sc.id
    FROM study_collections sc
    JOIN (SELECT collection_id, sum(score) AS score FROM activity GROUP BY collection_id) a
      ON a.collection_id = sc.id
    WHERE sc.deleted_at IS NULL AND (sc.visibility = 'public' OR sc.is_official = true) AND sc.hidden_at IS NULL
    ORDER BY a.score DESC, sc.created_at DESC
    LIMIT ${opts.limit}
  `);
  return fetchCollectionsByIdOrder(idRows.map((r) => r.id));
}

/** Collections discoverable by other users: public OR official, not deleted.
 *  Optional FTS (`q`) and course scope. Sorted per `sort`. */
export async function listDiscoverable(opts: {
  sort: DiscoverSort;
  q?: string;
  courseId?: string;
  limit: number;
}): Promise<Array<CollectionRow & { itemCount: number }>> {
  const where: Prisma.Sql[] = [
    Prisma.sql`sc.deleted_at IS NULL`,
    Prisma.sql`(sc.visibility = 'public' OR sc.is_official = true)`,
    Prisma.sql`sc.hidden_at IS NULL`,
  ];
  if (opts.courseId) where.push(Prisma.sql`sc.course_id = ${opts.courseId}::uuid`);

  const q = opts.q?.trim();
  const hasQ = !!q && collectionTsQueryHasTokens(q);
  if (hasQ) where.push(Prisma.sql`sc.search_vector @@ ${collectionTsQuery(q!)}`);
  if (opts.sort === "exam") {
    where.push(Prisma.sql`sc.exam_date IS NOT NULL AND sc.exam_date > now()`);
  }

  const rel = hasQ
    ? Prisma.sql`(ts_rank(sc.search_vector, ${collectionTsQuery(q!)}) / (ts_rank(sc.search_vector, ${collectionTsQuery(q!)}) + 1))`
    : Prisma.sql`0`;

  const recent = Prisma.sql`sc.created_at DESC`;
  let orderBy: Prisma.Sql;
  if (hasQ) {
    orderBy = Prisma.sql`${combinedScoreSql(rel)} DESC, ${recent}`;
  } else {
    switch (opts.sort) {
      case "recent":
      case "new":
        orderBy = recent;
        break;
      case "rating":
        orderBy = Prisma.sql`${bayesRatingSql()} DESC, sc.rating_count DESC, ${recent}`;
        break;
      case "views":
        orderBy = Prisma.sql`sc.view_count DESC, ${recent}`;
        break;
      case "exam":
        orderBy = Prisma.sql`sc.exam_date ASC`;
        break;
      case "popular":
      default:
        orderBy = Prisma.sql`${combinedScoreSql(Prisma.sql`0`)} DESC, ${recent}`;
        break;
    }
  }

  const idRows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT sc.id
    FROM study_collections sc
    WHERE ${Prisma.join(where, " AND ")}
    ORDER BY ${orderBy}
    LIMIT ${opts.limit}
  `);
  return fetchCollectionsByIdOrder(idRows.map((r) => r.id));
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
      hiddenAt: null,
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
  await db.$transaction(async (tx) => {
    await tx.studyCollectionTag.deleteMany({ where: { collectionId } });
    if (unique.length > 0) {
      await tx.studyCollectionTag.createMany({
        data: unique.map((tagId) => ({ collectionId, tagId })),
        skipDuplicates: true,
      });
    }
  });
}

/** Tag ids attached to a single collection. */
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

// ─── Moderation (Phase 4) ─────────────────────────────────────────

/** Hide a collection from all public surfaces (reversible). */
export async function hideCollection(
  id: string,
  adminId: string,
  reason: string | null,
): Promise<void> {
  await db.studyCollection.update({
    where: { id },
    data: { hiddenAt: new Date(), hiddenBy: adminId, hiddenReason: reason, updatedAt: new Date() },
  });
}

/** Reverse a hide. */
export async function unhideCollection(id: string): Promise<void> {
  await db.studyCollection.update({
    where: { id },
    data: { hiddenAt: null, hiddenBy: null, hiddenReason: null, updatedAt: new Date() },
  });
}

/** Public/official collections for the admin moderation list. When
 *  `includeHidden` is false, hidden ones are excluded. Newest first. */
export async function listForModeration(opts: {
  includeHidden: boolean;
  limit: number;
}): Promise<Array<CollectionRow & { itemCount: number }>> {
  const rows = await db.studyCollection.findMany({
    where: {
      deletedAt: null,
      OR: [{ visibility: "public" }, { isOfficial: true }],
      ...(opts.includeHidden ? {} : { hiddenAt: null }),
    },
    orderBy: [{ createdAt: "desc" }],
    take: opts.limit,
    include: { _count: { select: { items: true } } },
  });
  return rows.map(({ _count, ...r }) => ({ ...r, itemCount: _count.items }));
}

export async function countPublicCollections(): Promise<number> {
  return db.studyCollection.count({
    where: { deletedAt: null, OR: [{ visibility: "public" }, { isOfficial: true }] },
  });
}

export async function countHiddenCollections(): Promise<number> {
  return db.studyCollection.count({
    where: { deletedAt: null, hiddenAt: { not: null } },
  });
}
