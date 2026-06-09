import * as usersRepo from "../repositories/users.repo";
import * as quotaService from "./quota.service";
import * as reputation from "./reputation.service";
import { notFound } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";

export interface StorageQuotaDTO {
  usedBytes: number;
  quotaBytes: number;
  remainingBytes: number;
}

/**
 * Thin compatibility wrapper around `quota.service`. New callers should
 * prefer `quotaService.effectiveQuotaForUser(user)` directly when they
 * already hold an `AuthenticatedUser`.
 */
export async function resolveEffectiveQuotaBytes(
  user: AuthenticatedUser,
): Promise<{ usedBytes: bigint; quotaBytes: bigint }> {
  return quotaService.effectiveQuotaForUser(user);
}

export async function quotaSnapshotForUser(
  user: AuthenticatedUser,
): Promise<StorageQuotaDTO> {
  const q = await quotaService.effectiveQuotaForUser(user);
  return {
    usedBytes: Number(q.usedBytes),
    quotaBytes: Number(q.quotaBytes),
    remainingBytes: Number(quotaService.remainingBytes(q)),
  };
}


export interface UserSummaryDTO {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  isActive: boolean;
  status: usersRepo.AccountStatus;
  createdAt: string;
  /** Optional author-credibility block; populated only when a caller passes
   *  `{ withReputation: true }` (e.g. document uploaders). */
  reputation?: reputation.AuthorReputation | null;
}

function toSummary(u: usersRepo.UserWithRoles): UserSummaryDTO {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    roles: u.roles,
    isActive: u.isActive,
    status: u.status ?? "ACTIVE",
    createdAt: u.createdAt.toISOString(),
  };
}

export async function loadUserSummaries(
  ids: string[],
  opts: { withReputation?: boolean } = {},
): Promise<Map<string, UserSummaryDTO>> {
  const out = new Map<string, UserSummaryDTO>();
  if (ids.length === 0) return out;
  const users = await usersRepo.findManyWithRolesByIds(ids);
  for (const u of users) {
    out.set(u.id, toSummary(u));
  }
  // Opt-in author credibility: one batched reputation lookup for the whole id
  // set (no N+1). Only callers that surface author chips pay this cost.
  if (opts.withReputation) {
    const repMap = await reputation.reputationForUsers(ids);
    for (const [id, summary] of out) {
      summary.reputation = repMap.get(id) ?? null;
    }
  }
  return out;
}

export async function getUserSummary(id: string): Promise<UserSummaryDTO> {
  const rows = await usersRepo.findManyWithRolesByIds([id]);
  const u = rows[0];
  if (!u) throw notFound("User not found");
  return toSummary(u);
}

export async function listPendingLecturers(): Promise<UserSummaryDTO[]> {
  const rows = await usersRepo.listByStatusWithRoles("PENDING_APPROVAL");
  // Restrict to actual lecturers; a defensive filter in case other
  // pending statuses are added later.
  return rows
    .filter((r) => r.roles.includes("lecturer"))
    .map(toSummary);
}

/**
 * Lightweight user search used by the @mention picker on the
 * comment composer. Active users only, capped to a small limit.
 */
export async function searchUsers(
  q: string,
  limit: number,
): Promise<UserSummaryDTO[]> {
  const rows = await usersRepo.searchByQuery(q, limit);
  return rows.map(toSummary);
}

export async function listAllSummaries(): Promise<UserSummaryDTO[]> {
  const ids = await usersRepo.findActiveUserIdsOrderedByCreatedAt();
  const summaries = await loadUserSummaries(ids);
  return ids.map((id) => summaries.get(id)).filter((u): u is UserSummaryDTO => !!u);
}
