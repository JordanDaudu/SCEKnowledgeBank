import { randomBytes } from "node:crypto";
import * as usersRepo from "../repositories/users.repo";
import * as docsRepo from "../repositories/documents.repo";
import * as auditService from "./audit.service";
import * as notifications from "./notifications.service";
import { badRequest, conflict, notFound } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";

const PURGE_AFTER_DAYS = 30;

export async function deleteOwnAccount(user: AuthenticatedUser): Promise<void> {
  const lifecycle = await usersRepo.findLifecycleById(user.id);
  if (!lifecycle) throw notFound("Account not found");
  if (lifecycle.deletedAt) throw conflict("Account is already deleted");

  const fileCount = await docsRepo.countDocuments({ uploaderId: user.id });
  await usersRepo.softDeleteUser(user.id);
  await auditService.record(user.id, "account.deleted", "user", user.id, { fileCount });

  const adminIds = await usersRepo.findAdminUserIds();
  for (const adminId of adminIds) {
    await notifications.notify({
      recipientId: adminId,
      actorId: user.id,
      type: "account.deleted",
      subjectType: "user",
      subjectId: user.id,
      body: `${user.displayName} (${user.primaryRole}) deleted their account — ${fileCount} file(s) remain`,
      url: "/admin/orphaned-files",
    });
  }
}

export async function restoreAccount(
  admin: AuthenticatedUser,
  userId: string,
): Promise<void> {
  const lifecycle = await usersRepo.findLifecycleById(userId);
  if (!lifecycle || !lifecycle.deletedAt) throw notFound("Deleted account not found");
  if (lifecycle.anonymizedAt) throw conflict("Account was permanently removed and cannot be restored");
  await usersRepo.restoreUser(userId);
  await auditService.record(admin.id, "account.restored", "user", userId, {});
}

export async function purgeAccount(
  admin: AuthenticatedUser,
  userId: string,
): Promise<void> {
  const lifecycle = await usersRepo.findLifecycleById(userId);
  if (!lifecycle || !lifecycle.deletedAt) throw notFound("Deleted account not found");
  if (lifecycle.anonymizedAt) throw conflict("Account is already permanently removed");
  const ageMs = Date.now() - lifecycle.deletedAt.getTime();
  if (ageMs < PURGE_AFTER_DAYS * 86_400_000) {
    throw badRequest(
      `Account is not yet eligible for permanent removal (deleted < ${PURGE_AFTER_DAYS} days ago)`,
    );
  }
  await usersRepo.anonymizeUser(userId, {
    email: `deleted+${userId}@removed.invalid`,
    passwordHash: randomBytes(24).toString("hex"),
  });
  await auditService.record(admin.id, "account.purged", "user", userId, {});
}

export interface DeletedAccountDTO {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  deletedAt: string | null;
  anonymizedAt: string | null;
  fileCount: number;
  eligibleForPurge: boolean;
}

export async function listDeletedAccounts(): Promise<DeletedAccountDTO[]> {
  const rows = await usersRepo.listDeletedWithRoles();
  const out: DeletedAccountDTO[] = [];
  for (const r of rows) {
    const fileCount = await docsRepo.countDocuments({ uploaderId: r.id });
    const eligibleForPurge =
      !r.anonymizedAt &&
      !!r.deletedAt &&
      Date.now() - r.deletedAt.getTime() >= PURGE_AFTER_DAYS * 86_400_000;
    out.push({
      id: r.id,
      email: r.email,
      displayName: r.displayName,
      roles: r.roles,
      deletedAt: r.deletedAt?.toISOString() ?? null,
      anonymizedAt: r.anonymizedAt?.toISOString() ?? null,
      fileCount,
      eligibleForPurge,
    });
  }
  return out;
}
