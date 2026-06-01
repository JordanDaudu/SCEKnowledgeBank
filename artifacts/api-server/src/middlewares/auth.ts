import type { NextFunction, Request, Response } from "express";
import { forbidden, unauthorized } from "../lib/errors";
import { loadAuthenticatedUser } from "../services/auth.service";

export interface UserCourseEnrollment {
  courseId: string;
  roleInCourse: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  primaryRole: string;
  roles: string[];
  enrollments: UserCourseEnrollment[];
  username: string | null;
  avatarStoragePath: string | null;
  createdAt: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: AuthenticatedUser;
    }
  }
}

export async function loadUser(
  userId: string,
): Promise<AuthenticatedUser | null> {
  return loadAuthenticatedUser(userId);
}

export async function attachUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.session.userId;
  if (userId) {
    const user = await loadAuthenticatedUser(userId);
    if (user) req.authUser = user;
    else req.session.userId = undefined;
  }
  next();
}

export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.authUser) {
    next(unauthorized());
    return;
  }
  next();
}

export function requireRole(...allowed: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.authUser) return next(unauthorized());
    const ok = req.authUser.roles.some((r) => allowed.includes(r));
    if (!ok) return next(forbidden(`Requires one of: ${allowed.join(", ")}`));
    next();
  };
}

// Role-name helpers have been removed from this module. All role and
// visibility decisions now live in `services/permissions.service.ts`.
