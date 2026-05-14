import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import * as taxonomyService from "../services/taxonomy.service";

const router: IRouter = Router();

router.get("/courses", requireAuth, async (_req, res, next) => {
  try {
    res.json(await taxonomyService.listCourses());
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
