import { describe, expect, it } from "vitest";
import type { SuggestMetadataResponse } from "@workspace/api-client-react";
import {
  applySuggestion,
  defaultItemMeta,
  isItemReady,
  missingRequiredFields,
  type ItemMeta,
} from "./upload-analysis";

const YEAR = "2026";

function meta(over: Partial<ItemMeta> = {}): ItemMeta {
  return { ...defaultItemMeta(YEAR), ...over };
}

describe("isItemReady / missingRequiredFields", () => {
  it("is ready only when course and material type are both set", () => {
    expect(isItemReady(meta())).toBe(false);
    expect(isItemReady(meta({ courseId: "c1" }))).toBe(false);
    expect(isItemReady(meta({ courseId: "c1", materialType: "exam" }))).toBe(
      true,
    );
  });

  it("lists which required fields are missing", () => {
    expect(missingRequiredFields(meta())).toEqual([
      "Course",
      "Material Type",
    ]);
    expect(missingRequiredFields(meta({ courseId: "c1" }))).toEqual([
      "Material Type",
    ]);
    expect(
      missingRequiredFields(meta({ courseId: "c1", materialType: "exam" })),
    ).toEqual([]);
  });
});

describe("applySuggestion", () => {
  it("auto-fills material type, semester and year from filename signals", () => {
    const s = {
      keywords: [],
      tags: [],
      materialType: "exam",
      semester: "fall",
      academicYear: 2024,
    } as SuggestMetadataResponse;
    expect(applySuggestion(meta(), s, YEAR)).toEqual({
      materialType: "exam",
      semester: "fall",
      academicYear: "2024",
    });
  });

  it("auto-fills course only when confidence is high", () => {
    const high = {
      keywords: [],
      tags: [],
      course: { id: "c1", code: "CS101", title: "Intro" },
      courseConfidence: "high",
    } as SuggestMetadataResponse;
    expect(applySuggestion(meta(), high, YEAR)).toEqual({ courseId: "c1" });

    const low = {
      keywords: [],
      tags: [],
      course: { id: "c1", code: "CS101", title: "Intro" },
      courseConfidence: "low",
    } as SuggestMetadataResponse;
    expect(applySuggestion(meta(), low, YEAR)).toEqual({});
  });

  it("prefills the title only from embedded metadata, not the filename", () => {
    const fromMeta = {
      keywords: [],
      tags: [],
      title: "Real Title",
      titleSource: "metadata",
    } as SuggestMetadataResponse;
    expect(applySuggestion(meta(), fromMeta, YEAR)).toEqual({ title: "Real Title" });

    const fromName = {
      keywords: [],
      tags: [],
      title: "Guessed",
      titleSource: "filename",
    } as SuggestMetadataResponse;
    expect(applySuggestion(meta(), fromName, YEAR)).toEqual({});
  });

  it("never overwrites a field the user already filled", () => {
    const s = {
      keywords: [],
      tags: [],
      materialType: "exam",
      course: { id: "c1", code: "CS101", title: "Intro" },
      courseConfidence: "high",
    } as SuggestMetadataResponse;
    const filled = meta({ materialType: "slides", courseId: "other" });
    expect(applySuggestion(filled, s, YEAR)).toEqual({});
  });

  it("does not overwrite academicYear the user already changed", () => {
    const s = {
      keywords: [],
      tags: [],
      academicYear: 2024,
    } as SuggestMetadataResponse;
    const edited = meta({ academicYear: "2023" });
    expect(applySuggestion(edited, s, YEAR)).toEqual({});
  });

  it("replaces the default seed year when analysis finds a better one", () => {
    const s = {
      keywords: [],
      tags: [],
      academicYear: 2024,
    } as SuggestMetadataResponse;
    expect(applySuggestion(meta(), s, YEAR)).toEqual({ academicYear: "2024" });
  });
});
