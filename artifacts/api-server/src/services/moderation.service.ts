/**
 * Phase 4 — admin moderation of public collections. Hide/unhide (reversible),
 * remove any comment, and a lean moderation list. Every action is audited.
 * Admin-only: each function re-checks isAdmin (defensive, in addition to the
 * route's requireAdmin) and never touches private collections.
 */
import * as collectionsRepo from "../repositories/collections.repo";
import * as commentsRepo from "../repositories/collection-comments.repo";
import * as collectionsService from "./collections.service";
import * as permissions from "./permissions.service";
import * as audit from "./audit.service";
import { forbidden, notFound } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";
import type {
  CollectionDetailDTO,
  CollectionSummaryDTO,
} from "./collections.service";

function isPublic(c: collectionsRepo.CollectionRow): boolean {
  return c.visibility === "public" || c.isOfficial;
}

function requireAdmin(user: AuthenticatedUser): void {
  if (!permissions.isAdmin(user)) throw forbidden("Administrators only");
}

/** Load a public/official collection that an admin may moderate, else 404. */
async function loadModeratable(
  id: string,
): Promise<collectionsRepo.CollectionRow> {
  const c = await collectionsRepo.findCollectionById(id);
  if (!c || !isPublic(c)) throw notFound("Collection not found");
  return c;
}

export async function hideCollection(
  user: AuthenticatedUser,
  id: string,
  reason?: string,
): Promise<CollectionDetailDTO> {
  requireAdmin(user);
  await loadModeratable(id);
  await collectionsRepo.hideCollection(id, user.id, reason?.trim() || null);
  await audit.record(user.id, "collection.hidden", "study_collection", id, {
    reason: reason?.trim() || null,
  });
  const fresh = await collectionsRepo.findCollectionById(id);
  if (!fresh) throw notFound("Collection not found");
  return collectionsService.assembleDetail(fresh, user);
}

export async function unhideCollection(
  user: AuthenticatedUser,
  id: string,
): Promise<CollectionDetailDTO> {
  requireAdmin(user);
  await loadModeratable(id);
  await collectionsRepo.unhideCollection(id);
  await audit.record(user.id, "collection.unhidden", "study_collection", id);
  const fresh = await collectionsRepo.findCollectionById(id);
  if (!fresh) throw notFound("Collection not found");
  return collectionsService.assembleDetail(fresh, user);
}

export async function removeComment(
  user: AuthenticatedUser,
  commentId: string,
): Promise<void> {
  requireAdmin(user);
  const existing = await commentsRepo.findCommentById(commentId);
  if (!existing) throw notFound("Comment not found");
  await commentsRepo.softDeleteComment(commentId);
  await audit.record(
    user.id,
    "collection.comment.removed",
    "study_collection_comment",
    commentId,
    { collectionId: existing.collectionId },
  );
}

export interface ModerationListDTO {
  collections: CollectionSummaryDTO[];
  stats: { totalPublic: number; totalHidden: number };
}

export async function listModeration(
  user: AuthenticatedUser,
  opts: { includeHidden?: boolean; limit?: number },
): Promise<ModerationListDTO> {
  requireAdmin(user);
  const rows = await collectionsRepo.listForModeration({
    includeHidden: opts.includeHidden ?? true,
    limit: Math.min(opts.limit ?? 50, 100),
  });
  const collections = await collectionsService.summarize(rows, user);
  const [totalPublic, totalHidden] = await Promise.all([
    collectionsRepo.countPublicCollections(),
    collectionsRepo.countHiddenCollections(),
  ]);
  return { collections, stats: { totalPublic, totalHidden } };
}
