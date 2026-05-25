import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import * as usersService from "../services/users.service";

const router: IRouter = Router();

router.get("/storage/quota/me", requireAuth, async (req, res, next) => {
  try {
    const dto = await usersService.quotaSnapshotForUser(req.authUser!);
    res.json(dto);
  } catch (err) {
    next(err);
  }
});

export default router;
