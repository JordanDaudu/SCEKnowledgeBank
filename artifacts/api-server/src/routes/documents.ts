import { Router, type IRouter } from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
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
} from "drizzle-orm";
import {
  db,
  documents,
  documentFiles,
  documentTags,
  materialViewHistory,
  courses,
  tags as tagsTable,
} from "@workspace/db";
import {
  DocumentSuggestionsQueryParams,
  GetDocumentDownloadTokenParams,
  GetDocumentParams,
  GetDocumentPreviewTokenParams,
  ListDocumentsQueryParams,
  ListRecentDocumentsQueryParams,
  UpdateDocumentBody,
  UpdateDocumentParams,
  DeleteDocumentParams,
  DownloadDocumentParams,
  DownloadDocumentQueryParams,
  PreviewDocumentParams,
  PreviewDocumentQueryParams,
} from "@workspace/api-zod";
import { requireAuth, isAdmin, isLecturerOrAdmin } from "../middlewares/auth";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/errors";
import { assembleDocuments } from "../lib/mappers";
import { signToken, verifyToken } from "../lib/sign-url";
import { audit } from "../lib/audit";
import { getStorage } from "../lib/storage";
import { env } from "../lib/env";

const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024 },
});

function buildSignedUrl(
  documentId: string,
  action: "preview" | "download",
  token: string,
): string {
  return `/api/documents/${documentId}/${action}?token=${encodeURIComponent(
    token,
  )}`;
}

function canViewDocument(
  doc: typeof documents.$inferSelect,
  userId: string,
  roles: string[],
): boolean {
  if (doc.visibility === "public") return true;
  if (doc.visibility === "restricted") return true; // any authenticated user
  if (doc.visibility === "private") {
    return (
      doc.uploaderId === userId ||
      doc.ownerId === userId ||
      roles.includes("admin")
    );
  }
  return false;
}

// ───────────────────────────────────────────────────────── List + search
router.get("/documents", requireAuth, async (req, res, next) => {
  try {
    const q = ListDocumentsQueryParams.parse(req.query);

    const filters = [isNull(documents.deletedAt)];

    if (q.courseId) filters.push(eq(documents.courseId, q.courseId));
    if (q.categoryId) filters.push(eq(documents.categoryId, q.categoryId));
    if (q.materialType)
      filters.push(eq(documents.materialType, q.materialType));
    if (q.semester) filters.push(eq(documents.semester, q.semester));
    if (q.academicYear != null)
      filters.push(eq(documents.academicYear, q.academicYear));
    if (q.dateFrom)
      filters.push(gte(documents.createdAt, new Date(q.dateFrom)));
    if (q.dateTo) {
      const d = new Date(q.dateTo);
      d.setUTCHours(23, 59, 59, 999);
      filters.push(lte(documents.createdAt, d));
    }

    if (q.q) {
      const like = `%${q.q}%`;
      filters.push(
        or(
          ilike(documents.title, like),
          ilike(documents.description, like),
        )!,
      );
    }

    // Course code / lecturer name -> resolve to courseIds
    if (q.courseCode || q.lecturerName) {
      const courseFilters = [] as ReturnType<typeof eq>[];
      if (q.courseCode)
        courseFilters.push(ilike(courses.code, `%${q.courseCode}%`));
      if (q.lecturerName)
        courseFilters.push(
          ilike(courses.lecturerName, `%${q.lecturerName}%`),
        );
      const matched = await db
        .select({ id: courses.id })
        .from(courses)
        .where(and(...courseFilters));
      if (matched.length === 0) {
        res.json({ items: [], total: 0, page: q.page, pageSize: q.pageSize });
        return;
      }
      filters.push(
        inArray(
          documents.courseId,
          matched.map((m) => m.id),
        ),
      );
    }

    if (q.tagIds && q.tagIds.length > 0) {
      const matched = await db
        .select({ documentId: documentTags.documentId })
        .from(documentTags)
        .where(inArray(documentTags.tagId, q.tagIds));
      const docIds = Array.from(new Set(matched.map((m) => m.documentId)));
      if (docIds.length === 0) {
        res.json({ items: [], total: 0, page: q.page, pageSize: q.pageSize });
        return;
      }
      filters.push(inArray(documents.id, docIds));
    }

    // visibility scope: hide private docs unless uploader/owner or admin
    if (!isAdmin(req.authUser)) {
      filters.push(
        or(
          sql`${documents.visibility} <> 'private'`,
          eq(documents.uploaderId, req.authUser!.id),
          eq(documents.ownerId, req.authUser!.id),
        )!,
      );
    }

    let order;
    switch (q.sort) {
      case "oldest":
        order = asc(documents.createdAt);
        break;
      case "title":
        order = asc(documents.title);
        break;
      case "popularity":
        order = desc(documents.updatedAt);
        break;
      case "newest":
      default:
        order = desc(documents.createdAt);
        break;
    }

    const where = and(...filters);
    const countRows = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(documents)
      .where(where);
    const total = countRows[0]?.c ?? 0;

    const rows = await db
      .select()
      .from(documents)
      .where(where)
      .orderBy(order)
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);

    const items = await assembleDocuments(rows);
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────── Recent
router.get("/documents/recent", requireAuth, async (req, res, next) => {
  try {
    const q = ListRecentDocumentsQueryParams.parse(req.query);
    const recent = await db
      .select({
        documentId: materialViewHistory.documentId,
        viewedAt: sql<Date>`max(${materialViewHistory.viewedAt})`,
      })
      .from(materialViewHistory)
      .where(eq(materialViewHistory.userId, req.authUser!.id))
      .groupBy(materialViewHistory.documentId)
      .orderBy(desc(sql`max(${materialViewHistory.viewedAt})`))
      .limit(q.limit);

    if (recent.length === 0) {
      res.json([]);
      return;
    }
    const docRows = await db
      .select()
      .from(documents)
      .where(
        and(
          inArray(
            documents.id,
            recent.map((r) => r.documentId),
          ),
          isNull(documents.deletedAt),
        ),
      );
    const order = new Map(recent.map((r, i) => [r.documentId, i]));
    docRows.sort(
      (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
    );
    const items = await assembleDocuments(docRows);
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────── Suggestions
router.get("/documents/suggestions", requireAuth, async (req, res, next) => {
  try {
    const q = DocumentSuggestionsQueryParams.parse(req.query);
    const like = `%${q.q}%`;
    const suggestionFilters = [
      isNull(documents.deletedAt),
      or(
        ilike(documents.title, like),
        ilike(documents.description, like),
      )!,
    ];
    if (!isAdmin(req.authUser)) {
      suggestionFilters.push(
        or(
          sql`${documents.visibility} <> 'private'`,
          eq(documents.uploaderId, req.authUser!.id),
          eq(documents.ownerId, req.authUser!.id),
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
      .where(and(...suggestionFilters))
      .orderBy(desc(documents.createdAt))
      .limit(q.limit);
    const courseIds = rows
      .map((r) => r.courseId)
      .filter((i): i is string => !!i);
    const courseMap = new Map<string, string>();
    if (courseIds.length > 0) {
      const cRows = await db
        .select({ id: courses.id, code: courses.code })
        .from(courses)
        .where(inArray(courses.id, courseIds));
      for (const c of cRows) courseMap.set(c.id, c.code);
    }
    res.json(
      rows.map((r) => ({
        id: r.id,
        title: r.title,
        materialType: r.materialType,
        ...(r.courseId && courseMap.has(r.courseId)
          ? { courseCode: courseMap.get(r.courseId) }
          : {}),
      })),
    );
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────── Upload
const uploadHandler = upload.array("files");

router.post(
  "/documents/upload",
  requireAuth,
  (req, res, next) => {
    if (!isLecturerOrAdmin(req.authUser)) {
      return next(forbidden("Only lecturers and admins can upload"));
    }
    next();
  },
  uploadHandler,
  async (req, res, next) => {
    try {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) throw badRequest("No files provided");

      const sharedBody = req.body as Record<string, string | string[]>;
      const courseId = (sharedBody.courseId as string) || undefined;
      const categoryId = (sharedBody.categoryId as string) || undefined;
      const materialType = (sharedBody.materialType as string) || "other";
      const semester = (sharedBody.semester as string) || undefined;
      const academicYearRaw = sharedBody.academicYear as string | undefined;
      const academicYear = academicYearRaw
        ? Number.parseInt(academicYearRaw, 10)
        : undefined;
      const visibility = (sharedBody.visibility as string) || "public";
      const titleOverride = (sharedBody.title as string) || undefined;
      const description = (sharedBody.description as string) || "";
      const tagIds = Array.isArray(sharedBody.tagIds)
        ? (sharedBody.tagIds as string[])
        : sharedBody.tagIds
          ? [sharedBody.tagIds as string]
          : [];

      const storage = getStorage();
      const results: Array<Record<string, unknown>> = [];

      for (const file of files) {
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
          });

          const title =
            titleOverride && files.length === 1
              ? titleOverride
              : file.originalname.replace(/\.[^.]+$/, "") || file.originalname;

          const insertValues: typeof documents.$inferInsert = {
            id: docId,
            title,
            description,
            materialType,
            visibility,
            status: "published",
            uploaderId: req.authUser!.id,
            ownerId: req.authUser!.id,
            createdBy: req.authUser!.id,
            updatedBy: req.authUser!.id,
          };
          if (courseId) insertValues.courseId = courseId;
          if (categoryId) insertValues.categoryId = categoryId;
          if (semester) insertValues.semester = semester;
          if (academicYear != null && Number.isFinite(academicYear)) {
            insertValues.academicYear = academicYear;
          }

          const insertedDoc = await db
            .insert(documents)
            .values(insertValues)
            .returning();

          await db.insert(documentFiles).values({
            documentId: docId,
            originalFilename: file.originalname,
            storedFilename: key.split("/").pop() ?? key,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            storagePath: put.key,
            storageDriver: put.driver,
            checksum: put.checksum,
          });

          if (tagIds.length > 0) {
            await db
              .insert(documentTags)
              .values(tagIds.map((tagId) => ({ documentId: docId, tagId })))
              .onConflictDoNothing();
          }

          await audit(req.authUser!.id, "document.upload", "document", docId, {
            filename: file.originalname,
            sizeBytes: file.size,
          });

          const assembled = await assembleDocuments([insertedDoc[0]]);
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

      res.status(201).json({ results });
    } catch (err) {
      next(err);
    }
  },
);

// ───────────────────────────────────────────────────────── Get / Update / Delete
async function loadDocOr404(id: string) {
  const found = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
    .limit(1);
  if (!found[0]) throw notFound("Document not found");
  return found[0];
}

router.get("/documents/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = GetDocumentParams.parse(req.params);
    const doc = await loadDocOr404(id);
    if (!canViewDocument(doc, req.authUser!.id, req.authUser!.roles)) {
      throw forbidden("Cannot view this document");
    }
    // Record view
    await db
      .insert(materialViewHistory)
      .values({ documentId: doc.id, userId: req.authUser!.id });
    const assembled = await assembleDocuments([doc]);
    res.json(assembled[0]);
  } catch (err) {
    next(err);
  }
});

router.patch("/documents/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = UpdateDocumentParams.parse(req.params);
    const body = UpdateDocumentBody.parse(req.body);
    const doc = await loadDocOr404(id);
    const owns =
      doc.uploaderId === req.authUser!.id || doc.ownerId === req.authUser!.id;
    if (!owns && !isAdmin(req.authUser)) {
      throw forbidden("Cannot edit this document");
    }
    const patch: Partial<typeof documents.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: req.authUser!.id,
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

    await db.update(documents).set(patch).where(eq(documents.id, id));

    if (body.tagIds) {
      await db.delete(documentTags).where(eq(documentTags.documentId, id));
      if (body.tagIds.length > 0) {
        await db
          .insert(documentTags)
          .values(body.tagIds.map((tagId) => ({ documentId: id, tagId })))
          .onConflictDoNothing();
      }
    }

    await audit(req.authUser!.id, "document.update", "document", id);
    const updated = await loadDocOr404(id);
    const assembled = await assembleDocuments([updated]);
    res.json(assembled[0]);
  } catch (err) {
    next(err);
  }
});

router.delete("/documents/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = DeleteDocumentParams.parse(req.params);
    const doc = await loadDocOr404(id);
    const owns =
      doc.uploaderId === req.authUser!.id || doc.ownerId === req.authUser!.id;
    if (!owns && !isAdmin(req.authUser)) {
      throw forbidden("Cannot delete this document");
    }
    await db
      .update(documents)
      .set({ deletedAt: new Date(), updatedBy: req.authUser!.id })
      .where(eq(documents.id, id));
    await audit(req.authUser!.id, "document.delete", "document", id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────── Signed tokens
router.get(
  "/documents/:id/preview-token",
  requireAuth,
  async (req, res, next) => {
    try {
      const { id } = GetDocumentPreviewTokenParams.parse(req.params);
      const doc = await loadDocOr404(id);
      if (!canViewDocument(doc, req.authUser!.id, req.authUser!.roles)) {
        throw forbidden("Cannot preview this document");
      }
      const { token, expiresAt } = signToken(id, "preview", req.authUser!.id);
      res.json({
        token,
        expiresAt: expiresAt.toISOString(),
        url: buildSignedUrl(id, "preview", token),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/documents/:id/download-token",
  requireAuth,
  async (req, res, next) => {
    try {
      const { id } = GetDocumentDownloadTokenParams.parse(req.params);
      const doc = await loadDocOr404(id);
      if (!canViewDocument(doc, req.authUser!.id, req.authUser!.roles)) {
        throw forbidden("Cannot download this document");
      }
      const { token, expiresAt } = signToken(id, "download", req.authUser!.id);
      res.json({
        token,
        expiresAt: expiresAt.toISOString(),
        url: buildSignedUrl(id, "download", token),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ───────────────────────────────────────────────────────── Streaming
async function streamFile(
  documentId: string,
  res: import("express").Response,
  disposition: "inline" | "attachment",
): Promise<void> {
  const doc = await loadDocOr404(documentId);
  const fileRows = await db
    .select()
    .from(documentFiles)
    .where(eq(documentFiles.documentId, doc.id))
    .orderBy(desc(documentFiles.uploadedAt))
    .limit(1);
  const file = fileRows[0];
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

router.get("/documents/:id/preview", async (req, res, next) => {
  try {
    const { id } = PreviewDocumentParams.parse(req.params);
    const { token } = PreviewDocumentQueryParams.parse(req.query);
    const result = verifyToken(token, id, "preview");
    if (!result.valid) throw unauthorized("Invalid or expired token");
    await streamFile(id, res, "inline");
  } catch (err) {
    next(err);
  }
});

router.get("/documents/:id/download", async (req, res, next) => {
  try {
    const { id } = DownloadDocumentParams.parse(req.params);
    const { token } = DownloadDocumentQueryParams.parse(req.query);
    const result = verifyToken(token, id, "download");
    if (!result.valid) throw unauthorized("Invalid or expired token");
    await streamFile(id, res, "attachment");
    void audit(result.userId ?? null, "document.download", "document", id);
  } catch (err) {
    next(err);
  }
});

export default router;
