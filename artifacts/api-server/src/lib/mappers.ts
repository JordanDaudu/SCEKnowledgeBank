import { inArray, eq, isNull, and } from "drizzle-orm";
import {
  db,
  users,
  userRoles,
  roles,
  courses,
  categories,
  tags,
  documents,
  documentFiles,
  documentTags,
  comments,
} from "@workspace/db";

export interface UserSummaryDTO {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  isActive: boolean;
  createdAt: string;
}

export async function loadUserSummaries(
  ids: string[],
): Promise<Map<string, UserSummaryDTO>> {
  const out = new Map<string, UserSummaryDTO>();
  if (ids.length === 0) return out;
  const unique = Array.from(new Set(ids));
  const baseRows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      isActive: users.isActive,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(and(inArray(users.id, unique), isNull(users.deletedAt)));
  for (const r of baseRows) {
    out.set(r.id, {
      id: r.id,
      email: r.email,
      displayName: r.displayName,
      roles: [],
      isActive: r.isActive,
      createdAt: r.createdAt.toISOString(),
    });
  }
  const roleRows = await db
    .select({
      userId: userRoles.userId,
      name: roles.name,
    })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(inArray(userRoles.userId, unique));
  for (const r of roleRows) {
    const u = out.get(r.userId);
    if (u && !u.roles.includes(r.name)) u.roles.push(r.name);
  }
  return out;
}

export interface CourseDTO {
  id: string;
  code: string;
  title: string;
  lecturerName: string;
}

export async function loadCourses(
  ids: (string | null | undefined)[],
): Promise<Map<string, CourseDTO>> {
  const out = new Map<string, CourseDTO>();
  const valid = ids.filter((i): i is string => !!i);
  if (valid.length === 0) return out;
  const rows = await db
    .select()
    .from(courses)
    .where(inArray(courses.id, Array.from(new Set(valid))));
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

export interface CategoryDTO {
  id: string;
  name: string;
  slug: string;
  description?: string;
}

export async function loadCategories(
  ids: (string | null | undefined)[],
): Promise<Map<string, CategoryDTO>> {
  const out = new Map<string, CategoryDTO>();
  const valid = ids.filter((i): i is string => !!i);
  if (valid.length === 0) return out;
  const rows = await db
    .select()
    .from(categories)
    .where(inArray(categories.id, Array.from(new Set(valid))));
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

export interface DocumentDTO {
  id: string;
  title: string;
  description: string;
  course?: CourseDTO;
  category?: CategoryDTO;
  materialType: string;
  semester?: string;
  academicYear?: number;
  visibility: string;
  status: string;
  uploader: UserSummaryDTO;
  createdAt: string;
  updatedAt: string;
  viewCount: number;
  commentCount: number;
  tags: { id: string; name: string }[];
  file?: {
    id: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    uploadedAt: string;
    checksum?: string;
  };
}

export async function assembleDocuments(
  docs: (typeof documents.$inferSelect)[],
): Promise<DocumentDTO[]> {
  if (docs.length === 0) return [];
  const ids = docs.map((d) => d.id);
  const [coursesMap, categoriesMap, uploadersMap, fileRows, tagLinkRows] =
    await Promise.all([
      loadCourses(docs.map((d) => d.courseId)),
      loadCategories(docs.map((d) => d.categoryId)),
      loadUserSummaries(docs.map((d) => d.uploaderId)),
      db.select().from(documentFiles).where(inArray(documentFiles.documentId, ids)),
      db
        .select({
          documentId: documentTags.documentId,
          tagId: tags.id,
          name: tags.name,
        })
        .from(documentTags)
        .innerJoin(tags, eq(tags.id, documentTags.tagId))
        .where(inArray(documentTags.documentId, ids)),
    ]);

  // Comment counts
  const commentRows = await db
    .select({ documentId: comments.documentId, id: comments.id })
    .from(comments)
    .where(
      and(inArray(comments.documentId, ids), isNull(comments.deletedAt)),
    );
  const commentCounts = new Map<string, number>();
  for (const c of commentRows) {
    commentCounts.set(c.documentId, (commentCounts.get(c.documentId) ?? 0) + 1);
  }

  // File map (pick latest if multiple)
  const filesByDoc = new Map<string, (typeof fileRows)[number]>();
  for (const f of fileRows) {
    const existing = filesByDoc.get(f.documentId);
    if (!existing || f.uploadedAt > existing.uploadedAt) {
      filesByDoc.set(f.documentId, f);
    }
  }

  // Tags by document
  const tagsByDoc = new Map<string, { id: string; name: string }[]>();
  for (const t of tagLinkRows) {
    const list = tagsByDoc.get(t.documentId) ?? [];
    list.push({ id: t.tagId, name: t.name });
    tagsByDoc.set(t.documentId, list);
  }

  return docs.map((d) => {
    const uploader = uploadersMap.get(d.uploaderId) ?? {
      id: d.uploaderId,
      email: "",
      displayName: "Unknown",
      roles: [],
      isActive: false,
      createdAt: d.createdAt.toISOString(),
    };
    const file = filesByDoc.get(d.id);
    const dto: DocumentDTO = {
      id: d.id,
      title: d.title,
      description: d.description ?? "",
      materialType: d.materialType,
      visibility: d.visibility,
      status: d.status,
      uploader,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
      viewCount: 0,
      commentCount: commentCounts.get(d.id) ?? 0,
      tags: tagsByDoc.get(d.id) ?? [],
    };
    const c = d.courseId ? coursesMap.get(d.courseId) : undefined;
    if (c) dto.course = c;
    const cat = d.categoryId ? categoriesMap.get(d.categoryId) : undefined;
    if (cat) dto.category = cat;
    if (d.semester) dto.semester = d.semester;
    if (d.academicYear != null) dto.academicYear = d.academicYear;
    if (file) {
      dto.file = {
        id: file.id,
        originalFilename: file.originalFilename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        uploadedAt: file.uploadedAt.toISOString(),
        checksum: file.checksum,
      };
    }
    return dto;
  });
}
