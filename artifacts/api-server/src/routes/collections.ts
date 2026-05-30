import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { requireCollectionsAccess } from "../middlewares/collections-access";
import * as collectionsService from "../services/collections.service";
import * as studyProgressService from "../services/studyProgress.service";
import * as recommendationsService from "../services/recommendations.service";

const router: IRouter = Router();

const IdParams = z.object({ id: z.string().uuid() });
const ItemParams = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
});

const CreateBody = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  kind: z.string().optional(),
  courseId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  examName: z.string().optional(),
  semester: z.enum(["fall", "spring", "summer"]).optional(),
  academicYear: z.coerce.number().int().min(1900).max(2200).optional(),
  visibility: z.enum(["private", "public"]).optional(),
  examDate: z.coerce.date().optional(),
  documentIds: z.array(z.string().uuid()).optional(),
  tagIds: z.array(z.string().uuid()).optional(),
});
const UpdateBody = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  kind: z.string().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  examName: z.string().nullable().optional(),
  semester: z.enum(["fall", "spring", "summer"]).nullable().optional(),
  academicYear: z.coerce.number().int().min(1900).max(2200).nullable().optional(),
  visibility: z.enum(["private", "public"]).optional(),
  examDate: z.coerce.date().optional(),
  tagIds: z.array(z.string().uuid()).optional(),
});
const AddItemBody = z.object({
  documentId: z.string().uuid(),
  note: z.string().optional(),
});
const NoteBody = z.object({ note: z.string().nullable() });
const OrderBody = z.object({ documentIds: z.array(z.string().uuid()) });
const ProgressBody = z.object({ status: z.string() });

router.get("/collections", requireAuth, requireCollectionsAccess, async (req, res, next) => {
  try {
    res.json(await collectionsService.listMyCollections(req.authUser!));
  } catch (err) {
    next(err);
  }
});

router.post("/collections", requireAuth, requireCollectionsAccess, async (req, res, next) => {
  try {
    const body = CreateBody.parse(req.body);
    res.status(201).json(await collectionsService.createCollection(req.authUser!, body));
  } catch (err) {
    next(err);
  }
});

router.get("/collections/:id", requireAuth, requireCollectionsAccess, async (req, res, next) => {
  try {
    const { id } = IdParams.parse(req.params);
    res.json(await collectionsService.getCollection(id, req.authUser!));
  } catch (err) {
    next(err);
  }
});

router.patch("/collections/:id", requireAuth, requireCollectionsAccess, async (req, res, next) => {
  try {
    const { id } = IdParams.parse(req.params);
    const body = UpdateBody.parse(req.body);
    await collectionsService.updateCollection(id, req.authUser!, body);
    res.json(await collectionsService.getCollection(id, req.authUser!));
  } catch (err) {
    next(err);
  }
});

router.delete("/collections/:id", requireAuth, requireCollectionsAccess, async (req, res, next) => {
  try {
    const { id } = IdParams.parse(req.params);
    await collectionsService.deleteCollection(id, req.authUser!);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.post(
  "/collections/:id/duplicate",
  requireAuth,
  requireCollectionsAccess,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      res.status(201).json(await collectionsService.duplicateCollection(id, req.authUser!));
    } catch (err) {
      next(err);
    }
  },
);

router.post("/collections/:id/items", requireAuth, requireCollectionsAccess, async (req, res, next) => {
  try {
    const { id } = IdParams.parse(req.params);
    const body = AddItemBody.parse(req.body);
    await collectionsService.addDocument(id, req.authUser!, body.documentId, body.note);
    res.json(await collectionsService.getCollection(id, req.authUser!));
  } catch (err) {
    next(err);
  }
});

router.delete(
  "/collections/:id/items/:documentId",
  requireAuth,
  requireCollectionsAccess,
  async (req, res, next) => {
    try {
      const { id, documentId } = ItemParams.parse(req.params);
      await collectionsService.removeDocument(id, req.authUser!, documentId);
      res.json(await collectionsService.getCollection(id, req.authUser!));
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/collections/:id/items/:documentId",
  requireAuth,
  requireCollectionsAccess,
  async (req, res, next) => {
    try {
      const { id, documentId } = ItemParams.parse(req.params);
      const body = NoteBody.parse(req.body);
      await collectionsService.setItemNote(id, req.authUser!, documentId, body.note);
      res.json(await collectionsService.getCollection(id, req.authUser!));
    } catch (err) {
      next(err);
    }
  },
);

router.put("/collections/:id/order", requireAuth, requireCollectionsAccess, async (req, res, next) => {
  try {
    const { id } = IdParams.parse(req.params);
    const body = OrderBody.parse(req.body);
    await collectionsService.reorder(id, req.authUser!, body.documentIds);
    res.json(await collectionsService.getCollection(id, req.authUser!));
  } catch (err) {
    next(err);
  }
});

// ─── Study progress ───────────────────────────────────────────────
router.put("/documents/:id/progress", requireAuth, async (req, res, next) => {
  try {
    const { id } = IdParams.parse(req.params);
    const body = ProgressBody.parse(req.body);
    res.json(await studyProgressService.setProgress(id, body.status, req.authUser!));
  } catch (err) {
    next(err);
  }
});

router.get("/me/continue-studying", requireAuth, async (req, res, next) => {
  try {
    res.json(await studyProgressService.listInProgress(req.authUser!));
  } catch (err) {
    next(err);
  }
});

router.get("/me/recommendations", requireAuth, async (req, res, next) => {
  try {
    res.json(await recommendationsService.getRecommendations(req.authUser!));
  } catch (err) {
    next(err);
  }
});

export default router;
