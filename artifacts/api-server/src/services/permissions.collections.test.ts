import { describe, expect, it } from "vitest";
import { canUseCollections } from "./permissions.service";
import type { AuthenticatedUser } from "../middlewares/auth";

const mk = (roles: string[]): AuthenticatedUser =>
  ({ id: "u1", roles, enrollments: [] } as unknown as AuthenticatedUser);

describe("canUseCollections", () => {
  it("allows students and lecturers", () => {
    expect(canUseCollections(mk(["student"]))).toBe(true);
    expect(canUseCollections(mk(["lecturer"]))).toBe(true);
  });
  it("denies admins", () => {
    expect(canUseCollections(mk(["admin"]))).toBe(false);
    expect(canUseCollections(mk(["admin", "lecturer"]))).toBe(false);
  });
  it("denies null/undefined and roleless users", () => {
    expect(canUseCollections(null)).toBe(false);
    expect(canUseCollections(mk([]))).toBe(false);
  });
});
