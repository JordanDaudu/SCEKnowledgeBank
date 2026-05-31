# Batch Upload Redesign — Phase 1 (Per-File Cards) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single shared upload metadata form with an independent, auto-prefilled, independently-validated metadata card per file, so valid files upload immediately and invalid ones stay for correction (partial success).

**Architecture:** The upload endpoint is already per-file (one HTTP request per file, per-file results array) and the `suggest-metadata` analysis endpoint already exists — so this is ~80% a frontend restructure plus one net-new backend piece (course matching). Backend: add `matchCourse` to the suggestion service and expose `course`/`courseConfidence` in the API. Frontend: split `upload.tsx` into a page orchestrator + a `FileMetadataCard` component + a pure analysis-mapping module; give each queued file its own metadata state, run analysis per file, and upload only the files whose required fields (Course + Material Type) are filled.

**Tech Stack:** Node + Express 5 + Prisma + Vitest (api-server); Vite + React 19 + Radix UI + Tailwind + TanStack Query + generated Orval client (web); Playwright (web E2E). Monorepo via pnpm. OpenAPI spec at `lib/api-spec/openapi.yaml` with `pnpm --filter @workspace/api-spec run codegen` regenerating `lib/api-zod` + `lib/api-client-react`.

**Branch:** `feat/batch-upload-redesign` (already created; spec committed).

---

## File Structure

**Backend (create):**
- `artifacts/api-server/src/services/documents/course-match.ts` — pure course-candidate scorer (`scoreCourseCandidates`, `tokenize`). No I/O.
- `artifacts/api-server/src/services/documents/course-match.test.ts` — unit tests for the scorer.

**Backend (modify):**
- `artifacts/api-server/src/services/documents/suggest-metadata.service.ts` — add `course`/`courseConfidence` to `SuggestionResult`; add `matchCourse` (db query + permission scoping); call it in `suggestForUpload`.
- `artifacts/api-server/src/services/documents/suggest-metadata.service.test.ts` — extend the `db` mock with `course.findMany`; add a course-suggestion test.
- `lib/api-spec/openapi.yaml` — add `course` + `courseConfidence` to `SuggestMetadataResponse`.
- Generated: `lib/api-zod/**`, `lib/api-client-react/**` (via codegen, not hand-edited).

**Frontend (create):**
- `artifacts/web/src/lib/upload-analysis.ts` — pure helpers: `applySuggestion`, `isItemReady`, `missingRequiredFields`, default metadata factory.
- `artifacts/web/src/lib/upload-analysis.test.ts` — unit tests for the pure helpers.
- `artifacts/web/src/components/upload/FileMetadataCard.tsx` — presentational per-file card.

**Frontend (modify):**
- `artifacts/web/src/pages/upload.tsx` — per-file state, per-file analysis fetch, per-card submit loop; renders `FileMetadataCard`; remove the shared "Add Metadata" card.
- `artifacts/web/tests/upload-and-browse.spec.ts` — update helpers for per-card selectors; add a partial-success scenario.

---

## Task 1: Pure course-candidate scorer

**Files:**
- Create: `artifacts/api-server/src/services/documents/course-match.ts`
- Test: `artifacts/api-server/src/services/documents/course-match.test.ts`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/services/documents/course-match.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server exec vitest run src/services/documents/course-match.test.ts`
Expected: FAIL — cannot find module `./course-match`.

- [ ] **Step 3: Write minimal implementation**

Create `artifacts/api-server/src/services/documents/course-match.ts`:

```ts
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
  // Codes are often split by separators in filenames ("db-300"); collapsing
  // all tokens lets a normalised code ("db300") still be found as a substring.
  const collapsed = fileTokens.join("");
  const keywordSet = new Set(keywords.map((k) => k.toLowerCase()));

  // 1. Code match → high confidence. Course codes are unique, so at most one
  //    candidate can win here.
  for (const c of candidates) {
    const code = normaliseCode(c.code);
    if (code.length < 2) continue;
    if (fileTokenSet.has(code) || collapsed.includes(code) || keywordSet.has(code)) {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server exec vitest run src/services/documents/course-match.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/services/documents/course-match.ts artifacts/api-server/src/services/documents/course-match.test.ts
git commit -m "feat(api): pure course-candidate scorer for upload suggestions"
```

---

## Task 2: Wire `matchCourse` into the suggestion service

**Files:**
- Modify: `artifacts/api-server/src/services/documents/suggest-metadata.service.ts`
- Test: `artifacts/api-server/src/services/documents/suggest-metadata.service.test.ts`

- [ ] **Step 1: Write the failing test**

Edit `artifacts/api-server/src/services/documents/suggest-metadata.service.test.ts`.

First, extend the `@workspace/db` mock (top of file) to include `course.findMany`:

```ts
vi.mock("@workspace/db", () => ({
  db: {
    tag: { findMany: vi.fn() },
    category: { findFirst: vi.fn() },
    course: { findMany: vi.fn() },
  },
}));
```

Add a mocked handle near the other `vi.mocked(...)` lines:

```ts
const courseFindMany = vi.mocked(db.course.findMany);
```

In the `beforeEach`, reset it (default: no courses):

```ts
  courseFindMany.mockReset();
  courseFindMany.mockResolvedValue([]);
```

Then add this test inside `describe("suggestForUpload", ...)`:

```ts
  it("suggests a high-confidence course when the code matches the filename", async () => {
    extractMock.mockResolvedValue({});
    courseFindMany.mockResolvedValue([
      { id: "course-1", code: "CS101", title: "Intro to CS" },
    ] as never);

    const res = await suggestForUpload(
      {
        buffer: Buffer.from("x"),
        mimeType: "application/pdf",
        filename: "CS101-notes.pdf",
      },
      user, // lecturer in the fixture → admin path queries all courses
    );

    expect(res.course).toEqual({
      id: "course-1",
      code: "CS101",
      title: "Intro to CS",
    });
    expect(res.courseConfidence).toBe("high");
  });
```

Note: the fixture `user` has `roles: ["lecturer"]` and empty `enrollments`. For the test we exercise the admin/all-courses branch by also giving the lecturer no enrollment filter — see Step 3, where non-admins are scoped to enrolled courses. To keep this test on the simple "all courses" path, change the fixture user's roles to include admin **for this one assertion** is undesirable; instead the implementation in Step 3 scopes non-admins to enrolled courses, so update the fixture to enroll the user in `course-1`:

```ts
const user = {
  id: "u1",
  email: "u1@x.com",
  displayName: "u1",
  isActive: true,
  primaryRole: "lecturer",
  roles: ["lecturer"],
  enrollments: [{ courseId: "course-1", roleInCourse: "lecturer" }],
} as unknown as AuthenticatedUser;
```

(This keeps the existing tests passing — they don't assert on `course` — while giving the new test a course the lecturer teaches.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server exec vitest run src/services/documents/suggest-metadata.service.test.ts`
Expected: FAIL — `res.course` is `undefined` (matchCourse not implemented yet).

- [ ] **Step 3: Write the implementation**

Edit `artifacts/api-server/src/services/documents/suggest-metadata.service.ts`.

Add imports near the top (after the existing imports):

```ts
import * as permissions from "../permissions.service";
import {
  scoreCourseCandidates,
  type CourseCandidate,
  type CourseMatch,
} from "./course-match";
```

Extend the `SuggestionResult` interface — add these properties (place them after `academicYear`):

```ts
  /** Best-guess course, scoped to courses the user can upload to. */
  course?: { id: string; code: string; title: string };
  /**
   * Confidence of `course`:
   *   - "high" → code match / unique strong title match (UI auto-fills)
   *   - "low"  → weak/ambiguous match (UI shows a confirmable chip)
   */
  courseConfidence?: "high" | "low";
```

Add the `matchCourse` function (above `suggestForUpload`):

```ts
/**
 * Infer a course for the upload, scoped to courses the user may upload to:
 * admins match against every course; everyone else is limited to their
 * enrolled courses (and re-checked with `canUploadToCourse` so a stale
 * student enrollment can't suggest a course they actually can't post to).
 * Pure ranking is delegated to `scoreCourseCandidates`.
 */
async function matchCourse(
  filename: string,
  keywords: string[],
  user: AuthenticatedUser,
): Promise<CourseMatch | undefined> {
  let candidates: CourseCandidate[];

  if (user.roles.includes("admin")) {
    candidates = await db.course.findMany({
      select: { id: true, code: true, title: true },
    });
  } else {
    const enrolledIds = user.enrollments.map((e) => e.courseId);
    if (enrolledIds.length === 0) return undefined;
    const rows = await db.course.findMany({
      where: { id: { in: enrolledIds } },
      select: { id: true, code: true, title: true },
    });
    candidates = rows.filter((c) => permissions.canUploadToCourse(user, c.id));
  }

  if (candidates.length === 0) return undefined;
  return scoreCourseCandidates(candidates, filename, keywords);
}
```

In `suggestForUpload`, after the block that sets filename signals (the `parseFilenameSignals` section, just before `return result;`), add:

```ts
  // Phase 1 batch redesign: course inference (scoped to uploadable courses).
  const course = await matchCourse(input.filename, keywords, user);
  if (course) {
    result.course = { id: course.id, code: course.code, title: course.title };
    result.courseConfidence = course.confidence;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server exec vitest run src/services/documents/suggest-metadata.service.test.ts`
Expected: PASS (all existing tests + the new course test).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/services/documents/suggest-metadata.service.ts artifacts/api-server/src/services/documents/suggest-metadata.service.test.ts
git commit -m "feat(api): course matching in suggest-metadata (scoped to uploadable courses)"
```

---

## Task 3: Expose `course`/`courseConfidence` in the API contract

**Files:**
- Modify: `lib/api-spec/openapi.yaml:1857-1886`
- Generated: `lib/api-zod/**`, `lib/api-client-react/**`

- [ ] **Step 1: Edit the OpenAPI schema**

In `lib/api-spec/openapi.yaml`, in the `SuggestMetadataResponse` schema, after the `academicYear: { type: integer }` line, add:

```yaml
        course:
          type: object
          required: [id, code, title]
          properties:
            id: { type: string, format: uuid }
            code: { type: string }
            title: { type: string }
        courseConfidence: { type: string, enum: [high, low] }
```

- [ ] **Step 2: Regenerate the clients**

Run: `pnpm --filter @workspace/api-spec run codegen`
Expected: orval regenerates `lib/api-zod` + `lib/api-client-react`, then `typecheck:libs` passes with no errors.

- [ ] **Step 3: Verify the generated type carries the new fields**

Run: `git grep -n "courseConfidence" lib/api-zod lib/api-client-react`
Expected: at least one hit (the generated `SuggestMetadataResponse` type now includes `course` and `courseConfidence`).

- [ ] **Step 4: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react
git commit -m "feat(api): openapi course suggestion fields; regen clients"
```

---

## Task 4: Pure frontend analysis helpers

**Files:**
- Create: `artifacts/web/src/lib/upload-analysis.ts`
- Test: `artifacts/web/src/lib/upload-analysis.test.ts`

- [ ] **Step 1: Write the failing test**

Create `artifacts/web/src/lib/upload-analysis.test.ts`:

```ts
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
    expect(applySuggestion(meta(), s)).toEqual({
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
    expect(applySuggestion(meta(), high)).toEqual({ courseId: "c1" });

    const low = {
      keywords: [],
      tags: [],
      course: { id: "c1", code: "CS101", title: "Intro" },
      courseConfidence: "low",
    } as SuggestMetadataResponse;
    expect(applySuggestion(meta(), low)).toEqual({});
  });

  it("prefills the title only from embedded metadata, not the filename", () => {
    const fromMeta = {
      keywords: [],
      tags: [],
      title: "Real Title",
      titleSource: "metadata",
    } as SuggestMetadataResponse;
    expect(applySuggestion(meta(), fromMeta)).toEqual({ title: "Real Title" });

    const fromName = {
      keywords: [],
      tags: [],
      title: "Guessed",
      titleSource: "filename",
    } as SuggestMetadataResponse;
    expect(applySuggestion(meta(), fromName)).toEqual({});
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
    expect(applySuggestion(filled, s)).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/web exec vitest run src/lib/upload-analysis.test.ts`
Expected: FAIL — cannot find module `./upload-analysis`.

- [ ] **Step 3: Write the implementation**

Create `artifacts/web/src/lib/upload-analysis.ts`:

```ts
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
```

Note on the `academicYear` guard: `defaultItemMeta(meta.academicYear).academicYear` returns exactly `meta.academicYear`, so the comparison is "has the user changed it from the year it was seeded with?" Since seeding uses the current year and analysis runs immediately after add (before the user edits), this replaces the seeded year with the filename year when present. If the user already typed a different year, it is preserved.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/web exec vitest run src/lib/upload-analysis.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/web/src/lib/upload-analysis.ts artifacts/web/src/lib/upload-analysis.test.ts
git commit -m "feat(web): pure per-file upload analysis/validation helpers"
```

---

## Task 5: `FileMetadataCard` component

**Files:**
- Create: `artifacts/web/src/components/upload/FileMetadataCard.tsx`

This is a presentational component (no component-test framework is configured in web; it is covered by the Playwright E2E in Task 7). Build it complete and wire it in Task 6.

- [ ] **Step 1: Create the component**

Create `artifacts/web/src/components/upload/FileMetadataCard.tsx`:

```tsx
import { useState } from "react";
import type { SuggestMetadataResponse } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  File as FileIcon,
  X,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Clock,
  RotateCcw,
  Sparkles,
  ChevronDown,
} from "lucide-react";
import { MATERIAL_TYPES } from "@/lib/material-types";
import {
  type ItemMeta,
  type Semester,
  type Visibility,
  isItemReady,
  missingRequiredFields,
} from "@/lib/upload-analysis";

export type ItemStatus = "queued" | "uploading" | "success" | "failed";

export interface CardItem extends ItemMeta {
  id: string;
  filename: string;
  sizeBytes: number;
  status: ItemStatus;
  progress: number;
  error?: string;
  errorCode?: string;
  displayFilename?: string;
  duplicateOfDocumentId?: string;
  duplicateOfTitle?: string;
  suggestion?: SuggestMetadataResponse | null;
  analyzing: boolean;
}

interface Course {
  id: string;
  code: string;
  title: string;
}
interface NamedRow {
  id: string;
  name: string;
}

interface Props {
  item: CardItem;
  courses: Course[] | undefined;
  categories: NamedRow[] | undefined;
  availableTags: NamedRow[] | undefined;
  disabled: boolean;
  onChange: (patch: Partial<ItemMeta>) => void;
  onRemove: () => void;
  onRetry: () => void;
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function FileMetadataCard({
  item,
  courses,
  categories,
  availableTags,
  disabled,
  onChange,
  onRemove,
  onRetry,
}: Props) {
  const [showMore, setShowMore] = useState(false);
  const ready = isItemReady(item);
  const missing = missingRequiredFields(item);
  const s = item.suggestion;

  const toggleTag = (tagId: string) => {
    const next = item.tagIds.includes(tagId)
      ? item.tagIds.filter((t) => t !== tagId)
      : [...item.tagIds, tagId];
    onChange({ tagIds: next });
  };

  return (
    <Card data-testid={`file-card upload-item-${item.status}`}>
      <CardContent className="py-4 space-y-3">
        {/* Header: filename + status */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <FileIcon className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{item.filename}</p>
              <p className="text-xs text-muted-foreground">
                {formatMb(item.sizeBytes)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {item.analyzing && (
              <Badge variant="outline" className="gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Analyzing…
              </Badge>
            )}
            {!item.analyzing && item.status === "queued" && ready && (
              <Badge variant="outline" className="gap-1" data-testid="card-ready">
                <CheckCircle2 className="h-3 w-3 text-green-600" /> Ready
              </Badge>
            )}
            {!item.analyzing && item.status === "queued" && !ready && (
              <Badge
                variant="outline"
                className="gap-1 border-amber-400 text-amber-700"
                data-testid="card-needs-info"
              >
                <AlertTriangle className="h-3 w-3" /> Needs info
              </Badge>
            )}
            {item.status === "uploading" && (
              <Badge variant="outline" className="gap-1">
                <Clock className="h-3 w-3" /> {item.progress}%
              </Badge>
            )}
            {item.status === "success" && (
              <Badge
                variant="default"
                className="gap-1 bg-green-600 hover:bg-green-600"
              >
                <CheckCircle2 className="h-3 w-3" /> Uploaded
              </Badge>
            )}
            {item.status === "failed" && (
              <Badge variant="destructive" className="gap-1">
                <AlertCircle className="h-3 w-3" /> Failed
              </Badge>
            )}
            {item.status === "failed" && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onRetry}
                className="h-7 w-7"
                aria-label="Retry upload"
                data-testid="upload-retry"
                disabled={disabled}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            )}
            {item.status !== "uploading" && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onRemove}
                className="h-7 w-7"
                aria-label="Remove file"
                disabled={disabled}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Required fields — always visible while editable */}
        {(item.status === "queued" || item.status === "failed") && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Course *</label>
                <Select
                  value={item.courseId}
                  onValueChange={(v) => onChange({ courseId: v })}
                  disabled={disabled}
                >
                  <SelectTrigger data-testid="card-course-select">
                    <SelectValue placeholder="Select course" />
                  </SelectTrigger>
                  <SelectContent>
                    {courses?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.code} - {c.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Material Type *</label>
                <Select
                  value={item.materialType}
                  onValueChange={(v) => onChange({ materialType: v })}
                  disabled={disabled}
                >
                  <SelectTrigger data-testid="card-type-select">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {MATERIAL_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Low-confidence + secondary suggestion chips */}
            {s && (
              <SuggestionChips
                suggestion={s}
                item={item}
                onChange={onChange}
                toggleTag={toggleTag}
              />
            )}

            {/* Collapsible optional metadata */}
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowMore((v) => !v)}
            >
              <ChevronDown
                className={`h-3 w-3 transition-transform ${showMore ? "rotate-180" : ""}`}
              />
              More details
            </button>
            {showMore && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Category</label>
                  <Select
                    value={item.categoryId || "none"}
                    onValueChange={(v) =>
                      onChange({ categoryId: v === "none" ? "" : v })
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {categories?.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Visibility</label>
                  <Select
                    value={item.visibility}
                    onValueChange={(v) =>
                      onChange({ visibility: v as Visibility })
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Visibility" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">Public (Everyone)</SelectItem>
                      <SelectItem value="restricted">
                        Restricted (Enrolled only)
                      </SelectItem>
                      <SelectItem value="private">Private (Only me)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Semester</label>
                  <Select
                    value={item.semester || "none"}
                    onValueChange={(v) =>
                      onChange({ semester: v === "none" ? "" : (v as Semester) })
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select semester" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="fall">Fall</SelectItem>
                      <SelectItem value="spring">Spring</SelectItem>
                      <SelectItem value="summer">Summer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Academic Year</label>
                  <Input
                    type="number"
                    value={item.academicYear}
                    onChange={(e) => onChange({ academicYear: e.target.value })}
                    placeholder="e.g. 2024"
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-medium">Title</label>
                  <Input
                    type="text"
                    value={item.title}
                    onChange={(e) => onChange({ title: e.target.value })}
                    placeholder="Defaults to the filename if blank"
                    maxLength={300}
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-medium">Tags</label>
                  <div className="flex flex-wrap gap-2">
                    {availableTags?.map((tag) => {
                      const active = item.tagIds.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => toggleTag(tag.id)}
                          disabled={disabled}
                          className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                            active
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background text-foreground border-border hover:border-primary/40"
                          }`}
                        >
                          {tag.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Needs-info hint */}
            {item.status === "queued" && !ready && !item.analyzing && (
              <p
                className="text-xs text-amber-700"
                data-testid="card-missing"
              >
                {missing.map((f) => `${f} is required.`).join(" ")}
              </p>
            )}

            {/* Advisory duplicate warning from analysis */}
            {s?.duplicate && (
              <p
                className="text-xs text-amber-700"
                data-testid="card-duplicate-warning"
              >
                Possible duplicate of{" "}
                <a
                  href={`/documents/${s.duplicate.documentId}`}
                  className="underline font-medium"
                >
                  {s.duplicate.title}
                </a>
                .
              </p>
            )}
          </>
        )}

        {/* Failed: server/network error + duplicate link */}
        {item.status === "failed" && item.error && (
          <p className="text-xs text-destructive" data-testid="upload-error">
            {item.error}
            {item.errorCode === "duplicate_file" &&
              item.duplicateOfDocumentId && (
                <>
                  {" "}
                  <a
                    href={`/documents/${item.duplicateOfDocumentId}`}
                    className="underline font-medium"
                    data-testid="duplicate-link"
                  >
                    View original
                    {item.duplicateOfTitle ? ` "${item.duplicateOfTitle}"` : ""}
                  </a>
                </>
              )}
          </p>
        )}

        {/* Success: server rename notice */}
        {item.status === "success" &&
          item.displayFilename &&
          item.displayFilename !== item.filename && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="upload-rename"
            >
              Uploaded as{" "}
              <span className="font-mono">{item.displayFilename}</span> to avoid
              a duplicate name.
            </p>
          )}
      </CardContent>
    </Card>
  );
}

function SuggestionChips({
  suggestion: s,
  item,
  onChange,
  toggleTag,
}: {
  suggestion: SuggestMetadataResponse;
  item: CardItem;
  onChange: (patch: Partial<ItemMeta>) => void;
  toggleTag: (tagId: string) => void;
}) {
  const showCourseChip =
    s.course && s.courseConfidence === "low" && item.courseId !== s.course.id;
  const showCategoryChip = s.category && item.categoryId !== s.category.id;
  const suggestedTags = (s.tags ?? []).filter(
    (t) => !item.tagIds.includes(t.id),
  );

  if (!showCourseChip && !showCategoryChip && suggestedTags.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/20 bg-primary/5 p-2">
      <Sparkles className="h-3.5 w-3.5 text-primary" />
      {showCourseChip && s.course && (
        <Badge
          variant="outline"
          className="cursor-pointer"
          onClick={() => onChange({ courseId: s.course!.id })}
          data-testid="suggestion-course"
        >
          Suggested course: {s.course.code} - {s.course.title}
        </Badge>
      )}
      {showCategoryChip && s.category && (
        <Badge
          variant="outline"
          className="cursor-pointer"
          onClick={() => onChange({ categoryId: s.category!.id })}
          data-testid="suggestion-category"
        >
          + {s.category.name}
        </Badge>
      )}
      {suggestedTags.map((t) => (
        <Badge
          key={t.id}
          variant="outline"
          className="cursor-pointer"
          onClick={() => toggleTag(t.id)}
          data-testid="suggestion-tag"
        >
          + {t.name}
        </Badge>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck the component**

Run: `pnpm --filter @workspace/web exec tsc --noEmit`
Expected: PASS (no type errors). The component is not yet imported anywhere — that happens in Task 6.

- [ ] **Step 3: Commit**

```bash
git add artifacts/web/src/components/upload/FileMetadataCard.tsx
git commit -m "feat(web): per-file FileMetadataCard component"
```

---

## Task 6: Refactor `upload.tsx` to per-file cards

**Files:**
- Modify: `artifacts/web/src/pages/upload.tsx` (full rewrite of the component body)

- [ ] **Step 1: Rewrite the page**

Replace the entire contents of `artifacts/web/src/pages/upload.tsx` with:

```tsx
import { useState, useRef, useMemo } from "react";
import {
  useListCourses,
  useListCategories,
  useListTags,
  useGetMyStorageQuota,
  useGetCurrentUser,
  getGetMyStorageQuotaQueryKey,
  getListDocumentsQueryKey,
  getListRecentDocumentsQueryKey,
  suggestDocumentMetadata,
  type Document as ApiDocument,
  type UploadResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { UploadCloud, Loader2, AlertTriangle, HardDrive, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiEndpoints } from "@/lib/api-url";
import { isUnlimitedQuota } from "@/lib/format";
import {
  FileMetadataCard,
  type CardItem,
} from "@/components/upload/FileMetadataCard";
import {
  applySuggestion,
  defaultItemMeta,
  isItemReady,
  type ItemMeta,
} from "@/lib/upload-analysis";

const MAX_UPLOAD_MB = Number(import.meta.env.VITE_MAX_UPLOAD_MB ?? 50);
const MAX_FILE_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const ALLOWED_EXTENSIONS = [
  "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx",
  "txt", "md", "csv", "png", "jpg", "jpeg", "zip",
];

interface QueueItem extends CardItem {
  file: File;
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function validateFile(file: File): string | null {
  if (file.size > MAX_FILE_BYTES) {
    return `File exceeds ${MAX_UPLOAD_MB}MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB).`;
  }
  if (file.size === 0) return "File is empty.";
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return `Unsupported file type ".${ext || "unknown"}". Allowed: ${ALLOWED_EXTENSIONS.join(", ")}.`;
  }
  return null;
}

interface UploadHandle {
  promise: Promise<UploadResult>;
  abort: () => void;
}

function uploadOne(
  file: File,
  fields: Record<string, string | undefined>,
  tagIds: string[],
  onProgress: (pct: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<UploadResult>((resolve, reject) => {
    const form = new FormData();
    form.append("files", file);
    for (const [k, v] of Object.entries(fields)) {
      if (v != null && v !== "") form.append(k, v);
    }
    for (const t of tagIds) form.append("tagIds", t);
    xhr.open("POST", apiEndpoints.uploadDocuments());
    xhr.withCredentials = true;
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new Error("Upload failed due to network error"));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as UploadResult);
      } else {
        const data = xhr.response as { error?: { message?: string } } | null;
        reject(new Error(data?.error?.message || `HTTP ${xhr.status}`));
      }
    };
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

export default function Upload() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const analysisAbortsRef = useRef<Map<string, AbortController>>(new Map());

  const currentYear = new Date().getFullYear().toString();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [autoSubmitForReview, setAutoSubmitForReview] = useState(true);

  const { data: user } = useGetCurrentUser();
  const { data: allCourses } = useListCourses();
  const { data: categories } = useListCategories();
  const { data: availableTags } = useListTags();
  const { data: quota } = useGetMyStorageQuota();

  const isStudentUploader =
    !!user && !user.roles.includes("admin") && !user.roles.includes("lecturer");

  const courses = useMemo(() => {
    if (!allCourses) return undefined;
    if (!isStudentUploader || !user) return allCourses;
    const enrolledIds = new Set(user.enrollments.map((e) => e.courseId));
    return allCourses.filter((c) => enrolledIds.has(c.id));
  }, [allCourses, isStudentUploader, user]);

  const updateItem = (id: string, patch: Partial<QueueItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const analyzeItem = (id: string, file: File) => {
    const controller = new AbortController();
    analysisAbortsRef.current.set(id, controller);
    suggestDocumentMetadata(
      { file },
      { signal: controller.signal, credentials: "include" },
    )
      .then((suggestion) => {
        if (controller.signal.aborted) return;
        // Apply auto-fill against the item's CURRENT meta so we never clobber
        // edits the user made while analysis was in flight.
        setItems((prev) =>
          prev.map((it) =>
            it.id === id
              ? { ...it, suggestion, analyzing: false, ...applySuggestion(it, suggestion) }
              : it,
          ),
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) updateItem(id, { analyzing: false });
      })
      .finally(() => {
        analysisAbortsRef.current.delete(id);
      });
  };

  const addFiles = (files: File[]) => {
    const next: QueueItem[] = files.map((file) => {
      const err = validateFile(file);
      const meta: ItemMeta = defaultItemMeta(currentYear);
      return {
        ...meta,
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        filename: file.name,
        sizeBytes: file.size,
        status: err ? "failed" : "queued",
        progress: 0,
        error: err ?? undefined,
        errorCode: err ? "client_validation" : undefined,
        suggestion: null,
        analyzing: !err,
      };
    });
    setItems((prev) => [...prev, ...next]);
    // Kick off analysis for each newly added, client-valid file. Browser
    // connection limits provide natural throttling for large batches.
    for (const it of next) {
      if (it.status === "queued") analyzeItem(it.id, it.file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files?.length) addFiles(Array.from(e.dataTransfer.files));
  };
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) addFiles(Array.from(e.target.files));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeItem = (id: string) => {
    analysisAbortsRef.current.get(id)?.abort();
    analysisAbortsRef.current.delete(id);
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const retryItem = (id: string) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const err = validateFile(it.file);
        return {
          ...it,
          status: err ? "failed" : "queued",
          progress: 0,
          error: err ?? undefined,
          errorCode: err ? "client_validation" : undefined,
          duplicateOfDocumentId: undefined,
          duplicateOfTitle: undefined,
        };
      }),
    );
  };

  const readyCount = useMemo(
    () => items.filter((i) => i.status === "queued" && isItemReady(i)).length,
    [items],
  );
  const needsInfoCount = useMemo(
    () => items.filter((i) => i.status === "queued" && !isItemReady(i)).length,
    [items],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const toUpload = items.filter(
      (i) => i.status === "queued" && isItemReady(i),
    );
    if (toUpload.length === 0) {
      toast({
        variant: "destructive",
        title: "Nothing ready to upload",
        description: "Fill in Course and Material Type on at least one file.",
      });
      return;
    }

    setIsUploading(true);
    let okCount = 0;
    let failCount = 0;

    for (const item of toUpload) {
      const fields: Record<string, string | undefined> = {
        courseId: item.courseId,
        categoryId: item.categoryId || undefined,
        materialType: item.materialType,
        visibility: item.visibility,
        semester: item.semester || undefined,
        academicYear: item.academicYear || undefined,
        title: item.title.trim() || undefined,
        autoSubmitForReview:
          isStudentUploader && autoSubmitForReview ? "true" : undefined,
      };
      updateItem(item.id, { status: "uploading", progress: 0, error: undefined });
      const handle = uploadOne(item.file, fields, item.tagIds, (pct) =>
        updateItem(item.id, { progress: pct }),
      );
      try {
        const result = await handle.promise;
        const fileResult = result.results[0];
        if (fileResult?.success && fileResult.document) {
          const doc = fileResult.document as ApiDocument;
          okCount++;
          updateItem(item.id, {
            status: "success",
            progress: 100,
            displayFilename: doc.file?.displayFilename,
          });
        } else {
          failCount++;
          updateItem(item.id, {
            status: "failed",
            error: fileResult?.error || "Upload rejected by server",
            errorCode: fileResult?.errorCode,
            duplicateOfDocumentId: fileResult?.duplicateOfDocumentId,
            duplicateOfTitle: fileResult?.duplicateOfTitle,
          });
        }
      } catch (err) {
        failCount++;
        updateItem(item.id, {
          status: "failed",
          error: err instanceof Error ? err.message : "Upload failed",
          errorCode: "network",
        });
      }
    }

    setIsUploading(false);
    await queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getListRecentDocumentsQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getGetMyStorageQuotaQueryKey() });

    if (okCount > 0) {
      toast({
        title: `Uploaded ${okCount} file${okCount === 1 ? "" : "s"}`,
        description: failCount > 0 ? `${failCount} failed — see per-file errors.` : "",
      });
    }
    if (failCount > 0 && okCount === 0) {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: "See per-file errors below.",
      });
    }
    // Navigate away only when everything that was attempted succeeded AND
    // nothing still needs info on screen.
    if (failCount === 0 && okCount > 0 && needsInfoCount === 0) {
      setTimeout(() => setLocation("/browse"), 1500);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">Upload Materials</h1>
        <p className="text-muted-foreground mt-1">
          Each file gets its own details. Files with Course and Material Type filled in upload right away.
        </p>
      </div>

      {quota && (
        <Card data-testid="storage-quota-strip">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-primary/8 text-primary shrink-0 mt-0.5">
                <HardDrive className="h-4 w-4" />
              </div>
              <div className="flex-1 space-y-2 min-w-0">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Storage quota</span>
                  {isUnlimitedQuota(quota.quotaBytes) ? (
                    <span className="text-muted-foreground text-xs tabular-nums">
                      <span data-testid="quota-used">{formatBytes(quota.usedBytes)}</span>
                      {" used · "}
                      <span data-testid="quota-total" className="text-primary/80 font-medium">Unlimited</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs tabular-nums">
                      <span data-testid="quota-used">{formatBytes(quota.usedBytes)}</span>
                      {" / "}
                      <span data-testid="quota-total">{formatBytes(quota.quotaBytes)}</span>
                      {" · "}
                      <span data-testid="quota-remaining" className="text-primary/80 font-medium">{formatBytes(quota.remainingBytes)}</span>
                      {" free"}
                    </span>
                  )}
                </div>
                {!isUnlimitedQuota(quota.quotaBytes) && (
                  <Progress
                    value={quota.quotaBytes > 0 ? Math.min(100, (quota.usedBytes / quota.quotaBytes) * 100) : 0}
                    className="h-1.5"
                  />
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isStudentUploader && (
        <div
          className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm"
          data-testid="upload-student-notice"
        >
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <span className="font-medium">Student uploads require lecturer or admin approval before they appear publicly.</span>{" "}
            <span className="text-muted-foreground">
              You can only upload to courses you are enrolled in.
            </span>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold border border-primary/20">1</span>
              <div>
                <CardTitle>Select Files</CardTitle>
                <CardDescription className="mt-0.5">
                  Drag & drop or click to browse. PDF, DOCX, PPTX, XLSX, images — up to {MAX_UPLOAD_MB}MB each.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div
              className="border-2 border-dashed border-primary/30 rounded-xl p-8 text-center hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer group"
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              data-testid="upload-dropzone"
            >
              <div className="mx-auto mb-4 h-14 w-14 rounded-xl bg-primary/8 flex items-center justify-center group-hover:bg-primary/12 transition-colors">
                <UploadCloud className="h-7 w-7 text-primary" />
              </div>
              <p className="font-semibold text-foreground">Click to browse or drag files here</p>
              <p className="text-sm text-muted-foreground mt-1.5">
                PDF, DOCX, PPTX, XLSX, PNG, JPG, ZIP · up to {MAX_UPLOAD_MB}MB per file
              </p>
              <input type="file" multiple className="hidden" ref={fileInputRef} onChange={handleFileSelect} />
            </div>
          </CardContent>
        </Card>

        {items.length > 0 && (
          <div className="space-y-3" data-testid="upload-queue">
            {items.map((item) => (
              <FileMetadataCard
                key={item.id}
                item={item}
                courses={courses}
                categories={categories}
                availableTags={availableTags}
                disabled={isUploading}
                onChange={(patch) => updateItem(item.id, patch)}
                onRemove={() => removeItem(item.id)}
                onRetry={() => retryItem(item.id)}
              />
            ))}
          </div>
        )}

        {isStudentUploader && items.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border bg-secondary/40 px-3 py-2" data-testid="upload-autosubmit-row">
            <input
              id="upload-autosubmit"
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={autoSubmitForReview}
              onChange={(e) => setAutoSubmitForReview(e.target.checked)}
              data-testid="upload-autosubmit"
            />
            <label htmlFor="upload-autosubmit" className="text-sm flex-1 cursor-pointer">
              <span className="font-medium">Submit for review immediately after upload</span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                Recommended. Uncheck to keep documents as drafts and submit later.
              </span>
            </label>
          </div>
        )}

        <div className="space-y-4 border-t pt-6">
          <div className="flex items-center gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold border border-primary/20">2</span>
            <div>
              <p className="text-sm font-semibold text-foreground">Review & Upload</p>
              <p className="text-xs text-muted-foreground">
                {items.length === 0
                  ? "Add files above to continue"
                  : `${readyCount} ready · ${needsInfoCount} need${needsInfoCount === 1 ? "s" : ""} info`}
              </p>
            </div>
          </div>
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setLocation("/")} disabled={isUploading}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="lg"
              disabled={readyCount === 0 || isUploading}
              data-testid="upload-submit"
              className="sm:min-w-[180px]"
            >
              {isUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isUploading ? "Uploading…" : `Upload ${readyCount} ${readyCount === 1 ? "File" : "Files"}`}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
```

Notes on intentional changes from the old page:
- The shared "Add Metadata" card and shared form state are gone; metadata lives per card.
- The cancel-mid-flight / cancel-all controls from the old page are dropped for Phase 1 (the loop awaits each file; per-file retry covers failures). This keeps the page focused; re-introducing live cancel is a candidate for Phase 2 if needed.
- `RotateCcw` is imported but retry now lives inside the card; the page-level "retry all" banner is removed. If `tsc` flags `RotateCcw` as unused, remove it from the import.

- [ ] **Step 2: Typecheck and unit tests**

Run: `pnpm --filter @workspace/web exec tsc --noEmit`
Expected: PASS. (If `RotateCcw` is reported unused, delete it from the lucide-react import line and re-run.)

Run: `pnpm --filter @workspace/web run test`
Expected: PASS (existing web unit tests + `upload-analysis.test.ts`).

- [ ] **Step 3: Commit**

```bash
git add artifacts/web/src/pages/upload.tsx
git commit -m "feat(web): per-file metadata cards + partial-success upload"
```

---

## Task 7: Update + extend Playwright E2E

**Files:**
- Modify: `artifacts/web/tests/upload-and-browse.spec.ts`

The refactor scopes the Course/Type selects inside each file card, so the shared-form helper must target a specific card. Add a partial-success scenario.

- [ ] **Step 1: Update the course/type helper to target a card**

In `artifacts/web/tests/upload-and-browse.spec.ts`, replace `pickFirstCourseAndLectureNotes` with a card-scoped version:

```ts
async function fillCardCourseAndType(
  page: Page,
  cardIndex = 0,
): Promise<void> {
  const card = page.locator('[data-testid^="file-card"]').nth(cardIndex);
  // Course * select within this card.
  await card.getByTestId("card-course-select").click();
  await page.getByRole("option").first().click();
  // Material Type *
  await card.getByTestId("card-type-select").click();
  await page.getByRole("option", { name: /lecture notes/i }).click();
}
```

Then update the three call sites (`pickFirstCourseAndLectureNotes(page)` → `fillCardCourseAndType(page)`) in the "valid file uploads", "duplicate filename", and any other tests that referenced it.

- [ ] **Step 2: Add the partial-success test**

Add this test inside `test.describe("upload page", ...)`:

```ts
  test("uploads ready files and leaves needs-info files on screen", async ({
    page,
  }) => {
    await page.goto("/upload");
    const input = page.locator(
      '[data-testid="upload-dropzone"] input[type="file"]',
    );

    const a = `ready-${randomUUID().slice(0, 8)}.txt`;
    const b = `incomplete-${randomUUID().slice(0, 8)}.txt`;
    await input.setInputFiles([
      { name: a, mimeType: "text/plain", buffer: Buffer.from(`A ${randomUUID()}`) },
      { name: b, mimeType: "text/plain", buffer: Buffer.from(`B ${randomUUID()}`) },
    ]);

    // Two cards appear; fill required fields on the FIRST only.
    await expect(page.locator('[data-testid^="file-card"]')).toHaveCount(2);
    await fillCardCourseAndType(page, 0);

    // Button reflects exactly one ready file.
    await expect(page.getByTestId("upload-submit")).toHaveText(/Upload 1 File/i);
    await page.getByTestId("upload-submit").click();

    // The ready file succeeds; the incomplete one stays as needs-info.
    await expect(
      page.locator('[data-testid="upload-item-success"]'),
    ).toHaveCount(1, { timeout: 20_000 });
    await expect(page.getByTestId("card-needs-info")).toBeVisible();
    await expect(page.getByTestId("card-missing")).toContainText(/Course is required/i);
  });
```

- [ ] **Step 3: Run the E2E suite**

Run (requires dev API + web servers running per the project's E2E workflow): `pnpm --filter @workspace/web run test:e2e`
Expected: PASS — including the updated existing tests and the new partial-success test.

If the dev servers are not running in this environment, document that the test was not executed and run it during integration. Do not mark Step 3 complete without observing a pass.

- [ ] **Step 4: Commit**

```bash
git add artifacts/web/tests/upload-and-browse.spec.ts
git commit -m "test(web): per-card upload E2E + partial-success scenario"
```

---

## Task 8: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: API server typecheck + tests**

Run: `pnpm --filter @workspace/api-server exec tsc --noEmit`
Expected: PASS.

Run: `pnpm --filter @workspace/api-server run test`
Expected: PASS (includes `course-match.test.ts` and the extended `suggest-metadata.service.test.ts`).

- [ ] **Step 2: Web typecheck + unit tests**

Run: `pnpm --filter @workspace/web exec tsc --noEmit`
Expected: PASS.

Run: `pnpm --filter @workspace/web run test`
Expected: PASS.

- [ ] **Step 3: Lint (if the repo lints in CI)**

Run: `pnpm -w run lint` (or the repo's configured lint script)
Expected: PASS. Fix any new lint errors introduced by the new files.

- [ ] **Step 4: Final confirmation**

Confirm the branch builds clean and all task commits are present:

Run: `git -C . log --oneline feat/batch-upload-redesign -10`
Expected: spec + plan + the 7 implementation commits from Tasks 1–7.

---

## Self-Review (completed against the spec)

**Spec coverage:**
- Per-file metadata card → Task 5 (`FileMetadataCard`), Task 6 (rendered per item). ✓
- Backend per-file extraction reused → existing `suggest-metadata`, fired per file in Task 6. ✓
- Auto-prefill on high confidence; suggest on low → Task 4 (`applySuggestion`) + Task 5 (chips). ✓
- Net-new course matching scoped to uploadable courses → Tasks 1–2. ✓
- Only Course + Material Type required → Task 4 (`isItemReady`/`missingRequiredFields`), Task 6 (gating). ✓
- Valid files upload immediately; invalid stay → Task 6 (`toUpload` filter; needs-info untouched). ✓
- Partial success + file-level errors → Task 6 (existing per-file response mapping), Task 7 (E2E). ✓
- Per-file duplicate warning (advisory) + existing server hard-block error → Task 5 (`card-duplicate-warning`, `duplicate_file` link). ✓
- API contract exposes course fields → Task 3. ✓
- No upload-endpoint change → confirmed; Task 6 sends per-card fields through existing fields. ✓
- Phase-2 items (bulk-apply, grouping, aggregate progress, duplicate resolution) → intentionally absent. ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code; commands have expected output. ✓

**Type consistency:** `ItemMeta` (Task 4) is extended by `CardItem` (Task 5) which is extended by `QueueItem` (Task 6); `applySuggestion`/`isItemReady`/`missingRequiredFields`/`defaultItemMeta` signatures match across tasks; `CourseCandidate`/`CourseMatch` shared between Task 1 and Task 2; `scoreCourseCandidates(candidates, filename, keywords)` argument order is consistent. ✓
