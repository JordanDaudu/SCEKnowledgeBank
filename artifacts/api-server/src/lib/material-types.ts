/**
 * Canonical list of `Document.materialType` values supported by the
 * upload pipeline. Mirrors the frontend's
 * `artifacts/web/src/lib/material-types.ts` so the API validator and
 * the upload form stay in sync. If you add a new value here, update
 * the web file too.
 */
export const MATERIAL_TYPE_VALUES = [
  "lecture-notes",
  "problem-set",
  "exam",
  "syllabus",
  "slides",
  "project-report",
  "textbook",
  "review-notes",
  "cheat-sheet",
] as const;

export type MaterialType = (typeof MATERIAL_TYPE_VALUES)[number];
