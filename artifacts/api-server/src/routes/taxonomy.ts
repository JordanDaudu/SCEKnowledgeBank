import { Router, type IRouter } from "express";
import { asc } from "drizzle-orm";
import { db, courses, categories, tags } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/courses", requireAuth, async (_req, res, next) => {
  try {
    const rows = await db.select().from(courses).orderBy(asc(courses.code));
    res.json(
      rows.map((r) => ({
        id: r.id,
        code: r.code,
        title: r.title,
        lecturerName: r.lecturerName,
      })),
    );
  } catch (err) {
    next(err);
  }
});

router.get("/categories", requireAuth, async (_req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(categories)
      .orderBy(asc(categories.name));
    res.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        ...(r.description ? { description: r.description } : {}),
      })),
    );
  } catch (err) {
    next(err);
  }
});

router.get("/tags", requireAuth, async (_req, res, next) => {
  try {
    const rows = await db.select().from(tags).orderBy(asc(tags.name));
    res.json(rows.map((r) => ({ id: r.id, name: r.name })));
  } catch (err) {
    next(err);
  }
});

export default router;
