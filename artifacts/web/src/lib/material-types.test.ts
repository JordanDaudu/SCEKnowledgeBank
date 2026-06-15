import { describe, it, expect } from "vitest";
import {
  MATERIAL_TYPES,
  MATERIAL_TYPE_VALUES,
  formatMaterialType,
} from "./material-types";

describe("MATERIAL_TYPE_VALUES", () => {
  it("lists the value of every material type, in order", () => {
    expect(MATERIAL_TYPE_VALUES).toEqual(MATERIAL_TYPES.map((m) => m.value));
    expect(MATERIAL_TYPE_VALUES).toContain("lecture-notes");
    expect(MATERIAL_TYPE_VALUES).toContain("cheat-sheet");
  });
});

describe("formatMaterialType", () => {
  it("returns the canonical label for a known value", () => {
    expect(formatMaterialType("lecture-notes")).toBe("Lecture Notes");
    expect(formatMaterialType("exam")).toBe("Exam");
  });

  it("title-cases an unknown single word", () => {
    expect(formatMaterialType("assignment")).toBe("Assignment");
  });

  it("title-cases unknown values across -, _ and space separators", () => {
    expect(formatMaterialType("lecture_notes")).toBe("Lecture Notes");
    expect(formatMaterialType("old style-value")).toBe("Old Style Value");
  });
});
