import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireRole } from "../middlewares/auth";
import * as orphanedFilesService from "../services/orphaned-files.service";
import * as documentsService from "../services/documents.service";

const router: IRouter = Router();

const DocIdParam = z.object({ documentId: z.string().uuid() });
const ReassignBody = z.object({ newOwnerId: z.string().uuid() });

router.get("/admin/orphaned-files", requireRole("admin"), async (_req, res, next) => {
  try {
    res.json(await orphanedFilesService.listOrphanedFiles());
  } catch (err) {
    next(err);
  }
});

router.post(
  "/admin/orphaned-files/:documentId/reassign",
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const { documentId } = DocIdParam.parse(req.params);
      const { newOwnerId } = ReassignBody.parse(req.body);
      await orphanedFilesService.reassignDocument(req.authUser!, documentId, newOwnerId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/admin/orphaned-files/:documentId",
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const { documentId } = DocIdParam.parse(req.params);
      await documentsService.deleteDocument(documentId, req.authUser!);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

export default router;
