import { db } from "@workspace/db";
import type { Prisma } from "@workspace/db";

export interface DocumentRow {
  id: string;
  title: string;
  description: string;
  courseId: string | null;
  categoryId: string | null;
  materialType: string;
  semester: string | null;
  academicYear: number | null;
  visibility: string;
  status: string;
  uploaderId: string;
  ownerId: string;
  currentVersion: number;
  isLatestVersion: boolean;
  parentDocumentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export type DocumentInsert = Prisma.DocumentUncheckedCreateInput;

export interface DocumentFileRow {
  id: string;
  documentId: string;
  originalFilename: string;
  displayFilename: string;
  storedFilename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  storageDriver: string;
  checksum: string;
  versionLabel: string | null;
  uploadedAt: Date;
}

export interface DocumentFileInsert {
  documentId: string;
  originalFilename: string;
  displayFilename: string;
  storedFilename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  storageDriver?: string;
  checksum: string;
  versionLabel?: string | null;
}

export type DocumentSort = "newest" | "oldest" | "title" | "popularity";

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
  /**
   * Visibility scope, computed by the permissions service. `undefined`
   * means no extra constraint (e.g. admins). Otherwise it is AND'd into
   * the base where clause.
   */
  visibility: Prisma.DocumentWhereInput | undefined;
}

/** Convert a Prisma row (BigInt sizeBytes) to the number-based shape callers expect. */
function fromFileRow(r: {
  id: string;
  documentId: string;
  originalFilename: string;
  displayFilename: string;
  storedFilename: string;
  mimeType: string;
  sizeBytes: bigint;
  storagePath: string;
  storageDriver: string;
  checksum: string;
  versionLabel: string | null;
  uploadedAt: Date;
}): DocumentFileRow {
  return { ...r, sizeBytes: Number(r.sizeBytes) };
}

function buildBaseWhere(
  filters: DocumentListFilters,
): Prisma.DocumentWhereInput {
  const and: Prisma.DocumentWhereInput[] = [{ deletedAt: null }];
  if (filters.courseId) and.push({ courseId: filters.courseId });
  if (filters.categoryId) and.push({ categoryId: filters.categoryId });
  if (filters.materialType) and.push({ materialType: filters.materialType });
  if (filters.semester) and.push({ semester: filters.semester });
  if (filters.academicYear != null)
    and.push({ academicYear: filters.academicYear });
  if (filters.dateFrom || filters.dateTo) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (filters.dateFrom) createdAt.gte = filters.dateFrom;
    if (filters.dateTo) {
      const d = new Date(filters.dateTo);
      d.setUTCHours(23, 59, 59, 999);
      createdAt.lte = d;
    }
    and.push({ createdAt });
  }
  if (filters.q) {
    and.push({
      OR: [
        { title: { contains: filters.q, mode: "insensitive" } },
        { description: { contains: filters.q, mode: "insensitive" } },
      ],
    });
  }
  if (filters.restrictCourseIds) {
    if (filters.restrictCourseIds.length === 0) {
      // Force empty set, matching the previous Drizzle `sql\`false\`` clause.
      and.push({ id: { in: [] } });
    } else {
      and.push({ courseId: { in: filters.restrictCourseIds } });
    }
  }
  if (filters.restrictDocumentIds) {
    if (filters.restrictDocumentIds.length === 0) {
      and.push({ id: { in: [] } });
    } else {
      and.push({ id: { in: filters.restrictDocumentIds } });
    }
  }
  if (filters.visibility) {
    and.push(filters.visibility);
  }
  return { AND: and };
}

export async function countDocuments(
  filters: DocumentListFilters,
): Promise<number> {
  return db.document.count({ where: buildBaseWhere(filters) });
}

export async function listDocuments(
  filters: DocumentListFilters,
  options: { sort: DocumentSort; page: number; pageSize: number },
): Promise<DocumentRow[]> {
  const where = buildBaseWhere(filters);
  if (options.sort === "popularity") {
    // Pull all matching ids ordered by view count, then page.
    // (Same semantics as the previous Drizzle implementation.)
    const grouped = await db.materialViewHistory.groupBy({
      by: ["documentId"],
      where: { document: { is: where } },
      _count: { _all: true },
    });
    const viewMap = new Map<string, number>();
    for (const g of grouped) viewMap.set(g.documentId, g._count._all);
    const allDocs = await db.document.findMany({ where });
    allDocs.sort((a, b) => {
      const va = viewMap.get(a.id) ?? 0;
      const vb = viewMap.get(b.id) ?? 0;
      if (vb !== va) return vb - va;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
    const start = (options.page - 1) * options.pageSize;
    return allDocs.slice(start, start + options.pageSize);
  }
  let orderBy: Prisma.DocumentOrderByWithRelationInput;
  switch (options.sort) {
    case "oldest":
      orderBy = { createdAt: "asc" };
      break;
    case "title":
      orderBy = { title: "asc" };
      break;
    case "newest":
    default:
      orderBy = { createdAt: "desc" };
      break;
  }
  return db.document.findMany({
    where,
    orderBy,
    take: options.pageSize,
    skip: (options.page - 1) * options.pageSize,
  });
}

export interface SuggestionRow {
  id: string;
  title: string;
  materialType: string;
  courseId: string | null;
}

export interface SuggestionVisibilityScope {
  /** True when no visibility filter should be applied (admin). */
  unrestricted: boolean;
  userId: string;
}

export async function findSuggestions(
  term: string,
  limit: number,
  scope: SuggestionVisibilityScope,
): Promise<SuggestionRow[]> {
  // Uses the pg_trgm `%` operator and `similarity()` (both depend on the
  // pg_trgm extension created in the init migration). Implemented as raw
  // SQL because Prisma cannot express trigram operators directly. The
  // enrollment-based restricted-visibility check is expressed as a
  // correlated subquery against `course_enrollments` so we don't have to
  // bind a uuid[] parameter.
  const ilikeTerm = `%${term}%`;
  if (scope.unrestricted) {
    const rows = await db.$queryRaw<
      Array<{
        id: string;
        title: string;
        material_type: string;
        course_id: string | null;
      }>
    >`
      SELECT id, title, material_type, course_id
      FROM documents
      WHERE deleted_at IS NULL
        AND (title % ${term} OR description % ${term} OR title ILIKE ${ilikeTerm})
      ORDER BY greatest(similarity(title, ${term}), similarity(coalesce(description, ''), ${term})) DESC,
               created_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      materialType: r.material_type,
      courseId: r.course_id,
    }));
  }
  const uid = scope.userId;
  const rows = await db.$queryRaw<
    Array<{
      id: string;
      title: string;
      material_type: string;
      course_id: string | null;
    }>
  >`
    SELECT id, title, material_type, course_id
    FROM documents
    WHERE deleted_at IS NULL
      AND (title % ${term} OR description % ${term} OR title ILIKE ${ilikeTerm})
      AND (
        visibility = 'public'
        OR (
          visibility = 'restricted'
          AND course_id IS NOT NULL
          AND course_id IN (
            SELECT course_id FROM course_enrollments WHERE user_id = ${uid}::uuid
          )
        )
        OR (
          visibility = 'private'
          AND (uploader_id = ${uid}::uuid OR owner_id = ${uid}::uuid)
        )
      )
    ORDER BY greatest(similarity(title, ${term}), similarity(coalesce(description, ''), ${term})) DESC,
             created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    materialType: r.material_type,
    courseId: r.course_id,
  }));
}

export async function findByIdAlive(id: string): Promise<DocumentRow | null> {
  return db.document.findFirst({ where: { id, deletedAt: null } });
}

export async function findManyByIdsAlive(
  ids: string[],
): Promise<DocumentRow[]> {
  if (ids.length === 0) return [];
  return db.document.findMany({
    where: { id: { in: Array.from(new Set(ids)) }, deletedAt: null },
  });
}

export async function insertDocument(
  values: DocumentInsert,
): Promise<DocumentRow> {
  return db.document.create({ data: values });
}

export async function updateDocumentById(
  id: string,
  patch: Prisma.DocumentUncheckedUpdateInput,
): Promise<void> {
  await db.document.update({ where: { id }, data: patch });
}

export async function softDeleteDocument(
  id: string,
  updatedBy: string,
): Promise<void> {
  await db.document.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy },
  });
}

// ─── documentFiles ────────────────────────────────────────────────
export async function insertDocumentFile(
  values: DocumentFileInsert,
): Promise<void> {
  await db.documentFile.create({
    data: { ...values, sizeBytes: BigInt(values.sizeBytes) },
  });
}

export async function findLatestFileForDocument(
  documentId: string,
): Promise<DocumentFileRow | null> {
  const row = await db.documentFile.findFirst({
    where: { documentId },
    orderBy: { uploadedAt: "desc" },
  });
  return row ? fromFileRow(row) : null;
}

export async function findFilesByDocumentIds(
  ids: string[],
): Promise<DocumentFileRow[]> {
  if (ids.length === 0) return [];
  const rows = await db.documentFile.findMany({
    where: { documentId: { in: ids } },
  });
  return rows.map(fromFileRow);
}

export interface ExistingFileByChecksum {
  documentId: string;
  documentTitle: string;
}

/**
 * Find an alive (non-deleted document) DocumentFile uploaded by `uploaderId`
 * with the given checksum. Used by the upload pipeline to short-circuit
 * re-uploads of identical content by the same user before any storage
 * write happens.
 */
export async function findAliveFileByUploaderAndChecksum(
  uploaderId: string,
  checksum: string,
): Promise<ExistingFileByChecksum | null> {
  const row = await db.documentFile.findFirst({
    where: {
      checksum,
      document: { uploaderId, deletedAt: null },
    },
    select: { document: { select: { id: true, title: true } } },
    orderBy: { uploadedAt: "asc" },
  });
  if (!row) return null;
  return { documentId: row.document.id, documentTitle: row.document.title };
}

/**
 * Atomically:
 *   1. insert the Document row,
 *   2. insert its DocumentFile,
 *   3. attach any tag links,
 *   4. increment the uploader's `usedBytes` by the stored size.
 *
 * Used by the upload pipeline so that quota accounting can never drift
 * from the document table on partial failure.
 */
export async function insertDocumentWithFileAndQuota(args: {
  documentValues: DocumentInsert;
  fileValues: DocumentFileInsert;
  tagIds: string[];
  uploaderId: string;
  sizeBytes: number;
}): Promise<DocumentRow> {
  const { documentValues, fileValues, tagIds, uploaderId, sizeBytes } = args;
  return db.$transaction(async (tx) => {
    const doc = await tx.document.create({ data: documentValues });
    await tx.documentFile.create({
      data: { ...fileValues, sizeBytes: BigInt(fileValues.sizeBytes) },
    });
    if (tagIds.length > 0) {
      await tx.documentTag.createMany({
        data: tagIds.map((tagId) => ({ documentId: doc.id, tagId })),
        skipDuplicates: true,
      });
    }
    await tx.user.update({
      where: { id: uploaderId },
      data: { usedBytes: { increment: BigInt(sizeBytes) } },
    });
    return doc;
  });
}

export async function findUploaderDisplayFilenames(
  uploaderId: string,
): Promise<string[]> {
  const rows = await db.documentFile.findMany({
    where: {
      document: { uploaderId, deletedAt: null },
    },
    select: { displayFilename: true },
  });
  return rows.map((r) => r.displayFilename);
}

// ─── documentTags ─────────────────────────────────────────────────
export async function replaceDocumentTags(
  documentId: string,
  tagIds: string[],
): Promise<void> {
  await db.$transaction([
    db.documentTag.deleteMany({ where: { documentId } }),
    ...(tagIds.length > 0
      ? [
          db.documentTag.createMany({
            data: tagIds.map((tagId) => ({ documentId, tagId })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);
}

export async function addDocumentTags(
  documentId: string,
  tagIds: string[],
): Promise<void> {
  if (tagIds.length === 0) return;
  await db.documentTag.createMany({
    data: tagIds.map((tagId) => ({ documentId, tagId })),
    skipDuplicates: true,
  });
}

export async function findDocumentIdsByTagIds(
  tagIds: string[],
): Promise<string[]> {
  if (tagIds.length === 0) return [];
  const rows = await db.documentTag.findMany({
    where: { tagId: { in: tagIds } },
    select: { documentId: true },
  });
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
  const rows = await db.documentTag.findMany({
    where: { documentId: { in: ids } },
    select: {
      documentId: true,
      tagId: true,
      tag: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    documentId: r.documentId,
    tagId: r.tagId,
    name: r.tag.name,
  }));
}
