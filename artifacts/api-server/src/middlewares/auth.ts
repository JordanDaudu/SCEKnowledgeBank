import type { NextFunction, Request, Response } from "express";
import { eq, isNull, and } from "drizzle-orm";
import { db, users, userRoles, roles } from "@workspace/db";
import { forbidden, unauthorized } from "../lib/errors";

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  primaryRole: string;
  roles: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: AuthenticatedUser;
    }
  }
}

export async function loadUser(userId: string): Promise<AuthenticatedUser | null> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      isActive: users.isActive,
      primaryRoleId: users.primaryRoleId,
      roleName: roles.name,
    })
    .from(users)
    .leftJoin(userRoles, eq(userRoles.userId, users.id))
    .leftJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(users.id, userId), isNull(users.deletedAt)));
  if (rows.length === 0) return null;
  const first = rows[0];
  if (!first.isActive) return null;
  const roleNames = Array.from(
    new Set(rows.map((r) => r.roleName).filter((n): n is string => !!n)),
  );
  let primaryRole = "student";
  if (first.primaryRoleId) {
    const pr = await db
      .select({ name: roles.name })
      .from(roles)
      .where(eq(roles.id, first.primaryRoleId))
      .limit(1);
    if (pr[0]) primaryRole = pr[0].name;
  } else if (roleNames.length > 0) {
    primaryRole = roleNames[0];
  }
  return {
    id: first.id,
    email: first.email,
    displayName: first.displayName,
    isActive: first.isActive,
    primaryRole,
    roles: roleNames,
  };
}

export async function attachUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.session.userId;
  if (userId) {
    const user = await loadUser(userId);
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

export function isAdmin(u: AuthenticatedUser | undefined): boolean {
  return !!u?.roles.includes("admin");
}
export function isLecturerOrAdmin(u: AuthenticatedUser | undefined): boolean {
  return !!u && (u.roles.includes("admin") || u.roles.includes("lecturer"));
}
