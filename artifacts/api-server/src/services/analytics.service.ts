/**
 * M5 analytics service. Wraps the raw aggregation queries in
 * `analytics.repo` with:
 *   1. permission gates that delegate to `permissions.service`
 *      (admin for the workspace overview; admin OR lecturer-for-course
 *      for the per-course view).
 *   2. a tiny in-memory TTL cache so that the dashboard pages don't
 *      hammer the DB when a user rapidly refreshes or two admins are
 *      looking at the same data.
 *
 * The cache is process-local and intentionally simple — we don't need
 * cross-instance coherence here (data is read-only, slightly-stale is
 * fine, and the worst case is a 30-second-old number).
 */
import * as analyticsRepo from "../repositories/analytics.repo";
import * as permissions from "./permissions.service";
import type { AuthenticatedUser } from "../middlewares/auth";
import { forbidden, notFound } from "../lib/errors";

const DEFAULT_TTL_MS = 30_000;

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const cache = new Map<string, CacheEntry<unknown>>();

async function memoize<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;
  const value = await load();
  cache.set(key, { expiresAt: now + ttlMs, value });
  return value;
}

/** Test helper — clears the in-memory cache between cases. */
export function _resetCacheForTests(): void {
  cache.clear();
}

// ─── Public DTOs ──────────────────────────────────────────────────

export interface AdminAnalyticsOverview {
  totals: analyticsRepo.OverviewTotals;
  topDocumentsByViews: analyticsRepo.TopDocumentRow[];
  topDocumentsByDownloads: analyticsRepo.TopDocumentRow[];
  activeUploaders: analyticsRepo.ActiveUploaderRow[];
  uploadsLast14Days: analyticsRepo.DailyCountRow[];
  topCategories: analyticsRepo.TopCategoryRow[];
  duplicateGroups: analyticsRepo.DuplicateGroupRow[];
  generatedAt: string;
}

export interface CourseAnalytics {
  course: analyticsRepo.CourseInfo;
  totals: analyticsRepo.CourseTotals;
  topDocumentsByViews: analyticsRepo.TopDocumentRow[];
  topDocumentsByDownloads: analyticsRepo.TopDocumentRow[];
  activeUploaders: analyticsRepo.ActiveUploaderRow[];
  uploadsLast14Days: analyticsRepo.DailyCountRow[];
  generatedAt: string;
}

// ─── Endpoints ────────────────────────────────────────────────────

export async function getAdminOverview(
  user: AuthenticatedUser,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<AdminAnalyticsOverview> {
  if (!permissions.isAdmin(user)) {
    throw forbidden("Admin analytics is restricted to admins");
  }
  return memoize("overview", ttlMs, async () => {
    const [
      totals,
      topDocumentsByViews,
      topDocumentsByDownloads,
      activeUploaders,
      uploadsLast14Days,
      topCategories,
      duplicateGroups,
    ] = await Promise.all([
      analyticsRepo.fetchOverviewTotals(),
      analyticsRepo.fetchTopDocumentsByViews(10),
      analyticsRepo.fetchTopDocumentsByDownloads(10),
      analyticsRepo.fetchActiveUploaders(10),
      analyticsRepo.fetchDailyUploads(14),
      analyticsRepo.fetchTopCategories(8),
      analyticsRepo.fetchDuplicateGroups(10),
    ]);
    return {
      totals,
      topDocumentsByViews,
      topDocumentsByDownloads,
      activeUploaders,
      uploadsLast14Days,
      topCategories,
      duplicateGroups,
      generatedAt: new Date().toISOString(),
    };
  });
}

export async function getCourseAnalytics(
  courseId: string,
  user: AuthenticatedUser,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<CourseAnalytics> {
  if (!permissions.isAdmin(user) && !permissions.isLecturerForCourse(user, courseId)) {
    throw forbidden("Course analytics is restricted to admins and the course's lecturers");
  }
  // The course-info lookup is cheap and gates 404 vs 200; do it outside
  // the cache so a deleted course doesn't linger.
  const course = await analyticsRepo.fetchCourseInfo(courseId);
  if (!course) throw notFound("Course not found");

  return memoize(`course:${courseId}`, ttlMs, async () => {
    const [
      totals,
      topDocumentsByViews,
      topDocumentsByDownloads,
      activeUploaders,
      uploadsLast14Days,
    ] = await Promise.all([
      analyticsRepo.fetchCourseTotals(courseId),
      analyticsRepo.fetchCourseTopDocumentsByViews(courseId, 10),
      analyticsRepo.fetchCourseTopDocumentsByDownloads(courseId, 10),
      analyticsRepo.fetchCourseActiveUploaders(courseId, 10),
      analyticsRepo.fetchDailyUploads(14, courseId),
    ]);
    return {
      course,
      totals,
      topDocumentsByViews,
      topDocumentsByDownloads,
      activeUploaders,
      uploadsLast14Days,
      generatedAt: new Date().toISOString(),
    };
  });
}
