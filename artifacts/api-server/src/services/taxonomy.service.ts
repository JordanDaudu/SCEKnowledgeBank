import * as taxonomyRepo from "../repositories/taxonomy.repo";

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

export async function listCourses(): Promise<CourseDTO[]> {
  const rows = await taxonomyRepo.listAllCourses();
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    title: r.title,
    lecturerName: r.lecturerName,
  }));
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
