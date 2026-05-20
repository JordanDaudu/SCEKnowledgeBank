import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import * as usersService from "../services/users.service";

const router: IRouter = Router();

router.get("/users", requireRole("admin"), async (_req, res, next) => {
  try {
    const summaries = await usersService.listAllSummaries();
    res.json(summaries);
  } catch (err) {
    next(err);
  }
});

// Authenticated user search for the @mention picker. Returns a small,
// capped list of active users matching by display name / email.
// Intentionally not admin-only: any signed-in user composing a comment
// needs to be able to find their teammates.
const SearchQuery = z.object({
  q: z.string().min(1).max(64),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

router.get("/users/search", requireAuth, async (req, res, next) => {
  try {
    const { q, limit } = SearchQuery.parse(req.query);
    const users = await usersService.searchUsers(q, limit);
    res.json(users);
  } catch (err) {
    next(err);
  }
});

export default router;
