/**
 * Prep Hub — community discovery over PUBLIC study collections.
 *
 * Read + follow + recommend only. All write/management lives in
 * collections.service. Private collections are never exposed here — not even
 * to their owner (owners manage them in the Collections module).
 */
import * as collectionsRepo from "../repositories/collections.repo";
import * as collectionsService from "./collections.service";
import * as recommendationsService from "./recommendations.service";
import { notFound } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";
import type {
  CollectionSummaryDTO,
  CollectionDetailDTO,
} from "./collections.service";

/** A collection is in Prep Hub iff it is public or official (curated). */
function isPublic(c: collectionsRepo.CollectionRow): boolean {
  return c.visibility === "public" || c.isOfficial;
}

export async function listDiscoverable(
  user: AuthenticatedUser,
  opts: { sort?: collectionsRepo.DiscoverSort; courseId?: string; limit?: number },
): Promise<CollectionSummaryDTO[]> {
  const rows = await collectionsRepo.listDiscoverable({
    sort: opts.sort ?? "popular",
    courseId: opts.courseId,
    limit: Math.min(opts.limit ?? 24, 50),
  });
  return collectionsService.summarize(rows, user);
}

export async function getPublicCollection(
  id: string,
  user: AuthenticatedUser,
): Promise<CollectionDetailDTO> {
  const c = await collectionsRepo.findCollectionById(id);
  // Private collections must never appear in Prep Hub — 404 (not 403) so we
  // don't reveal existence.
  if (!c || !isPublic(c)) throw notFound("Collection not found");
  return collectionsService.assembleDetail(c, user);
}

export async function followCollection(
  id: string,
  user: AuthenticatedUser,
): Promise<CollectionDetailDTO> {
  const c = await collectionsRepo.findCollectionById(id);
  if (!c || !isPublic(c)) throw notFound("Collection not found");
  const created = await collectionsRepo.followCollection(id, user.id);
  if (created) await collectionsService.recomputePopularity(id);
  const fresh = (await collectionsRepo.findCollectionById(id)) ?? c;
  return collectionsService.assembleDetail(fresh, user);
}

export async function unfollowCollection(
  id: string,
  user: AuthenticatedUser,
): Promise<CollectionDetailDTO> {
  const c = await collectionsRepo.findCollectionById(id);
  if (!c || !isPublic(c)) throw notFound("Collection not found");
  const removed = await collectionsRepo.unfollowCollection(id, user.id);
  if (removed) await collectionsService.recomputePopularity(id);
  const fresh = (await collectionsRepo.findCollectionById(id)) ?? c;
  return collectionsService.assembleDetail(fresh, user);
}

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
  return collectionsService.summarize(rows, user);
}
