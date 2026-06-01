import * as usersRepo from "../repositories/users.repo";
import * as auditService from "./audit.service";
import { badRequest, conflict } from "../lib/errors";
import { validateUsername } from "../lib/username";
import type { AuthenticatedUser } from "../middlewares/auth";

export type AvailabilityReason = "invalid" | "reserved" | "taken";

export async function checkUsernameAvailability(
  user: AuthenticatedUser,
  raw: string,
): Promise<{ available: boolean; reason?: AvailabilityReason }> {
  const v = validateUsername(raw);
  if (!v.ok) return { available: false, reason: v.reason };
  if (user.username && v.value === user.username) return { available: true };
  const existing = await usersRepo.findByUsername(v.value);
  if (existing && existing.id !== user.id) return { available: false, reason: "taken" };
  return { available: true };
}

export async function updateUsername(
  user: AuthenticatedUser,
  raw: string,
): Promise<{ username: string }> {
  const v = validateUsername(raw);
  if (!v.ok) {
    throw badRequest(
      v.reason === "reserved"
        ? "That username is reserved."
        : "Invalid username. Use 3–30 letters, numbers, or underscores.",
      { errorCode: v.reason === "reserved" ? "username_reserved" : "username_invalid" },
    );
  }
  if (user.username === v.value) return { username: v.value };
  const existing = await usersRepo.findByUsername(v.value);
  if (existing && existing.id !== user.id) {
    throw conflict("That username is already taken.");
  }
  await usersRepo.updateUsername(user.id, v.value);
  await auditService.record(user.id, "user.username_changed", "user", user.id, {
    from: user.username,
    to: v.value,
  });
  return { username: v.value };
}
