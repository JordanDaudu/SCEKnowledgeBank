import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/users.repo", () => ({
  findByEmail: vi.fn(),
  findByEmailCaseInsensitive: vi.fn(),
  findManyWithRolesByIds: vi.fn(),
  findRoleNameById: vi.fn(),
  findRoleIdByName: vi.fn(),
  findById: vi.fn(),
  findActiveUserIdsOrderedByCreatedAt: vi.fn(),
  createWithRole: vi.fn(),
  updateStatus: vi.fn(),
  updatePasswordHash: vi.fn(),
}));

vi.mock("../repositories/enrollments.repo", () => ({
  findEnrollmentsForUser: vi.fn().mockResolvedValue([]),
  upsertEnrollments: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./audit.service", () => ({
  record: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("bcryptjs", () => ({
  default: { compare: vi.fn(), hash: vi.fn().mockResolvedValue("hashed-pw") },
}));

import bcrypt from "bcryptjs";
import * as usersRepo from "../repositories/users.repo";
import * as enrollmentsRepo from "../repositories/enrollments.repo";
import * as auditService from "./audit.service";
import { HttpError } from "../lib/errors";
import {
  login,
  loadAuthenticatedUser,
  register,
  approveUser,
  disableUser,
  generateTempPassword,
  adminResetPassword,
  PASSWORD_RULES,
} from "./auth.service";

const findByEmail = vi.mocked(usersRepo.findByEmail);
const findByEmailCaseInsensitive = vi.mocked(
  usersRepo.findByEmailCaseInsensitive,
);
const findManyWithRolesByIds = vi.mocked(usersRepo.findManyWithRolesByIds);
const findRoleNameById = vi.mocked(usersRepo.findRoleNameById);
const findRoleIdByName = vi.mocked(usersRepo.findRoleIdByName);
const createWithRole = vi.mocked(usersRepo.createWithRole);
const updateStatus = vi.mocked(usersRepo.updateStatus);
const findById = vi.mocked(usersRepo.findById);
const updatePasswordHash = vi.mocked(usersRepo.updatePasswordHash);
const upsertEnrollments = vi.mocked(enrollmentsRepo.upsertEnrollments);
const bcryptCompare = vi.mocked(bcrypt.compare);
const bcryptHash = vi.mocked(bcrypt.hash);
const auditRecord = vi.mocked(auditService.record);

const baseUserRow = {
  id: "user-1",
  email: "a@b.com",
  displayName: "Tester",
  passwordHash: "hashed",
  isActive: true,
  status: "ACTIVE" as const,
  studentId: null,
  lecturerId: null,
  department: null,
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
  status: "ACTIVE" as const,
  primaryRoleId: null,
  createdAt: new Date("2025-01-01T00:00:00Z"),
  roles: ["student"],
  username: "tester",
  avatarStoragePath: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("login", () => {
  it("throws 401 when no user exists with that email", async () => {
    findByEmailCaseInsensitive.mockResolvedValueOnce(null);
    await expect(login("missing@b.com", "pw")).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
    });
    expect(bcryptCompare).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it("throws 401 when the user is deactivated", async () => {
    findByEmailCaseInsensitive.mockResolvedValueOnce({
      ...baseUserRow,
      isActive: false,
    } as never);
    await expect(login("a@b.com", "pw")).rejects.toBeInstanceOf(HttpError);
    expect(bcryptCompare).not.toHaveBeenCalled();
  });

  it("throws 401 when the password is wrong", async () => {
    findByEmailCaseInsensitive.mockResolvedValueOnce(baseUserRow as never);
    bcryptCompare.mockResolvedValueOnce(false as never);
    await expect(login("a@b.com", "bad")).rejects.toMatchObject({
      status: 401,
    });
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it("rejects DISABLED accounts with a 403 even on correct password", async () => {
    findByEmailCaseInsensitive.mockResolvedValueOnce({
      ...baseUserRow,
      status: "DISABLED",
    } as never);
    bcryptCompare.mockResolvedValueOnce(true as never);
    await expect(login("a@b.com", "pw")).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it("rejects PENDING_APPROVAL accounts with a 403", async () => {
    findByEmailCaseInsensitive.mockResolvedValueOnce({
      ...baseUserRow,
      status: "PENDING_APPROVAL",
    } as never);
    bcryptCompare.mockResolvedValueOnce(true as never);
    await expect(login("a@b.com", "pw")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("throws 401 when the user vanishes between lookup and role load", async () => {
    findByEmailCaseInsensitive.mockResolvedValueOnce(baseUserRow as never);
    bcryptCompare.mockResolvedValueOnce(true as never);
    findManyWithRolesByIds.mockResolvedValueOnce([]);
    await expect(login("a@b.com", "pw")).rejects.toMatchObject({ status: 401 });
  });

  it("returns the authenticated user and records an audit entry on success", async () => {
    findByEmailCaseInsensitive.mockResolvedValueOnce(baseUserRow as never);
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

describe("register", () => {
  const validStudent = {
    fullName: "Riley Carter",
    email: "Riley@uni.edu",
    password: "secret123",
    confirmPassword: "secret123",
    role: "student" as const,
  };

  it("creates a student in ACTIVE status and auto-logs-them-in", async () => {
    findByEmailCaseInsensitive.mockResolvedValueOnce(null);
    findRoleIdByName.mockResolvedValueOnce("role-student");
    createWithRole.mockResolvedValueOnce({
      ...baseUserRow,
      id: "new-1",
      email: "riley@uni.edu",
      displayName: "Riley Carter",
    } as never);
    findManyWithRolesByIds.mockResolvedValueOnce([
      { ...baseRoleRow, id: "new-1", roles: ["student"] },
    ]);

    const result = await register(validStudent);

    expect(bcryptHash).toHaveBeenCalledWith("secret123", 10);
    expect(createWithRole).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "riley@uni.edu",
        primaryRoleId: "role-student",
        status: "ACTIVE",
        passwordHash: "hashed-pw",
      }),
    );
    expect(result.status).toBe("ACTIVE");
    expect(result.userId).toBe("new-1");
    expect(result.user?.primaryRole).toBe("student");
    expect(auditRecord).toHaveBeenCalledWith(
      "new-1",
      "user.register",
      "user",
      "new-1",
      { role: "student", status: "ACTIVE" },
    );
  });

  it("creates a lecturer in PENDING_APPROVAL with no auto-login", async () => {
    findByEmailCaseInsensitive.mockResolvedValueOnce(null);
    findRoleIdByName.mockResolvedValueOnce("role-lecturer");
    createWithRole.mockResolvedValueOnce({
      ...baseUserRow,
      id: "new-2",
      status: "PENDING_APPROVAL",
    } as never);

    const result = await register({
      ...validStudent,
      email: "prof@uni.edu",
      role: "lecturer",
      lecturerId: "L-1",
      department: "CS",
    });

    expect(createWithRole).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "PENDING_APPROVAL",
        lecturerId: "L-1",
        department: "CS",
      }),
    );
    expect(result.status).toBe("PENDING_APPROVAL");
    expect(result.userId).toBeNull();
    expect(result.user).toBeNull();
    expect(findManyWithRolesByIds).not.toHaveBeenCalled();
  });

  it("rejects admin role attempts as bad input", async () => {
    await expect(
      register({ ...validStudent, role: "admin" as never }),
    ).rejects.toMatchObject({ status: 400 });
    expect(createWithRole).not.toHaveBeenCalled();
  });

  it("rejects duplicate emails with 409", async () => {
    findByEmailCaseInsensitive.mockResolvedValueOnce(baseUserRow as never);
    await expect(register(validStudent)).rejects.toMatchObject({
      status: 409,
      code: "conflict",
    });
    expect(createWithRole).not.toHaveBeenCalled();
  });

  it("rejects passwords that fail strength rules", async () => {
    await expect(
      register({ ...validStudent, password: "short", confirmPassword: "short" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      register({
        ...validStudent,
        password: "alllettersnodigit",
        confirmPassword: "alllettersnodigit",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects mismatched password confirmation", async () => {
    await expect(
      register({ ...validStudent, confirmPassword: "different1" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("opportunistically enrolls students in supplied courses", async () => {
    findByEmailCaseInsensitive.mockResolvedValueOnce(null);
    findRoleIdByName.mockResolvedValueOnce("role-student");
    createWithRole.mockResolvedValueOnce({
      ...baseUserRow,
      id: "new-3",
    } as never);
    findManyWithRolesByIds.mockResolvedValueOnce([
      { ...baseRoleRow, id: "new-3" },
    ]);

    await register({
      ...validStudent,
      enrolledCourseIds: ["course-a", "course-b"],
    });

    expect(upsertEnrollments).toHaveBeenCalledWith([
      { userId: "new-3", courseId: "course-a", roleInCourse: "student" },
      { userId: "new-3", courseId: "course-b", roleInCourse: "student" },
    ]);
  });
});

describe("approve/disable", () => {
  it("approve sets status ACTIVE and audits the actor", async () => {
    updateStatus.mockResolvedValueOnce({
      ...baseUserRow,
      id: "target",
      status: "ACTIVE",
    } as never);
    await approveUser("target", "actor");
    expect(updateStatus).toHaveBeenCalledWith("target", "ACTIVE");
    expect(auditRecord).toHaveBeenCalledWith(
      "actor",
      "user.approve",
      "user",
      "target",
    );
  });

  it("disable sets status DISABLED and audits the actor", async () => {
    updateStatus.mockResolvedValueOnce({
      ...baseUserRow,
      id: "target",
      status: "DISABLED",
    } as never);
    await disableUser("target", "actor");
    expect(updateStatus).toHaveBeenCalledWith("target", "DISABLED");
    expect(auditRecord).toHaveBeenCalledWith(
      "actor",
      "user.disable",
      "user",
      "target",
    );
  });

  it("approve throws when the user is missing", async () => {
    updateStatus.mockResolvedValueOnce(null);
    await expect(approveUser("ghost", "actor")).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe("generateTempPassword", () => {
  it("produces a password of the requested length", () => {
    expect(generateTempPassword(8)).toHaveLength(8);
    expect(generateTempPassword(12)).toHaveLength(12);
  });

  it("always satisfies the platform password rules (letter + digit)", () => {
    // Run many iterations: the generator guarantees a letter and a digit,
    // so every output must pass the regex used at registration/login.
    for (let i = 0; i < 200; i++) {
      const pw = generateTempPassword(8);
      expect(pw.length).toBeGreaterThanOrEqual(PASSWORD_RULES.minLength);
      expect(PASSWORD_RULES.regex.test(pw)).toBe(true);
    }
  });

  it("never emits visually ambiguous characters (0 O 1 l I)", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateTempPassword(8)).not.toMatch(/[0O1lI]/);
    }
  });

  it("produces varied output (not a constant)", () => {
    const seen = new Set(
      Array.from({ length: 20 }, () => generateTempPassword(8)),
    );
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("adminResetPassword", () => {
  it("hashes a fresh password, stores it, and returns the plaintext", async () => {
    findById.mockResolvedValueOnce({ ...baseUserRow, id: "target" } as never);

    const result = await adminResetPassword("admin-1", "target");

    expect(result.password).toHaveLength(8);
    expect(PASSWORD_RULES.regex.test(result.password)).toBe(true);
    expect(bcryptHash).toHaveBeenCalledWith(result.password, 10);
    expect(updatePasswordHash).toHaveBeenCalledWith("target", "hashed-pw");
    expect(auditRecord).toHaveBeenCalledWith(
      "admin-1",
      "user.password_reset",
      "user",
      "target",
      { byAdmin: true },
    );
  });

  it("throws 400 when the target user does not exist", async () => {
    findById.mockResolvedValueOnce(null);
    await expect(adminResetPassword("admin-1", "ghost")).rejects.toMatchObject({
      status: 400,
    });
    expect(updatePasswordHash).not.toHaveBeenCalled();
  });
});
