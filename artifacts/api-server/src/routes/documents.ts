import { Router, type IRouter } from "express";
import multer from "multer";
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
import { requireAuth, isLecturerOrAdmin } from "../middlewares/auth";
import { forbidden } from "../lib/errors";
import { env } from "../lib/env";
import * as documentsService from "../services/documents.service";

const router: IRouter = Router();

/**
 * Normalize array-valued query parameters before Zod parsing.
 *
 * Express + qs delivers `?tagIds=abc` as a bare string and
 * `?tagIds=abc&tagIds=def` as a string array. Our generated zod schema
 * requires an array for `tagIds`, so a single selection (the common case
 * when the user picks just one tag) would otherwise 400.
 */
function normalizeArrayQuery<K extends string>(
  query: Record<string, unknown>,
  keys: K[],
): Record<string, unknown> {
  const out = { ...query };
  for (const k of keys) {
    const v = out[k];
    if (typeof v === "string") out[k] = [v];
  }
  return out;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024 },
});

router.get("/documents", requireAuth, async (req, res, next) => {
  try {
    const q = ListDocumentsQueryParams.parse(
      normalizeArrayQuery(req.query as Record<string, unknown>, ["tagIds"]),
    );
    const result = await documentsService.listDocuments(q, req.authUser!);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/documents/recent", requireAuth, async (req, res, next) => {
  try {
    const q = ListRecentDocumentsQueryParams.parse(req.query);
    const items = await documentsService.listRecentForUser(
      req.authUser!,
      q.limit,
    );
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.get("/documents/suggestions", requireAuth, async (req, res, next) => {
  try {
    const q = DocumentSuggestionsQueryParams.parse(req.query);
    const items = await documentsService.suggest(q.q, q.limit, req.authUser!);
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.post(
  "/documents/upload",
  requireAuth,
  (req, res, next) => {
    if (!isLecturerOrAdmin(req.authUser)) {
      return next(forbidden("Only lecturers and admins can upload"));
    }
    next();
  },
  upload.array("files"),
  async (req, res, next) => {
    try {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      const body = req.body as Record<string, string | string[] | undefined>;
      const academicYearRaw = body.academicYear as string | undefined;
      const academicYear = academicYearRaw
        ? Number.parseInt(academicYearRaw, 10)
        : undefined;
      const tagIds = Array.isArray(body.tagIds)
        ? (body.tagIds as string[])
        : body.tagIds
          ? [body.tagIds as string]
          : [];

      const input: documentsService.UploadInput = {
        files,
        materialType: (body.materialType as string) || "other",
        visibility: (body.visibility as string) || "public",
        description: (body.description as string) || "",
        tagIds,
      };
      if (body.courseId) input.courseId = body.courseId as string;
      if (body.categoryId) input.categoryId = body.categoryId as string;
      if (body.semester) input.semester = body.semester as string;
      if (academicYear != null) input.academicYear = academicYear;
      if (body.title) input.titleOverride = body.title as string;

      const results = await documentsService.uploadDocuments(
        input,
        req.authUser!,
      );
      res.status(201).json({ results });
    } catch (err) {
      next(err);
    }
  },
);

router.get("/documents/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = GetDocumentParams.parse(req.params);
    const dto = await documentsService.getById(id, req.authUser!);
    res.json(dto);
  } catch (err) {
    next(err);
  }
});

router.patch("/documents/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = UpdateDocumentParams.parse(req.params);
    const body = UpdateDocumentBody.parse(req.body);
    const dto = await documentsService.updateDocument(
      id,
      body,
      req.authUser!,
    );
    res.json(dto);
  } catch (err) {
    next(err);
  }
});

router.delete("/documents/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = DeleteDocumentParams.parse(req.params);
    await documentsService.deleteDocument(id, req.authUser!);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get(
  "/documents/:id/preview-token",
  requireAuth,
  async (req, res, next) => {
    try {
      const { id } = GetDocumentPreviewTokenParams.parse(req.params);
      const dto = await documentsService.issueAccessToken(
        id,
        "preview",
        req.authUser!,
      );
      res.json(dto);
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
      const dto = await documentsService.issueAccessToken(
        id,
        "download",
        req.authUser!,
      );
      res.json(dto);
    } catch (err) {
      next(err);
    }
  },
);

router.get("/documents/:id/preview", async (req, res, next) => {
  try {
    const { id } = PreviewDocumentParams.parse(req.params);
    const { token } = PreviewDocumentQueryParams.parse(req.query);
    await documentsService.streamPreview(id, token, res);
  } catch (err) {
    next(err);
  }
});

router.get("/documents/:id/download", async (req, res, next) => {
  try {
    const { id } = DownloadDocumentParams.parse(req.params);
    const { token } = DownloadDocumentQueryParams.parse(req.query);
    await documentsService.streamDownload(id, token, res);
  } catch (err) {
    next(err);
  }
});

export default router;
