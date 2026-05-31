/**
 * Phase 1 batch-upload redesign — course inference.
 *
 * Pure, deterministic scoring of course candidates against an uploaded
 * file's name and extracted keywords. No I/O — the DB query + permission
 * scoping live in `matchCourse` (suggest-metadata.service.ts); this module
 * just ranks an already-fetched candidate list so the logic is unit-testable
 * in isolation.
 *
 * Confidence:
 *   - "high" → the course code appears as a token in the filename, OR a
 *     unique candidate matches 2+ content words of its title. The UI
 *     auto-fills the Course field.
 *   - "low"  → a single content-word match, or a tie. The UI shows a
 *     "Suggested" chip the user must confirm.
 */

export interface CourseCandidate {
  id: string;
  code: string;
  title: string;
}

export interface CourseMatch extends CourseCandidate {
  confidence: "high" | "low";
}

// Small stoplist so generic title words ("to", "the", "of", "and") and very
// short tokens can't, on their own, produce a course match.
const STOPWORDS = new Set([
  "to",
  "the",
  "of",
  "and",
  "for",
  "in",
  "on",
  "an",
  "a",
  "intro",
]);

export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

function normaliseCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function contentWords(title: string): string[] {
  return tokenize(title).filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

export function scoreCourseCandidates(
  candidates: CourseCandidate[],
  filename: string,
  keywords: string[],
): CourseMatch | undefined {
  const fileTokens = tokenize(filename);
  const fileTokenSet = new Set(fileTokens);
  const keywordSet = new Set(keywords.map((k) => k.toLowerCase()));

  // A code may be split by separators in a filename ("db-300" → ["db","300"]).
  // Build the set of concatenations of up to 3 CONSECUTIVE tokens so a code
  // like "db300" matches as a whole, WITHOUT the false positives an unbounded
  // substring scan would cause (e.g. code "cs10" must not match token "cs101").
  const joinedWindows = new Set<string>();
  for (let i = 0; i < fileTokens.length; i++) {
    let acc = "";
    for (let j = i; j < Math.min(i + 3, fileTokens.length); j++) {
      acc += fileTokens[j];
      joinedWindows.add(acc);
    }
  }

  // 1. Code match → high confidence. Course codes are unique, so at most one
  //    candidate can win here. (joinedWindows already includes single tokens.)
  for (const c of candidates) {
    const code = normaliseCode(c.code);
    if (code.length < 2) continue;
    if (joinedWindows.has(code) || keywordSet.has(code)) {
      return { ...c, confidence: "high" };
    }
  }

  // 2. Title content-word overlap.
  let best: CourseCandidate | undefined;
  let bestScore = 0;
  let tie = false;
  for (const c of candidates) {
    let score = 0;
    for (const w of contentWords(c.title)) {
      if (fileTokenSet.has(w) || keywordSet.has(w)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = c;
      tie = false;
    } else if (score === bestScore && score > 0) {
      tie = true;
    }
  }

  if (!best || bestScore === 0) return undefined;
  const confidence = bestScore >= 2 && !tie ? "high" : "low";
  return { ...best, confidence };
}
