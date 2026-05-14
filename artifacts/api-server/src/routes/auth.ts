import { Router, type IRouter } from "express";
import { LoginBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import * as authService from "../services/auth.service";

const router: IRouter = Router();

router.post("/login", async (req, res, next) => {
  try {
    const body = LoginBody.parse(req.body);
    const { userId, user } = await authService.login(body.email, body.password);
    req.session.userId = userId;
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });
    res.json({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      primaryRole: user.primaryRole,
      roles: user.roles,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/logout", (req, res, next) => {
  const userId = req.session.userId;
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("kb.sid");
    if (userId) void authService.recordLogout(userId);
    res.status(204).end();
  });
});

router.get("/me", requireAuth, (req, res) => {
  const u = req.authUser!;
  res.json({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    primaryRole: u.primaryRole,
    roles: u.roles,
  });
});

export default router;
