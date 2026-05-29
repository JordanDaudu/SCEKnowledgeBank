/**
 * Refinement Phase 6d — recommendations.
 *
 * "Recommended for you": top-ranked documents (Phase 2 score) in the courses
 * the user cares about — their enrolments plus the courses of what they've
 * recently viewed / favorited — excluding documents they've already engaged
 * with so suggestions stay fresh. Falls back to globally top-ranked content
 * when there's no interest signal yet (new accounts).
 */
import * as docsRepo from "../repositories/documents.repo";
import * as viewRepo from "../repositories/viewHistory.repo";
import * as favoritesRepo from "../repositories/favorites.repo";
import * as studyProgressRepo from "../repositories/studyProgress.repo";
import * as documentsService from "./documents.service";
import * as permissions from "./permissions.service";
import type { AuthenticatedUser } from "../middlewares/auth";

export async function getRecommendations(
  user: AuthenticatedUser,
  limit = 8,
): Promise<documentsService.DocumentDTO[]> {
  // Engagement signals — what the user has already seen (also our exclude set).
  const [recentIds, favoriteIds, inProgressIds] = await Promise.all([
    viewRepo.listRecentDocumentIdsForUser(user.id, 30),
    favoritesRepo.listDocumentIdsForUser(user.id, 100),
    studyProgressRepo.listInProgressDocumentIds(user.id, 50),
  ]);
  const seen = Array.from(new Set([...recentIds, ...favoriteIds, ...inProgressIds]));

  // Interest courses: enrolments + courses of the documents the user has
  // engaged with.
  const enrolledCourseIds = user.enrollments.map((e) => e.courseId);
  const engagedDocs = seen.length > 0 ? await docsRepo.findManyByIdsAlive(seen) : [];
  const engagedCourseIds = engagedDocs
    .map((d) => d.courseId)
    .filter((c): c is string => !!c);
  const courseIds = Array.from(new Set([...enrolledCourseIds, ...engagedCourseIds]));

  const visibilitySql = permissions.visibleDocumentFilterSql(user);

  // Primary pass: scoped to interest courses. If that yields too little
  // (or there are no interest courses), top up with a global pass.
  const primary =
    courseIds.length > 0
      ? await docsRepo.recommendDocuments(visibilitySql, {
          courseIds,
          excludeIds: seen,
          limit,
        })
      : [];

  let rows = primary;
  if (rows.length < limit) {
    const excludeForGlobal = Array.from(
      new Set([...seen, ...rows.map((r) => r.id)]),
    );
    const global = await docsRepo.recommendDocuments(visibilitySql, {
      excludeIds: excludeForGlobal,
      limit: limit - rows.length,
    });
    rows = [...rows, ...global];
  }

  return documentsService.assembleDocuments(rows, user);
}
