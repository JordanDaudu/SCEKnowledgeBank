import { describe, expect, it } from "vitest";
import { forbiddenProfileKey, auditActionForForbiddenKey } from "./profile-guard";

describe("forbiddenProfileKey", () => {
  it("returns null when only allowed keys are present", () => {
    expect(forbiddenProfileKey({ username: "noa_x" })).toBeNull();
  });
  it("detects role/email/status/id keys", () => {
    expect(forbiddenProfileKey({ role: "admin" })).toBe("role");
    expect(forbiddenProfileKey({ username: "x", email: "a@b.c" })).toBe("email");
    expect(forbiddenProfileKey({ status: "ACTIVE" })).toBe("status");
    expect(forbiddenProfileKey({ primaryRoleId: "x" })).toBe("primaryRoleId");
  });
});

describe("auditActionForForbiddenKey", () => {
  it("maps keys to the right audit action", () => {
    expect(auditActionForForbiddenKey("role")).toBe("user.role_change_attempt");
    expect(auditActionForForbiddenKey("primaryRoleId")).toBe("user.role_change_attempt");
    expect(auditActionForForbiddenKey("email")).toBe("user.email_change_attempt");
    expect(auditActionForForbiddenKey("status")).toBe("user.profile_tamper_attempt");
  });
});
