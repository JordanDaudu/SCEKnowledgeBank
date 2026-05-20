import { createHash } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import type { Response } from "express";
import * as docsRepo from "../repositories/documents.repo";
import * as taxonomyRepo from "../repositories/taxonomy.repo";
import * as commentsRepo from "../repositories/comments.repo";
import * as viewRepo from "../repositories/viewHistory.repo";
import * as usersService from "./users.service";
import * as taxonomyService from "./taxonomy.service";
import * as auditService from "./audit.service";
import * as permissions from "./permissions.service";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/errors";
import { signToken, verifyToken } from "../lib/sign-url";
import { getStorage } from "../lib/storage";
import { env } from "../lib/env";
import { mimeMatchesContent } from "../lib/mime-sniff";
import type { AuthenticatedUser } from "../middlewares/auth";

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export interface DocumentDTO {
  id: string;
  title: string;
  description: string;
  course?: taxonomyService.CourseDTO;
  category?: taxonomyService.CategoryDTO;
  materialType: string;
  semester?: string;
  academicYear?: number;
  visibility: string;
  status: string;
  uploader: usersService.UserSummaryDTO;
  createdAt: string;
  updatedAt: string;
  viewCount: number;
  commentCount: number;
  tags: { id: string; name: string }[];
  file?: {
    id: string;
    originalFilename: string;
    displayFilename: string;
    mimeType: string;
    sizeBytes: number;
    uploadedAt: string;
    checksum?: string;
  };
}

// All visibility / role checks are delegated to permissions.service.

export async function assembleDocuments(
  docs: docsRepo.DocumentRow[],
): Promise<DocumentDTO[]> {
  if (docs.length === 0) return [];
  const ids = docs.map((d) => d.id);
  const [coursesMap, categoriesMap, uploadersMap, fileRows, tagLinks] =
    await Promise.all([
      taxonomyService.loadCourses(docs.map((d) => d.courseId)),
      taxonomyService.loadCategories(docs.map((d) => d.categoryId)),
      usersService.loadUserSummaries(docs.map((d) => d.uploaderId)),
      docsRepo.findFilesByDocumentIds(ids),
      docsRepo.findTagLinksForDocuments(ids),
    ]);

  const commentCounts = await commentsRepo.countAliveByDocumentIds(ids);
  const viewCounts = await viewRepo.countViewsByDocumentIds(ids);

  const filesByDoc = new Map<string, (typeof fileRows)[number]>();
  for (const f of fileRows) {
    const existing = filesByDoc.get(f.documentId);
    if (!existing || f.uploadedAt > existing.uploadedAt) {
      filesByDoc.set(f.documentId, f);
    }
  }

  const tagsByDoc = new Map<string, { id: string; name: string }[]>();
  for (const t of tagLinks) {
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
      viewCount: viewCounts.get(d.id) ?? 0,
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
        displayFilename: file.displayFilename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        uploadedAt: file.uploadedAt.toISOString(),
        checksum: file.checksum,
      };
    }
    return dto;
  });
}

export interface ListDocumentsQuery {
  courseId?: string;
  categoryId?: string;
  materialType?: string;
  semester?: string;
  academicYear?: number;
  dateFrom?: Date;
  dateTo?: Date;
  q?: string;
  courseCode?: string;
  lecturerName?: string;
  tagIds?: string[];
  sort: docsRepo.DocumentSort;
  page: number;
  pageSize: number;
}

export interface ListDocumentsResult {
  items: DocumentDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listDocuments(
  q: ListDocumentsQuery,
  user: AuthenticatedUser,
): Promise<ListDocumentsResult> {
  const filters: docsRepo.DocumentListFilters = {
    visibility: permissions.visibleDocumentFilter(user),
  };
  if (q.courseId) filters.courseId = q.courseId;
  if (q.categoryId) filters.categoryId = q.categoryId;
  if (q.materialType) filters.materialType = q.materialType;
  if (q.semester) filters.semester = q.semester;
  if (q.academicYear != null) filters.academicYear = q.academicYear;
  if (q.dateFrom) filters.dateFrom = q.dateFrom;
  if (q.dateTo) filters.dateTo = q.dateTo;
  if (q.q) filters.q = q.q;

  if (q.courseCode || q.lecturerName) {
    const ids = await taxonomyRepo.findCourseIdsByCodeOrLecturer(
      q.courseCode,
      q.lecturerName,
    );
    if (ids.length === 0) {
      return { items: [], total: 0, page: q.page, pageSize: q.pageSize };
    }
    filters.restrictCourseIds = ids;
  }

  if (q.tagIds && q.tagIds.length > 0) {
    const docIds = await docsRepo.findDocumentIdsByTagIds(q.tagIds);
    if (docIds.length === 0) {
      return { items: [], total: 0, page: q.page, pageSize: q.pageSize };
    }
    filters.restrictDocumentIds = docIds;
  }

  const total = await docsRepo.countDocuments(filters);
  const rows = await docsRepo.listDocuments(filters, {
    sort: q.sort,
    page: q.page,
    pageSize: q.pageSize,
  });
  const items = await assembleDocuments(rows);
  return { items, total, page: q.page, pageSize: q.pageSize };
}

export async function listRecentForUser(
  user: AuthenticatedUser,
  limit: number,
): Promise<DocumentDTO[]> {
  const ids = await viewRepo.listRecentDocumentIdsForUser(user.id, limit);
  if (ids.length === 0) return [];
  const docs = await docsRepo.findManyByIdsAlive(ids);
  // Recently-viewed history can outlive a user's access — e.g. if a
  // restricted document's course enrollment is revoked, or a private doc
  // changes owners. Re-check visibility every time so the recents strip
  // honors the same rules as `listDocuments` / `getById`.
  const visible = docs.filter((d) => permissions.canView(d, user));
  const order = new Map(ids.map((id, i) => [id, i]));
  visible.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return assembleDocuments(visible);
}

export interface SuggestionDTO {
  id: string;
  title: string;
  materialType: string;
  courseCode?: string;
}

export async function suggest(
  term: string,
  limit: number,
  user: AuthenticatedUser,
): Promise<SuggestionDTO[]> {
  const rows = await docsRepo.findSuggestions(term, limit, {
    unrestricted: permissions.isAdmin(user),
    userId: user.id,
  });
  const courseIds = rows
    .map((r) => r.courseId)
    .filter((i): i is string => !!i);
  const courseCodes = await taxonomyRepo.findCourseCodesByIds(courseIds);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    materialType: r.materialType,
    ...(r.courseId && courseCodes.has(r.courseId)
      ? { courseCode: courseCodes.get(r.courseId)! }
      : {}),
  }));
}

export async function getById(
  id: string,
  user: AuthenticatedUser,
): Promise<DocumentDTO> {
  const doc = await docsRepo.findByIdAlive(id);
  if (!doc) throw notFound("Document not found");
  if (!permissions.canView(doc, user))
    throw forbidden("Cannot view this document");
  await viewRepo.recordView(doc.id, user.id);
  const assembled = await assembleDocuments([doc]);
  return assembled[0];
}

export interface UpdateDocumentInput {
  title?: string;
  description?: string;
  courseId?: string | null;
  categoryId?: string | null;
  materialType?: string;
  semester?: string | null;
  academicYear?: number | null;
  visibility?: string;
  status?: string;
  tagIds?: string[];
}

export async function updateDocument(
  id: string,
  body: UpdateDocumentInput,
  user: AuthenticatedUser,
): Promise<DocumentDTO> {
  const doc = await docsRepo.findByIdAlive(id);
  if (!doc) throw notFound("Document not found");
  if (!permissions.canEdit(doc, user))
    throw forbidden("Cannot edit this document");

  const patch: Partial<docsRepo.DocumentInsert> = {
    updatedAt: new Date(),
    updatedBy: user.id,
  };
  if (body.title !== undefined) patch.title = body.title;
  if (body.description !== undefined) patch.description = body.description;
  if (body.courseId !== undefined) patch.courseId = body.courseId;
  if (body.categoryId !== undefined) patch.categoryId = body.categoryId;
  if (body.materialType !== undefined) patch.materialType = body.materialType;
  if (body.semester !== undefined) patch.semester = body.semester;
  if (body.academicYear !== undefined) patch.academicYear = body.academicYear;
  if (body.visibility !== undefined) patch.visibility = body.visibility;
  if (body.status !== undefined) patch.status = body.status;

  await docsRepo.updateDocumentById(id, patch);

  if (body.tagIds) {
    await docsRepo.replaceDocumentTags(id, body.tagIds);
  }

  await auditService.record(user.id, "document.update", "document", id);
  const updated = await docsRepo.findByIdAlive(id);
  if (!updated) throw notFound("Document not found");
  const assembled = await assembleDocuments([updated]);
  return assembled[0];
}

export async function deleteDocument(
  id: string,
  user: AuthenticatedUser,
): Promise<void> {
  const doc = await docsRepo.findByIdAlive(id);
  if (!doc) throw notFound("Document not found");
  if (!permissions.canDelete(doc, user))
    throw forbidden("Cannot delete this document");
  await docsRepo.softDeleteDocument(id, user.id);
  await auditService.record(user.id, "document.delete", "document", id);
}

// ─── Upload ─────────────────────────────────────────────────────────
export interface UploadInput {
  files: Express.Multer.File[];
  courseId?: string;
  categoryId?: string;
  materialType: string;
  semester?: string;
  academicYear?: number;
  visibility: string;
  titleOverride?: string;
  description: string;
  tagIds: string[];
}

export interface UploadResultEntry {
  originalFilename: string;
  success: boolean;
  document?: DocumentDTO;
  error?: string;
  errorCode?: string;
  /**
   * When `errorCode === "duplicate_file"`, the id and title of the
   * existing document that matched on (uploaderId, sha256). Lets the UI
   * link the user straight to the original instead of asking them to
   * "look for it".
   */
  duplicateOfDocumentId?: string;
  duplicateOfTitle?: string;
}

export async function uploadDocuments(
  input: UploadInput,
  user: AuthenticatedUser,
): Promise<UploadResultEntry[]> {
  if (input.files.length === 0) throw badRequest("No files provided");
  // Authoritative course-aware upload check — keeps internal callers
  // (not just the HTTP route) honest. Lecturers may only upload into
  // courses they actually teach; admins may upload anywhere.
  if (!permissions.canUploadToCourse(user, input.courseId ?? null)) {
    throw forbidden(
      input.courseId
        ? "You can only upload to courses you teach"
        : "Only admins or lecturers with at least one taught course may upload",
    );
  }

  const storage = getStorage();
  const results: UploadResultEntry[] = [];

  // Resolve the uploader's effective quota once up front; the running
  // `plannedUsed` tally is updated as files successfully commit, so a
  // partial-batch failure can't slip a later file past the cap. We work
  // in BigInt throughout to avoid Number precision loss on multi-GB
  // quotas.
  const { usedBytes: startUsed, quotaBytes } =
    await usersService.resolveEffectiveQuotaBytes(user.id);
  let plannedUsed = startUsed;

  const existingNames = await docsRepo.findUploaderDisplayFilenames(user.id);
  const usedNames = new Set(existingNames);

  function uniquify(name: string): string {
    if (!usedNames.has(name)) {
      usedNames.add(name);
      return name;
    }
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    for (let i = 2; i < 1000; i++) {
      const candidate = `${base} (${i})${ext}`;
      if (!usedNames.has(candidate)) {
        usedNames.add(candidate);
        return candidate;
      }
    }
    const candidate = `${base}-${uuidv4().slice(0, 8)}${ext}`;
    usedNames.add(candidate);
    return candidate;
  }

  for (const file of input.files) {
    try {
      if (
        env.allowedMimeTypes.length > 0 &&
        !env.allowedMimeTypes.includes(file.mimetype)
      ) {
        results.push({
          originalFilename: file.originalname,
          success: false,
          error: `Disallowed mime type: ${file.mimetype}`,
          errorCode: "disallowed_mime",
        });
        continue;
      }
      if (!mimeMatchesContent(file.mimetype, file.buffer)) {
        results.push({
          originalFilename: file.originalname,
          success: false,
          error: `File content does not match declared type ${file.mimetype}`,
          errorCode: "mime_mismatch",
        });
        continue;
      }

      // Hash exactly once. Reused for the dedup short-circuit below and
      // again as the stored `DocumentFile.checksum` (storage adapter
      // trusts this via `precomputedChecksum`).
      const checksum = sha256Hex(file.buffer);

      // Same-uploader dedup: if this user already has an alive document
      // backed by a file with this checksum, short-circuit before any
      // storage write. The duplicate result carries the original doc's
      // id/title so the UI can link straight to it.
      const dup = await docsRepo.findAliveFileByUploaderAndChecksum(
        user.id,
        checksum,
      );
      if (dup) {
        results.push({
          originalFilename: file.originalname,
          success: false,
          error: `You already uploaded this exact file as "${dup.documentTitle}".`,
          errorCode: "duplicate_file",
          duplicateOfDocumentId: dup.documentId,
          duplicateOfTitle: dup.documentTitle,
        });
        continue;
      }

      // Quota gate: would committing this file push the planned total
      // past the user's effective quota? If so, refuse without touching
      // storage or `usedBytes`. Per-file (rather than whole-batch) so a
      // smaller subsequent file can still squeak in under the cap.
      const fileSize = BigInt(file.size);
      if (plannedUsed + fileSize > quotaBytes) {
        const remaining = quotaBytes - plannedUsed;
        const remainingForMsg = remaining > 0n ? remaining : 0n;
        results.push({
          originalFilename: file.originalname,
          success: false,
          error: `Storage quota exceeded — ${Number(remainingForMsg)} bytes remaining of ${Number(quotaBytes)}.`,
          errorCode: "storage_quota_exceeded",
        });
        continue;
      }

      const docId = uuidv4();
      const ext = file.originalname.includes(".")
        ? file.originalname.slice(file.originalname.lastIndexOf("."))
        : "";
      const safeExt = ext.replace(/[^A-Za-z0-9.]/g, "").slice(0, 16);
      const key = `documents/${docId.slice(0, 2)}/${docId}${safeExt}`;

      const put = await storage.put({
        key,
        body: file.buffer,
        contentType: file.mimetype,
        precomputedChecksum: checksum,
      });

      const title =
        input.titleOverride && input.files.length === 1
          ? input.titleOverride
          : file.originalname.replace(/\.[^.]+$/, "") || file.originalname;

      const insertValues: docsRepo.DocumentInsert = {
        id: docId,
        title,
        description: input.description,
        materialType: input.materialType,
        visibility: input.visibility,
        status: "published",
        uploaderId: user.id,
        ownerId: user.id,
        createdBy: user.id,
        updatedBy: user.id,
      };
      if (input.courseId) insertValues.courseId = input.courseId;
      if (input.categoryId) insertValues.categoryId = input.categoryId;
      if (input.semester) insertValues.semester = input.semester;
      if (input.academicYear != null && Number.isFinite(input.academicYear)) {
        insertValues.academicYear = input.academicYear;
      }

      const displayName = uniquify(file.originalname);
      const fileValues: docsRepo.DocumentFileInsert = {
        documentId: docId,
        originalFilename: file.originalname,
        displayFilename: displayName,
        storedFilename: key.split("/").pop() ?? key,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storagePath: put.key,
        storageDriver: put.driver,
        checksum: put.checksum,
      };

      // Insert document, file, tag links, and increment usedBytes all in
      // one transaction so a partial failure cannot drift the counter.
      const insertedDoc = await docsRepo.insertDocumentWithFileAndQuota({
        documentValues: insertValues,
        fileValues,
        tagIds: input.tagIds,
        uploaderId: user.id,
        sizeBytes: file.size,
      });
      plannedUsed += fileSize;

      await auditService.record(
        user.id,
        "document.upload",
        "document",
        docId,
        {
          filename: file.originalname,
          sizeBytes: file.size,
        },
      );

      const assembled = await assembleDocuments([insertedDoc]);
      results.push({
        originalFilename: file.originalname,
        success: true,
        document: assembled[0],
      });
    } catch (e) {
      results.push({
        originalFilename: file.originalname,
        success: false,
        error: e instanceof Error ? e.message : "Upload failed",
        errorCode: "upload_failed",
      });
    }
  }

  return results;
}

// ─── Signed tokens ─────────────────────────────────────────────────
export interface SignedTokenDTO {
  token: string;
  expiresAt: string;
  url: string;
}

function buildSignedUrl(
  documentId: string,
  action: "preview" | "download",
  token: string,
): string {
  return `/api/documents/${documentId}/${action}?token=${encodeURIComponent(token)}`;
}

export async function issueAccessToken(
  id: string,
  action: "preview" | "download",
  user: AuthenticatedUser,
): Promise<SignedTokenDTO> {
  const doc = await docsRepo.findByIdAlive(id);
  if (!doc) throw notFound("Document not found");
  if (!permissions.canView(doc, user)) {
    throw forbidden(
      action === "preview"
        ? "Cannot preview this document"
        : "Cannot download this document",
    );
  }
  const { token, expiresAt } = signToken(id, action, user.id);
  return {
    token,
    expiresAt: expiresAt.toISOString(),
    url: buildSignedUrl(id, action, token),
  };
}

// ─── Streaming ────────────────────────────────────────────────────
async function streamFile(
  documentId: string,
  res: Response,
  disposition: "inline" | "attachment",
): Promise<void> {
  const doc = await docsRepo.findByIdAlive(documentId);
  if (!doc) throw notFound("Document not found");
  const file = await docsRepo.findLatestFileForDocument(doc.id);
  if (!file) throw notFound("Document has no file");
  const stream = await getStorage().getStream(file.storagePath);
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Content-Length", String(file.sizeBytes));
  const safeName = file.originalFilename.replace(/[^A-Za-z0-9._-]/g, "_");
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename="${safeName}"`,
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  stream.pipe(res);
}

export async function streamPreview(
  id: string,
  token: string,
  res: Response,
): Promise<void> {
  const result = verifyToken(token, id, "preview");
  if (!result.valid) throw unauthorized("Invalid or expired token");
  if (result.userId) {
    await viewRepo.tryRecordView(id, result.userId);
  }
  await streamFile(id, res, "inline");
}

export async function streamDownload(
  id: string,
  token: string,
  res: Response,
): Promise<void> {
  const result = verifyToken(token, id, "download");
  if (!result.valid) throw unauthorized("Invalid or expired token");
  await streamFile(id, res, "attachment");
  void auditService.record(
    result.userId ?? null,
    "document.download",
    "document",
    id,
  );
}
