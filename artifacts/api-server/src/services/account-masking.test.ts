import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { assembleDocuments } from "./documents.service";
import * as docsRepo from "../repositories/documents.repo";

const SX = `_mask_${Date.now().toString(36)}`;
let uploaderId: string;
let docId: string;

const admin: AuthenticatedUser = {
  id: "admin-mask", email: "a@x", displayName: "Adm", isActive: true,
  primaryRole: "admin", roles: ["admin"], enrollments: [],
  username: null, avatarStoragePath: null, createdAt: new Date().toISOString(),
};

beforeAll(async () => {
  const u = await db.user.create({ data: { email: `up${SX}@demo`, passwordHash: "x", displayName: "Will Bedeleted" } });
  uploaderId = u.id;
  const d = await db.document.create({
    data: {
      title: `Doc ${SX}`, description: "", materialType: "lecture-notes", visibility: "public",
      status: "published", uploaderId: u.id, ownerId: u.id, createdBy: u.id, updatedBy: u.id,
    },
  });
  docId = d.id;
  await db.user.update({ where: { id: u.id }, data: { deletedAt: new Date() } });
});

afterAll(async () => {
  await db.document.deleteMany({ where: { id: docId } });
  await db.user.deleteMany({ where: { id: uploaderId } });
});

describe("deleted-uploader masking", () => {
  it("renders 'Original uploader removed' for a soft-deleted uploader", async () => {
    const row = await docsRepo.findByIdAlive(docId);
    const [dto] = await assembleDocuments([row!], admin);
    expect(dto.uploader.displayName).toBe("Original uploader removed");
  });
});
