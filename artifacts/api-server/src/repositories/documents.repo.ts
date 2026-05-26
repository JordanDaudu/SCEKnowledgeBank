import { db, Prisma } from "@workspace/db";

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
  // Extracted metadata (task #27). All optional — extraction can fail
  // per-file without failing the upload.
  extractedText: string | null;
  pageCount: number | null;
  detectedTitle: string | null;
  author: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  thumbnailPath: string | null;
  thumbnailMimeType: string | null;
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
  // Extracted metadata (task #27). Persisted alongside the file row
  // so each file version captures the metadata that was current when
  // it was uploaded.
  extractedText?: string | null;
  pageCount?: number | null;
  detectedTitle?: string | null;
  author?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  thumbnailPath?: string | null;
  thumbnailMimeType?: string | null;
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
  extractedText: string | null;
  pageCount: number | null;
  detectedTitle: string | null;
  author: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  thumbnailPath: string | null;
  thumbnailMimeType: string | null;
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
  // NOTE: `filters.q` is intentionally NOT applied here. The FTS code
  // path (`searchDocumentsRanked` + `countSearchDocuments`) takes over
  // when `q` is set; the prisma list/count helpers only run for the
  // non-FTS case where `filters.q` is absent.
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

// ─── Full-text search (task #28) ─────────────────────────────────
//
// When `q` is provided, callers route through `searchDocumentsRanked`
// + `countSearchDocuments` instead of the prisma-based helpers above.
// The two paths share the same filter shape but FTS uses raw SQL so
// we can `ORDER BY ts_rank(...)` and exploit the GIN index on
// `documents.search_vector`. All non-`q` filters compose into both
// paths identically.
//
// The `d.` alias is required by `visibilitySql` (built by
// `permissions.service.visibleDocumentFilterSql`).

function buildFilterFragmentsSql(filters: DocumentListFilters): Prisma.Sql[] {
  const parts: Prisma.Sql[] = [Prisma.sql`d.deleted_at IS NULL`];
  if (filters.courseId)
    parts.push(Prisma.sql`d.course_id = ${filters.courseId}::uuid`);
  if (filters.categoryId)
    parts.push(Prisma.sql`d.category_id = ${filters.categoryId}::uuid`);
  if (filters.materialType)
    parts.push(Prisma.sql`d.material_type = ${filters.materialType}`);
  if (filters.semester)
    parts.push(Prisma.sql`d.semester = ${filters.semester}`);
  if (filters.academicYear != null)
    parts.push(Prisma.sql`d.academic_year = ${filters.academicYear}`);
  if (filters.dateFrom)
    parts.push(Prisma.sql`d.created_at >= ${filters.dateFrom}`);
  if (filters.dateTo) {
    const d = new Date(filters.dateTo);
    d.setUTCHours(23, 59, 59, 999);
    parts.push(Prisma.sql`d.created_at <= ${d}`);
  }
  if (filters.restrictCourseIds) {
    if (filters.restrictCourseIds.length === 0) {
      parts.push(Prisma.sql`FALSE`);
    } else {
      parts.push(
        Prisma.sql`d.course_id IN (${Prisma.join(
          filters.restrictCourseIds.map((id) => Prisma.sql`${id}::uuid`),
        )})`,
      );
    }
  }
  if (filters.restrictDocumentIds) {
    if (filters.restrictDocumentIds.length === 0) {
      parts.push(Prisma.sql`FALSE`);
    } else {
      parts.push(
        Prisma.sql`d.id IN (${Prisma.join(
          filters.restrictDocumentIds.map((id) => Prisma.sql`${id}::uuid`),
        )})`,
      );
    }
  }
  return parts;
}

export async function countSearchDocuments(
  q: string,
  filters: DocumentListFilters,
  visibilitySql: Prisma.Sql,
): Promise<number> {
  const where = Prisma.join(
    [
      ...buildFilterFragmentsSql(filters),
      visibilitySql,
      Prisma.sql`d.search_vector @@ plainto_tsquery('english', ${q})`,
    ],
    " AND ",
  );
  const rows = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count
    FROM documents d
    WHERE ${where}
  `;
  return Number(rows[0]?.count ?? 0n);
}

export async function searchDocumentsRanked(
  q: string,
  filters: DocumentListFilters,
  visibilitySql: Prisma.Sql,
  options: { sort: DocumentSort; page: number; pageSize: number },
): Promise<DocumentRow[]> {
  const where = Prisma.join(
    [
      ...buildFilterFragmentsSql(filters),
      visibilitySql,
      Prisma.sql`d.search_vector @@ plainto_tsquery('english', ${q})`,
    ],
    " AND ",
  );
  // Ranking is always ts_rank-first when `q` is present (the task
  // contract). `options.sort` only changes the tie-breaker so it stays
  // stable with the non-FTS code path.
  const tieBreaker =
    options.sort === "oldest"
      ? Prisma.sql`d.created_at ASC`
      : options.sort === "title"
        ? Prisma.sql`d.title ASC`
        : Prisma.sql`d.created_at DESC`;
  const offset = (options.page - 1) * options.pageSize;
  const idRows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT d.id
    FROM documents d
    WHERE ${where}
    ORDER BY ts_rank(d.search_vector, plainto_tsquery('english', ${q})) DESC,
             ${tieBreaker}
    LIMIT ${options.pageSize} OFFSET ${offset}
  `;
  if (idRows.length === 0) return [];
  const ids = idRows.map((r) => r.id);
  // Re-load full rows in the ranked order. We can't ORDER BY a
  // CASE/array_position cleanly through Prisma's typed find, so sort
  // in JS — the page is at most `pageSize` rows.
  const docs = await db.document.findMany({ where: { id: { in: ids } } });
  const order = new Map(ids.map((id, i) => [id, i]));
  docs.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return docs;
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

/**
 * Soft-delete a document and release its storage bytes from the
 * uploader's quota in a single transaction (US-10). Bytes are summed
 * across every DocumentFile (i.e. every version) belonging to the doc.
 * The uploader's `usedBytes` is floored at zero defensively in case
 * historical drift exists.
 */
export async function softDeleteDocumentAndReleaseQuota(
  id: string,
  updatedBy: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const doc = await tx.document.findUnique({
      where: { id },
      select: { uploaderId: true, deletedAt: true },
    });
    if (!doc || doc.deletedAt) return;
    // Only release bytes that were *actually billed* on insert. Restore
    // rows (countedTowardQuota=false) share an existing blob with an
    // earlier version, so they were never debited and must not be
    // credited back — otherwise repeated restore+delete would zero out
    // the user's used_bytes while real storage is still in use.
    const files = await tx.documentFile.findMany({
      where: { documentId: id, countedTowardQuota: true },
      select: { sizeBytes: true },
    });
    const total = files.reduce((s, f) => s + f.sizeBytes, 0n);
    await tx.document.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy },
    });
    if (total > 0n) {
      // GREATEST(0, used_bytes - total) so a counter that has drifted
      // negative through historical migrations cannot wrap around.
      await tx.$executeRaw`
        UPDATE "users"
        SET "used_bytes" = GREATEST(0, "used_bytes" - ${total}::bigint)
        WHERE "id" = ${doc.uploaderId}::uuid
      `;
    }
  });
}

// ─── Document versions (US-5) ────────────────────────────────────
//
// Each DocumentFile row is a version. The "current" version is the
// row with the highest `versionNumber`; older rows are preserved
// (never overwritten or deleted) so download/restore can reach them.

export interface DocumentVersionRow {
  id: string;
  documentId: string;
  versionNumber: number;
  originalFilename: string;
  displayFilename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  storageDriver: string;
  checksum: string;
  changeNote: string | null;
  uploadedById: string | null;
  uploadedAt: Date;
  isCurrent: boolean;
}

export async function findVersionsByDocument(
  documentId: string,
): Promise<DocumentVersionRow[]> {
  const rows = await db.documentFile.findMany({
    where: { documentId },
    orderBy: [{ versionNumber: "desc" }, { uploadedAt: "desc" }],
  });
  if (rows.length === 0) return [];
  const maxVersion = rows[0]!.versionNumber;
  return rows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    versionNumber: r.versionNumber,
    originalFilename: r.originalFilename,
    displayFilename: r.displayFilename,
    mimeType: r.mimeType,
    sizeBytes: Number(r.sizeBytes),
    storagePath: r.storagePath,
    storageDriver: r.storageDriver,
    checksum: r.checksum,
    changeNote: r.changeNote,
    uploadedById: r.uploadedById,
    uploadedAt: r.uploadedAt,
    isCurrent: r.versionNumber === maxVersion,
  }));
}

export async function findVersionByIdAndDocument(
  versionId: string,
  documentId: string,
): Promise<DocumentVersionRow | null> {
  const r = await db.documentFile.findFirst({
    where: { id: versionId, documentId },
  });
  if (!r) return null;
  const maxRow = await db.documentFile.findFirst({
    where: { documentId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  return {
    id: r.id,
    documentId: r.documentId,
    versionNumber: r.versionNumber,
    originalFilename: r.originalFilename,
    displayFilename: r.displayFilename,
    mimeType: r.mimeType,
    sizeBytes: Number(r.sizeBytes),
    storagePath: r.storagePath,
    storageDriver: r.storageDriver,
    checksum: r.checksum,
    changeNote: r.changeNote,
    uploadedById: r.uploadedById,
    uploadedAt: r.uploadedAt,
    isCurrent: r.versionNumber === (maxRow?.versionNumber ?? r.versionNumber),
  };
}

/**
 * Insert a brand-new version of `documentId`. Performs in one tx:
 *   1. compute next version number = MAX(version_number) + 1,
 *   2. insert DocumentFile,
 *   3. bump documents.current_version, updated_at, updated_by,
 *   4. increment uploader's used_bytes by sizeBytes.
 *
 * `releaseQuota` should be set true for normal new uploads. For
 * restore-existing-version (where the same blob is reused) pass false
 * so the same bytes aren't double-counted against the user's quota.
 */
export async function insertNewVersionFile(args: {
  documentId: string;
  uploadedById: string;
  fileValues: Omit<DocumentFileInsert, "documentId"> & { changeNote?: string | null };
  countTowardQuota: boolean;
  uploaderIdForQuota: string;
}): Promise<DocumentVersionRow> {
  const { documentId, uploadedById, fileValues, countTowardQuota, uploaderIdForQuota } = args;
  return db.$transaction(async (tx) => {
    const maxRow = await tx.documentFile.findFirst({
      where: { documentId },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });
    const nextVersion = (maxRow?.versionNumber ?? 0) + 1;
    const created = await tx.documentFile.create({
      data: {
        ...fileValues,
        documentId,
        sizeBytes: BigInt(fileValues.sizeBytes),
        versionNumber: nextVersion,
        changeNote: fileValues.changeNote ?? null,
        uploadedById,
        countedTowardQuota: countTowardQuota,
      },
    });
    await tx.document.update({
      where: { id: documentId },
      data: {
        currentVersion: nextVersion,
        updatedAt: new Date(),
        updatedBy: uploadedById,
      },
    });
    if (countTowardQuota && fileValues.sizeBytes > 0) {
      await tx.user.update({
        where: { id: uploaderIdForQuota },
        data: { usedBytes: { increment: BigInt(fileValues.sizeBytes) } },
      });
    }
    return {
      id: created.id,
      documentId: created.documentId,
      versionNumber: created.versionNumber,
      originalFilename: created.originalFilename,
      displayFilename: created.displayFilename,
      mimeType: created.mimeType,
      sizeBytes: Number(created.sizeBytes),
      storagePath: created.storagePath,
      storageDriver: created.storageDriver,
      checksum: created.checksum,
      changeNote: created.changeNote,
      uploadedById: created.uploadedById,
      uploadedAt: created.uploadedAt,
      isCurrent: true,
    };
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
