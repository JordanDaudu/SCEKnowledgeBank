import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { requireCollectionsAccess } from "../middlewares/collections-access";
import * as prepHubService from "../services/prep-hub.service";

const router: IRouter = Router();

const IdParams = z.object({ id: z.string().uuid() });
const DiscoverQuery = z.object({
  sort: z.enum(["popular", "recent"]).optional(),
  courseId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

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

// Recommendations are personalized off the caller's course signal. Admins
// have no enrollments, so the service returns an empty list for them — that
// is intended (admins browse the discover list, not personalized recs).
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
  requireCollectionsAccess,
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
  requireCollectionsAccess,
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
