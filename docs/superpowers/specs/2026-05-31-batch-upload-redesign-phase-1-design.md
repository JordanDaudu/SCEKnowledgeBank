# Batch Upload UX & Validation Redesign — Phase 1 (Core)

**Date:** 2026-05-31
**Branch:** `feat/batch-upload-redesign`
**Status:** Design approved, ready for implementation plan

## Objective

Redesign the batch upload experience so users can upload many files at once
while providing required metadata on a **per-file** basis. Maximize successful
uploads, minimize effort, and ensure one invalid file never blocks the rest of
the batch (partial-success uploads).

## Scope

**Phase 1 (this spec — Core):**

- An independent metadata card for every selected file.
- Per-file metadata extraction + confidence-based prefill (including net-new
  automatic *course* matching).
- Per-file validation: only **Course** and **Material Type** are required.
- Partial-success upload: valid files upload immediately; invalid files stay on
  screen for correction; per-file errors are reported at the file level.
- Per-file duplicate **warning** surfaced on its card.

**Phase 2 (deferred — out of scope here):**

- Bulk-apply toolbar (set a value across selected files).
- Smart "related files → same course" grouping suggestions.
- Animated aggregate progress.
- Duplicate **resolution** actions (skip / replace / upload-anyway). Phase 1
  *surfaces* duplicate warnings and the existing same-uploader hard-block error,
  but adds no resolution UI.

## Background: what already exists

Exploration of the current codebase established that most of the required
infrastructure is already present:

- **Upload is already per-file at the network layer.** `uploadOne`
  (`artifacts/web/src/pages/upload.tsx`) sends **one** file per HTTP request in
  a loop and reads `results[0]`. `POST /documents/upload`
  (`artifacts/api-server/src/routes/documents.ts`) already accepts per-request
  metadata and already returns a per-file results array
  (`UploadResultEntry[]`) with `success`, `error`, `errorCode`,
  `duplicateOfDocumentId`, `duplicateOfTitle`. Partial success, per-file
  validation, dedup, store, save, and search-indexing already work end-to-end.
  **The upload endpoint contract does not change.**
- **The analysis seam already exists.** `suggestForUpload`
  (`artifacts/api-server/src/services/documents/suggest-metadata.service.ts`,
  endpoint `POST /v2/documents/suggest-metadata`) extracts title (with
  `titleSource` confidence), keywords, language, tags, category, filename
  signals (material-type/semester/year, each with provenance), and a duplicate
  probe. Today it is wired only to the **first** queued file.
- **Filename parsing** (`filename-intel.ts`) deterministically yields material
  type, semester, and academic year.
- No automatic **course** matching exists yet — this is the one net-new piece
  of inference logic.

The result: this redesign is **~80% a frontend restructure plus one backend
addition (course matching)**.

## Architecture decisions (from brainstorming)

1. **Analyze in-place, no staging infrastructure.** On file-select, each file is
   sent once to the existing `suggest-metadata` endpoint to populate its card.
   On Upload, valid files are sent to `/documents/upload`. No temp storage, no
   staging tokens, no garbage collection.
2. **Course matching: filename + content token match, scoped to uploadable
   courses.** High-confidence → auto-prefill; low-confidence → suggest chip.
3. **Core-first scope.** Extras (bulk-apply, grouping, duplicate resolution,
   aggregate progress) are Phase 2.

## Backend changes

### 1. `matchCourse` in `suggest-metadata.service.ts`

Net-new course inference, scoped server-side to courses the user can upload to
(enrolled courses for students; all courses for lecturers/admins — enforcing
the same set the frontend currently filters to as a UX convenience).

Matching inputs: the normalized filename tokens (reuse `filename-intel`
normalization) and extracted keywords. Matching targets: course `code` and
`title`.

Confidence tiers:

- **`high`** — the course *code* appears as a token in the filename or extracted
  text (e.g. `MATH101`), **or** exactly one allowed course's title strongly
  matches the keywords. Returned as `course` with `courseConfidence: "high"`.
  The UI auto-fills the Course field.
- **`low`** — a fuzzy / name-token match, or multiple candidates (return the
  top-ranked one). Returned as `course` with `courseConfidence: "low"`. The UI
  shows a "Suggested" chip; the field is **not** auto-filled.
- **none** — no plausible match; `course` omitted.

Reuses the existing `nameMatchOr`-style case-insensitive matching already used
for tags/categories. Pure ranking logic is unit-testable in isolation.

### 2. OpenAPI + client regen

Extend the `SuggestMetadataResponse` schema in the OpenAPI spec
(`lib/api-spec/openapi.yaml`) with:

- `course?: { id: string; code: string; title: string }`
- `courseConfidence?: "high" | "low"`

Run the standard codegen flow to regenerate the Zod validators
(`lib/api-zod`) and the React Query client (`lib/api-client-react`).

### 3. No change to `POST /documents/upload`

The endpoint already performs, per file: validate required fields → check
duplicates → store → save metadata → index for search, with failures isolated
per file and reported in the response. Phase 1 sends per-card metadata through
the existing per-request fields.

## Confidence → prefill rule (uniform)

| Field | Auto-fill the field (high) | Suggest-only chip (low) |
|---|---|---|
| Course | code match / single strong name match | fuzzy / multi-candidate |
| Material type | filename pattern matched (deterministic) | — (fill it) |
| Title | from embedded PDF metadata (`titleSource: "metadata"`) | from filename stem (`titleSource: "filename"`) |
| Semester / Year | parsed from filename | — |

Auto-filled fields remain editable. Low-confidence suggestions render as a
"Suggested: X" chip the user clicks to accept. Material type auto-fills from the
deterministic filename parser (matches the spec's `Type = Exam` example);
because it is always editable and visibly sourced "from filename", a wrong guess
is cheap to correct.

## Frontend changes

### Decomposition of `upload.tsx`

`upload.tsx` is currently ~1097 lines and mixes file-queue management, a single
shared metadata form, suggestion rendering, and the submit loop. Split into
focused units:

- **`upload.tsx`** (page orchestration) — dropzone, storage-quota strip, student
  approval notice, the per-file submit loop, and the action bar. Owns the
  `items` array and the cancel/retry refs that already exist.
- **`FileMetadataCard.tsx`** — renders one file's card: required **Course** and
  **Material Type** selects; a collapsible "More details" section (category,
  visibility, semester, academic year, title, tags); low-confidence suggestion
  chips; the per-card status badge; and per-card duplicate/error messages.
  Receives the item + course/tag/category lists as props; emits metadata changes
  upward.
- **`useFileAnalysis`** (hook or util) — fires `suggest-metadata` per file with a
  small concurrency cap, maps each result → that card's default field values via
  the confidence rule, and tracks analyzing state. Aborts in-flight requests for
  removed files.

### Per-file state

Each `QueueItem` is extended to carry its own metadata instead of reading shared
form state:

```
courseId, materialType, categoryId, visibility, semester,
academicYear, title, tagIds,
suggestion, analyzing (bool), // analysis result + in-flight flag
status, progress, error, errorCode, duplicateOf* // existing fields
```

Bonus: because each upload is a single-file request, **per-file `title` now
works for every file** (today the server honors `title` only for single-file
batches, but each request *is* a single file, so a per-card title is honored as
`titleOverride`).

### Card status model

```
Analyzing            → spinner while suggest-metadata is in flight
Ready (✅)           → Course AND Material Type both set
Needs info (⚠)       → a required field is missing (lists which)
Uploading (n%)       → request in flight (existing per-file progress)
Uploaded (✅)        → server returned success
Failed (❌)          → server/network error; retry available
Duplicate (⚠ chip)   → suggest-metadata duplicate probe hit (advisory)
```

### Upload behavior

- The action button uploads only **Ready** cards, via the existing per-file loop
  (each builds its own `fields` from its card state). The loop, cancel/retry,
  and query invalidation are unchanged.
- **Needs-info** cards are skipped and stay on screen for correction; the user
  can fix them and upload again later.
- Per-file results map back to each card exactly as today: success → Uploaded;
  server rejection (`duplicate_file`, storage, etc.) → Failed with the file-level
  error message and any duplicate link; network error → Failed + retry.
- The batch never fails as a whole. Errors are always file-level
  ("Course is required.", "Material Type is required.",
  "File already exists.", "Upload failed due to network error.").

### Preserved behavior

Storage-quota strip, student approval notice, `autoSubmitForReview` checkbox,
client-side file validation (size/type/empty), filename UTF-8 handling, and the
existing cancel-all / retry-all controls all remain.

## Error handling

- **Client validation** (size/type/empty) → card enters `Failed` immediately on
  add, as today.
- **Missing required field** → `Needs info`; not sent on upload; per-field
  message on the card.
- **Server rejection / network** → `Failed` with the exact server message +
  retry, per card.
- Analysis failures are best-effort: a file that can't be analyzed still gets a
  fully usable (empty) card the user can fill manually — never blocks.

## Testing

- **Unit:** `matchCourse` confidence tiers (code match → high; single strong
  name → high; fuzzy/multi → low; no match → none). Suggestion → card-default
  mapping (which fields auto-fill vs. become chips).
- **Component:** `FileMetadataCard` validation states (ready vs. needs-info),
  chip-apply behavior, collapsible details.
- **Integration / E2E:** a partial-success batch — some cards Ready, one
  Needs-info (stays), one server-rejected (Failed + retry) — following the
  existing Vitest + Playwright patterns. Reuses existing upload test scaffolding.

## Success criteria

- An individual metadata card for every selected file.
- High-confidence metadata auto-extracted and prefilled; low-confidence shown as
  confirmable suggestions.
- Manual correction per file; only Course and Material Type required.
- Valid files upload immediately; invalid files remain for correction.
- Partial-success uploads with clear file-level validation and upload errors.
- One invalid file never fails the batch.
- Reuses the existing metadata extraction, duplicate detection, approval
  workflow, and search indexing infrastructure (no upload-endpoint contract
  change).
