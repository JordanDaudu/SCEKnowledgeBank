import { db } from "@workspace/db";

export interface EnrollmentRow {
  courseId: string;
  roleInCourse: string;
}

export async function findEnrollmentsForUser(
  userId: string,
): Promise<EnrollmentRow[]> {
  const rows = await db.courseEnrollment.findMany({
    where: { userId },
    select: { courseId: true, roleInCourse: true },
  });
  return rows.map((r) => ({
    courseId: r.courseId,
    roleInCourse: r.roleInCourse,
  }));
}

export interface EnrollmentInsert {
  userId: string;
  courseId: string;
  roleInCourse: string;
}

export async function upsertEnrollments(rows: EnrollmentInsert[]): Promise<void> {
  if (rows.length === 0) return;
  await db.courseEnrollment.createMany({ data: rows, skipDuplicates: true });
}

/**
 * Returns the subset of `userIds` currently enrolled in `courseId`.
 * Used by producer-side fan-outs that must re-check course access
 * against the live enrollment table (favorites can outlive a revoke).
 */
export async function findEnrolledUserIds(
  courseId: string,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await db.courseEnrollment.findMany({
    where: { courseId, userId: { in: userIds } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}
