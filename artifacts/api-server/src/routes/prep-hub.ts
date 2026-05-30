import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import * as permissions from "../services/permissions.service";
import { forbidden } from "../lib/errors";
import * as prepHubService from "../services/prep-hub.service";

const router: IRouter = Router();

const IdParams = z.object({ id: z.string().uuid() });
const DiscoverQuery = z.object({
  sort: z.enum(["popular", "recent"]).optional(),
  courseId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

// Following is a personal study affordance — students + lecturers only.
const requireFollowAccess: import("express").RequestHandler = (req, _res, next) => {
  if (!permissions.canUseCollections(req.authUser)) {
    return next(forbidden("Following is not available for your account"));
  }
  next();
};

router.get("/prep-hub/collections", requireAuth, async (req, res, next) => {
  try {
    const q = DiscoverQuery.parse(req.query);
    res.json(
      await prepHubService.listDiscoverable(req.authUser!, {
        sort: q.sort,
        courseId: q.courseId,
        limit: q.limit,
      }),
    );
  } catch (err) {
    next(err);
  }
});

router.get("/prep-hub/recommended", requireAuth, async (req, res, next) => {
  try {
    res.json(await prepHubService.getRecommendedCollections(req.authUser!));
  } catch (err) {
    next(err);
  }
});

router.get("/prep-hub/collections/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = IdParams.parse(req.params);
    res.json(await prepHubService.getPublicCollection(id, req.authUser!));
  } catch (err) {
    next(err);
  }
});

router.post(
  "/prep-hub/collections/:id/follow",
  requireAuth,
  requireFollowAccess,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      res.json(await prepHubService.followCollection(id, req.authUser!));
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/prep-hub/collections/:id/follow",
  requireAuth,
  requireFollowAccess,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      res.json(await prepHubService.unfollowCollection(id, req.authUser!));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
