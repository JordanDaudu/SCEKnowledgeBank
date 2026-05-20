import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/users.repo", () => ({
  findByEmail: vi.fn(),
  findManyWithRolesByIds: vi.fn(),
  findRoleNameById: vi.fn(),
  findById: vi.fn(),
  findActiveUserIdsOrderedByCreatedAt: vi.fn(),
}));

vi.mock("../repositories/enrollments.repo", () => ({
  findEnrollmentsForUser: vi.fn().mockResolvedValue([]),
  upsertEnrollments: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./audit.service", () => ({
  record: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("bcryptjs", () => ({
  default: { compare: vi.fn() },
}));

import bcrypt from "bcryptjs";
import * as usersRepo from "../repositories/users.repo";
import * as auditService from "./audit.service";
import { HttpError } from "../lib/errors";
import { login, loadAuthenticatedUser } from "./auth.service";

const findByEmail = vi.mocked(usersRepo.findByEmail);
const findManyWithRolesByIds = vi.mocked(usersRepo.findManyWithRolesByIds);
const findRoleNameById = vi.mocked(usersRepo.findRoleNameById);
const bcryptCompare = vi.mocked(bcrypt.compare);
const auditRecord = vi.mocked(auditService.record);

const baseUserRow = {
  id: "user-1",
  email: "a@b.com",
  displayName: "Tester",
  passwordHash: "hashed",
  isActive: true,
  primaryRoleId: null,
  createdAt: new Date("2025-01-01T00:00:00Z"),
  deletedAt: null,
  updatedAt: new Date("2025-01-01T00:00:00Z"),
};

const baseRoleRow = {
  id: "user-1",
  email: "a@b.com",
  displayName: "Tester",
  isActive: true,
  primaryRoleId: null,
  createdAt: new Date("2025-01-01T00:00:00Z"),
  roles: ["student"],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("login", () => {
  it("throws 401 when no user exists with that email", async () => {
    findByEmail.mockResolvedValueOnce(null);
    await expect(login("missing@b.com", "pw")).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
    });
    expect(bcryptCompare).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it("throws 401 when the user is deactivated", async () => {
    findByEmail.mockResolvedValueOnce({
      ...baseUserRow,
      isActive: false,
    } as never);
    await expect(login("a@b.com", "pw")).rejects.toBeInstanceOf(HttpError);
    expect(bcryptCompare).not.toHaveBeenCalled();
  });

  it("throws 401 when the password is wrong", async () => {
    findByEmail.mockResolvedValueOnce(baseUserRow as never);
    bcryptCompare.mockResolvedValueOnce(false as never);
    await expect(login("a@b.com", "bad")).rejects.toMatchObject({
      status: 401,
    });
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it("throws 401 when the user vanishes between lookup and role load", async () => {
    findByEmail.mockResolvedValueOnce(baseUserRow as never);
    bcryptCompare.mockResolvedValueOnce(true as never);
    findManyWithRolesByIds.mockResolvedValueOnce([]);
    await expect(login("a@b.com", "pw")).rejects.toMatchObject({ status: 401 });
  });

  it("returns the authenticated user and records an audit entry on success", async () => {
    findByEmail.mockResolvedValueOnce(baseUserRow as never);
    bcryptCompare.mockResolvedValueOnce(true as never);
    findManyWithRolesByIds.mockResolvedValueOnce([baseRoleRow]);

    const result = await login("a@b.com", "pw");

    expect(result.userId).toBe("user-1");
    expect(result.user).toMatchObject({
      id: "user-1",
      email: "a@b.com",
      primaryRole: "student",
      roles: ["student"],
    });
    expect(auditRecord).toHaveBeenCalledWith(
      "user-1",
      "user.login",
      "user",
      "user-1",
    );
  });
});

describe("loadAuthenticatedUser", () => {
  it("returns null for missing/inactive users", async () => {
    findManyWithRolesByIds.mockResolvedValueOnce([]);
    expect(await loadAuthenticatedUser("nope")).toBeNull();

    findManyWithRolesByIds.mockResolvedValueOnce([
      { ...baseRoleRow, isActive: false },
    ]);
    expect(await loadAuthenticatedUser("user-1")).toBeNull();
  });

  it("resolves primary role from primaryRoleId when set", async () => {
    findManyWithRolesByIds.mockResolvedValueOnce([
      { ...baseRoleRow, primaryRoleId: "role-1", roles: ["student", "admin"] },
    ]);
    findRoleNameById.mockResolvedValueOnce("admin");
    const u = await loadAuthenticatedUser("user-1");
    expect(u?.primaryRole).toBe("admin");
  });

  it("falls back to first role name when primaryRoleId is null", async () => {
    findManyWithRolesByIds.mockResolvedValueOnce([
      { ...baseRoleRow, roles: ["lecturer"] },
    ]);
    const u = await loadAuthenticatedUser("user-1");
    expect(u?.primaryRole).toBe("lecturer");
  });
});
