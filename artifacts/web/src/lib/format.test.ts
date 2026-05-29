import { describe, it, expect } from "vitest";
import { isUnlimitedQuota } from "./format";

const PB = 1024 ** 5;
const GB = 1024 ** 3;

describe("isUnlimitedQuota", () => {
  it("treats the local dev stub (absurdly large) as unlimited", () => {
    // ~8,185,452 TB — the local STORAGE_DRIVER=local sentinel
    expect(isUnlimitedQuota(8185452 * 1024 ** 4)).toBe(true);
  });

  it("treats anything at or above 1 PB as unlimited", () => {
    expect(isUnlimitedQuota(PB)).toBe(true);
    expect(isUnlimitedQuota(PB * 2)).toBe(true);
  });

  it("treats realistic per-user quotas as limited", () => {
    expect(isUnlimitedQuota(5 * GB)).toBe(false);
    expect(isUnlimitedQuota(500 * 1024 ** 2)).toBe(false);
    expect(isUnlimitedQuota(0)).toBe(false);
  });

  it("treats non-finite / invalid values as unlimited (no usable bar)", () => {
    expect(isUnlimitedQuota(Number.POSITIVE_INFINITY)).toBe(true);
    expect(isUnlimitedQuota(NaN)).toBe(true);
  });
});
