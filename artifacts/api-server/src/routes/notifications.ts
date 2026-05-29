import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import * as notificationsService from "../services/notifications.service";

const router: IRouter = Router();

const ListQuery = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  unreadOnly: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "true"),
});

const IdParams = z.object({
  id: z.string().uuid(),
});

router.get("/notifications", requireAuth, async (req, res, next) => {
  try {
    const q = ListQuery.parse(req.query);
    const args: notificationsService.ListArgs = {};
    if (q.limit !== undefined) args.limit = q.limit;
    if (q.unreadOnly !== undefined) args.unreadOnly = q.unreadOnly;
    const list = await notificationsService.listForUser(req.authUser!, args);
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.get(
  "/notifications/unread-count",
  requireAuth,
  async (req, res, next) => {
    try {
      const unread = await notificationsService.unreadCountForUser(
        req.authUser!,
      );
      res.json({ unread });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/notifications/:id/read",
  requireAuth,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      await notificationsService.markRead(id, req.authUser!);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/notifications/read-all",
  requireAuth,
  async (req, res, next) => {
    try {
      const result = await notificationsService.markAllRead(req.authUser!);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
