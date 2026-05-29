/**
 * Phase 3 — filename intelligence.
 *
 * Pure, deterministic parsing of an uploaded file's name into upload-form
 * signals: material type, semester, and academic year. Used to pre-fill the
 * upload form. Never throws and never does I/O — safe to call on every file,
 * including Office documents we can't extract text from.
 */
import { type MaterialType } from "../../lib/material-types";

export interface FilenameSignals {
  materialType?: MaterialType;
  semester?: "fall" | "spring" | "summer";
  academicYear?: number;
}

// Checked in order; first match wins. Ordered so the more specific intent
// beats the generic one (e.g. "midterm review" → review-notes, not exam;
// a plain "midterm" with no review word still falls through to exam).
const TYPE_PATTERNS: Array<[RegExp, MaterialType]> = [
  [/\b(cheat ?sheet|formula ?sheet)\b/, "cheat-sheet"],
  [/\b(syllabus|outline)\b/, "syllabus"],
  [/\b(slides?|deck|presentation|ppt|pptx|keynote)\b/, "slides"],
  [/\b(review|revision|summary|recap)\b/, "review-notes"],
  [/\b(exam|midterm|final|quiz|test)\b/, "exam"],
  [/\b(hw\d*|homework|problem ?set|pset|assignment|exercise)\b/, "problem-set"],
  [/\b(project|report)\b/, "project-report"],
  [/\b(textbook|chapter|book)\b/, "textbook"],
  [/\b(lecture|lec|notes?)\b/, "lecture-notes"],
];

export function parseFilenameSignals(filename: string): FilenameSignals {
  const stem = filename.includes(".")
    ? filename.slice(0, filename.lastIndexOf("."))
    : filename;
  // Normalise separators (._-, etc.) to single spaces and pad with spaces so
  // the \b-anchored patterns below see clean word boundaries.
  const norm = ` ${stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;

  const out: FilenameSignals = {};

  for (const [re, type] of TYPE_PATTERNS) {
    if (re.test(norm)) {
      out.materialType = type;
      break;
    }
  }

  if (/\b(fall|autumn)\b/.test(norm)) out.semester = "fall";
  else if (/\bspring\b/.test(norm)) out.semester = "spring";
  else if (/\bsummer\b/.test(norm)) out.semester = "summer";

  const ym = norm.match(/\b(\d{4})\b/);
  if (ym) {
    const y = Number(ym[1]);
    if (y >= 1990 && y <= 2099) out.academicYear = y;
  }

  return out;
}
