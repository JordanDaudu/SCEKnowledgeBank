import type { SuggestMetadataResponse } from "@workspace/api-client-react";

export type Visibility = "public" | "restricted" | "private";
export type Semester = "fall" | "spring" | "summer" | "";

/** The user-editable metadata carried by every queued file. */
export interface ItemMeta {
  courseId: string;
  materialType: string;
  categoryId: string;
  visibility: Visibility;
  semester: Semester;
  academicYear: string;
  title: string;
  tagIds: string[];
}

/** Fresh, empty metadata for a newly queued file. `year` is the current year. */
export function defaultItemMeta(year: string): ItemMeta {
  return {
    courseId: "",
    materialType: "",
    categoryId: "",
    visibility: "public",
    semester: "",
    academicYear: year,
    title: "",
    tagIds: [],
  };
}

/** Only Course and Material Type are required to upload a file. */
export function isItemReady(meta: ItemMeta): boolean {
  return !!meta.courseId && !!meta.materialType;
}

/** Human-readable list of unfilled required fields (for the card status). */
export function missingRequiredFields(meta: ItemMeta): string[] {
  const missing: string[] = [];
  if (!meta.courseId) missing.push("Course");
  if (!meta.materialType) missing.push("Material Type");
  return missing;
}

/**
 * Map a per-file suggestion to the fields we auto-fill, per the confidence
 * rule in the design spec. Never overwrites a field the user already set, so
 * it is safe to call when a late suggestion resolves after the user has begun
 * editing. Low-confidence course, category, and filename-derived titles are
 * NOT auto-filled — the card renders those as confirmable chips instead.
 */
export function applySuggestion(
  meta: ItemMeta,
  s: SuggestMetadataResponse,
): Partial<ItemMeta> {
  const patch: Partial<ItemMeta> = {};
  if (!meta.materialType && s.materialType) patch.materialType = s.materialType;
  if (!meta.semester && s.semester) patch.semester = s.semester as Semester;
  // academicYear always starts at the current year; a filename-derived year is
  // a better guess, so replace it as long as the user hasn't typed their own.
  if (s.academicYear && meta.academicYear === defaultItemMeta(meta.academicYear).academicYear) {
    patch.academicYear = String(s.academicYear);
  }
  if (!meta.title && s.titleSource === "metadata" && s.title) {
    patch.title = s.title;
  }
  if (!meta.courseId && s.course && s.courseConfidence === "high") {
    patch.courseId = s.course.id;
  }
  return patch;
}
