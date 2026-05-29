import { describe, it, expect } from "vitest";
import { computePopularity } from "../lib/collection-popularity";

describe("computePopularity", () => {
  it("is zero for an empty, unfollowed collection", () => {
    expect(computePopularity(0, 0)).toBe(0);
  });

  it("weights followers more heavily than items", () => {
    // 1 follower should outrank 2 items
    expect(computePopularity(1, 0)).toBeGreaterThan(computePopularity(0, 2));
  });

  it("combines followers and items", () => {
    expect(computePopularity(2, 5)).toBe(2 * 3 + 5);
  });

  it("never returns a negative score", () => {
    expect(computePopularity(-1, -1)).toBeGreaterThanOrEqual(0);
  });
});
