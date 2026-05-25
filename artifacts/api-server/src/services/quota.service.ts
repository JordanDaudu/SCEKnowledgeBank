/**
 * Centralized storage-quota service (US-10).
 *
 * Owns the single source of truth for:
 *   - how much storage a given user is allowed (effective limit),
 *   - how much they are currently using,
 *   - whether a proposed upload would fit.
 *
 * Limits are layered:
 *   1. per-user override (`users.quota_bytes`) wins if set,
 *   2. otherwise the highest role-based default among the user's roles,
 *   3. otherwise the server-wide `DEFAULT_USER_STORAGE_QUOTA_MB` floor.
 *
 * Admins are effectively unlimited via a large sentinel.
 *
 * TODO(sprint-3): per-course quotas, soft warnings before hard reject,
 * background reconciliation against object-storage byte counts, billing
 * tier integration.
 */
import * as usersRepo from "../repositories/users.repo";
import { env } from "../lib/env";
import { notFound } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";

export interface EffectiveQuota {
  usedBytes: bigint;
  quotaBytes: bigint;
}

function roleBasedDefault(roles: readonly string[]): bigint {
  if (roles.includes("admin")) return env.unlimitedQuotaBytes;
  if (roles.includes("lecturer")) return env.defaultLecturerQuotaBytes;
  if (roles.includes("student")) return env.defaultStudentQuotaBytes;
  return env.defaultUserStorageQuotaBytes;
}

/**
 * Resolve the effective quota for an authenticated user (preferred path).
 * Uses the in-memory `roles` from the session so we don't re-hit the
 * roles table on every upload.
 */
export async function effectiveQuotaForUser(
  user: AuthenticatedUser,
): Promise<EffectiveQuota> {
  const row = await usersRepo.findQuotaById(user.id);
  if (!row) throw notFound("User not found");
  const quotaBytes = row.quotaBytes ?? roleBasedDefault(user.roles);
  return { usedBytes: row.usedBytes, quotaBytes };
}

/**
 * Resolve effective quota by id when the caller only has a user id and
 * needs to look the roles up. Slower path; prefer
 * `effectiveQuotaForUser` when an `AuthenticatedUser` is in scope.
 */
export async function effectiveQuotaById(
  userId: string,
): Promise<EffectiveQuota> {
  const [quotaRow, withRoles] = await Promise.all([
    usersRepo.findQuotaById(userId),
    usersRepo.findManyWithRolesByIds([userId]),
  ]);
  if (!quotaRow) throw notFound("User not found");
  const roles = withRoles[0]?.roles ?? [];
  const quotaBytes = quotaRow.quotaBytes ?? roleBasedDefault(roles);
  return { usedBytes: quotaRow.usedBytes, quotaBytes };
}

export function remainingBytes(q: EffectiveQuota): bigint {
  const r = q.quotaBytes - q.usedBytes;
  return r > 0n ? r : 0n;
}

export function canFit(q: EffectiveQuota, sizeBytes: bigint): boolean {
  return q.usedBytes + sizeBytes <= q.quotaBytes;
}
