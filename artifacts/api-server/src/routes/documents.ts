import { Router, type IRouter } from "express";
import multer from "multer";
import { z } from "zod";
import {
  DocumentSuggestionsQueryParams,
  GetDocumentDownloadTokenParams,
  GetDocumentParams,
  GetDocumentPreviewTokenParams,
  ListDocumentsQueryParams,
  ListPendingReviewDocumentsQueryParams,
  ListRecentDocumentsQueryParams,
  UpdateDocumentBody,
  UpdateDocumentParams,
  DeleteDocumentParams,
  SubmitDocumentForReviewParams,
  ApproveDocumentParams,
  RejectDocumentParams,
  RejectDocumentBody,
  DownloadDocumentParams,
  DownloadDocumentQueryParams,
  PreviewDocumentParams,
  PreviewDocumentQueryParams,
  GetDocumentThumbnailParams,
  GetDocumentThumbnailQueryParams,
  ListDocumentVersionsParams,
  UploadDocumentVersionParams,
  RestoreDocumentVersionParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { forbidden } from "../lib/errors";
import { env } from "../lib/env";
import { MATERIAL_TYPE_VALUES } from "../lib/material-types";
import * as documentsService from "../services/documents.service";
import * as permissions from "../services/permissions.service";

// Sprint-2 audit: validate every field of the multipart upload body
// before the request reaches the service. Without this, a malformed
// UUID or bogus enum value would either bubble up as a generic
// `upload_failed` from the service, or — worse — slip through as a
// stored bad value. Multipart parses every field as a string, so we
// coerce numerics and accept multi-valued tagIds either as an array
// or a single string (Express + qs behaviour).
const UploadBodySchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(4000).optional(),
  visibility: z.enum(["public", "restricted", "private"]).default("public"),
  materialType: z
    .string()
    .refine((v) => (MATERIAL_TYPE_VALUES as readonly string[]).includes(v), {
      message: `materialType must be one of: ${MATERIAL_TYPE_VALUES.join(", ")}`,
    })
    .default("lecture-notes"),
  courseId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  semester: z.enum(["fall", "spring", "summer"]).optional(),
  academicYear: z.coerce.number().int().min(1900).max(2200).optional(),
  tagIds: z
    .union([z.string().uuid(), z.array(z.string().uuid())])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  // Sprint-3 M2: uploaders may choose to land a new doc as `draft` so
  // they can then move it through submit-for-review → approve/reject.
  // Default stays `published` to preserve legacy upload UX.
  status: z.enum(["draft", "published"]).optional(),
});

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
    if (!req.authUser || !permissions.canUpload(req.authUser)) {
      return next(forbidden("Only lecturers and admins can upload"));
    }
    next();
  },
  upload.array("files"),
  async (req, res, next) => {
    try {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      // Validate the multipart body up front (Sprint-2 audit). On
      // failure Zod throws; the error middleware turns that into a
      // clean 400 instead of the previous opaque `upload_failed`.
      const body = UploadBodySchema.parse(req.body);

      const input: documentsService.UploadInput = {
        files,
        materialType: body.materialType,
        visibility: body.visibility,
        description: body.description ?? "",
        tagIds: body.tagIds ?? [],
      };
      if (body.courseId) input.courseId = body.courseId;
      if (body.categoryId) input.categoryId = body.categoryId;
      if (body.semester) input.semester = body.semester;
      if (body.academicYear != null) input.academicYear = body.academicYear;
      if (body.title) input.titleOverride = body.title;
      if (body.status) input.status = body.status;

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

// ─── Review workflow (Sprint-3 M2) ───────────────────────────────
// IMPORTANT: `/documents/pending-review` MUST come before
// `/documents/:id` — Express matches in order, and otherwise the :id
// route would swallow `pending-review` as an id and 400 on UUID parse.

router.get(
  "/documents/pending-review",
  requireAuth,
  async (req, res, next) => {
    try {
      const q = ListPendingReviewDocumentsQueryParams.parse(req.query);
      const result = await documentsService.listPendingReview(req.authUser!, {
        page: q.page,
        pageSize: q.pageSize,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/documents/:id/submit-for-review",
  requireAuth,
  async (req, res, next) => {
    try {
      const { id } = SubmitDocumentForReviewParams.parse(req.params);
      const dto = await documentsService.submitForReview(id, req.authUser!);
      res.json(dto);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/documents/:id/approve",
  requireAuth,
  async (req, res, next) => {
    try {
      const { id } = ApproveDocumentParams.parse(req.params);
      const dto = await documentsService.approveDocument(id, req.authUser!);
      res.json(dto);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/documents/:id/reject",
  requireAuth,
  async (req, res, next) => {
    try {
      const { id } = RejectDocumentParams.parse(req.params);
      const body = RejectDocumentBody.parse(req.body);
      const dto = await documentsService.rejectDocument(
        id,
        body.reason,
        req.authUser!,
      );
      res.json(dto);
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

// ─── Versions (US-5) ─────────────────────────────────────────────
router.get(
  "/documents/:id/versions",
  requireAuth,
  async (req, res, next) => {
    try {
      const { id } = ListDocumentVersionsParams.parse(req.params);
      const dto = await documentsService.listVersions(id, req.authUser!);
      res.json(dto);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/documents/:id/versions",
  requireAuth,
  upload.single("file"),
  async (req, res, next) => {
    try {
      const { id } = UploadDocumentVersionParams.parse(req.params);
      const file = req.file as Express.Multer.File | undefined;
      if (!file) return next(forbidden("No file provided"));
      const changeNoteRaw =
        typeof req.body?.changeNote === "string"
          ? req.body.changeNote
          : undefined;
      const input: documentsService.UploadVersionInput = { file };
      if (changeNoteRaw && changeNoteRaw.trim().length > 0) {
        input.changeNote = changeNoteRaw.slice(0, 500);
      }
      const dto = await documentsService.uploadNewVersion(
        id,
        input,
        req.authUser!,
      );
      res.status(201).json(dto);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/documents/:id/versions/:versionId/restore",
  requireAuth,
  async (req, res, next) => {
    try {
      const { id, versionId } = RestoreDocumentVersionParams.parse(req.params);
      const dto = await documentsService.restoreVersion(
        id,
        versionId,
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

router.get("/documents/:id/thumbnail", async (req, res, next) => {
  try {
    const { id } = GetDocumentThumbnailParams.parse(req.params);
    const { token } = GetDocumentThumbnailQueryParams.parse(req.query);
    await documentsService.streamThumbnail(id, token, res);
  } catch (err) {
    next(err);
  }
});

router.get("/documents/:id/download", async (req, res, next) => {
  try {
    const { id } = DownloadDocumentParams.parse(req.params);
    const { token, versionId } = DownloadDocumentQueryParams.parse(req.query);
    await documentsService.streamDownload(id, token, res, versionId);
  } catch (err) {
    next(err);
  }
});

export default router;
