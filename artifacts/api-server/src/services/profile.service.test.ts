import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { checkUsernameAvailability, updateUsername } from "./profile.service";

const SX = `_prof_${Date.now().toString(36)}`;
const handle = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 30);
let alice: AuthenticatedUser;
let bobId: string;

function authUser(id: string, username: string | null): AuthenticatedUser {
  return {
    id, email: `${username ?? id}@demo`, displayName: "T", isActive: true,
    primaryRole: "student", roles: ["student"], enrollments: [],
    username, avatarStoragePath: null, createdAt: new Date().toISOString(),
  };
}

beforeAll(async () => {
  const a = await db.user.create({ data: { email: `a${SX}@demo`, passwordHash: "x", displayName: "A", username: handle(`alice${SX}`) } });
  const b = await db.user.create({ data: { email: `b${SX}@demo`, passwordHash: "x", displayName: "B", username: handle(`bob${SX}`) } });
  alice = authUser(a.id, a.username);
  bobId = b.id;
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { actorUserId: { in: [alice.id, bobId] } } });
  await db.user.deleteMany({ where: { id: { in: [alice.id, bobId] } } });
});

describe("checkUsernameAvailability", () => {
  it("flags invalid and reserved", async () => {
    expect(await checkUsernameAvailability(alice, "ab")).toEqual({ available: false, reason: "invalid" });
    expect(await checkUsernameAvailability(alice, "admin")).toEqual({ available: false, reason: "reserved" });
  });
  it("treats the caller's own username as available (no-op rename)", async () => {
    expect(await checkUsernameAvailability(alice, alice.username!.toUpperCase())).toEqual({ available: true });
  });
  it("flags a name taken by someone else", async () => {
    const bob = await db.user.findUnique({ where: { id: bobId } });
    expect(await checkUsernameAvailability(alice, bob!.username!)).toEqual({ available: false, reason: "taken" });
  });
  it("reports a free name as available", async () => {
    expect(await checkUsernameAvailability(alice, handle(`free${SX}`))).toEqual({ available: true });
  });
});

describe("updateUsername", () => {
  it("changes the username and writes an audit entry", async () => {
    const next = handle(`renamed${SX}`);
    const res = await updateUsername(alice, next);
    expect(res).toEqual({ username: next });
    const row = await db.user.findUnique({ where: { id: alice.id } });
    expect(row!.username).toBe(next);
    const audit = await db.auditLog.findFirst({
      where: { actorUserId: alice.id, action: "user.username_changed" },
    });
    expect(audit).not.toBeNull();
  });
  it("rejects a name taken by someone else with a conflict", async () => {
    const bob = await db.user.findUnique({ where: { id: bobId } });
    await expect(updateUsername(alice, bob!.username!)).rejects.toMatchObject({ status: 409 });
  });
});
