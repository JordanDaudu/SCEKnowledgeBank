import { db, Prisma } from "@workspace/db";

export type AccountStatus = "ACTIVE" | "PENDING_APPROVAL" | "DISABLED";

export interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  primaryRoleId: string | null;
  isActive: boolean;
  status: AccountStatus;
  studentId: string | null;
  lecturerId: string | null;
  department: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export async function findByEmail(email: string): Promise<UserRow | null> {
  const row = await db.user.findFirst({ where: { email, deletedAt: null } });
  return row as UserRow | null;
}

/**
 * Case-insensitive email lookup used by registration to enforce
 * uniqueness regardless of how the user typed it.
 */
export async function findByEmailCaseInsensitive(
  email: string,
): Promise<UserRow | null> {
  const row = await db.user.findFirst({
    where: {
      deletedAt: null,
      email: { equals: email, mode: "insensitive" },
    },
  });
  return row as UserRow | null;
}

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  displayName: string;
  primaryRoleId: string;
  status: AccountStatus;
  studentId?: string | null;
  lecturerId?: string | null;
  department?: string | null;
}

/**
 * Insert a new user and link them to a single primary role via the
 * `user_roles` join table in one transaction.
 */
export async function createWithRole(
  input: CreateUserInput,
): Promise<UserRow> {
  return db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: input.email,
        passwordHash: input.passwordHash,
        displayName: input.displayName,
        primaryRoleId: input.primaryRoleId,
        status: input.status,
        studentId: input.studentId ?? null,
        lecturerId: input.lecturerId ?? null,
        department: input.department ?? null,
      },
    });
    await tx.userRole.create({
      data: { userId: created.id, roleId: input.primaryRoleId },
    });
    return created as UserRow;
  });
}

export async function updateStatus(
  id: string,
  status: AccountStatus,
): Promise<UserRow | null> {
  try {
    const row = await db.user.update({
      where: { id },
      data: { status, updatedAt: new Date() },
    });
    return row as UserRow;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    ) {
      return null;
    }
    throw err;
  }
}

export async function listByStatusWithRoles(
  status: AccountStatus,
): Promise<UserWithRoles[]> {
  const rows = await db.user.findMany({
    where: { deletedAt: null, status },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      displayName: true,
      isActive: true,
      primaryRoleId: true,
      createdAt: true,
      status: true,
      username: true,
      avatarStoragePath: true,
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
    status: r.status as AccountStatus,
    username: r.username,
    avatarStoragePath: r.avatarStoragePath,
    roles: Array.from(new Set(r.userRoles.map((ur) => ur.role.name))),
  }));
}

export async function findRoleIdByName(name: string): Promise<string | null> {
  const row = await db.role.findFirst({
    where: { name },
    select: { id: true },
  });
  return row?.id ?? null;
}

export async function findById(id: string): Promise<UserRow | null> {
  const row = await db.user.findFirst({ where: { id, deletedAt: null } });
  return row as UserRow | null;
}

export interface UserWithRoles {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  primaryRoleId: string | null;
  createdAt: Date;
  roles: string[];
  status?: AccountStatus;
  username: string | null;
  avatarStoragePath: string | null;
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
      status: true,
      username: true,
      avatarStoragePath: true,
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
    status: r.status as AccountStatus,
    username: r.username,
    avatarStoragePath: r.avatarStoragePath,
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
      username: true,
      avatarStoragePath: true,
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
    username: r.username,
    avatarStoragePath: r.avatarStoragePath,
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

// ─── Profile foundation: username + avatar ────────────────────────────

export async function findByUsername(
  username: string,
): Promise<{ id: string } | null> {
  return db.user.findFirst({
    where: { username, deletedAt: null },
    select: { id: true },
  });
}

export async function updateUsername(id: string, username: string): Promise<void> {
  await db.user.update({
    where: { id },
    data: { username, updatedAt: new Date() },
  });
}

export async function updateAvatar(
  id: string,
  storagePath: string | null,
  mimeType: string | null,
): Promise<void> {
  await db.user.update({
    where: { id },
    data: {
      avatarStoragePath: storagePath,
      avatarMimeType: mimeType,
      updatedAt: new Date(),
    },
  });
}

export async function findAvatarById(
  id: string,
): Promise<{ avatarStoragePath: string | null; avatarMimeType: string | null } | null> {
  return db.user.findFirst({
    where: { id, deletedAt: null },
    select: { avatarStoragePath: true, avatarMimeType: true },
  });
}
