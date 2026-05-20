import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import * as usersService from "../services/users.service";
import * as authService from "../services/auth.service";

const router: IRouter = Router();

router.get("/users", requireRole("admin"), async (_req, res, next) => {
  try {
    const summaries = await usersService.listAllSummaries();
    res.json(summaries);
  } catch (err) {
    next(err);
  }
});

// Admin-only: list lecturers whose accounts are awaiting approval.
router.get(
  "/users/pending-lecturers",
  requireRole("admin"),
  async (_req, res, next) => {
    try {
      const summaries = await usersService.listPendingLecturers();
      res.json(summaries);
    } catch (err) {
      next(err);
    }
  },
);

const IdParam = z.object({ id: z.string().uuid() });

router.post(
  "/users/:id/approve",
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const { id } = IdParam.parse(req.params);
      await authService.approveUser(id, req.authUser!.id);
      const summary = await usersService.getUserSummary(id);
      res.json(summary);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/users/:id/disable",
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const { id } = IdParam.parse(req.params);
      await authService.disableUser(id, req.authUser!.id);
      const summary = await usersService.getUserSummary(id);
      res.json(summary);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Admin route aliases (Sprint-2 audit) ──────────────────────────
// The audit asked for `/admin/users/...` paths alongside the
// historical `/users/...` paths so the admin-only operations are
// discoverable under an explicit admin namespace. Both paths reuse
// the exact same handlers (single source of truth), and both keep
// the `requireRole("admin")` guard. The OpenAPI spec advertises both
// so generated clients can pick either alias.
router.get(
  "/admin/users/pending-lecturers",
  requireRole("admin"),
  async (_req, res, next) => {
    try {
      const summaries = await usersService.listPendingLecturers();
      res.json(summaries);
    } catch (err) {
      next(err);
    }
  },
);

const AdminUserIdParam = z.object({ userId: z.string().uuid() });

router.post(
  "/admin/users/:userId/approve",
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const { userId } = AdminUserIdParam.parse(req.params);
      await authService.approveUser(userId, req.authUser!.id);
      const summary = await usersService.getUserSummary(userId);
      res.json(summary);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/admin/users/:userId/disable",
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const { userId } = AdminUserIdParam.parse(req.params);
      await authService.disableUser(userId, req.authUser!.id);
      const summary = await usersService.getUserSummary(userId);
      res.json(summary);
    } catch (err) {
      next(err);
    }
  },
);

// Authenticated user search for the @mention picker. Returns a small,
// capped list of active users matching by display name / email.
// Intentionally not admin-only: any signed-in user composing a comment
// needs to be able to find their teammates.
const SearchQuery = z.object({
  q: z.string().min(1).max(64),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

router.get("/users/search", requireAuth, async (req, res, next) => {
  try {
    const { q, limit } = SearchQuery.parse(req.query);
    const users = await usersService.searchUsers(q, limit);
    res.json(users);
  } catch (err) {
    next(err);
  }
});

export default router;
