/**
 * Defence-in-depth for PATCH /me/profile: the only writable field is
 * `username`. Any attempt to send a protected field is rejected AND audited.
 */
const ROLE_KEYS = ["role", "roles", "primaryRole", "primaryRoleId", "roleId"];
const EMAIL_KEYS = ["email"];
const OTHER_FORBIDDEN = ["status", "id", "userId", "isActive", "deletedAt"];
const FORBIDDEN = [...ROLE_KEYS, ...EMAIL_KEYS, ...OTHER_FORBIDDEN];

export function forbiddenProfileKey(body: Record<string, unknown>): string | null {
  for (const k of FORBIDDEN) {
    if (Object.prototype.hasOwnProperty.call(body, k)) return k;
  }
  return null;
}

export type TamperAuditAction =
  | "user.role_change_attempt"
  | "user.email_change_attempt"
  | "user.profile_tamper_attempt";

export function auditActionForForbiddenKey(key: string): TamperAuditAction {
  if (ROLE_KEYS.includes(key)) return "user.role_change_attempt";
  if (EMAIL_KEYS.includes(key)) return "user.email_change_attempt";
  return "user.profile_tamper_attempt";
}
