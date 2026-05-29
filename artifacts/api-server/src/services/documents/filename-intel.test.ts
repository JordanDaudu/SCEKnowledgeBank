import { describe, expect, it } from "vitest";
import { parseFilenameSignals } from "./filename-intel";

/**
 * Phase 3 — filename intelligence. Pure, deterministic parsing of a
 * filename into upload-form signals (material type / semester / year). Must
 * never throw and must return undefined fields when nothing is recognised.
 */
describe("parseFilenameSignals", () => {
  it("detects exam + semester + year from a rich filename", () => {
    const s = parseFilenameSignals("CS101-final-exam-fall-2024.pdf");
    expect(s.materialType).toBe("exam");
    expect(s.semester).toBe("fall");
    expect(s.academicYear).toBe(2024);
  });

  it("maps homework / problem-set vocabulary", () => {
    expect(parseFilenameSignals("hw3_solutions.pdf").materialType).toBe("problem-set");
    expect(parseFilenameSignals("problem set 2.docx").materialType).toBe("problem-set");
    expect(parseFilenameSignals("assignment-1.pdf").materialType).toBe("problem-set");
  });

  it("maps lecture, slides, syllabus, cheat sheet, review", () => {
    expect(parseFilenameSignals("week2-lecture-notes.pdf").materialType).toBe("lecture-notes");
    expect(parseFilenameSignals("intro_slides.pptx").materialType).toBe("slides");
    expect(parseFilenameSignals("course-syllabus.pdf").materialType).toBe("syllabus");
    expect(parseFilenameSignals("algorithms-cheatsheet.pdf").materialType).toBe("cheat-sheet");
    expect(parseFilenameSignals("midterm-review-summary.pdf").materialType).toBe("review-notes");
  });

  it("recognises spring/summer and 4-digit years", () => {
    const s = parseFilenameSignals("notes spring 2023.pdf");
    expect(s.semester).toBe("spring");
    expect(s.academicYear).toBe(2023);
    expect(parseFilenameSignals("summer_project.pdf").semester).toBe("summer");
  });

  it("returns an empty object for an unrecognisable name (never throws)", () => {
    const s = parseFilenameSignals("scan0001.pdf");
    expect(s.materialType).toBeUndefined();
    expect(s.semester).toBeUndefined();
    expect(s.academicYear).toBeUndefined();
  });

  it("ignores implausible years", () => {
    // 1850 and 3000 are out of the academic range we accept.
    expect(parseFilenameSignals("doc-1850.pdf").academicYear).toBeUndefined();
    expect(parseFilenameSignals("v2-3000.pdf").academicYear).toBeUndefined();
  });
});
