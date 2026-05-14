import { Router, type IRouter } from "express";
import { requireRole } from "../middlewares/auth";
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

export default router;
