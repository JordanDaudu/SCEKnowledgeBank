import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { deleteOwnAccount, restoreAccount, purgeAccount, listDeletedAccounts } from "./account.service";

const SX = `_acct_${Date.now().toString(36)}`;
let adminId: string;
let userId: string;

function authed(id: string, primaryRole: string): AuthenticatedUser {
  return {
    id, email: `${id}@demo`, displayName: id, isActive: true,
    primaryRole, roles: [primaryRole], enrollments: [],
    username: null, avatarStoragePath: null, createdAt: new Date().toISOString(),
  };
}

beforeAll(async () => {
  const adminRole = (await db.role.findFirst({ where: { name: "admin" } }))
    ?? (await db.role.create({ data: { name: "admin", description: "Administrator" } }));
  const a = await db.user.create({ data: { email: `adm${SX}@demo`, passwordHash: "x", displayName: "Adm", primaryRoleId: adminRole.id } });
  await db.userRole.create({ data: { userId: a.id, roleId: adminRole.id } });
  adminId = a.id;
  const u = await db.user.create({ data: { email: `u${SX}@demo`, passwordHash: "x", displayName: "U", username: `u${SX}`.slice(0, 30) } });
  userId = u.id;
});

afterAll(async () => {
  await db.notification.deleteMany({ where: { recipientId: adminId } });
  await db.auditLog.deleteMany({ where: { actorUserId: { in: [adminId, userId] } } });
  await db.userRole.deleteMany({ where: { userId: { in: [adminId, userId] } } });
  await db.user.deleteMany({ where: { id: { in: [adminId, userId] } } });
});

describe("account.service", () => {
  it("deleteOwnAccount soft-deletes, audits, and notifies admins", async () => {
    await deleteOwnAccount(authed(userId, "student"));
    const u = await db.user.findUnique({ where: { id: userId } });
    expect(u?.deletedAt).not.toBeNull();
    const audit = await db.auditLog.findFirst({ where: { actorUserId: userId, action: "account.deleted" } });
    expect(audit).not.toBeNull();
    const notif = await db.notification.findFirst({ where: { recipientId: adminId, type: "account.deleted" } });
    expect(notif).not.toBeNull();
  });

  it("listDeletedAccounts includes the user and marks purge eligibility", async () => {
    const list = await listDeletedAccounts();
    const row = list.find((r) => r.id === userId);
    expect(row).toBeTruthy();
    expect(row?.eligibleForPurge).toBe(false);
  });

  it("purgeAccount rejects a not-yet-eligible (<30d) account", async () => {
    await expect(purgeAccount(authed(adminId, "admin"), userId)).rejects.toMatchObject({ status: 400 });
  });

  it("restoreAccount clears deletedAt", async () => {
    await restoreAccount(authed(adminId, "admin"), userId);
    const u = await db.user.findUnique({ where: { id: userId } });
    expect(u?.deletedAt).toBeNull();
  });

  it("purgeAccount scrubs PII once eligible (>30d)", async () => {
    await db.user.update({ where: { id: userId }, data: { deletedAt: new Date(Date.now() - 31 * 86_400_000) } });
    await purgeAccount(authed(adminId, "admin"), userId);
    const u = await db.user.findUnique({ where: { id: userId } });
    expect(u?.anonymizedAt).not.toBeNull();
    expect(u?.displayName).toBe("Removed user");
    expect(u?.username).toBeNull();
  });

  it("restoreAccount is blocked after anonymization", async () => {
    await expect(restoreAccount(authed(adminId, "admin"), userId)).rejects.toMatchObject({ status: 409 });
  });
});
