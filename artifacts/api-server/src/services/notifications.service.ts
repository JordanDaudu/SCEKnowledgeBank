import * as notificationsRepo from "../repositories/notifications.repo";
import * as usersService from "./users.service";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import type { AuthenticatedUser } from "../middlewares/auth";

export interface NotificationDTO {
  id: string;
  type: string;
  subjectType: string;
  subjectId: string;
  body: string;
  url: string | null;
  readAt: string | null;
  createdAt: string;
  actor: usersService.UserSummaryDTO | null;
}

export interface NotifyArgs {
  recipientId: string;
  actorId?: string | null;
  type: string;
  subjectType: string;
  subjectId: string;
  body?: string;
  url?: string | null;
}

/**
 * Producer-facing helper. Inserts a notification for `recipientId`
 * unless one already exists for the same (type, subjectType,
 * subjectId) — the unique index in the repo absorbs duplicates.
 *
 * Hard rules enforced here so callers don't have to:
 *   • feature flag — when `FEATURE_NOTIFICATIONS=false`, no-op.
 *   • no self-notify — a user never gets a notification for their
 *     own action.
 *   • non-throwing — any failure (DB down, validation, etc) is
 *     logged and swallowed; a notify error must never fail the
 *     originating write (e.g. a comment post).
 */
export async function notify(args: NotifyArgs): Promise<void> {
  try {
    if (!env.featureNotifications) return;
    if (args.actorId && args.actorId === args.recipientId) return;
    await notificationsRepo.insertIfNew({
      recipientId: args.recipientId,
      actorId: args.actorId ?? null,
      type: args.type,
      subjectType: args.subjectType,
      subjectId: args.subjectId,
      body: args.body ?? "",
      url: args.url ?? null,
    });
  } catch (err) {
    logger.warn(
      {
        err,
        type: args.type,
        subjectType: args.subjectType,
        subjectId: args.subjectId,
      },
      "notify failed (swallowed)",
    );
  }
}

function toDTO(
  r: notificationsRepo.NotificationRow,
  actors: Map<string, usersService.UserSummaryDTO>,
): NotificationDTO {
  return {
    id: r.id,
    type: r.type,
    subjectType: r.subjectType,
    subjectId: r.subjectId,
    body: r.body,
    url: r.url,
    readAt: r.readAt ? r.readAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    actor: r.actorId ? (actors.get(r.actorId) ?? null) : null,
  };
}

export interface ListArgs {
  limit?: number;
  unreadOnly?: boolean;
}

export async function listForUser(
  user: AuthenticatedUser,
  args: ListArgs = {},
): Promise<NotificationDTO[]> {
  const rows = await notificationsRepo.listForRecipient(user.id, {
    limit: args.limit ?? 20,
    unreadOnly: args.unreadOnly,
  });
  const actorIds = rows
    .map((r) => r.actorId)
    .filter((id): id is string => !!id);
  const actors = await usersService.loadUserSummaries(Array.from(new Set(actorIds)));
  return rows.map((r) => toDTO(r, actors));
}

export async function unreadCountForUser(
  user: AuthenticatedUser,
): Promise<number> {
  return notificationsRepo.countUnread(user.id);
}

export async function markRead(
  id: string,
  user: AuthenticatedUser,
): Promise<void> {
  await notificationsRepo.markRead(id, user.id);
}

export async function markAllRead(
  user: AuthenticatedUser,
): Promise<{ updated: number }> {
  const updated = await notificationsRepo.markAllRead(user.id);
  return { updated };
}
