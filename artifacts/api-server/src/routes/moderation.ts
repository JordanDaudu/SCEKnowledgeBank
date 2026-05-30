import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/require-admin";
import * as moderation from "../services/moderation.service";

const router: IRouter = Router();

const IdParams = z.object({ id: z.string().uuid() });
const CommentIdParams = z.object({ commentId: z.string().uuid() });
const HideBody = z.object({ reason: z.string().max(500).optional() });
const ListQuery = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
});

router.get(
  "/admin/collections/moderation",
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { limit } = ListQuery.parse(req.query);
      res.json(await moderation.listModeration(req.authUser!, { limit }));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/admin/collections/:id/hide",
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      const { reason } = HideBody.parse(req.body);
      res.json(await moderation.hideCollection(req.authUser!, id, reason));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/admin/collections/:id/unhide",
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      res.json(await moderation.unhideCollection(req.authUser!, id));
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/admin/collections/comments/:commentId",
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { commentId } = CommentIdParams.parse(req.params);
      await moderation.removeComment(req.authUser!, commentId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

export default router;
