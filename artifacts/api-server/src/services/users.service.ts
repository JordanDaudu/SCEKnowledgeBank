import * as usersRepo from "../repositories/users.repo";
import { env } from "../lib/env";
import { notFound } from "../lib/errors";

export interface StorageQuotaDTO {
  usedBytes: number;
  quotaBytes: number;
  remainingBytes: number;
}

/**
 * Resolve the effective storage quota for a user. Returns BigInts so the
 * upload pipeline can safely compare against multi-GB totals without
 * precision loss; callers that serialise to JSON should convert via
 * `quotaSnapshotForUser`.
 */
export async function resolveEffectiveQuotaBytes(
  userId: string,
): Promise<{ usedBytes: bigint; quotaBytes: bigint }> {
  const row = await usersRepo.findQuotaById(userId);
  if (!row) throw notFound("User not found");
  const quotaBytes = row.quotaBytes ?? env.defaultUserStorageQuotaBytes;
  return { usedBytes: row.usedBytes, quotaBytes };
}

export async function quotaSnapshotForUser(
  userId: string,
): Promise<StorageQuotaDTO> {
  const { usedBytes, quotaBytes } = await resolveEffectiveQuotaBytes(userId);
  const remaining = quotaBytes - usedBytes;
  return {
    usedBytes: Number(usedBytes),
    quotaBytes: Number(quotaBytes),
    remainingBytes: Number(remaining > 0n ? remaining : 0n),
  };
}


export interface UserSummaryDTO {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  isActive: boolean;
  createdAt: string;
}

export async function loadUserSummaries(
  ids: string[],
): Promise<Map<string, UserSummaryDTO>> {
  const out = new Map<string, UserSummaryDTO>();
  if (ids.length === 0) return out;
  const users = await usersRepo.findManyWithRolesByIds(ids);
  for (const u of users) {
    out.set(u.id, {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      roles: u.roles,
      isActive: u.isActive,
      createdAt: u.createdAt.toISOString(),
    });
  }
  return out;
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
  return rows.map((u) => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    roles: u.roles,
    isActive: u.isActive,
    createdAt: u.createdAt.toISOString(),
  }));
}

export async function listAllSummaries(): Promise<UserSummaryDTO[]> {
  const ids = await usersRepo.findActiveUserIdsOrderedByCreatedAt();
  const summaries = await loadUserSummaries(ids);
  return ids.map((id) => summaries.get(id)).filter((u): u is UserSummaryDTO => !!u);
}
