import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import * as taxonomyService from "../services/taxonomy.service";

const router: IRouter = Router();

const CoursesQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

const CreateCourseBody = z.object({
  code: z.string().trim().min(1).max(32),
  title: z.string().trim().min(1).max(200),
  lecturerName: z.string().trim().min(1).max(120),
});

const UpdateCourseBody = z
  .object({
    code: z.string().trim().min(1).max(32).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    lecturerName: z.string().trim().min(1).max(120).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, {
    message: "At least one field must be provided.",
  });

const CourseIdParam = z.object({ id: z.string().uuid() });

router.get("/courses", requireAuth, async (req, res, next) => {
  try {
    const { q, limit } = CoursesQuery.parse(req.query);
    res.json(await taxonomyService.listCourses({ q, limit }));
  } catch (err) {
    next(err);
  }
});

router.post("/courses", requireRole("admin"), async (req, res, next) => {
  try {
    const input = CreateCourseBody.parse(req.body);
    const course = await taxonomyService.createCourse(input);
    res.status(201).json(course);
  } catch (err) {
    next(err);
  }
});

router.patch("/courses/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const { id } = CourseIdParam.parse(req.params);
    const input = UpdateCourseBody.parse(req.body);
    const course = await taxonomyService.updateCourse(id, input);
    res.json(course);
  } catch (err) {
    next(err);
  }
});

router.delete("/courses/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const { id } = CourseIdParam.parse(req.params);
    await taxonomyService.deleteCourse(id);
    res.status(204).end();
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
