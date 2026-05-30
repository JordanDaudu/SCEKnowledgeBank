/**
 * Phase 2 — engagement (likes, ratings, views) on PUBLIC collections.
 *
 * Read/follow/recommend stay in prep-hub.service; collection CRUD stays in
 * collections.service. This module only writes the engagement event rows
 * (the repo maintains the denormalised counters) and returns a refreshed
 * detail DTO. Private collections are never engageable — 404, never 403.
 */
import * as collectionsRepo from "../repositories/collections.repo";
import * as engagementRepo from "../repositories/collection-engagement.repo";
import * as collectionsService from "./collections.service";
import { badRequest, notFound } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";
import type { CollectionDetailDTO } from "./collections.service";

/** A collection accepts engagement iff it is public or official. */
function isPublic(c: collectionsRepo.CollectionRow): boolean {
  return c.visibility === "public" || c.isOfficial;
}

/** Load a public collection or 404. */
async function loadEngageable(
  id: string,
): Promise<collectionsRepo.CollectionRow> {
  const c = await collectionsRepo.findCollectionById(id);
  if (!c || !isPublic(c)) throw notFound("Collection not found");
  return c;
}

async function refreshed(
  c: collectionsRepo.CollectionRow,
  user: AuthenticatedUser,
): Promise<CollectionDetailDTO> {
  const fresh = (await collectionsRepo.findCollectionById(c.id)) ?? c;
  return collectionsService.assembleDetail(fresh, user);
}

export async function likeCollection(
  id: string,
  user: AuthenticatedUser,
): Promise<CollectionDetailDTO> {
  const c = await loadEngageable(id);
  if (c.ownerId === user.id) throw badRequest("You can't like your own collection");
  await engagementRepo.likeCollection(id, user.id);
  return refreshed(c, user);
}

export async function unlikeCollection(
  id: string,
  user: AuthenticatedUser,
): Promise<CollectionDetailDTO> {
  const c = await loadEngageable(id);
  await engagementRepo.unlikeCollection(id, user.id);
  return refreshed(c, user);
}

export async function rateCollection(
  id: string,
  user: AuthenticatedUser,
  value: number,
): Promise<CollectionDetailDTO> {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw badRequest("Rating must be an integer from 1 to 5");
  }
  const c = await loadEngageable(id);
  if (c.ownerId === user.id) throw badRequest("You can't rate your own collection");
  await engagementRepo.setRating(id, user.id, value);
  return refreshed(c, user);
}

export async function clearRating(
  id: string,
  user: AuthenticatedUser,
): Promise<CollectionDetailDTO> {
  const c = await loadEngageable(id);
  await engagementRepo.clearRating(id, user.id);
  return refreshed(c, user);
}

/** Record a view (non-fatal). Called from prep-hub.getPublicCollection. */
export async function recordView(
  id: string,
  user: AuthenticatedUser,
): Promise<void> {
  await engagementRepo.tryRecordView(id, user.id);
}
