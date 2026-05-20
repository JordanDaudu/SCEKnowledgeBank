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
