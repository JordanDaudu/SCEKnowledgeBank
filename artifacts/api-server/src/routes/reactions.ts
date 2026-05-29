import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import * as reactionsService from "../services/reactions.service";

const router: IRouter = Router();

// Zod is only used here for path validation — request bodies are
// empty on both POST and DELETE; the kind comes in via the URL.
const ReactionParams = z.object({
  commentId: z.string().uuid(),
  kind: z.string().min(1),
});

router.post(
  "/comments/:commentId/reactions/:kind",
  requireAuth,
  async (req, res, next) => {
    try {
      const { commentId, kind } = ReactionParams.parse(req.params);
      const summary = await reactionsService.addReaction(
        commentId,
        kind,
        req.authUser!,
      );
      res.json(summary);
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/comments/:commentId/reactions/:kind",
  requireAuth,
  async (req, res, next) => {
    try {
      const { commentId, kind } = ReactionParams.parse(req.params);
      const summary = await reactionsService.removeReaction(
        commentId,
        kind,
        req.authUser!,
      );
      res.json(summary);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
