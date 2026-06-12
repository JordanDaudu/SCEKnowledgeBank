import { db } from "@workspace/db";

export interface CourseRow {
  id: string;
  code: string;
  title: string;
  lecturerName: string;
  lecturerUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: Date;
}

export interface TagRow {
  id: string;
  name: string;
  createdAt: Date;
}

export interface ListCoursesOptions {
  q?: string;
  limit?: number;
}

export async function listAllCourses(opts: ListCoursesOptions = {}): Promise<CourseRow[]> {
  const q = opts.q?.trim();
  return db.course.findMany({
    where: q
      ? {
          OR: [
            { code: { contains: q, mode: "insensitive" } },
            { title: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { code: "asc" },
    take: opts.limit ?? undefined,
  });
}

export async function listAllCategories(): Promise<CategoryRow[]> {
  return db.category.findMany({ orderBy: { name: "asc" } });
}

export async function listAllTags(): Promise<TagRow[]> {
  return db.tag.findMany({ orderBy: { name: "asc" } });
}

export async function findCoursesByIds(ids: string[]): Promise<CourseRow[]> {
  if (ids.length === 0) return [];
  return db.course.findMany({
    where: { id: { in: Array.from(new Set(ids)) } },
  });
}

/**
 * Lightweight existence check used by services that need to validate a
 * `courseId` argument before mutating (e.g. moving a document into a
 * course). Returns `true` iff a course with this id is present.
 */
export async function courseExists(id: string): Promise<boolean> {
  const row = await db.course.findUnique({ where: { id }, select: { id: true } });
  return row !== null;
}

export async function findCategoriesByIds(
  ids: string[],
): Promise<CategoryRow[]> {
  if (ids.length === 0) return [];
  return db.category.findMany({
    where: { id: { in: Array.from(new Set(ids)) } },
  });
}

export async function findCourseIdsByCodeOrLecturer(
  courseCode: string | undefined,
  lecturerName: string | undefined,
): Promise<string[]> {
  if (!courseCode && !lecturerName) return [];
  const where: Record<string, unknown> = {};
  const ands: Array<Record<string, unknown>> = [];
  if (courseCode)
    ands.push({ code: { contains: courseCode, mode: "insensitive" } });
  if (lecturerName)
    ands.push({
      lecturerName: { contains: lecturerName, mode: "insensitive" },
    });
  where.AND = ands;
  const rows = await db.course.findMany({ where, select: { id: true } });
  return rows.map((r) => r.id);
}

export async function findCourseCodesByIds(
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const rows = await db.course.findMany({
    where: { id: { in: Array.from(new Set(ids)) } },
    select: { id: true, code: true },
  });
  for (const r of rows) map.set(r.id, r.code);
  return map;
}

export async function findCourseByCode(code: string): Promise<CourseRow | null> {
  return db.course.findUnique({ where: { code } });
}

export async function findCourseById(id: string): Promise<CourseRow | null> {
  return db.course.findUnique({ where: { id } });
}

export async function createCourse(data: {
  code: string;
  title: string;
  lecturerName: string;
}): Promise<CourseRow> {
  return db.course.create({ data });
}

export async function updateCourse(
  id: string,
  data: Partial<{ code: string; title: string; lecturerName: string }>,
): Promise<CourseRow> {
  return db.course.update({ where: { id }, data });
}

export async function deleteCourse(id: string): Promise<void> {
  await db.course.delete({ where: { id } });
}
