import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import * as reputation from "../services/reputation.service";

const router: IRouter = Router();

const LeaderboardQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
const IdParams = z.object({ id: z.string().uuid() });

// GET /leaderboard?limit=50 — contributor reputation ranking (cached).
router.get("/leaderboard", requireAuth, async (req, res, next) => {
  try {
    const { limit } = LeaderboardQuery.parse(req.query);
    res.json(await reputation.getLeaderboard({ limit }));
  } catch (err) {
    next(err);
  }
});

// GET /users/:id/reputation — one user's score, level, and badges.
router.get("/users/:id/reputation", requireAuth, async (req, res, next) => {
  try {
    const { id } = IdParams.parse(req.params);
    res.json(await reputation.getUserReputation(id));
  } catch (err) {
    next(err);
  }
});

export default router;
