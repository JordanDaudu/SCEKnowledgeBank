import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { LoginBody } from "@workspace/api-zod";
import { requireAuth, loadUser } from "../middlewares/auth";
import { unauthorized } from "../lib/errors";
import { audit } from "../lib/audit";

const router: IRouter = Router();

router.post("/login", async (req, res, next) => {
  try {
    const body = LoginBody.parse(req.body);
    const found = await db
      .select()
      .from(users)
      .where(and(eq(users.email, body.email), isNull(users.deletedAt)))
      .limit(1);
    const user = found[0];
    if (!user || !user.isActive) throw unauthorized("Invalid credentials");
    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) throw unauthorized("Invalid credentials");
    req.session.userId = user.id;
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });
    const auth = await loadUser(user.id);
    if (!auth) throw unauthorized("Account not available");
    await audit(user.id, "user.login", "user", user.id);
    res.json({
      id: auth.id,
      email: auth.email,
      displayName: auth.displayName,
      primaryRole: auth.primaryRole,
      roles: auth.roles,
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
    if (userId) void audit(userId, "user.logout", "user", userId);
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
