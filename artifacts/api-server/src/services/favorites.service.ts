import * as favoritesRepo from "../repositories/favorites.repo";
import * as docsRepo from "../repositories/documents.repo";
import * as enrollmentsRepo from "../repositories/enrollments.repo";
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
  const doc = await docsRepo.findByIdAlive(documentId);
  if (!doc) return [];
  const subscribers = await favoritesRepo.listSubscribersForDocument(
    documentId,
  );
  const exclude = new Set(excludeUserIds);
  const candidates = subscribers.filter((uid) => !exclude.has(uid));
  if (candidates.length === 0) return [];

  // Re-validate visibility on the producer side. Favorite rows survive
  // access revocation (so a user can still unsubscribe), so we must
  // never blindly fan out activity content to them. Mirror the same
  // rules permissions.canView enforces for a viewer:
  //   - public    → anyone
  //   - private   → uploader/owner only
  //   - restricted→ users currently enrolled in the doc's course
  // Documents hidden by the review workflow are also filtered out:
  // only the uploader/owner sees pre-approval activity.
  const reviewHidden = isReviewHiddenStatus(doc.status);
  const ownerAllowed = (uid: string) =>
    uid === doc.uploaderId || uid === doc.ownerId;

  if (reviewHidden) return candidates.filter(ownerAllowed);
  if (doc.visibility === "private") return candidates.filter(ownerAllowed);
  if (doc.visibility === "public") return candidates;
  if (doc.visibility === "restricted") {
    if (!doc.courseId) return candidates.filter(ownerAllowed);
    const enrolled = new Set(
      await enrollmentsRepo.findEnrolledUserIds(doc.courseId, candidates),
    );
    return candidates.filter((uid) => ownerAllowed(uid) || enrolled.has(uid));
  }
  return [];
}

// Mirrors permissions.isReviewHidden without pulling the whole module
// graph (which would otherwise create an import cycle through
// documents.service for the producer code path).
function isReviewHiddenStatus(status: string | null | undefined): boolean {
  // Keep in lockstep with `permissions.REVIEW_HIDDEN_STATUSES`.
  // Sprint-3 completion: `draft` joined the hidden set.
  return (
    status === "draft" ||
    status === "pending_review" ||
    status === "rejected"
  );
}
