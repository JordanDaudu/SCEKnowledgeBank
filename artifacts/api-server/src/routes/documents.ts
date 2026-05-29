import { Router, type IRouter, type RequestHandler } from "express";
import multer from "multer";
import { decodeMultipartFilename } from "../lib/filename";
import { z } from "zod";
import {
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
  BulkDocumentActionBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { forbidden } from "../lib/errors";
import { env } from "../lib/env";
import { MATERIAL_TYPE_VALUES } from "../lib/material-types";
import * as documentsService from "../services/documents.service";
import * as searchService from "../services/search.service";
import * as permissions from "../services/permissions.service";
import * as dedupService from "../services/documents/dedup.service";
import * as suggestMetadataService from "../services/documents/suggest-metadata.service";

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
  // Default stays `published` to preserve legacy upload UX. Students
  // are force-pinned to `draft` by the service regardless of input.
  status: z.enum(["draft", "published"]).optional(),
  // Sprint-3 completion: when true, every successful upload is
  // immediately routed through `submitForReview` (audited + uploader
  // notified on approve/reject). Multipart delivers booleans as
  // strings, so coerce common truthy literals.
  autoSubmitForReview: z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === "boolean" ? v : ["1", "true", "on", "yes"].includes(v.toLowerCase())))
    .optional(),
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

// multer/busboy hand us `originalname` as latin1-decoded bytes, so UTF-8
// filenames (e.g. Hebrew) arrive mojibake'd. Normalise every uploaded file's
// name right after parsing so all downstream consumers (storage, DTO,
// filename-intel) see the correct UTF-8 name.
const normalizeUploadFilenames: RequestHandler = (req, _res, next) => {
  const fix = (f?: Express.Multer.File) => {
    if (f) f.originalname = decodeMultipartFilename(f.originalname);
  };
  fix(req.file);
  if (Array.isArray(req.files)) {
    req.files.forEach(fix);
  } else if (req.files) {
    for (const arr of Object.values(req.files)) arr.forEach(fix);
  }
  next();
};

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

// ─── v2 search surface (only search surface as of Sprint-3 M7) ────
// The legacy `GET /documents/suggestions` and the `q` parameter on
// `GET /documents` were retired in M7. The v2 endpoints below are
// the only full-text / autocomplete entry points, layering rank-aware
// snippets, facet counts, and a typed autocomplete that returns
// tag/course/uploader hits in addition to (and not just) documents.

const SearchQueryParams = z.object({
  q: z.string().trim().optional(),
  courseId: z.string().uuid().optional(),
  courseCode: z.string().optional(),
  lecturerName: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  materialType: z.string().optional(),
  semester: z.enum(["fall", "spring", "summer"]).optional(),
  academicYear: z.coerce.number().int().min(1900).max(2200).optional(),
  tagIds: z
    .union([z.string().uuid(), z.array(z.string().uuid())])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  uploaderId: z.string().uuid().optional(),
  status: z.string().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  sort: z
    .enum([
      "newest",
      "oldest",
      "title",
      "popularity",
      "relevance",
      "recent",
      "viewed",
      "downloaded",
      "favorited",
      "trending",
    ])
    .default("newest"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const FacetsQueryParams = SearchQueryParams.omit({
  sort: true,
  page: true,
  pageSize: true,
}).extend({
  // Facets ignore sort/pagination — they count the whole filtered
  // result set. We still default sort to "newest" before handing the
  // filter object to the service so the type signature is satisfied.
});

const AutocompleteQueryParams = z.object({
  q: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

router.get("/v2/documents/search", requireAuth, async (req, res, next) => {
  try {
    const q = SearchQueryParams.parse(
      normalizeArrayQuery(req.query as Record<string, unknown>, ["tagIds"]),
    );
    const result = await searchService.searchDocuments(q, req.authUser!);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get(
  "/v2/documents/search/facets",
  requireAuth,
  async (req, res, next) => {
    try {
      const parsed = FacetsQueryParams.parse(
        normalizeArrayQuery(req.query as Record<string, unknown>, ["tagIds"]),
      );
      const result = await searchService.searchFacets(
        { ...parsed, sort: "newest", page: 1, pageSize: 1 },
        req.authUser!,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Sprint-3 M4: smart-metadata helpers ──────────────────────────
// `duplicate-check` is a cheap probe the upload form fires before
// shipping bytes; `suggest-metadata` runs the real extractor chain
// against a single multipart file and returns title/tags/keywords/
// language plus a duplicate banner when applicable.

const DuplicateCheckQueryParams = z.object({
  // sha256 hex digest = 64 lowercase hex chars. We validate the shape
  // so a typo can't accidentally hit the slow filemany scan with a
  // random string.
  checksum: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/i, "checksum must be a 64-char hex sha256"),
});

router.get(
  "/v2/documents/duplicate-check",
  requireAuth,
  async (req, res, next) => {
    try {
      const { checksum } = DuplicateCheckQueryParams.parse(req.query);
      const duplicate = await dedupService.findVisibleDuplicateByChecksum(
        checksum.toLowerCase(),
        req.authUser!,
      );
      res.json({ duplicate: duplicate ?? null });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/v2/documents/suggest-metadata",
  requireAuth,
  (req, res, next) => {
    if (!req.authUser || !permissions.canUpload(req.authUser)) {
      return next(
        forbidden(
          "You do not have permission to upload. Students must be enrolled in at least one course.",
        ),
      );
    }
    next();
  },
  upload.single("file"),
  normalizeUploadFilenames,
  async (req, res, next) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "file is required" });
        return;
      }
      const result = await suggestMetadataService.suggestForUpload(
        {
          buffer: file.buffer,
          mimeType: file.mimetype,
          filename: file.originalname,
        },
        req.authUser!,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

router.get("/v2/documents/autocomplete", requireAuth, async (req, res, next) => {
  try {
    const q = AutocompleteQueryParams.parse(req.query);
    const result = await searchService.autocomplete(
      q.q,
      q.limit,
      req.authUser!,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post(
  "/documents/upload",
  requireAuth,
  (req, res, next) => {
    if (!req.authUser || !permissions.canUpload(req.authUser)) {
      // Students with zero enrollments fall through canUpload — the
      // message has to cover all three roles now (Sprint-3 completion).
      return next(
        forbidden(
          "You do not have permission to upload. Students must be enrolled in at least one course.",
        ),
      );
    }
    next();
  },
  upload.array("files"),
  normalizeUploadFilenames,
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
      if (body.autoSubmitForReview != null) {
        input.autoSubmitForReview = body.autoSubmitForReview;
      }

      const results = await documentsService.uploadDocuments(
        input,
        req.authUser!,
      );

      // Sprint-3 completion: after a successful upload, if the caller
      // asked for auto-submit (student UI default), route every fresh
      // draft through the M2 submit-for-review service so the audit
      // row + downstream notify pipeline fire exactly once. A
      // per-doc failure here is non-fatal — the file is uploaded and
      // the uploader can retry submission from the doc detail page.
      if (body.autoSubmitForReview) {
        for (const r of results) {
          if (r.success && r.document && r.document.status === "draft") {
            try {
              const dto = await documentsService.submitForReview(
                r.document.id,
                req.authUser!,
              );
              r.document = dto;
            } catch {
              // swallow — doc is still uploaded as draft
            }
          }
        }
      }
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

router.post("/documents/bulk", requireAuth, async (req, res, next) => {
  try {
    const body = BulkDocumentActionBody.parse(req.body);
    const results = await documentsService.bulkDocumentAction(
      body,
      req.authUser!,
    );
    res.json({ results });
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
  normalizeUploadFilenames,
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

router.delete(
  "/documents/:id/versions/:versionId",
  requireAuth,
  async (req, res, next) => {
    try {
      const { id, versionId } = RestoreDocumentVersionParams.parse(req.params);
      await documentsService.deleteVersion(id, versionId, req.authUser!);
      res.status(204).end();
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
