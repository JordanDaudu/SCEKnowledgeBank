import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import * as usersRepo from "../repositories/users.repo";
import * as enrollmentsRepo from "../repositories/enrollments.repo";
import * as auditService from "./audit.service";
import { badRequest, conflict, forbidden, unauthorized } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";

export const PASSWORD_RULES = {
  minLength: 8,
  // At least one letter and one number. Kept permissive enough to be
  // demo-friendly while still catching obviously weak inputs.
  regex: /^(?=.*[A-Za-z])(?=.*\d).+$/,
};

export interface RegisterInput {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
  role: "student" | "lecturer";
  studentId?: string;
  lecturerId?: string;
  department?: string;
  enrolledCourseIds?: string[];
  teachingCourseIds?: string[];
}

export interface RegisterResult {
  /** Populated only when the user was auto-logged-in (students). */
  userId: string | null;
  user: AuthenticatedUser | null;
  status: usersRepo.AccountStatus;
  message: string;
}

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
  // Session-resolution must also honour lifecycle status: a user that
  // an admin disables (or that was created PENDING_APPROVAL and
  // somehow has a session — e.g. they registered as a student then
  // were later flagged) must not be treated as authenticated.
  if (u.status && u.status !== "ACTIVE") return null;
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
    username: u.username,
    avatarStoragePath: u.avatarStoragePath,
    createdAt: u.createdAt.toISOString(),
  };
}

export async function login(
  email: string,
  password: string,
): Promise<LoginResult> {
  // Case-insensitive email lookup so logins work regardless of the
  // casing the user typed.
  const user = await usersRepo.findByEmailCaseInsensitive(email);
  if (!user || !user.isActive) throw unauthorized("Invalid credentials");
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw unauthorized("Invalid credentials");
  if (user.status === "DISABLED") {
    throw forbidden(
      "Your account has been disabled. Please contact an administrator.",
    );
  }
  if (user.status === "PENDING_APPROVAL") {
    throw forbidden(
      "Your lecturer account is pending admin approval.",
    );
  }
  const auth = await loadAuthenticatedUser(user.id);
  if (!auth) throw unauthorized("Account not available");
  await auditService.record(user.id, "user.login", "user", user.id);
  return { userId: user.id, user: auth };
}

export async function recordLogout(userId: string): Promise<void> {
  await auditService.record(userId, "user.logout", "user", userId);
}

// ─── Registration ────────────────────────────────────────────────────

function validateRegisterInput(input: RegisterInput): void {
  const errs: string[] = [];
  if (!input.fullName?.trim()) errs.push("fullName is required");
  if (!input.email?.trim()) errs.push("email is required");
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    errs.push("email is not a valid address");
  }
  if (!input.password) errs.push("password is required");
  if (input.password && input.password.length < PASSWORD_RULES.minLength) {
    errs.push(`password must be at least ${PASSWORD_RULES.minLength} characters`);
  }
  if (input.password && !PASSWORD_RULES.regex.test(input.password)) {
    errs.push("password must include at least one letter and one number");
  }
  if (input.password !== input.confirmPassword) {
    errs.push("password confirmation does not match");
  }
  if (input.role !== "student" && input.role !== "lecturer") {
    errs.push("role must be student or lecturer");
  }
  if (errs.length > 0) throw badRequest(errs.join("; "));
}

/**
 * Register a new student or lecturer account.
 *
 * - Students: created in `ACTIVE` status and ready to log in.
 * - Lecturers: created in `PENDING_APPROVAL` until an admin approves.
 *
 * Admin self-registration is intentionally impossible — the zod schema
 * on the route narrows `role` to a literal union of `student | lecturer`,
 * and this service rejects anything else as bad input.
 *
 * Course enrollment IDs are honoured opportunistically: rows are
 * inserted via `createMany skipDuplicates`, so unknown course IDs do
 * not block registration. The optional `studentId` / `lecturerId` /
 * `department` strings are stored on the user record for display.
 */
export async function register(input: RegisterInput): Promise<RegisterResult> {
  validateRegisterInput(input);

  const email = input.email.trim().toLowerCase();
  const existing = await usersRepo.findByEmailCaseInsensitive(email);
  if (existing) throw conflict("An account with that email already exists");

  const roleId = await usersRepo.findRoleIdByName(input.role);
  if (!roleId) {
    // Misconfigured DB — roles should be seeded. Surface a 500-style
    // error via badRequest so the user sees a clean message instead of
    // a raw Prisma error.
    throw badRequest(`Role '${input.role}' is not available`);
  }

  const passwordHash = await bcrypt.hash(input.password, 10);
  const status: usersRepo.AccountStatus =
    input.role === "lecturer" ? "PENDING_APPROVAL" : "ACTIVE";

  const created = await usersRepo.createWithRole({
    email,
    passwordHash,
    displayName: input.fullName.trim(),
    primaryRoleId: roleId,
    status,
    studentId: input.studentId?.trim() || null,
    lecturerId: input.lecturerId?.trim() || null,
    department: input.department?.trim() || null,
  });

  // Optional course enrollments. We accept the lists even when the
  // role doesn't traditionally use that list — e.g. a student passing
  // teachingCourseIds is just ignored — to keep the API forgiving.
  const courseIds =
    input.role === "student"
      ? input.enrolledCourseIds ?? []
      : input.teachingCourseIds ?? [];
  if (courseIds.length > 0) {
    await enrollmentsRepo.upsertEnrollments(
      courseIds.map((courseId) => ({
        userId: created.id,
        courseId,
        roleInCourse: input.role,
      })),
    );
  }

  await auditService.record(created.id, "user.register", "user", created.id, {
    role: input.role,
    status,
  });

  if (status === "ACTIVE") {
    const auth = await loadAuthenticatedUser(created.id);
    if (!auth) throw unauthorized("Account not available");
    return {
      userId: created.id,
      user: auth,
      status,
      message: "Welcome to Knowledge Bank.",
    };
  }
  return {
    userId: null,
    user: null,
    status,
    message: "Your lecturer account is pending admin approval.",
  };
}

export async function approveUser(
  targetUserId: string,
  actorId: string,
): Promise<usersRepo.UserRow> {
  const row = await usersRepo.updateStatus(targetUserId, "ACTIVE");
  if (!row) throw badRequest("User not found");
  await auditService.record(actorId, "user.approve", "user", targetUserId);
  return row;
}

export async function disableUser(
  targetUserId: string,
  actorId: string,
): Promise<usersRepo.UserRow> {
  const row = await usersRepo.updateStatus(targetUserId, "DISABLED");
  if (!row) throw badRequest("User not found");
  await auditService.record(actorId, "user.disable", "user", targetUserId);
  return row;
}

// ─── Admin password reset ─────────────────────────────────────────────

// Character sets used to build a temporary password. Visually ambiguous
// characters (0/O, 1/l/I) are intentionally omitted so the admin can read
// the generated password aloud or copy it without confusion.
const PW_LOWER = "abcdefghijkmnpqrstuvwxyz";
const PW_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const PW_DIGITS = "23456789";

/**
 * Generate a strong, random temporary password. Guarantees at least one
 * lowercase letter, one uppercase letter, and one digit so it always
 * satisfies {@link PASSWORD_RULES} (letter + number). Uses crypto-grade
 * randomness via `crypto.randomInt`.
 */
export function generateTempPassword(length = 8): string {
  if (length < 3) throw new Error("Temporary password must be at least 3 chars");
  const all = PW_LOWER + PW_UPPER + PW_DIGITS;
  const chars = [
    PW_LOWER[randomInt(PW_LOWER.length)],
    PW_UPPER[randomInt(PW_UPPER.length)],
    PW_DIGITS[randomInt(PW_DIGITS.length)],
  ];
  for (let i = chars.length; i < length; i++) {
    chars.push(all[randomInt(all.length)]);
  }
  // Fisher–Yates shuffle so the guaranteed characters aren't always first.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/**
 * Admin-initiated password reset: set a freshly generated strong password
 * on the target user and return the plaintext once so the admin can hand
 * it to the user. The plaintext is never stored — only its bcrypt hash.
 */
export async function adminResetPassword(
  actorId: string,
  targetUserId: string,
): Promise<{ password: string }> {
  const target = await usersRepo.findById(targetUserId);
  if (!target) throw badRequest("User not found");
  const password = generateTempPassword(8);
  const passwordHash = await bcrypt.hash(password, 10);
  await usersRepo.updatePasswordHash(targetUserId, passwordHash);
  await auditService.record(
    actorId,
    "user.password_reset",
    "user",
    targetUserId,
    { byAdmin: true },
  );
  return { password };
}
