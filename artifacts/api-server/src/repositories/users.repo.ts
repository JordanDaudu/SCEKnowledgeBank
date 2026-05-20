import { db } from "@workspace/db";

export interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  primaryRoleId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export async function findByEmail(email: string): Promise<UserRow | null> {
  return db.user.findFirst({ where: { email, deletedAt: null } });
}

export async function findById(id: string): Promise<UserRow | null> {
  return db.user.findFirst({ where: { id, deletedAt: null } });
}

export interface UserWithRoles {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  primaryRoleId: string | null;
  createdAt: Date;
  roles: string[];
}

export async function findManyWithRolesByIds(
  ids: string[],
): Promise<UserWithRoles[]> {
  if (ids.length === 0) return [];
  const unique = Array.from(new Set(ids));
  const rows = await db.user.findMany({
    where: { id: { in: unique }, deletedAt: null },
    select: {
      id: true,
      email: true,
      displayName: true,
      isActive: true,
      primaryRoleId: true,
      createdAt: true,
      userRoles: { select: { role: { select: { name: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    displayName: r.displayName,
    isActive: r.isActive,
    primaryRoleId: r.primaryRoleId,
    createdAt: r.createdAt,
    roles: Array.from(new Set(r.userRoles.map((ur) => ur.role.name))),
  }));
}

/**
 * Case-insensitive prefix/substring search over `display_name` and
 * `email`, capped to a small `limit` for autocomplete use (e.g. the
 * @mention picker). Active users only; ordered by display name so
 * results are stable.
 */
export async function searchByQuery(
  q: string,
  limit: number,
): Promise<UserWithRoles[]> {
  const term = q.trim();
  if (term === "") return [];
  const rows = await db.user.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      OR: [
        { displayName: { contains: term, mode: "insensitive" } },
        { email: { contains: term, mode: "insensitive" } },
      ],
    },
    orderBy: { displayName: "asc" },
    take: limit,
    select: {
      id: true,
      email: true,
      displayName: true,
      isActive: true,
      primaryRoleId: true,
      createdAt: true,
      userRoles: { select: { role: { select: { name: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    displayName: r.displayName,
    isActive: r.isActive,
    primaryRoleId: r.primaryRoleId,
    createdAt: r.createdAt,
    roles: Array.from(new Set(r.userRoles.map((ur) => ur.role.name))),
  }));
}

export async function findActiveByDisplayNames(
  displayNames: string[],
): Promise<{ id: string; displayName: string }[]> {
  if (displayNames.length === 0) return [];
  // Case-insensitive name match: the @mention picker should resolve
  // `@alice` to a user with displayName `Alice`. Prisma's `in` operator
  // does not accept a `mode: insensitive`, so we fan the list out into
  // an OR of per-name `equals` checks.
  const unique = Array.from(new Set(displayNames));
  return db.user.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      OR: unique.map((name) => ({
        displayName: { equals: name, mode: "insensitive" as const },
      })),
    },
    select: { id: true, displayName: true },
  });
}

export async function findActiveByIds(
  ids: string[],
): Promise<{ id: string }[]> {
  if (ids.length === 0) return [];
  const unique = Array.from(new Set(ids));
  return db.user.findMany({
    where: { deletedAt: null, isActive: true, id: { in: unique } },
    select: { id: true },
  });
}

export async function findActiveUserIdsOrderedByCreatedAt(): Promise<string[]> {
  const rows = await db.user.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export interface QuotaRow {
  usedBytes: bigint;
  quotaBytes: bigint | null;
}

export async function findQuotaById(id: string): Promise<QuotaRow | null> {
  const row = await db.user.findUnique({
    where: { id },
    select: { usedBytes: true, quotaBytes: true },
  });
  return row ?? null;
}

export async function findRoleNameById(id: string): Promise<string | null> {
  const row = await db.role.findUnique({
    where: { id },
    select: { name: true },
  });
  return row?.name ?? null;
}
