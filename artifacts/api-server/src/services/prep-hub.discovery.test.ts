import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { createCollection } from "./collections.service";
import { listDiscoverable, listTrending } from "./prep-hub.service";

const SX = `_phdisc_${Date.now().toString(36)}`;
let user: AuthenticatedUser;
let calcId: string;

beforeAll(async () => {
  const u = await db.user.create({ data: { email: `u${SX}@demo`, passwordHash: "x", displayName: `U${SX}`, isActive: true } });
  user = { id: u.id, roles: ["student"], enrollments: [] } as unknown as AuthenticatedUser;
  calcId = (await createCollection(user, { title: `Calculus ${SX}`, visibility: "public" })).id;
  await createCollection(user, { title: `Physics ${SX}`, visibility: "public" });
});

afterAll(async () => {
  await db.studyCollection.deleteMany({ where: { ownerId: user.id } });
  await db.user.deleteMany({ where: { id: user.id } });
});

describe("prep-hub.service discovery", () => {
  it("listDiscoverable threads q into FTS search", async () => {
    const rows = await listDiscoverable(user, { sort: "popular", q: "calculus", limit: 50 });
    expect(rows.map((r) => r.id)).toContain(calcId);
    expect(rows.every((r) => r.visibility === "public")).toBe(true);
  });
  it("listTrending returns summaries (no throw on empty activity)", async () => {
    const rows = await listTrending(user, 10);
    expect(Array.isArray(rows)).toBe(true);
  });
});
