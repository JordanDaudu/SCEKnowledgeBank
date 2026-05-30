import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { createCollection } from "./collections.service";
import { createComment } from "./collection-comments.service";
import { hideCollection, unhideCollection, removeComment, listModeration } from "./moderation.service";

const SX = `_modsvc_${Date.now().toString(36)}`;
let owner: AuthenticatedUser;
let commenter: AuthenticatedUser;
let admin: AuthenticatedUser;
let colId: string;

beforeAll(async () => {
  const o = await db.user.create({ data: { email: `o${SX}@demo`, passwordHash: "x", displayName: `O${SX}`, isActive: true } });
  const c = await db.user.create({ data: { email: `c${SX}@demo`, passwordHash: "x", displayName: `C${SX}`, isActive: true } });
  const a = await db.user.create({ data: { email: `a${SX}@demo`, passwordHash: "x", displayName: `A${SX}`, isActive: true } });
  owner = { id: o.id, roles: ["student"], enrollments: [] } as unknown as AuthenticatedUser;
  commenter = { id: c.id, roles: ["student"], enrollments: [] } as unknown as AuthenticatedUser;
  admin = { id: a.id, roles: ["admin"], enrollments: [] } as unknown as AuthenticatedUser;
  colId = (await createCollection(owner, { title: `ModSvc ${SX}`, visibility: "public" })).id;
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { actorUserId: admin.id } });
  await db.studyCollectionComment.deleteMany({ where: { collectionId: colId } });
  await db.studyCollection.deleteMany({ where: { ownerId: owner.id } });
  await db.user.deleteMany({ where: { id: { in: [owner.id, commenter.id, admin.id] } } });
});

describe("moderation.service", () => {
  it("non-admins are forbidden from every op", async () => {
    await expect(hideCollection(owner, colId, "x")).rejects.toThrow();
    await expect(unhideCollection(owner, colId)).rejects.toThrow();
    await expect(listModeration(owner, {})).rejects.toThrow();
  });

  it("admin hide/unhide sets+clears the flag and audits", async () => {
    const hidden = await hideCollection(admin, colId, "off-topic");
    expect(hidden.hiddenAt).toBeTruthy();
    expect(hidden.hiddenReason).toBe("off-topic");
    const auditRow = await db.auditLog.findFirst({ where: { actorUserId: admin.id, action: "collection.hidden", entityId: colId } });
    expect(auditRow).not.toBeNull();
    const shown = await unhideCollection(admin, colId);
    expect(shown.hiddenAt).toBeUndefined();
  });

  it("admin removeComment soft-deletes any comment + decrements commentCount + audits", async () => {
    const cm = await createComment(colId, commenter, "to be removed");
    const before = (await db.studyCollection.findUniqueOrThrow({ where: { id: colId }, select: { commentCount: true } })).commentCount;
    await removeComment(admin, cm.id);
    const after = (await db.studyCollection.findUniqueOrThrow({ where: { id: colId }, select: { commentCount: true } })).commentCount;
    expect(after).toBe(before - 1);
    const deleted = await db.studyCollectionComment.findUniqueOrThrow({ where: { id: cm.id } });
    expect(deleted.deletedAt).not.toBeNull();
    const auditRow = await db.auditLog.findFirst({ where: { actorUserId: admin.id, action: "collection.comment.removed", entityId: cm.id } });
    expect(auditRow).not.toBeNull();
  });

  it("listModeration returns collections + stats for an admin", async () => {
    const res = await listModeration(admin, {});
    expect(Array.isArray(res.collections)).toBe(true);
    expect(typeof res.stats.totalPublic).toBe("number");
    expect(typeof res.stats.totalHidden).toBe("number");
  });
});
