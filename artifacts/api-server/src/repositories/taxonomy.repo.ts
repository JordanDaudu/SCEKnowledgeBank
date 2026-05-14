import { and, asc, ilike, inArray } from "drizzle-orm";
import { db, courses, categories, tags } from "@workspace/db";

export type CourseRow = typeof courses.$inferSelect;
export type CategoryRow = typeof categories.$inferSelect;
export type TagRow = typeof tags.$inferSelect;

export async function listAllCourses(): Promise<CourseRow[]> {
  return db.select().from(courses).orderBy(asc(courses.code));
}

export async function listAllCategories(): Promise<CategoryRow[]> {
  return db.select().from(categories).orderBy(asc(categories.name));
}

export async function listAllTags(): Promise<TagRow[]> {
  return db.select().from(tags).orderBy(asc(tags.name));
}

export async function findCoursesByIds(ids: string[]): Promise<CourseRow[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(courses)
    .where(inArray(courses.id, Array.from(new Set(ids))));
}

export async function findCategoriesByIds(
  ids: string[],
): Promise<CategoryRow[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(categories)
    .where(inArray(categories.id, Array.from(new Set(ids))));
}

export async function findCourseIdsByCodeOrLecturer(
  courseCode: string | undefined,
  lecturerName: string | undefined,
): Promise<string[]> {
  const conds = [] as ReturnType<typeof ilike>[];
  if (courseCode) conds.push(ilike(courses.code, `%${courseCode}%`));
  if (lecturerName)
    conds.push(ilike(courses.lecturerName, `%${lecturerName}%`));
  if (conds.length === 0) return [];
  const rows = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(...conds));
  return rows.map((r) => r.id);
}

export async function findCourseCodesByIds(
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({ id: courses.id, code: courses.code })
    .from(courses)
    .where(inArray(courses.id, Array.from(new Set(ids))));
  for (const r of rows) map.set(r.id, r.code);
  return map;
}
