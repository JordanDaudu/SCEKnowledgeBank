import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, users, userRoles, roles } from "@workspace/db";

export type UserRow = typeof users.$inferSelect;

export async function findByEmail(email: string): Promise<UserRow | null> {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findById(id: string): Promise<UserRow | null> {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
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
  const baseRows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      isActive: users.isActive,
      primaryRoleId: users.primaryRoleId,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(and(inArray(users.id, unique), isNull(users.deletedAt)));
  const map = new Map<string, UserWithRoles>();
  for (const r of baseRows) {
    map.set(r.id, {
      id: r.id,
      email: r.email,
      displayName: r.displayName,
      isActive: r.isActive,
      primaryRoleId: r.primaryRoleId,
      createdAt: r.createdAt,
      roles: [],
    });
  }
  const roleRows = await db
    .select({ userId: userRoles.userId, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(inArray(userRoles.userId, unique));
  for (const r of roleRows) {
    const u = map.get(r.userId);
    if (u && !u.roles.includes(r.name)) u.roles.push(r.name);
  }
  return Array.from(map.values());
}

export async function findActiveUserIdsOrderedByCreatedAt(): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(isNull(users.deletedAt))
    .orderBy(desc(users.createdAt));
  return rows.map((r) => r.id);
}

export async function findRoleNameById(id: string): Promise<string | null> {
  const rows = await db
    .select({ name: roles.name })
    .from(roles)
    .where(eq(roles.id, id))
    .limit(1);
  return rows[0]?.name ?? null;
}
