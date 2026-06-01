import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { listOrphanedFiles, reassignDocument } from "./orphaned-files.service";

const SX = `_orph_${Date.now().toString(36)}`;
let deletedUserId: string;
let activeUserId: string;
let adminId: string;
let docId: string;
let admin: AuthenticatedUser;

beforeAll(async () => {
  const d = await db.user.create({ data: { email: `del${SX}@demo`, passwordHash: "x", displayName: "Del", deletedAt: new Date() } });
  const a = await db.user.create({ data: { email: `act${SX}@demo`, passwordHash: "x", displayName: "Act" } });
  const adm = await db.user.create({ data: { email: `adm${SX}@demo`, passwordHash: "x", displayName: "Adm" } });
  deletedUserId = d.id; activeUserId = a.id; adminId = adm.id;
  admin = {
    id: adm.id, email: adm.email, displayName: "Adm", isActive: true,
    primaryRole: "admin", roles: ["admin"], enrollments: [],
    username: null, avatarStoragePath: null, createdAt: new Date().toISOString(),
  };
  const doc = await db.document.create({
    data: { title: `Orphan ${SX}`, description: "", materialType: "lecture-notes", visibility: "public", status: "published", uploaderId: d.id, ownerId: d.id, createdBy: d.id, updatedBy: d.id },
  });
  docId = doc.id;
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { entityId: docId } });
  await db.document.deleteMany({ where: { id: docId } });
  await db.user.deleteMany({ where: { id: { in: [deletedUserId, activeUserId, adminId] } } });
});

describe("orphaned-files.service", () => {
  it("lists documents whose uploader is deleted", async () => {
    const list = await listOrphanedFiles();
    expect(list.some((f) => f.id === docId)).toBe(true);
  });

  it("reassignDocument moves uploader+owner to an active user and audits", async () => {
    await reassignDocument(admin, docId, activeUserId);
    const doc = await db.document.findUnique({ where: { id: docId } });
    expect(doc?.uploaderId).toBe(activeUserId);
    expect(doc?.ownerId).toBe(activeUserId);
    const audit = await db.auditLog.findFirst({ where: { action: "document.reassign", entityId: docId } });
    expect(audit).not.toBeNull();
    const list = await listOrphanedFiles();
    expect(list.some((f) => f.id === docId)).toBe(false);
  });

  it("reassignDocument rejects a missing target", async () => {
    await expect(reassignDocument(admin, docId, "00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({ status: 404 });
  });
});
