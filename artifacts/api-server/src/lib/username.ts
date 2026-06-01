/**
 * Pure username rules (no DB). Usernames are stored canonical-lowercase, so
 * uniqueness is case-insensitive by storage. Uniqueness itself is checked
 * against the DB in profile.service.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "admin", "administrator", "system", "support", "root", "api", "me",
  "null", "undefined", "anonymous", "moderator", "staff", "help",
  "about", "settings", "profile", "user", "users",
]);

const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

export function canonicalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export type UsernameValidation =
  | { ok: true; value: string }
  | { ok: false; reason: "invalid" | "reserved" };

export function validateUsername(raw: string): UsernameValidation {
  const value = canonicalizeUsername(raw);
  if (!USERNAME_RE.test(value)) return { ok: false, reason: "invalid" };
  if (RESERVED_USERNAMES.has(value)) return { ok: false, reason: "reserved" };
  return { ok: true, value };
}
