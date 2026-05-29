import { Router, type IRouter } from "express";
import { ListActivityQueryParams } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import * as auditService from "../services/audit.service";

const router: IRouter = Router();

router.get("/activity", requireAuth, async (req, res, next) => {
  try {
    const q = ListActivityQueryParams.parse(req.query);
    const result = await auditService.listActivity(req.authUser!, {
      page: q.page,
      pageSize: q.pageSize,
      entityType: q.entityType,
      mine: q.mine,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
