import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/users.repo", () => ({
  findQuotaById: vi.fn(),
  findManyWithRolesByIds: vi.fn(),
}));

import * as usersRepo from "../repositories/users.repo";
import * as quotaService from "./quota.service";
import { env } from "../lib/env";
import type { AuthenticatedUser } from "../middlewares/auth";

const findQuota = vi.mocked(usersRepo.findQuotaById);
const findWithRoles = vi.mocked(usersRepo.findManyWithRolesByIds);

function makeUser(roles: string[]): AuthenticatedUser {
  return {
    id: "u1",
    email: "u1@x.com",
    displayName: "U",
    isActive: true,
    primaryRole: roles[0] ?? "student",
    roles,
    enrollments: [],
  } as AuthenticatedUser;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("quota.service.effectiveQuotaForUser — role-based defaults", () => {
  it("admins get the unlimited sentinel when no override is set", async () => {
    findQuota.mockResolvedValue({ usedBytes: 1000n, quotaBytes: null });
    const q = await quotaService.effectiveQuotaForUser(makeUser(["admin"]));
    expect(q.quotaBytes).toBe(env.unlimitedQuotaBytes);
    expect(q.usedBytes).toBe(1000n);
    // canFit is effectively always true within reason for admins
    expect(quotaService.canFit(q, BigInt(10 * 1024 * 1024 * 1024))).toBe(true);
  });

  it("lecturers get the lecturer default when no override is set", async () => {
    findQuota.mockResolvedValue({ usedBytes: 0n, quotaBytes: null });
    const q = await quotaService.effectiveQuotaForUser(makeUser(["lecturer"]));
    expect(q.quotaBytes).toBe(env.defaultLecturerQuotaBytes);
  });

  it("students get the student default when no override is set", async () => {
    findQuota.mockResolvedValue({ usedBytes: 0n, quotaBytes: null });
    const q = await quotaService.effectiveQuotaForUser(makeUser(["student"]));
    expect(q.quotaBytes).toBe(env.defaultStudentQuotaBytes);
  });

  it("per-user override wins over any role-based default", async () => {
    findQuota.mockResolvedValue({ usedBytes: 0n, quotaBytes: 12345n });
    const q = await quotaService.effectiveQuotaForUser(makeUser(["lecturer"]));
    expect(q.quotaBytes).toBe(12345n);
  });

  it("when a user has multiple roles, the highest-tier default wins", async () => {
    findQuota.mockResolvedValue({ usedBytes: 0n, quotaBytes: null });
    // student + lecturer → lecturer default
    let q = await quotaService.effectiveQuotaForUser(
      makeUser(["student", "lecturer"]),
    );
    expect(q.quotaBytes).toBe(env.defaultLecturerQuotaBytes);
    // student + admin → admin unlimited
    q = await quotaService.effectiveQuotaForUser(
      makeUser(["student", "admin"]),
    );
    expect(q.quotaBytes).toBe(env.unlimitedQuotaBytes);
  });

  it("falls back to the universal env default when the user has no roles", async () => {
    findQuota.mockResolvedValue({ usedBytes: 0n, quotaBytes: null });
    const q = await quotaService.effectiveQuotaForUser(makeUser([]));
    expect(q.quotaBytes).toBe(env.defaultUserStorageQuotaBytes);
  });
});

describe("quota.service helpers", () => {
  it("remainingBytes clamps to zero when usage exceeds quota", () => {
    expect(
      quotaService.remainingBytes({ usedBytes: 1000n, quotaBytes: 800n }),
    ).toBe(0n);
    expect(
      quotaService.remainingBytes({ usedBytes: 300n, quotaBytes: 800n }),
    ).toBe(500n);
  });

  it("canFit boundary: equal-to-quota is allowed, one byte more is not", () => {
    const q = { usedBytes: 100n, quotaBytes: 500n };
    expect(quotaService.canFit(q, 400n)).toBe(true);
    expect(quotaService.canFit(q, 401n)).toBe(false);
  });
});

describe("quota.service.effectiveQuotaById — by-id path", () => {
  it("looks up roles by id and applies the role-based default", async () => {
    findQuota.mockResolvedValue({ usedBytes: 50n, quotaBytes: null });
    findWithRoles.mockResolvedValue([
      { id: "u1", roles: ["student"] } as never,
    ]);
    const q = await quotaService.effectiveQuotaById("u1");
    expect(q.quotaBytes).toBe(env.defaultStudentQuotaBytes);
    expect(q.usedBytes).toBe(50n);
  });
});
