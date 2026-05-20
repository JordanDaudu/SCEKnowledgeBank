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

export async function listAllCourses(): Promise<CourseRow[]> {
  return db.course.findMany({ orderBy: { code: "asc" } });
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
