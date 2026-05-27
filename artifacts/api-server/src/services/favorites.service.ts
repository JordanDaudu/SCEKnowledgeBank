import * as favoritesRepo from "../repositories/favorites.repo";
import * as docsRepo from "../repositories/documents.repo";
import * as documentsService from "./documents.service";
import * as permissions from "./permissions.service";
import { forbidden, notFound } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";

async function loadVisibleDocument(
  documentId: string,
  user: AuthenticatedUser,
) {
  const doc = await docsRepo.findByIdAlive(documentId);
  if (!doc) throw notFound("Document not found");
  if (!permissions.canView(doc, user))
    throw forbidden("Cannot favorite this document");
  return doc;
}

export async function favoriteDocument(
  documentId: string,
  user: AuthenticatedUser,
): Promise<{ favorited: true }> {
  await loadVisibleDocument(documentId, user);
  await favoritesRepo.insertIfAbsent(user.id, documentId);
  return { favorited: true };
}

export async function unfavoriteDocument(
  documentId: string,
  user: AuthenticatedUser,
): Promise<{ favorited: false }> {
  // No visibility check on remove — users should always be able to
  // unsubscribe themselves, even if access has since been revoked.
  await favoritesRepo.deleteOne(user.id, documentId);
  return { favorited: false };
}

export async function isFavorited(
  documentId: string,
  user: AuthenticatedUser,
): Promise<boolean> {
  return favoritesRepo.isFavorited(user.id, documentId);
}

/**
 * "Following" list — documents the viewer has favorited that they can
 * still see. Re-checking visibility per row means revoking course
 * access (or a doc moving to private) drops the row from the list
 * even though the favorite row stays in the table.
 */
export async function listFavoritesForUser(
  user: AuthenticatedUser,
): Promise<documentsService.DocumentDTO[]> {
  const ids = await favoritesRepo.listDocumentIdsForUser(user.id);
  if (ids.length === 0) return [];
  const docs = await docsRepo.findManyByIdsAlive(ids);
  const visible = docs.filter((d) => permissions.canView(d, user));
  // Preserve favorite-recency ordering (the IDs from
  // listDocumentIdsForUser come back newest-first).
  const order = new Map(ids.map((id, i) => [id, i]));
  visible.sort(
    (a, b) =>
      (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
  return documentsService.assembleDocuments(visible, user);
}

/**
 * Producer-side helper for the M1 notification bus. Returns the set
 * of users that should receive a `document.activity` notification for
 * an event on `documentId`, minus `excludeUserIds` (typically the
 * actor + any users already covered by a more-specific notification
 * such as comment.mention or comment.reply).
 */
export async function recipientsForDocumentActivity(
  documentId: string,
  excludeUserIds: Iterable<string>,
): Promise<string[]> {
  const subscribers = await favoritesRepo.listSubscribersForDocument(
    documentId,
  );
  const exclude = new Set(excludeUserIds);
  return subscribers.filter((uid) => !exclude.has(uid));
}
