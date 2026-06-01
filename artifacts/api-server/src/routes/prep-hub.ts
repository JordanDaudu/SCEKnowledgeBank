import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { requireCollectionsAccess } from "../middlewares/collections-access";
import * as prepHubService from "../services/prep-hub.service";
import * as engagementService from "../services/collection-engagement.service";
import * as commentsService from "../services/collection-comments.service";

const router: IRouter = Router();

const IdParams = z.object({ id: z.string().uuid() });
const DiscoverQuery = z.object({
  sort: z.enum(["popular", "recent", "new", "rating", "views", "trending", "exam"]).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  courseId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});
const TrendingQuery = z.object({
  limit: z.coerce.number().int().positive().max(50).optional(),
});
const RatingBody = z.object({ value: z.coerce.number().int().min(1).max(5) });
const CommentBody = z.object({ body: z.string().min(1) });
const CommentIdParams = z.object({ commentId: z.string().uuid() });

router.get("/prep-hub/collections", requireAuth, async (req, res, next) => {
  try {
    const q = DiscoverQuery.parse(req.query);
    res.json(
      await prepHubService.listDiscoverable(req.authUser!, {
        sort: q.sort,
        q: q.q,
        courseId: q.courseId,
        limit: q.limit,
      }),
    );
  } catch (err) {
    next(err);
  }
});

router.get("/prep-hub/trending", requireAuth, async (req, res, next) => {
  try {
    const { limit } = TrendingQuery.parse(req.query);
    res.json(await prepHubService.listTrending(req.authUser!, limit));
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

router.get("/prep-hub/followed", requireAuth, async (req, res, next) => {
  try {
    res.json(await prepHubService.listFollowed(req.authUser!));
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

// ─── Engagement (Phase 2) ─────────────────────────────────────────

router.post(
  "/prep-hub/collections/:id/like",
  requireAuth,
  requireCollectionsAccess,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      res.json(await engagementService.likeCollection(id, req.authUser!));
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/prep-hub/collections/:id/like",
  requireAuth,
  requireCollectionsAccess,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      res.json(await engagementService.unlikeCollection(id, req.authUser!));
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  "/prep-hub/collections/:id/rating",
  requireAuth,
  requireCollectionsAccess,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      const { value } = RatingBody.parse(req.body);
      res.json(await engagementService.rateCollection(id, req.authUser!, value));
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/prep-hub/collections/:id/rating",
  requireAuth,
  requireCollectionsAccess,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      res.json(await engagementService.clearRating(id, req.authUser!));
    } catch (err) {
      next(err);
    }
  },
);

// ─── Comments (Phase 2) ───────────────────────────────────────────

router.get(
  "/prep-hub/collections/:id/comments",
  requireAuth,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      res.json(await commentsService.listComments(id, req.authUser!));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/prep-hub/collections/:id/comments",
  requireAuth,
  requireCollectionsAccess,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      const { body } = CommentBody.parse(req.body);
      res.status(201).json(await commentsService.createComment(id, req.authUser!, body));
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/prep-hub/collections/comments/:commentId",
  requireAuth,
  requireCollectionsAccess,
  async (req, res, next) => {
    try {
      const { commentId } = CommentIdParams.parse(req.params);
      const { body } = CommentBody.parse(req.body);
      res.json(await commentsService.editComment(commentId, req.authUser!, body));
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/prep-hub/collections/comments/:commentId",
  requireAuth,
  requireCollectionsAccess,
  async (req, res, next) => {
    try {
      const { commentId } = CommentIdParams.parse(req.params);
      await commentsService.deleteComment(commentId, req.authUser!);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

export default router;
