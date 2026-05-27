import { db } from "@workspace/db";
import type { Prisma } from "@workspace/db";

export interface NotificationRow {
  id: string;
  recipientId: string;
  actorId: string | null;
  type: string;
  subjectType: string;
  subjectId: string;
  body: string;
  url: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationInsert {
  recipientId: string;
  actorId?: string | null;
  type: string;
  subjectType: string;
  subjectId: string;
  body?: string;
  url?: string | null;
}

/**
 * Insert a notification if one with the same
 * (recipientId, type, subjectType, subjectId) tuple does not already
 * exist. Returns the freshly-inserted row, or `null` when the unique
 * constraint suppressed the insert (caller treats this as a no-op).
 *
 * Implemented with `createMany({ skipDuplicates: true })` so the
 * unique-violation never raises — matches the dedup semantics
 * documented in the migration.
 */
export async function insertIfNew(
  values: NotificationInsert,
): Promise<NotificationRow | null> {
  const data: Prisma.NotificationUncheckedCreateInput = {
    recipientId: values.recipientId,
    type: values.type,
    subjectType: values.subjectType,
    subjectId: values.subjectId,
    body: values.body ?? "",
  };
  if (values.actorId !== undefined) data.actorId = values.actorId;
  if (values.url !== undefined) data.url = values.url;
  const result = await db.notification.createMany({
    data,
    skipDuplicates: true,
  });
  if (result.count === 0) return null;
  return db.notification.findFirst({
    where: {
      recipientId: values.recipientId,
      type: values.type,
      subjectType: values.subjectType,
      subjectId: values.subjectId,
    },
    orderBy: { createdAt: "desc" },
  });
}

export interface ListOptions {
  limit: number;
  unreadOnly?: boolean;
}

export async function listForRecipient(
  recipientId: string,
  opts: ListOptions,
): Promise<NotificationRow[]> {
  const where: Prisma.NotificationWhereInput = { recipientId };
  if (opts.unreadOnly) where.readAt = null;
  return db.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(opts.limit, 100)),
  });
}

export async function countUnread(recipientId: string): Promise<number> {
  return db.notification.count({
    where: { recipientId, readAt: null },
  });
}

/**
 * Mark a single notification read, scoped to its recipient so a user
 * cannot flip another user's row by guessing an id. Returns true when
 * something was updated.
 */
export async function markRead(
  id: string,
  recipientId: string,
): Promise<boolean> {
  const result = await db.notification.updateMany({
    where: { id, recipientId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count > 0;
}

export async function markAllRead(recipientId: string): Promise<number> {
  const result = await db.notification.updateMany({
    where: { recipientId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}
