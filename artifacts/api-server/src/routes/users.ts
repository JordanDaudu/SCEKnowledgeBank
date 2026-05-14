import { Router, type IRouter } from "express";
import { desc, isNull } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { requireRole } from "../middlewares/auth";
import { loadUserSummaries } from "../lib/mappers";

const router: IRouter = Router();

router.get("/users", requireRole("admin"), async (_req, res, next) => {
  try {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(isNull(users.deletedAt))
      .orderBy(desc(users.createdAt));
    const summaries = await loadUserSummaries(rows.map((r) => r.id));
    res.json(rows.map((r) => summaries.get(r.id)).filter(Boolean));
  } catch (err) {
    next(err);
  }
});

export default router;
