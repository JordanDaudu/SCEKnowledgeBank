import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import * as taxonomyService from "../services/taxonomy.service";

const router: IRouter = Router();

const CoursesQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

router.get("/courses", requireAuth, async (req, res, next) => {
  try {
    const { q, limit } = CoursesQuery.parse(req.query);
    res.json(await taxonomyService.listCourses({ q, limit }));
  } catch (err) {
    next(err);
  }
});

router.get("/categories", requireAuth, async (_req, res, next) => {
  try {
    res.json(await taxonomyService.listCategories());
  } catch (err) {
    next(err);
  }
});

router.get("/tags", requireAuth, async (_req, res, next) => {
  try {
    res.json(await taxonomyService.listTags());
  } catch (err) {
    next(err);
  }
});

export default router;
