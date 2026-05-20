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

export async function findActiveUserIdsOrderedByCreatedAt(): Promise<string[]> {
  const rows = await db.user.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function findRoleNameById(id: string): Promise<string | null> {
  const row = await db.role.findUnique({
    where: { id },
    select: { name: true },
  });
  return row?.name ?? null;
}
