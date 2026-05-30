/**
 * Refinement Phase 6 — study collections (Prep Hub).
 *
 * Collections are user-owned ordered groupings of EXISTING documents. This
 * service owns ownership enforcement, document-visibility checks on add, and
 * DTO assembly (reusing documentsService so item cards match the rest of the
 * app). Items reference documents by id only — nothing is duplicated.
 */
import * as collectionsRepo from "../repositories/collections.repo";
import * as studyProgressRepo from "../repositories/studyProgress.repo";
import * as docsRepo from "../repositories/documents.repo";
import * as documentsService from "./documents.service";
import * as recommendationsService from "./recommendations.service";
import * as permissions from "./permissions.service";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { computePopularity } from "../lib/collection-popularity";
import type { AuthenticatedUser } from "../middlewares/auth";

const COLLECTION_KINDS = [
  "collection",
  "exam_prep",
  "revision",
  "semester",
  "learning_path",
] as const;

const VISIBILITIES = ["private", "public"] as const;

const SEMESTERS = ["fall", "spring", "summer"] as const;

export interface CollectionSummaryDTO {
  id: string;
  title: string;
  description: string;
  kind: string;
  visibility: string;
  courseId?: string;
  categoryId?: string;
  examName?: string;
  semester?: string;
  academicYear?: number;
  tagIds: string[];
  isOfficial: boolean;
  examDate?: string;
  itemCount: number;
  completedCount: number;
  progressPercent: number;
  followerCount: number;
  isFollowing: boolean;
  popularityScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionItemDTO {
  document: documentsService.DocumentDTO;
  note?: string;
  position: number;
  progress?: studyProgressRepo.ProgressStatus;
}

export interface CollectionDetailDTO extends CollectionSummaryDTO {
  items: CollectionItemDTO[];
}

interface SummaryExtra {
  followerCount?: number;
  isFollowing?: boolean;
  completedCount?: number;
  tagIds?: string[];
}

function toSummary(
  c: collectionsRepo.CollectionRow & { itemCount: number },
  extra: SummaryExtra = {},
): CollectionSummaryDTO {
  const completedCount = Math.min(extra.completedCount ?? 0, c.itemCount);
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    kind: c.kind,
    visibility: c.visibility,
    courseId: c.courseId ?? undefined,
    categoryId: c.categoryId ?? undefined,
    examName: c.examName ?? undefined,
    semester: c.semester ?? undefined,
    academicYear: c.academicYear ?? undefined,
    tagIds: extra.tagIds ?? [],
    isOfficial: c.isOfficial,
    examDate: c.examDate?.toISOString(),
    itemCount: c.itemCount,
    completedCount,
    progressPercent:
      c.itemCount > 0 ? Math.round((completedCount / c.itemCount) * 100) : 0,
    followerCount: extra.followerCount ?? 0,
    isFollowing: extra.isFollowing ?? false,
    popularityScore: c.popularityScore,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** Enrich a batch of collection rows with the viewer's follow state, follower
 *  counts, and completed-item counts (one batched query each — no N+1). */
async function summarize(
  rows: Array<collectionsRepo.CollectionRow & { itemCount: number }>,
  user: AuthenticatedUser,
): Promise<CollectionSummaryDTO[]> {
  const ids = rows.map((r) => r.id);
  const [followerCounts, followed, completed, tagMap] = await Promise.all([
    collectionsRepo.countFollowersForCollections(ids),
    collectionsRepo.listFollowedCollectionIds(user.id, ids),
    collectionsRepo.countCompletedForCollections(user.id, ids),
    collectionsRepo.listTagIdsForCollections(ids),
  ]);
  return rows.map((r) =>
    toSummary(r, {
      followerCount: followerCounts.get(r.id) ?? 0,
      isFollowing: followed.has(r.id),
      completedCount: completed.get(r.id) ?? 0,
      tagIds: tagMap.get(r.id) ?? [],
    }),
  );
}

/** Recompute and persist a collection's popularity score (US-55). Called
 *  whenever its followers or items change. */
async function recomputePopularity(collectionId: string): Promise<void> {
  const [items, followers] = await Promise.all([
    collectionsRepo.countItems(collectionId),
    collectionsRepo.countFollowers(collectionId),
  ]);
  await collectionsRepo.setPopularityScore(
    collectionId,
    computePopularity(followers, items),
  );
}

/** Load a collection the user is allowed to MANAGE (owner only). */
async function loadOwned(
  id: string,
  user: AuthenticatedUser,
): Promise<collectionsRepo.CollectionRow> {
  const c = await collectionsRepo.findCollectionById(id);
  if (!c) throw notFound("Collection not found");
  if (c.ownerId !== user.id) throw forbidden("Not your collection");
  return c;
}

/** Load a collection the user is allowed to VIEW: their own, or any public /
 *  official (curated) collection. Management still requires ownership. */
async function loadVisible(
  id: string,
  user: AuthenticatedUser,
): Promise<collectionsRepo.CollectionRow> {
  const c = await collectionsRepo.findCollectionById(id);
  if (!c) throw notFound("Collection not found");
  if (c.ownerId === user.id || c.visibility === "public" || c.isOfficial) {
    return c;
  }
  throw forbidden("This collection is private");
}

export async function createCollection(
  user: AuthenticatedUser,
  input: {
    title: string;
    description?: string;
    kind?: string;
    courseId?: string | null;
    categoryId?: string | null;
    examName?: string | null;
    semester?: string | null;
    academicYear?: number | null;
    tagIds?: string[];
    visibility?: string;
    examDate?: Date | null;
    /** Optionally seed the bundle with these documents at creation (US-51). */
    documentIds?: string[];
  },
): Promise<CollectionSummaryDTO> {
  const title = input.title?.trim();
  if (!title) throw badRequest("Title is required");
  if (input.kind && !(COLLECTION_KINDS as readonly string[]).includes(input.kind)) {
    throw badRequest(`Unknown kind. Allowed: ${COLLECTION_KINDS.join(", ")}`);
  }
  if (
    input.visibility &&
    !(VISIBILITIES as readonly string[]).includes(input.visibility)
  ) {
    throw badRequest(`Unknown visibility. Allowed: ${VISIBILITIES.join(", ")}`);
  }
  if (input.semester && !(SEMESTERS as readonly string[]).includes(input.semester)) {
    throw badRequest(`Unknown semester. Allowed: ${SEMESTERS.join(", ")}`);
  }

  // Validate every selected material up front (US-51): they must exist and be
  // visible to the user, so we never create a bundle then half-fill it.
  const documentIds = Array.from(new Set(input.documentIds ?? []));
  if (documentIds.length > 0) {
    const docs = await docsRepo.findManyByIdsAlive(documentIds);
    const allowed = new Set(
      docs.filter((d) => permissions.canView(d, user)).map((d) => d.id),
    );
    const invalid = documentIds.filter((id) => !allowed.has(id));
    if (invalid.length > 0) {
      throw badRequest(
        "One or more selected materials don't exist or aren't accessible to you",
      );
    }
  }

  const created = await collectionsRepo.createCollection({
    ownerId: user.id,
    title,
    description: input.description?.trim() ?? "",
    kind: input.kind ?? "collection",
    courseId: input.courseId ?? null,
    categoryId: input.categoryId ?? null,
    examName: input.examName?.trim() || null,
    semester: input.semester ?? null,
    academicYear: input.academicYear ?? null,
    visibility: input.visibility ?? "private",
    examDate: input.examDate ?? null,
  });
  for (const documentId of documentIds) {
    await collectionsRepo.addItem(created.id, documentId);
  }
  if (documentIds.length > 0) await recomputePopularity(created.id);
  const tagIds = Array.from(new Set(input.tagIds ?? []));
  if (tagIds.length > 0) {
    await collectionsRepo.setCollectionTags(created.id, tagIds);
  }
  return toSummary({ ...created, itemCount: documentIds.length }, { tagIds });
}

export async function listMyCollections(
  user: AuthenticatedUser,
): Promise<CollectionSummaryDTO[]> {
  const rows = await collectionsRepo.listCollectionsForOwner(user.id);
  return summarize(rows, user);
}

/** Discoverable (shared/official) collections, ranked (US-55). */
export async function listDiscoverable(
  user: AuthenticatedUser,
  opts: { sort?: collectionsRepo.DiscoverSort; courseId?: string; limit?: number },
): Promise<CollectionSummaryDTO[]> {
  const rows = await collectionsRepo.listDiscoverable({
    sort: opts.sort ?? "popular",
    courseId: opts.courseId,
    limit: Math.min(opts.limit ?? 24, 50),
  });
  return summarize(rows, user);
}

/** Recommend shared/official bundles in the user's interest courses (US-62).
 *  Returns a clean empty list when there's no course signal or no matches. */
export async function getRecommendedCollections(
  user: AuthenticatedUser,
  limit = 6,
): Promise<CollectionSummaryDTO[]> {
  const { courseIds } = await recommendationsService.getInterestCourseIds(user);
  if (courseIds.length === 0) return [];
  const followed = await collectionsRepo.listFollowedCollectionIds(user.id);
  const rows = await collectionsRepo.recommendCollections({
    courseIds,
    excludeOwnerId: user.id,
    excludeIds: Array.from(followed),
    limit,
  });
  return summarize(rows, user);
}

export async function getCollection(
  id: string,
  user: AuthenticatedUser,
): Promise<CollectionDetailDTO> {
  const c = await loadVisible(id, user);
  const itemRows = await collectionsRepo.listItems(id);
  const docIds = itemRows.map((i) => i.documentId);
  const docs = await docsRepo.findManyByIdsAlive(docIds);
  // Only surface documents the user can still see (access may have changed
  // since the item was added). Item order is preserved from itemRows.
  const visible = docs.filter((d) => permissions.canView(d, user));
  const dtos = await documentsService.assembleDocuments(visible, user);
  const dtoById = new Map(dtos.map((d) => [d.id, d]));
  const progress = await studyProgressRepo.getProgressForDocuments(
    user.id,
    docIds,
  );
  const items: CollectionItemDTO[] = itemRows
    .filter((i) => dtoById.has(i.documentId))
    .map((i) => ({
      document: dtoById.get(i.documentId)!,
      note: i.note ?? undefined,
      position: i.position,
      progress: progress.get(i.documentId),
    }));
  const completedCount = items.filter((i) => i.progress === "completed").length;
  const [followerCount, following, tagIds] = await Promise.all([
    collectionsRepo.countFollowers(id),
    collectionsRepo.isFollowing(id, user.id),
    collectionsRepo.listCollectionTagIds(id),
  ]);
  const summary = toSummary(
    { ...c, itemCount: items.length },
    { followerCount, isFollowing: following, completedCount, tagIds },
  );
  return { ...summary, items };
}

/** Follow a shared/official collection (US-56). Owners may follow their own
 *  too — harmless and keeps the UI uniform. Idempotent. */
export async function followCollection(
  id: string,
  user: AuthenticatedUser,
): Promise<CollectionDetailDTO> {
  await loadVisible(id, user);
  const created = await collectionsRepo.followCollection(id, user.id);
  if (created) await recomputePopularity(id);
  return getCollection(id, user);
}

export async function unfollowCollection(
  id: string,
  user: AuthenticatedUser,
): Promise<CollectionDetailDTO> {
  await loadVisible(id, user);
  const removed = await collectionsRepo.unfollowCollection(id, user.id);
  if (removed) await recomputePopularity(id);
  return getCollection(id, user);
}

export async function updateCollection(
  id: string,
  user: AuthenticatedUser,
  patch: {
    title?: string;
    description?: string;
    kind?: string;
    visibility?: string;
    examDate?: Date | null;
    categoryId?: string | null;
    examName?: string | null;
    semester?: string | null;
    academicYear?: number | null;
    tagIds?: string[];
  },
): Promise<void> {
  await loadOwned(id, user);
  const data: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const t = patch.title.trim();
    if (!t) throw badRequest("Title cannot be empty");
    data.title = t;
  }
  if (patch.description !== undefined) data.description = patch.description.trim();
  if (patch.kind !== undefined) {
    if (!(COLLECTION_KINDS as readonly string[]).includes(patch.kind)) {
      throw badRequest(`Unknown kind. Allowed: ${COLLECTION_KINDS.join(", ")}`);
    }
    data.kind = patch.kind;
  }
  if (patch.visibility !== undefined) {
    if (!(VISIBILITIES as readonly string[]).includes(patch.visibility)) {
      throw badRequest(`Unknown visibility. Allowed: ${VISIBILITIES.join(", ")}`);
    }
    data.visibility = patch.visibility;
  }
  if (patch.examDate !== undefined) data.examDate = patch.examDate;
  if (patch.semester !== undefined) {
    if (patch.semester !== null && !(SEMESTERS as readonly string[]).includes(patch.semester)) {
      throw badRequest(`Unknown semester. Allowed: ${SEMESTERS.join(", ")}`);
    }
    data.semester = patch.semester;
  }
  if (patch.categoryId !== undefined) data.categoryId = patch.categoryId;
  if (patch.examName !== undefined) data.examName = patch.examName?.trim() || null;
  if (patch.academicYear !== undefined) data.academicYear = patch.academicYear;
  await collectionsRepo.updateCollection(id, data);
  if (patch.tagIds !== undefined) {
    await collectionsRepo.setCollectionTags(id, patch.tagIds);
  }
}

export async function deleteCollection(
  id: string,
  user: AuthenticatedUser,
): Promise<void> {
  await loadOwned(id, user);
  await collectionsRepo.softDeleteCollection(id);
}

export async function addDocument(
  id: string,
  user: AuthenticatedUser,
  documentId: string,
  note?: string,
): Promise<void> {
  await loadOwned(id, user);
  // The document must exist and be visible to the user — you can't stash a
  // document you can't see.
  const doc = await docsRepo.findByIdAlive(documentId);
  if (!doc || !permissions.canView(doc, user)) {
    throw notFound("Document not found");
  }
  await collectionsRepo.addItem(id, documentId, note?.trim() || undefined);
  await recomputePopularity(id);
}

export async function removeDocument(
  id: string,
  user: AuthenticatedUser,
  documentId: string,
): Promise<void> {
  await loadOwned(id, user);
  await collectionsRepo.removeItem(id, documentId);
  await recomputePopularity(id);
}

export async function setItemNote(
  id: string,
  user: AuthenticatedUser,
  documentId: string,
  note: string | null,
): Promise<void> {
  await loadOwned(id, user);
  await collectionsRepo.updateItemNote(id, documentId, note?.trim() || null);
}

export async function reorder(
  id: string,
  user: AuthenticatedUser,
  orderedDocumentIds: string[],
): Promise<void> {
  await loadOwned(id, user);
  await collectionsRepo.reorderItems(id, orderedDocumentIds);
}
