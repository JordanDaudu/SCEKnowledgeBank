import * as usersRepo from "../repositories/users.repo";

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

export async function listAllSummaries(): Promise<UserSummaryDTO[]> {
  const ids = await usersRepo.findActiveUserIdsOrderedByCreatedAt();
  const summaries = await loadUserSummaries(ids);
  return ids.map((id) => summaries.get(id)).filter((u): u is UserSummaryDTO => !!u);
}
