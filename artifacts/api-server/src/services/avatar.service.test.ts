import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { setAvatar, removeAvatar } from "./avatar.service";
import * as usersRepo from "../repositories/users.repo";

const SX = `_av_${Date.now().toString(36)}`;
const handle = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 30);
let user: AuthenticatedUser;

async function pngBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 120, b: 200 } } })
    .png().toBuffer();
}

beforeAll(async () => {
  const u = await db.user.create({ data: { email: `u${SX}@demo`, passwordHash: "x", displayName: "U", username: handle(`av${SX}`) } });
  user = {
    id: u.id, email: u.email, displayName: "U", isActive: true,
    primaryRole: "student", roles: ["student"], enrollments: [],
    username: u.username, avatarStoragePath: null, createdAt: new Date().toISOString(),
  };
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { actorUserId: user.id } });
  await db.user.deleteMany({ where: { id: user.id } });
});

describe("avatar.service", () => {
  it("rejects a disallowed mime type", async () => {
    await expect(
      setAvatar(user, { buffer: Buffer.from("hi"), mimetype: "text/plain" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("normalizes + stores a valid image and records the columns", async () => {
    await setAvatar(user, { buffer: await pngBuffer(), mimetype: "image/png" });
    const row = await usersRepo.findAvatarById(user.id);
    expect(row?.avatarStoragePath).toBe(`avatars/${user.id}.webp`);
    expect(row?.avatarMimeType).toBe("image/webp");
    const audit = await db.auditLog.findFirst({
      where: { actorUserId: user.id, action: "user.avatar_changed" },
    });
    expect(audit).not.toBeNull();
  });

  it("removes the avatar (clears columns)", async () => {
    const withAvatar = { ...user, avatarStoragePath: `avatars/${user.id}.webp` };
    await removeAvatar(withAvatar);
    const row = await usersRepo.findAvatarById(user.id);
    expect(row?.avatarStoragePath).toBeNull();
    expect(row?.avatarMimeType).toBeNull();
  });
});
