/**
 * Read-only aggregation queries powering the M5 analytics endpoints.
 *
 * All queries are intentionally raw SQL because:
 *   - Prisma's `groupBy` cannot do the joins (document + course + user)
 *     in one round-trip and would force N+1 lookups per row.
 *   - Date-bucketing with `date_trunc` is awkward through the
 *     generated client.
 *
 * Visibility scoping is NOT applied here — these queries are gated at
 * the service layer (`analytics.service.ts`) by admin/lecturer
 * permission checks. Lecturer-facing queries always take a `courseId`
 * the service has already verified the user teaches.
 */
import { db } from "@workspace/db";

export interface OverviewTotals {
  totalDocuments: number;
  totalUsers: number;
  totalComments: number;
  pendingReviewCount: number;
  viewsThisWeek: number;
  viewsPriorWeek: number;
  downloadsThisWeek: number;
  downloadsPriorWeek: number;
  uploadsThisWeek: number;
}

export interface CourseTotals {
  totalDocuments: number;
  pendingReviewCount: number;
  totalComments: number;
  viewsThisWeek: number;
  viewsPriorWeek: number;
  downloadsThisWeek: number;
  downloadsPriorWeek: number;
  uploadsThisWeek: number;
}

export interface TopDocumentRow {
  documentId: string;
  title: string;
  courseCode: string | null;
  count: number;
}

export interface ActiveUploaderRow {
  userId: string;
  displayName: string;
  uploadCount: number;
}

export interface DailyCountRow {
  day: string; // YYYY-MM-DD
  count: number;
}

export interface CourseInfo {
  id: string;
  code: string;
  title: string;
}

// ─── Overview (admin, workspace-wide) ─────────────────────────────

export async function fetchOverviewTotals(): Promise<OverviewTotals> {
  const rows = await db.$queryRaw<
    Array<{
      total_documents: bigint;
      total_users: bigint;
      total_comments: bigint;
      pending_review_count: bigint;
      views_this_week: bigint;
      views_prior_week: bigint;
      downloads_this_week: bigint;
      downloads_prior_week: bigint;
      uploads_this_week: bigint;
    }>
  >`
    SELECT
      (SELECT COUNT(*) FROM documents WHERE deleted_at IS NULL)             AS total_documents,
      (SELECT COUNT(*) FROM users WHERE status = 'ACTIVE')                  AS total_users,
      (SELECT COUNT(*) FROM comments WHERE deleted_at IS NULL)              AS total_comments,
      (SELECT COUNT(*) FROM documents
         WHERE deleted_at IS NULL AND status = 'pending_review')            AS pending_review_count,
      (SELECT COUNT(*) FROM material_view_history
         WHERE viewed_at >= now() - interval '7 days')                      AS views_this_week,
      (SELECT COUNT(*) FROM material_view_history
         WHERE viewed_at >= now() - interval '14 days'
           AND viewed_at <  now() - interval '7 days')                      AS views_prior_week,
      (SELECT COUNT(*) FROM audit_log
         WHERE action = 'document.download'
           AND created_at >= now() - interval '7 days')                     AS downloads_this_week,
      (SELECT COUNT(*) FROM audit_log
         WHERE action = 'document.download'
           AND created_at >= now() - interval '14 days'
           AND created_at <  now() - interval '7 days')                     AS downloads_prior_week,
      (SELECT COUNT(*) FROM documents
         WHERE deleted_at IS NULL
           AND created_at >= now() - interval '7 days')                     AS uploads_this_week
  `;
  const r = rows[0];
  return {
    totalDocuments: Number(r.total_documents),
    totalUsers: Number(r.total_users),
    totalComments: Number(r.total_comments),
    pendingReviewCount: Number(r.pending_review_count),
    viewsThisWeek: Number(r.views_this_week),
    viewsPriorWeek: Number(r.views_prior_week),
    downloadsThisWeek: Number(r.downloads_this_week),
    downloadsPriorWeek: Number(r.downloads_prior_week),
    uploadsThisWeek: Number(r.uploads_this_week),
  };
}

export async function fetchTopDocumentsByViews(
  limit = 10,
): Promise<TopDocumentRow[]> {
  const rows = await db.$queryRaw<
    Array<{
      document_id: string;
      title: string;
      course_code: string | null;
      count: bigint;
    }>
  >`
    SELECT d.id::text AS document_id, d.title, c.code AS course_code,
           COUNT(*)::bigint AS count
    FROM material_view_history v
    JOIN documents d ON d.id = v.document_id
    LEFT JOIN courses c ON c.id = d.course_id
    WHERE v.viewed_at >= now() - interval '30 days'
      AND d.deleted_at IS NULL
    GROUP BY d.id, d.title, c.code
    ORDER BY count DESC, d.title ASC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    documentId: r.document_id,
    title: r.title,
    courseCode: r.course_code,
    count: Number(r.count),
  }));
}

export async function fetchTopDocumentsByDownloads(
  limit = 10,
): Promise<TopDocumentRow[]> {
  const rows = await db.$queryRaw<
    Array<{
      document_id: string;
      title: string;
      course_code: string | null;
      count: bigint;
    }>
  >`
    SELECT d.id::text AS document_id, d.title, c.code AS course_code,
           COUNT(*)::bigint AS count
    FROM audit_log a
    JOIN documents d ON d.id::text = a.entity_id
    LEFT JOIN courses c ON c.id = d.course_id
    WHERE a.action = 'document.download'
      AND a.entity_type = 'document'
      AND a.created_at >= now() - interval '30 days'
      AND d.deleted_at IS NULL
    GROUP BY d.id, d.title, c.code
    ORDER BY count DESC, d.title ASC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    documentId: r.document_id,
    title: r.title,
    courseCode: r.course_code,
    count: Number(r.count),
  }));
}

export async function fetchActiveUploaders(
  limit = 10,
): Promise<ActiveUploaderRow[]> {
  const rows = await db.$queryRaw<
    Array<{ user_id: string; display_name: string; upload_count: bigint }>
  >`
    SELECT d.uploader_id::text AS user_id,
           u.display_name,
           COUNT(*)::bigint AS upload_count
    FROM documents d
    JOIN users u ON u.id = d.uploader_id
    WHERE d.created_at >= now() - interval '7 days'
      AND d.deleted_at IS NULL
    GROUP BY d.uploader_id, u.display_name
    ORDER BY upload_count DESC, u.display_name ASC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    uploadCount: Number(r.upload_count),
  }));
}

export async function fetchDailyUploads(
  days = 14,
  courseId?: string,
): Promise<DailyCountRow[]> {
  const rows = courseId
    ? await db.$queryRaw<Array<{ day: Date; count: bigint }>>`
        SELECT date_trunc('day', created_at)::date AS day,
               COUNT(*)::bigint AS count
        FROM documents
        WHERE deleted_at IS NULL
          AND created_at >= now() - (${days}::int * interval '1 day')
          AND course_id = ${courseId}::uuid
        GROUP BY day
        ORDER BY day
      `
    : await db.$queryRaw<Array<{ day: Date; count: bigint }>>`
        SELECT date_trunc('day', created_at)::date AS day,
               COUNT(*)::bigint AS count
        FROM documents
        WHERE deleted_at IS NULL
          AND created_at >= now() - (${days}::int * interval '1 day')
        GROUP BY day
        ORDER BY day
      `;
  return rows.map((r) => ({
    day: new Date(r.day).toISOString().slice(0, 10),
    count: Number(r.count),
  }));
}

// ─── Per-course (lecturer or admin) ───────────────────────────────

export async function fetchCourseInfo(
  courseId: string,
): Promise<CourseInfo | null> {
  const c = await db.course.findUnique({
    where: { id: courseId },
    select: { id: true, code: true, title: true },
  });
  return c;
}

export async function fetchCourseTotals(
  courseId: string,
): Promise<CourseTotals> {
  const rows = await db.$queryRaw<
    Array<{
      total_documents: bigint;
      pending_review_count: bigint;
      total_comments: bigint;
      views_this_week: bigint;
      views_prior_week: bigint;
      downloads_this_week: bigint;
      downloads_prior_week: bigint;
      uploads_this_week: bigint;
    }>
  >`
    SELECT
      (SELECT COUNT(*) FROM documents
         WHERE deleted_at IS NULL AND course_id = ${courseId}::uuid)        AS total_documents,
      (SELECT COUNT(*) FROM documents
         WHERE deleted_at IS NULL
           AND status = 'pending_review'
           AND course_id = ${courseId}::uuid)                               AS pending_review_count,
      (SELECT COUNT(*) FROM comments cm
         JOIN documents d ON d.id = cm.document_id
         WHERE cm.deleted_at IS NULL
           AND d.deleted_at IS NULL
           AND d.course_id = ${courseId}::uuid)                             AS total_comments,
      (SELECT COUNT(*) FROM material_view_history v
         JOIN documents d ON d.id = v.document_id
         WHERE v.viewed_at >= now() - interval '7 days'
           AND d.course_id = ${courseId}::uuid)                             AS views_this_week,
      (SELECT COUNT(*) FROM material_view_history v
         JOIN documents d ON d.id = v.document_id
         WHERE v.viewed_at >= now() - interval '14 days'
           AND v.viewed_at <  now() - interval '7 days'
           AND d.course_id = ${courseId}::uuid)                             AS views_prior_week,
      (SELECT COUNT(*) FROM audit_log a
         JOIN documents d ON d.id::text = a.entity_id
         WHERE a.action = 'document.download'
           AND a.created_at >= now() - interval '7 days'
           AND d.course_id = ${courseId}::uuid)                             AS downloads_this_week,
      (SELECT COUNT(*) FROM audit_log a
         JOIN documents d ON d.id::text = a.entity_id
         WHERE a.action = 'document.download'
           AND a.created_at >= now() - interval '14 days'
           AND a.created_at <  now() - interval '7 days'
           AND d.course_id = ${courseId}::uuid)                             AS downloads_prior_week,
      (SELECT COUNT(*) FROM documents
         WHERE deleted_at IS NULL
           AND course_id = ${courseId}::uuid
           AND created_at >= now() - interval '7 days')                     AS uploads_this_week
  `;
  const r = rows[0];
  return {
    totalDocuments: Number(r.total_documents),
    pendingReviewCount: Number(r.pending_review_count),
    totalComments: Number(r.total_comments),
    viewsThisWeek: Number(r.views_this_week),
    viewsPriorWeek: Number(r.views_prior_week),
    downloadsThisWeek: Number(r.downloads_this_week),
    downloadsPriorWeek: Number(r.downloads_prior_week),
    uploadsThisWeek: Number(r.uploads_this_week),
  };
}

export async function fetchCourseTopDocumentsByViews(
  courseId: string,
  limit = 10,
): Promise<TopDocumentRow[]> {
  const rows = await db.$queryRaw<
    Array<{
      document_id: string;
      title: string;
      course_code: string | null;
      count: bigint;
    }>
  >`
    SELECT d.id::text AS document_id, d.title, c.code AS course_code,
           COUNT(*)::bigint AS count
    FROM material_view_history v
    JOIN documents d ON d.id = v.document_id
    LEFT JOIN courses c ON c.id = d.course_id
    WHERE v.viewed_at >= now() - interval '30 days'
      AND d.deleted_at IS NULL
      AND d.course_id = ${courseId}::uuid
    GROUP BY d.id, d.title, c.code
    ORDER BY count DESC, d.title ASC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    documentId: r.document_id,
    title: r.title,
    courseCode: r.course_code,
    count: Number(r.count),
  }));
}

export async function fetchCourseTopDocumentsByDownloads(
  courseId: string,
  limit = 10,
): Promise<TopDocumentRow[]> {
  const rows = await db.$queryRaw<
    Array<{
      document_id: string;
      title: string;
      course_code: string | null;
      count: bigint;
    }>
  >`
    SELECT d.id::text AS document_id, d.title, c.code AS course_code,
           COUNT(*)::bigint AS count
    FROM audit_log a
    JOIN documents d ON d.id::text = a.entity_id
    LEFT JOIN courses c ON c.id = d.course_id
    WHERE a.action = 'document.download'
      AND a.entity_type = 'document'
      AND a.created_at >= now() - interval '30 days'
      AND d.deleted_at IS NULL
      AND d.course_id = ${courseId}::uuid
    GROUP BY d.id, d.title, c.code
    ORDER BY count DESC, d.title ASC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    documentId: r.document_id,
    title: r.title,
    courseCode: r.course_code,
    count: Number(r.count),
  }));
}

export async function fetchCourseActiveUploaders(
  courseId: string,
  limit = 10,
): Promise<ActiveUploaderRow[]> {
  const rows = await db.$queryRaw<
    Array<{ user_id: string; display_name: string; upload_count: bigint }>
  >`
    SELECT d.uploader_id::text AS user_id,
           u.display_name,
           COUNT(*)::bigint AS upload_count
    FROM documents d
    JOIN users u ON u.id = d.uploader_id
    WHERE d.created_at >= now() - interval '7 days'
      AND d.deleted_at IS NULL
      AND d.course_id = ${courseId}::uuid
    GROUP BY d.uploader_id, u.display_name
    ORDER BY upload_count DESC, u.display_name ASC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    uploadCount: Number(r.upload_count),
  }));
}
