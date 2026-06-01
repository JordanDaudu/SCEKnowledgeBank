import { Router, type IRouter } from "express";
import { z } from "zod";
import { LoginBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import * as authService from "../services/auth.service";
import { currentUserDto } from "../lib/current-user-dto";

const router: IRouter = Router();

// Server-side zod schema for registration. We intentionally do NOT
// import this from `@workspace/api-zod` — keeping the literal `role`
// union here ensures `admin` can never sneak through public
// registration even if the OpenAPI spec is ever loosened.
const RegisterBody = z.object({
  fullName: z.string().trim().min(1, "fullName is required").max(120),
  email: z.string().trim().min(1, "email is required").max(254),
  password: z.string().min(1, "password is required").max(200),
  confirmPassword: z.string().min(1, "confirmPassword is required").max(200),
  role: z.enum(["student", "lecturer"]),
  studentId: z.string().trim().max(64).optional(),
  lecturerId: z.string().trim().max(64).optional(),
  department: z.string().trim().max(120).optional(),
  enrolledCourseIds: z.array(z.string().uuid()).max(50).optional(),
  teachingCourseIds: z.array(z.string().uuid()).max(50).optional(),
});

router.post("/register", async (req, res, next) => {
  try {
    const body = RegisterBody.parse(req.body);
    const result = await authService.register(body);
    if (result.userId && result.user) {
      // Student path: auto-login by setting the session cookie.
      req.session.userId = result.userId;
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
      });
      res.status(201).json({
        status: result.status,
        message: result.message,
        user: {
          id: result.user.id,
          email: result.user.email,
          displayName: result.user.displayName,
          primaryRole: result.user.primaryRole,
          roles: result.user.roles,
          enrollments: result.user.enrollments,
        },
      });
      return;
    }
    // Lecturer path: account created but pending approval; no session.
    res.status(201).json({
      status: result.status,
      message: result.message,
      user: null,
    });
  } catch (err) {
    next(err);
  }
});

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
      enrollments: user.enrollments,
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
  res.json(currentUserDto(req.authUser!));
});

export default router;
