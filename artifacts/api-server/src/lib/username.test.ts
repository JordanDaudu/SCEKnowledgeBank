import { describe, expect, it } from "vitest";
import { canonicalizeUsername, validateUsername, RESERVED_USERNAMES } from "./username";

describe("canonicalizeUsername", () => {
  it("trims and lowercases", () => {
    expect(canonicalizeUsername("  Noa_Student  ")).toBe("noa_student");
  });
});

describe("validateUsername", () => {
  it("accepts a valid handle and returns the canonical value", () => {
    expect(validateUsername("Noa_Student")).toEqual({ ok: true, value: "noa_student" });
  });
  it("rejects too-short / too-long / bad chars as invalid", () => {
    expect(validateUsername("ab")).toEqual({ ok: false, reason: "invalid" });
    expect(validateUsername("a".repeat(31))).toEqual({ ok: false, reason: "invalid" });
    expect(validateUsername("has space")).toEqual({ ok: false, reason: "invalid" });
    expect(validateUsername("dash-no")).toEqual({ ok: false, reason: "invalid" });
  });
  it("rejects reserved names (case-insensitive)", () => {
    expect(validateUsername("Admin")).toEqual({ ok: false, reason: "reserved" });
    expect(validateUsername("support")).toEqual({ ok: false, reason: "reserved" });
  });
  it("exposes the reserved set", () => {
    expect(RESERVED_USERNAMES.has("admin")).toBe(true);
  });
});
