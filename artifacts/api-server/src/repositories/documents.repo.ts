import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  db,
  documents,
  documentFiles,
  documentTags,
  materialViewHistory,
  tags as tagsTable,
} from "@workspace/db";

export type DocumentRow = typeof documents.$inferSelect;
export type DocumentInsert = typeof documents.$inferInsert;
export type DocumentFileRow = typeof documentFiles.$inferSelect;
export type DocumentFileInsert = typeof documentFiles.$inferInsert;

export type DocumentSort = "newest" | "oldest" | "title" | "popularity";

export interface VisibilityScope {
  /** If "private-allowed-for", restrict private docs to this user. If "all", admin-style. */
  mode: "all" | "private-allowed-for";
  userId?: string;
}

export interface DocumentListFilters {
  courseId?: string;
  categoryId?: string;
  materialType?: string;
  semester?: string;
  academicYear?: number;
  dateFrom?: Date;
  dateTo?: Date;
  q?: string;
  /** Pre-resolved course ids to restrict to (e.g. after courseCode/lecturerName lookup). */
  restrictCourseIds?: string[];
  /** Pre-resolved document ids to restrict to (e.g. after tag lookup). */
  restrictDocumentIds?: string[];
  visibility: VisibilityScope;
}

function buildBaseConditions(filters: DocumentListFilters): SQL[] {
  const conds: SQL[] = [isNull(documents.deletedAt)];
  if (filters.courseId) conds.push(eq(documents.courseId, filters.courseId));
  if (filters.categoryId)
    conds.push(eq(documents.categoryId, filters.categoryId));
  if (filters.materialType)
    conds.push(eq(documents.materialType, filters.materialType));
  if (filters.semester) conds.push(eq(documents.semester, filters.semester));
  if (filters.academicYear != null)
    conds.push(eq(documents.academicYear, filters.academicYear));
  if (filters.dateFrom) conds.push(gte(documents.createdAt, filters.dateFrom));
  if (filters.dateTo) {
    const d = new Date(filters.dateTo);
    d.setUTCHours(23, 59, 59, 999);
    conds.push(lte(documents.createdAt, d));
  }
  if (filters.q) {
    const like = `%${filters.q}%`;
    conds.push(
      or(ilike(documents.title, like), ilike(documents.description, like))!,
    );
  }
  if (filters.restrictCourseIds) {
    if (filters.restrictCourseIds.length === 0) {
      // Force empty
      conds.push(sql`false`);
    } else {
      conds.push(inArray(documents.courseId, filters.restrictCourseIds));
    }
  }
  if (filters.restrictDocumentIds) {
    if (filters.restrictDocumentIds.length === 0) {
      conds.push(sql`false`);
    } else {
      conds.push(inArray(documents.id, filters.restrictDocumentIds));
    }
  }
  if (filters.visibility.mode === "private-allowed-for") {
    const uid = filters.visibility.userId!;
    conds.push(
      or(
        sql`${documents.visibility} <> 'private'`,
        eq(documents.uploaderId, uid),
        eq(documents.ownerId, uid),
      )!,
    );
  }
  return conds;
}

export async function countDocuments(
  filters: DocumentListFilters,
): Promise<number> {
  const where = and(...buildBaseConditions(filters));
  const rows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(documents)
    .where(where);
  return rows[0]?.c ?? 0;
}

export async function listDocuments(
  filters: DocumentListFilters,
  options: { sort: DocumentSort; page: number; pageSize: number },
): Promise<DocumentRow[]> {
  const where = and(...buildBaseConditions(filters));
  if (options.sort === "popularity") {
    const result = await db
      .select({
        doc: documents,
        views: sql<number>`coalesce(count(${materialViewHistory.id}), 0)::int`,
      })
      .from(documents)
      .leftJoin(
        materialViewHistory,
        eq(materialViewHistory.documentId, documents.id),
      )
      .where(where)
      .groupBy(documents.id)
      .orderBy(
        desc(sql`coalesce(count(${materialViewHistory.id}), 0)`),
        desc(documents.createdAt),
      )
      .limit(options.pageSize)
      .offset((options.page - 1) * options.pageSize);
    return result.map((r) => r.doc);
  }
  let order;
  switch (options.sort) {
    case "oldest":
      order = asc(documents.createdAt);
      break;
    case "title":
      order = asc(documents.title);
      break;
    case "newest":
    default:
      order = desc(documents.createdAt);
      break;
  }
  return db
    .select()
    .from(documents)
    .where(where)
    .orderBy(order)
    .limit(options.pageSize)
    .offset((options.page - 1) * options.pageSize);
}

export interface SuggestionRow {
  id: string;
  title: string;
  materialType: string;
  courseId: string | null;
}

export async function findSuggestions(
  term: string,
  limit: number,
  visibility: VisibilityScope,
): Promise<SuggestionRow[]> {
  const conds: SQL[] = [
    isNull(documents.deletedAt),
    sql`(${documents.title} % ${term} OR ${documents.description} % ${term} OR ${documents.title} ILIKE ${"%" + term + "%"})`,
  ];
  if (visibility.mode === "private-allowed-for") {
    const uid = visibility.userId!;
    conds.push(
      or(
        sql`${documents.visibility} <> 'private'`,
        eq(documents.uploaderId, uid),
        eq(documents.ownerId, uid),
      )!,
    );
  }
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      materialType: documents.materialType,
      courseId: documents.courseId,
    })
    .from(documents)
    .where(and(...conds))
    .orderBy(
      desc(
        sql`greatest(similarity(${documents.title}, ${term}), similarity(coalesce(${documents.description}, ''), ${term}))`,
      ),
      desc(documents.createdAt),
    )
    .limit(limit);
  return rows;
}

export async function findByIdAlive(id: string): Promise<DocumentRow | null> {
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findManyByIdsAlive(
  ids: string[],
): Promise<DocumentRow[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(documents)
    .where(
      and(
        inArray(documents.id, Array.from(new Set(ids))),
        isNull(documents.deletedAt),
      ),
    );
}

export async function insertDocument(
  values: DocumentInsert,
): Promise<DocumentRow> {
  const rows = await db.insert(documents).values(values).returning();
  return rows[0];
}

export async function updateDocumentById(
  id: string,
  patch: Partial<DocumentInsert>,
): Promise<void> {
  await db.update(documents).set(patch).where(eq(documents.id, id));
}

export async function softDeleteDocument(
  id: string,
  updatedBy: string,
): Promise<void> {
  await db
    .update(documents)
    .set({ deletedAt: new Date(), updatedBy })
    .where(eq(documents.id, id));
}

// ─── documentFiles ────────────────────────────────────────────────
export async function insertDocumentFile(
  values: DocumentFileInsert,
): Promise<void> {
  await db.insert(documentFiles).values(values);
}

export async function findLatestFileForDocument(
  documentId: string,
): Promise<DocumentFileRow | null> {
  const rows = await db
    .select()
    .from(documentFiles)
    .where(eq(documentFiles.documentId, documentId))
    .orderBy(desc(documentFiles.uploadedAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function findFilesByDocumentIds(
  ids: string[],
): Promise<DocumentFileRow[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(documentFiles)
    .where(inArray(documentFiles.documentId, ids));
}

export async function findUploaderDisplayFilenames(
  uploaderId: string,
): Promise<string[]> {
  const rows = await db
    .select({ name: documentFiles.displayFilename })
    .from(documentFiles)
    .innerJoin(documents, eq(documents.id, documentFiles.documentId))
    .where(
      and(
        eq(documents.uploaderId, uploaderId),
        isNull(documents.deletedAt),
      ),
    );
  return rows.map((r) => r.name);
}

// ─── documentTags ─────────────────────────────────────────────────
export async function replaceDocumentTags(
  documentId: string,
  tagIds: string[],
): Promise<void> {
  await db.delete(documentTags).where(eq(documentTags.documentId, documentId));
  if (tagIds.length > 0) {
    await db
      .insert(documentTags)
      .values(tagIds.map((tagId) => ({ documentId, tagId })))
      .onConflictDoNothing();
  }
}

export async function addDocumentTags(
  documentId: string,
  tagIds: string[],
): Promise<void> {
  if (tagIds.length === 0) return;
  await db
    .insert(documentTags)
    .values(tagIds.map((tagId) => ({ documentId, tagId })))
    .onConflictDoNothing();
}

export async function findDocumentIdsByTagIds(
  tagIds: string[],
): Promise<string[]> {
  if (tagIds.length === 0) return [];
  const rows = await db
    .select({ documentId: documentTags.documentId })
    .from(documentTags)
    .where(inArray(documentTags.tagId, tagIds));
  return Array.from(new Set(rows.map((r) => r.documentId)));
}

export interface TagLink {
  documentId: string;
  tagId: string;
  name: string;
}

export async function findTagLinksForDocuments(
  ids: string[],
): Promise<TagLink[]> {
  if (ids.length === 0) return [];
  return db
    .select({
      documentId: documentTags.documentId,
      tagId: tagsTable.id,
      name: tagsTable.name,
    })
    .from(documentTags)
    .innerJoin(tagsTable, eq(tagsTable.id, documentTags.tagId))
    .where(inArray(documentTags.documentId, ids));
}
