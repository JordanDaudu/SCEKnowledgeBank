import sharp from "sharp";
import type { Response } from "express";
import * as usersRepo from "../repositories/users.repo";
import * as auditService from "./audit.service";
import { getStorage } from "../lib/storage";
import { badRequest, notFound } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";

const ALLOWED_AVATAR_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const AVATAR_SIZE = 256;

function avatarKey(userId: string): string {
  return `avatars/${userId}.webp`;
}

export async function setAvatar(
  user: AuthenticatedUser,
  file: { buffer: Buffer; mimetype: string },
): Promise<void> {
  if (!ALLOWED_AVATAR_MIME.has(file.mimetype)) {
    throw badRequest("Avatar must be a JPG, PNG, or WebP image.", { errorCode: "avatar_bad_type" });
  }
  let normalized: Buffer;
  try {
    normalized = await sharp(file.buffer, { failOn: "none" })
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw badRequest("Could not process that image. Try a different file.", { errorCode: "avatar_unprocessable" });
  }
  const key = avatarKey(user.id);
  await getStorage().put({ key, body: normalized, contentType: "image/webp" });
  await usersRepo.updateAvatar(user.id, key, "image/webp");
  await auditService.record(user.id, "user.avatar_changed", "user", user.id, { action: "set" });
}

export async function removeAvatar(user: AuthenticatedUser): Promise<void> {
  if (user.avatarStoragePath) {
    try {
      await getStorage().delete(user.avatarStoragePath);
    } catch {
      // best-effort: the object may already be gone; columns are the source of truth
    }
  }
  await usersRepo.updateAvatar(user.id, null, null);
  await auditService.record(user.id, "user.avatar_changed", "user", user.id, { action: "remove" });
}

export async function streamAvatar(userId: string, res: Response): Promise<void> {
  const row = await usersRepo.findAvatarById(userId);
  if (!row || !row.avatarStoragePath) throw notFound("No avatar");
  const stream = await getStorage().getStream(row.avatarStoragePath);
  res.setHeader("Content-Type", row.avatarMimeType ?? "image/webp");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  stream.pipe(res);
}
