import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import * as analyticsService from "../services/analytics.service";

const router: IRouter = Router();

router.get("/admin/analytics/overview", requireAuth, async (req, res, next) => {
  try {
    const dto = await analyticsService.getAdminOverview(req.authUser!);
    res.json(dto);
  } catch (err) {
    next(err);
  }
});

const CourseParam = z.object({ courseId: z.string().uuid() });

router.get("/courses/:courseId/analytics", requireAuth, async (req, res, next) => {
  try {
    const { courseId } = CourseParam.parse(req.params);
    const dto = await analyticsService.getCourseAnalytics(courseId, req.authUser!);
    res.json(dto);
  } catch (err) {
    next(err);
  }
});

export default router;
