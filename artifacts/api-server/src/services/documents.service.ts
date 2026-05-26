import { createHash } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import type { Response } from "express";
import * as docsRepo from "../repositories/documents.repo";
import * as taxonomyRepo from "../repositories/taxonomy.repo";
import * as commentsRepo from "../repositories/comments.repo";
import * as viewRepo from "../repositories/viewHistory.repo";
import * as usersService from "./users.service";
import * as quotaService from "./quota.service";
import * as taxonomyService from "./taxonomy.service";
import * as auditService from "./audit.service";
import * as permissions from "./permissions.service";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/errors";
import { signToken, verifyToken } from "../lib/sign-url";
import { getStorage } from "../lib/storage";
import { env } from "../lib/env";
import { mimeMatchesContent } from "../lib/mime-sniff";
import type { AuthenticatedUser } from "../middlewares/auth";
import {
  extractMetadata,
  fallbackIconFor,
  type FallbackIconType,
} from "./documents/metadata.service";

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
    extractedMetadata?: {
      pageCount?: number;
      detectedTitle?: string;
      author?: string;
      imageWidth?: number;
      imageHeight?: number;
      hasExtractedText: boolean;
    };
  };
  /**
   * Signed URL to a server-generated thumbnail (e.g. for image
   * uploads) when one exists. Goes through the same signed-URL path
   * as preview/download so visibility is enforced consistently.
   */
  thumbnailUrl?: string;
  /**
   * Generic icon bucket the UI should render when no thumbnail is
   * available. Derived from the latest file's MIME type by
   * `metadata.service.fallbackIconFor`.
   */
  fallbackIconType: FallbackIconType;
  /**
   * Server-computed permission flags for the requesting user. The
   * frontend reads these directly — it must not recompute permissions
   * locally from role/uploader heuristics (Sprint-2 audit).
   */
  permissions: {
    canView: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canDownload: boolean;
    canComment: boolean;
  };
}

// All visibility / role checks are delegated to permissions.service.

export async function assembleDocuments(
  docs: docsRepo.DocumentRow[],
  user: AuthenticatedUser,
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
      status: "ACTIVE",
      createdAt: d.createdAt.toISOString(),
    };
    const file = filesByDoc.get(d.id);
    // Permission flags are computed per-row using the canonical
    // permissions service so the wire DTO reflects exactly what the
    // server would enforce on write. `canDownload` mirrors `canView`:
    // signed-URL issuance lives behind the same visibility predicate.
    const permObj = {
      uploaderId: d.uploaderId,
      ownerId: d.ownerId,
      visibility: d.visibility,
      courseId: d.courseId,
    };
    const canView = permissions.canView(permObj, user);
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
      fallbackIconType: "unknown",
      permissions: {
        canView,
        canEdit: permissions.canEdit(permObj, user),
        canDelete: permissions.canDelete(permObj, user),
        canDownload: canView,
        canComment: permissions.canComment(permObj, user),
      },
    };
    const c = d.courseId ? coursesMap.get(d.courseId) : undefined;
    if (c) dto.course = c;
    const cat = d.categoryId ? categoriesMap.get(d.categoryId) : undefined;
    if (cat) dto.category = cat;
    if (d.semester) dto.semester = d.semester;
    if (d.academicYear != null) dto.academicYear = d.academicYear;
    if (file) {
      const fileDto: NonNullable<DocumentDTO["file"]> = {
        id: file.id,
        originalFilename: file.originalFilename,
        displayFilename: file.displayFilename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        uploadedAt: file.uploadedAt.toISOString(),
        checksum: file.checksum,
      };
      const extracted: NonNullable<
        NonNullable<DocumentDTO["file"]>["extractedMetadata"]
      > = { hasExtractedText: !!file.extractedText };
      if (file.pageCount != null) extracted.pageCount = file.pageCount;
      if (file.detectedTitle) extracted.detectedTitle = file.detectedTitle;
      if (file.author) extracted.author = file.author;
      if (file.imageWidth != null) extracted.imageWidth = file.imageWidth;
      if (file.imageHeight != null) extracted.imageHeight = file.imageHeight;
      fileDto.extractedMetadata = extracted;
      dto.file = fileDto;
      dto.fallbackIconType = fallbackIconFor(file.mimeType);
      if (file.thumbnailPath) {
        // Sign a short-lived thumbnail URL bound to the uploader of
        // the doc; thumbnails are only emitted once visibility has
        // already been checked (callers of assembleDocuments filter
        // first), so the embedded URL is safe to surface here.
        const { token } = signToken(d.id, "thumbnail", d.uploaderId);
        dto.thumbnailUrl = `/api/documents/${d.id}/thumbnail?token=${encodeURIComponent(token)}`;
      }
    } else {
      dto.fallbackIconType = fallbackIconFor(undefined);
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

  // When `q` is present we route through the Postgres FTS path
  // (task #28): same filters, but ranked by ts_rank against the GIN
  // index on `documents.search_vector`. Without `q` we keep the
  // existing prisma-based list path so sort/popularity semantics are
  // unchanged.
  if (q.q) {
    const visibilitySql = permissions.visibleDocumentFilterSql(user);
    const [total, rows] = await Promise.all([
      docsRepo.countSearchDocuments(q.q, filters, visibilitySql),
      docsRepo.searchDocumentsRanked(q.q, filters, visibilitySql, {
        sort: q.sort,
        page: q.page,
        pageSize: q.pageSize,
      }),
    ]);
    const items = await assembleDocuments(rows, user);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  const total = await docsRepo.countDocuments(filters);
  const rows = await docsRepo.listDocuments(filters, {
    sort: q.sort,
    page: q.page,
    pageSize: q.pageSize,
  });
  const items = await assembleDocuments(rows, user);
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
  return assembleDocuments(visible, user);
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
  const assembled = await assembleDocuments([doc], user);
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

  // ── Course-aware update guards (Sprint-2 audit) ──────────────────
  //
  // 1. If the patch changes `courseId`, the user must be allowed to
  //    upload into the *target* course as well. Without this check a
  //    lecturer who teaches course A but not B could read-modify-write
  //    a course-A doc into course B, smuggling it into a course they
  //    do not teach.
  // 2. The target course must actually exist; otherwise we'd produce
  //    an orphaned FK reference (and a confusing 500 downstream).
  // 3. A document whose final visibility is `restricted` must end up
  //    bound to a course — `restricted` without a `courseId` is not a
  //    meaningful state (nobody could read it; see permissions.canView).
  const effectiveCourseId =
    body.courseId !== undefined ? body.courseId : doc.courseId;
  const effectiveVisibility =
    body.visibility !== undefined ? body.visibility : doc.visibility;
  if (body.courseId !== undefined && body.courseId !== doc.courseId) {
    if (!permissions.canUploadToCourse(user, body.courseId ?? null)) {
      throw forbidden(
        body.courseId
          ? "You can only move documents into courses you teach"
          : "Only admins or lecturers with at least one taught course may detach a document from its course",
      );
    }
    if (body.courseId) {
      const exists = await taxonomyRepo.courseExists(body.courseId);
      if (!exists) throw badRequest("Target course does not exist");
    }
  }
  if (effectiveVisibility === "restricted" && !effectiveCourseId) {
    throw badRequest(
      "Restricted documents must be bound to a course (courseId required)",
    );
  }

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
  const assembled = await assembleDocuments([updated], user);
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
  // US-10: free the bytes from the uploader's quota atomically with
  // the soft-delete. Storage blobs are intentionally NOT purged here —
  // an admin can hard-restore by un-setting `deleted_at` if needed.
  // TODO(sprint-3): background reaper that hard-deletes blobs after a
  // grace period and reconciles the quota counter.
  await docsRepo.softDeleteDocumentAndReleaseQuota(id, user.id);
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

  // Sprint-2 audit: restricted visibility is only meaningful when the
  // document is bound to a course (`permissions.canView` requires
  // enrollment in `doc.courseId` for restricted reads). Refusing this
  // combination at the *service* boundary keeps every caller — HTTP,
  // tests, scripts — from creating a structurally-unreadable row.
  if (input.visibility === "restricted" && !input.courseId) {
    throw badRequest(
      "Restricted documents must be linked to a course.",
    );
  }

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

  // If the caller supplied a courseId, prove it resolves to a real
  // course before we touch storage. Without this the FK would only
  // fire mid-insert, surfacing as a 500 instead of a clean 400 and
  // leaving an orphan blob in object storage.
  if (input.courseId) {
    const exists = await taxonomyRepo.courseExists(input.courseId);
    if (!exists) throw badRequest("Target course does not exist");
  }

  const storage = getStorage();
  const results: UploadResultEntry[] = [];

  // Resolve the uploader's effective quota once up front; the running
  // `plannedUsed` tally is updated as files successfully commit, so a
  // partial-batch failure can't slip a later file past the cap. We work
  // in BigInt throughout to avoid Number precision loss on multi-GB
  // quotas.
  const { usedBytes: startUsed, quotaBytes } =
    await usersService.resolveEffectiveQuotaBytes(user);
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

      // Task #27: server-side metadata extraction. Never throws —
      // a malformed PDF or extractor crash must not fail the upload.
      // If a thumbnail came back, persist it under its own key.
      const extracted = await extractMetadata({
        buffer: file.buffer,
        mimeType: file.mimetype,
        filename: file.originalname,
      });
      let thumbnailPath: string | null = null;
      let thumbnailMimeType: string | null = null;
      if (extracted.thumbnail) {
        const thumbKey = `thumbnails/${docId.slice(0, 2)}/${docId}.jpg`;
        try {
          const thumbPut = await storage.put({
            key: thumbKey,
            body: extracted.thumbnail.body,
            contentType: extracted.thumbnail.mimeType,
          });
          thumbnailPath = thumbPut.key;
          thumbnailMimeType = extracted.thumbnail.mimeType;
        } catch {
          // Thumbnail write failure is also non-fatal; the doc just
          // shows the fallback icon.
          thumbnailPath = null;
        }
      }

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
        extractedText: extracted.extractedText ?? null,
        pageCount: extracted.pageCount ?? null,
        detectedTitle: extracted.detectedTitle ?? null,
        author: extracted.author ?? null,
        imageWidth: extracted.imageWidth ?? null,
        imageHeight: extracted.imageHeight ?? null,
        thumbnailPath,
        thumbnailMimeType,
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

      const assembled = await assembleDocuments([insertedDoc], user);
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

// ─── Versioning (US-5) ─────────────────────────────────────────────
export interface DocumentVersionDTO {
  id: string;
  documentId: string;
  versionNumber: number;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  changeNote: string | null;
  uploadedAt: string;
  uploader: usersService.UserSummaryDTO | null;
  isCurrent: boolean;
}

async function toVersionDTOs(
  rows: docsRepo.DocumentVersionRow[],
): Promise<DocumentVersionDTO[]> {
  const uploaderIds = Array.from(
    new Set(rows.map((r) => r.uploadedById).filter((id): id is string => !!id)),
  );
  const uploaders = await usersService.loadUserSummaries(uploaderIds);
  return rows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    versionNumber: r.versionNumber,
    originalFilename: r.originalFilename,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    checksum: r.checksum,
    changeNote: r.changeNote,
    uploadedAt: r.uploadedAt.toISOString(),
    uploader: r.uploadedById ? uploaders.get(r.uploadedById) ?? null : null,
    isCurrent: r.isCurrent,
  }));
}

export async function listVersions(
  documentId: string,
  user: AuthenticatedUser,
): Promise<DocumentVersionDTO[]> {
  const doc = await docsRepo.findByIdAlive(documentId);
  if (!doc) throw notFound("Document not found");
  if (!permissions.canView(doc, user))
    throw forbidden("Cannot view this document");
  const rows = await docsRepo.findVersionsByDocument(documentId);
  return toVersionDTOs(rows);
}

export interface UploadVersionInput {
  file: Express.Multer.File;
  changeNote?: string;
}

export async function uploadNewVersion(
  documentId: string,
  input: UploadVersionInput,
  user: AuthenticatedUser,
): Promise<DocumentVersionDTO> {
  const doc = await docsRepo.findByIdAlive(documentId);
  if (!doc) throw notFound("Document not found");
  if (!permissions.canManageVersions(doc, user))
    throw forbidden("Cannot upload a new version of this document");

  const file = input.file;
  if (!file) throw badRequest("No file provided");
  if (
    env.allowedMimeTypes.length > 0 &&
    !env.allowedMimeTypes.includes(file.mimetype)
  ) {
    throw badRequest(`Disallowed mime type: ${file.mimetype}`);
  }
  if (!mimeMatchesContent(file.mimetype, file.buffer)) {
    throw badRequest(
      `File content does not match declared type ${file.mimetype}`,
    );
  }

  // Quota gate against the original uploader (storage bytes always
  // belong to the user who owns the document, not the user uploading
  // the new version). In the common case those are the same person and
  // we can reuse the in-memory roles; otherwise we look the uploader
  // up by id so the role-based default still applies.
  const q =
    doc.uploaderId === user.id
      ? await quotaService.effectiveQuotaForUser(user)
      : await quotaService.effectiveQuotaById(doc.uploaderId);
  const fileSize = BigInt(file.size);
  if (!quotaService.canFit(q, fileSize)) {
    throw badRequest(
      `Storage quota exceeded for the document's uploader — ${Number(q.quotaBytes - q.usedBytes > 0n ? q.quotaBytes - q.usedBytes : 0n)} bytes remaining of ${Number(q.quotaBytes)}.`,
    );
  }

  // Persist the new blob under a versioned key.
  const checksum = sha256Hex(file.buffer);
  const ext = file.originalname.includes(".")
    ? file.originalname.slice(file.originalname.lastIndexOf("."))
    : "";
  const safeExt = ext.replace(/[^A-Za-z0-9.]/g, "").slice(0, 16);
  const nextVersionGuess = doc.currentVersion + 1;
  const key = `documents/${documentId.slice(0, 2)}/${documentId}.v${nextVersionGuess}-${uuidv4().slice(0, 8)}${safeExt}`;
  const put = await getStorage().put({
    key,
    body: file.buffer,
    contentType: file.mimetype,
    precomputedChecksum: checksum,
  });

  // Run extractor; failures are non-fatal — version still uploads.
  const extracted = await extractMetadata({
    buffer: file.buffer,
    mimeType: file.mimetype,
    filename: file.originalname,
  });
  let thumbnailPath: string | null = null;
  let thumbnailMimeType: string | null = null;
  if (extracted.thumbnail) {
    try {
      const thumbKey = `thumbnails/${documentId.slice(0, 2)}/${documentId}.v${nextVersionGuess}.jpg`;
      const thumbPut = await getStorage().put({
        key: thumbKey,
        body: extracted.thumbnail.body,
        contentType: extracted.thumbnail.mimeType,
      });
      thumbnailPath = thumbPut.key;
      thumbnailMimeType = extracted.thumbnail.mimeType;
    } catch {
      thumbnailPath = null;
    }
  }

  const inserted = await docsRepo.insertNewVersionFile({
    documentId,
    uploadedById: user.id,
    countTowardQuota: true,
    uploaderIdForQuota: doc.uploaderId,
    fileValues: {
      originalFilename: file.originalname,
      displayFilename: file.originalname,
      storedFilename: key.split("/").pop() ?? key,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      storagePath: put.key,
      storageDriver: put.driver,
      checksum: put.checksum,
      extractedText: extracted.extractedText ?? null,
      pageCount: extracted.pageCount ?? null,
      detectedTitle: extracted.detectedTitle ?? null,
      author: extracted.author ?? null,
      imageWidth: extracted.imageWidth ?? null,
      imageHeight: extracted.imageHeight ?? null,
      thumbnailPath,
      thumbnailMimeType,
      changeNote: input.changeNote?.trim() || null,
    },
  });

  await auditService.record(
    user.id,
    "document.version.create",
    "document",
    documentId,
    { versionNumber: inserted.versionNumber, sizeBytes: file.size },
  );

  const [dto] = await toVersionDTOs([inserted]);
  return dto;
}

/**
 * "Restore" an older version by making it the new latest. Implemented
 * as a *forward* operation: insert a new DocumentFile row that points
 * at the same storage blob as the source version, with a fresh
 * versionNumber. The original old row stays intact, preserving full
 * linear history. No bytes are added to the user's quota — the blob
 * is shared.
 */
export async function restoreVersion(
  documentId: string,
  versionId: string,
  user: AuthenticatedUser,
): Promise<DocumentVersionDTO> {
  const doc = await docsRepo.findByIdAlive(documentId);
  if (!doc) throw notFound("Document not found");
  if (!permissions.canManageVersions(doc, user))
    throw forbidden("Cannot restore versions of this document");
  const source = await docsRepo.findVersionByIdAndDocument(versionId, documentId);
  if (!source) throw notFound("Version not found");
  if (source.isCurrent) {
    throw badRequest("This version is already the current one");
  }

  const inserted = await docsRepo.insertNewVersionFile({
    documentId,
    uploadedById: user.id,
    // The blob is shared with the source version → do NOT double-count
    // it against quota. The original upload already paid the cost.
    countTowardQuota: false,
    uploaderIdForQuota: doc.uploaderId,
    fileValues: {
      originalFilename: source.originalFilename,
      displayFilename: source.displayFilename,
      storedFilename: source.storagePath.split("/").pop() ?? source.storagePath,
      mimeType: source.mimeType,
      sizeBytes: source.sizeBytes,
      storagePath: source.storagePath,
      storageDriver: source.storageDriver,
      checksum: source.checksum,
      changeNote: `Restored from version ${source.versionNumber}`,
    },
  });

  await auditService.record(
    user.id,
    "document.version.restore",
    "document",
    documentId,
    {
      restoredFromVersion: source.versionNumber,
      newVersionNumber: inserted.versionNumber,
    },
  );

  const [dto] = await toVersionDTOs([inserted]);
  return dto;
}

// ─── Signed tokens ─────────────────────────────────────────────────
export interface SignedTokenDTO {
  token: string;
  expiresAt: string;
  url: string;
}

function buildSignedUrl(
  documentId: string,
  action: "preview" | "download" | "thumbnail",
  token: string,
): string {
  return `/api/documents/${documentId}/${action}?token=${encodeURIComponent(token)}`;
}

export async function issueAccessToken(
  id: string,
  action: "preview" | "download" | "thumbnail",
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
  versionId?: string,
): Promise<void> {
  const doc = await docsRepo.findByIdAlive(documentId);
  if (!doc) throw notFound("Document not found");
  let file: {
    storagePath: string;
    mimeType: string;
    sizeBytes: number | bigint;
    originalFilename: string;
  } | null = null;
  if (versionId) {
    // Caller asked for a specific historical version. We've already
    // verified the user can view the document via the signed token; an
    // older version is no broader than the current one, so allowing
    // download is safe.
    const v = await docsRepo.findVersionByIdAndDocument(versionId, documentId);
    if (!v) throw notFound("Version not found");
    file = v;
  } else {
    file = await docsRepo.findLatestFileForDocument(doc.id);
  }
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
  if (disposition === "inline") {
    // Inline (preview) responses are loaded inside an <iframe> on the
    // web app. Without explicit framing permissions Chrome shows its
    // "This page has been blocked by Chrome" interstitial when any
    // upstream proxy injects a restrictive X-Frame-Options or COEP
    // header. We allow:
    //  - 'self' for production (same-origin web + api behind the
    //    autoscale router),
    //  - the Replit workspace/dev domains so the preview also renders
    //    inside the workspace's nested iframe during development.
    // Note: we intentionally do NOT set X-Frame-Options — it cannot
    // express a list of allowed origins and would override the CSP
    // policy in older browsers, blocking the workspace iframe.
    res.setHeader(
      "Content-Security-Policy",
      "frame-ancestors 'self' https://*.replit.dev https://*.replit.com https://replit.com https://*.replit.app",
    );
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Cache-Control", "private, no-store");
  }
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
  versionId?: string,
): Promise<void> {
  const result = verifyToken(token, id, "download");
  if (!result.valid) throw unauthorized("Invalid or expired token");
  await streamFile(id, res, "attachment", versionId);
  void auditService.record(
    result.userId ?? null,
    "document.download",
    "document",
    id,
  );
}

/**
 * Stream a server-generated thumbnail for `id`. Reuses the same signed
 * URL machinery as preview/download so visibility is enforced
 * consistently (the token is minted in `assembleDocuments` only after
 * `permissions.canView` succeeded). If the document has no thumbnail
 * (e.g. extraction failed), responds 404 — the UI will already be
 * rendering the fallback icon by then.
 */
export async function streamThumbnail(
  id: string,
  token: string,
  res: Response,
): Promise<void> {
  const result = verifyToken(token, id, "thumbnail");
  if (!result.valid) throw unauthorized("Invalid or expired token");
  const file = await docsRepo.findLatestFileForDocument(id);
  if (!file || !file.thumbnailPath) throw notFound("No thumbnail");
  const stream = await getStorage().getStream(file.thumbnailPath);
  res.setHeader("Content-Type", file.thumbnailMimeType ?? "image/jpeg");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Thumbnails are rendered as <img> in the SPA but may also surface
  // inside iframed preview panes (e.g. fallback when in-browser
  // preview is unsupported). Allow same-origin + Replit workspace
  // framing so upstream proxy defaults can't block them.
  res.setHeader(
    "Content-Security-Policy",
    "frame-ancestors 'self' https://*.replit.dev https://*.replit.com https://replit.com https://*.replit.app",
  );
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  stream.pipe(res);
}
