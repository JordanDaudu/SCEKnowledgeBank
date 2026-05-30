import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import {
  hideCollection,
  unhideCollection,
  listDiscoverable,
  listForModeration,
  countHiddenCollections,
} from "./collections.repo";

const SX = `_mod_${Date.now().toString(36)}`;
let ownerId: string;
let adminId: string;
let colId: string;

beforeAll(async () => {
  ownerId = (await db.user.create({ data: { email: `o${SX}@demo`, passwordHash: "x", displayName: `O${SX}`, isActive: true } })).id;
  adminId = (await db.user.create({ data: { email: `ad${SX}@demo`, passwordHash: "x", displayName: `AD${SX}`, isActive: true } })).id;
  colId = (await db.studyCollection.create({ data: { ownerId, title: `Mod ${SX}`, visibility: "public" } })).id;
});

afterAll(async () => {
  await db.studyCollection.deleteMany({ where: { ownerId } });
  await db.user.deleteMany({ where: { id: { in: [ownerId, adminId] } } });
});

describe("collections.repo moderation", () => {
  it("hide removes from discovery + counts; moderation list still sees it; unhide restores", async () => {
    let ids = (await listDiscoverable({ sort: "new", limit: 100 })).map((r) => r.id);
    expect(ids).toContain(colId);

    await hideCollection(colId, adminId, "spam");
    const row = await db.studyCollection.findUniqueOrThrow({ where: { id: colId } });
    expect(row.hiddenAt).not.toBeNull();
    expect(row.hiddenBy).toBe(adminId);
    expect(row.hiddenReason).toBe("spam");

    ids = (await listDiscoverable({ sort: "new", limit: 100 })).map((r) => r.id);
    expect(ids).not.toContain(colId);

    expect((await listForModeration({ includeHidden: true, limit: 100 })).map((r) => r.id)).toContain(colId);
    expect((await listForModeration({ includeHidden: false, limit: 100 })).map((r) => r.id)).not.toContain(colId);
    expect(await countHiddenCollections()).toBeGreaterThanOrEqual(1);

    await unhideCollection(colId);
    const after = await db.studyCollection.findUniqueOrThrow({ where: { id: colId } });
    expect(after.hiddenAt).toBeNull();
    ids = (await listDiscoverable({ sort: "new", limit: 100 })).map((r) => r.id);
    expect(ids).toContain(colId);
  });
});
