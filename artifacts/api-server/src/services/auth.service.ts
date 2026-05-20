import bcrypt from "bcryptjs";
import * as usersRepo from "../repositories/users.repo";
import * as enrollmentsRepo from "../repositories/enrollments.repo";
import * as auditService from "./audit.service";
import { unauthorized } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";

export interface LoginResult {
  userId: string;
  user: AuthenticatedUser;
}

export async function loadAuthenticatedUser(
  userId: string,
): Promise<AuthenticatedUser | null> {
  const users = await usersRepo.findManyWithRolesByIds([userId]);
  const u = users[0];
  if (!u || !u.isActive) return null;
  let primaryRole = "student";
  if (u.primaryRoleId) {
    const name = await usersRepo.findRoleNameById(u.primaryRoleId);
    if (name) primaryRole = name;
  } else if (u.roles.length > 0) {
    primaryRole = u.roles[0];
  }
  const enrollments = await enrollmentsRepo.findEnrollmentsForUser(u.id);
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    isActive: u.isActive,
    primaryRole,
    roles: u.roles,
    enrollments,
  };
}

export async function login(
  email: string,
  password: string,
): Promise<LoginResult> {
  const user = await usersRepo.findByEmail(email);
  if (!user || !user.isActive) throw unauthorized("Invalid credentials");
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw unauthorized("Invalid credentials");
  const auth = await loadAuthenticatedUser(user.id);
  if (!auth) throw unauthorized("Account not available");
  await auditService.record(user.id, "user.login", "user", user.id);
  return { userId: user.id, user: auth };
}

export async function recordLogout(userId: string): Promise<void> {
  await auditService.record(userId, "user.logout", "user", userId);
}
