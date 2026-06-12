import * as taxonomyRepo from "../repositories/taxonomy.repo";
import { conflict, notFound } from "../lib/errors";

export interface CourseDTO {
  id: string;
  code: string;
  title: string;
  lecturerName: string;
}

export interface CategoryDTO {
  id: string;
  name: string;
  slug: string;
  description?: string;
}

export interface TagDTO {
  id: string;
  name: string;
}

export async function listCourses(
  opts: { q?: string; limit?: number } = {},
): Promise<CourseDTO[]> {
  const rows = await taxonomyRepo.listAllCourses(opts);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    title: r.title,
    lecturerName: r.lecturerName,
  }));
}

export async function createCourse(input: {
  code: string;
  title: string;
  lecturerName: string;
}): Promise<CourseDTO> {
  const code = input.code.trim();
  // Course codes are unique; surface a friendly 409 rather than a raw DB error.
  const existing = await taxonomyRepo.findCourseByCode(code);
  if (existing) {
    throw conflict(`A course with code "${code}" already exists.`);
  }
  const row = await taxonomyRepo.createCourse({
    code,
    title: input.title.trim(),
    lecturerName: input.lecturerName.trim(),
  });
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    lecturerName: row.lecturerName,
  };
}

export async function updateCourse(
  id: string,
  input: { code?: string; title?: string; lecturerName?: string },
): Promise<CourseDTO> {
  const existing = await taxonomyRepo.findCourseById(id);
  if (!existing) throw notFound("Course not found.");

  const data: { code?: string; title?: string; lecturerName?: string } = {};
  if (input.code !== undefined) {
    const code = input.code.trim();
    // Renaming onto another course's code would violate the unique constraint.
    if (code !== existing.code) {
      const clash = await taxonomyRepo.findCourseByCode(code);
      if (clash && clash.id !== id) {
        throw conflict(`A course with code "${code}" already exists.`);
      }
      data.code = code;
    }
  }
  if (input.title !== undefined) data.title = input.title.trim();
  if (input.lecturerName !== undefined) {
    data.lecturerName = input.lecturerName.trim();
  }

  const row = await taxonomyRepo.updateCourse(id, data);
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    lecturerName: row.lecturerName,
  };
}

export async function deleteCourse(id: string): Promise<void> {
  const existing = await taxonomyRepo.findCourseById(id);
  if (!existing) throw notFound("Course not found.");
  // Enrollments cascade away; documents/requests/collections are unlinked
  // (their courseId is set null) — see the Prisma relations on Course.
  await taxonomyRepo.deleteCourse(id);
}

export async function listCategories(): Promise<CategoryDTO[]> {
  const rows = await taxonomyRepo.listAllCategories();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    ...(r.description ? { description: r.description } : {}),
  }));
}

export async function listTags(): Promise<TagDTO[]> {
  const rows = await taxonomyRepo.listAllTags();
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

export async function loadCourses(
  ids: (string | null | undefined)[],
): Promise<Map<string, CourseDTO>> {
  const out = new Map<string, CourseDTO>();
  const valid = ids.filter((i): i is string => !!i);
  const rows = await taxonomyRepo.findCoursesByIds(valid);
  for (const r of rows) {
    out.set(r.id, {
      id: r.id,
      code: r.code,
      title: r.title,
      lecturerName: r.lecturerName,
    });
  }
  return out;
}

export async function loadCategories(
  ids: (string | null | undefined)[],
): Promise<Map<string, CategoryDTO>> {
  const out = new Map<string, CategoryDTO>();
  const valid = ids.filter((i): i is string => !!i);
  const rows = await taxonomyRepo.findCategoriesByIds(valid);
  for (const r of rows) {
    out.set(r.id, {
      id: r.id,
      name: r.name,
      slug: r.slug,
      ...(r.description ? { description: r.description } : {}),
    });
  }
  return out;
}
