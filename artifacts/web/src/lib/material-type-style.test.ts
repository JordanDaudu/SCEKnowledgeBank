import { describe, it, expect } from "vitest";
import { materialTypeStyle } from "./material-type-style";
import { MATERIAL_TYPE_VALUES } from "./material-types";

describe("materialTypeStyle", () => {
  const unknown = materialTypeStyle("definitely-not-a-type");

  it("returns a defined icon and non-empty classes for every known type", () => {
    for (const value of MATERIAL_TYPE_VALUES) {
      const s = materialTypeStyle(value);
      expect(s.icon, value).toBeTruthy();
      expect(s.tile.length, value).toBeGreaterThan(0);
      expect(s.tag.length, value).toBeGreaterThan(0);
    }
  });

  it("gives each known type a distinct (non-default) tile color", () => {
    for (const value of MATERIAL_TYPE_VALUES) {
      expect(materialTypeStyle(value).tile, value).not.toBe(unknown.tile);
    }
  });

  it("colors the extra material-type values that appear in real data", () => {
    // Seed/legacy data uses these beyond the curated upload dropdown.
    for (const value of ["assignment", "summary", "reading", "template"]) {
      expect(materialTypeStyle(value).tile, value).not.toBe(unknown.tile);
      expect(materialTypeStyle(value).tag, value).toContain("dark:");
    }
  });

  it("falls back to a neutral default for unknown or missing values", () => {
    expect(materialTypeStyle(undefined).tile).toBe(unknown.tile);
    expect(materialTypeStyle("").tile).toBe(unknown.tile);
    expect(unknown.icon).toBeTruthy();
    expect(unknown.tile).toContain("muted");
  });

  it("includes explicit dark-mode variants for every known (colored) type", () => {
    // The neutral default relies on theme-aware `muted` tokens, so it needs
    // no `dark:` variant; the colored types do.
    for (const value of MATERIAL_TYPE_VALUES) {
      expect(materialTypeStyle(value).tag, value).toContain("dark:");
    }
  });
});
