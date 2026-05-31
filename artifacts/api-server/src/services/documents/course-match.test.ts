import { describe, expect, it } from "vitest";
import { scoreCourseCandidates, tokenize } from "./course-match";

const CANDIDATES = [
  { id: "c1", code: "CS101", title: "Introduction to Computer Science" },
  { id: "c2", code: "MATH201", title: "Linear Algebra" },
  { id: "c3", code: "DB300", title: "Database Systems" },
];

describe("tokenize", () => {
  it("lowercases and splits on non-alphanumerics", () => {
    expect(tokenize("CS101-Final_Exam.pdf")).toEqual([
      "cs101",
      "final",
      "exam",
      "pdf",
    ]);
  });
});

describe("scoreCourseCandidates", () => {
  it("returns high confidence when the course code appears in the filename", () => {
    const match = scoreCourseCandidates(CANDIDATES, "CS101-final-exam.pdf", []);
    expect(match).toEqual({
      id: "c1",
      code: "CS101",
      title: "Introduction to Computer Science",
      confidence: "high",
    });
  });

  it("matches a code even when separators split it in the filename", () => {
    const match = scoreCourseCandidates(CANDIDATES, "db-300-notes.pdf", []);
    expect(match?.id).toBe("c3");
    expect(match?.confidence).toBe("high");
  });

  it("returns high confidence on a unique 2+ word title match", () => {
    const match = scoreCourseCandidates(
      CANDIDATES,
      "database-systems-summary.pdf",
      ["database", "systems"],
    );
    expect(match?.id).toBe("c3");
    expect(match?.confidence).toBe("high");
  });

  it("returns low confidence on a single weak title-word match", () => {
    const match = scoreCourseCandidates(CANDIDATES, "algebra-notes.pdf", [
      "algebra",
    ]);
    expect(match?.id).toBe("c2");
    expect(match?.confidence).toBe("low");
  });

  it("returns undefined when nothing matches", () => {
    const match = scoreCourseCandidates(CANDIDATES, "random-file.pdf", [
      "unrelated",
    ]);
    expect(match).toBeUndefined();
  });

  it("ignores short/stopword title words so they don't inflate the score", () => {
    // "to" is a stopword, "Introduction"/"Computer"/"Science" are content
    // words. A filename with only "to" must NOT match c1.
    const match = scoreCourseCandidates(CANDIDATES, "to.pdf", ["to"]);
    expect(match).toBeUndefined();
  });
});
