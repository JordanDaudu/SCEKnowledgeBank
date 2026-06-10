# AI Summary + Tag Suggestions — Design Spec

**Date:** 2026-06-10
**Status:** Approved
**Provider:** Google Gemini (`gemini-2.5-flash`, free tier)

## Overview

After a document upload completes, a background job sends the document's already-extracted text to Gemini, which generates a short summary and suggests tags from the existing tag catalog. The results are stored as a **pending suggestion**. The uploader is notified, reviews the suggestion on the document detail page, and accepts (fully or partially) or dismisses it. Nothing AI-generated is publicly visible until the uploader accepts it.

## Goals

- Every text-bearing upload gets an AI summary + tag suggestions automatically, with zero upload latency added.
- The uploader stays in control: suggest-and-confirm, never auto-apply.
- Hebrew documents get Hebrew summaries; English documents get English summaries.
- The feature degrades to a no-op when `GEMINI_API_KEY` is not configured.

## Non-goals (v1)

- Bulk backfill of existing documents (the manual "Generate" button covers individual old documents).
- Retry queues or scheduled workers.
- Creating new tags (suggestions are restricted to the existing catalog to avoid tag sprawl).
- Suggestions for files without extractable text (scanned images, etc.).

## Architecture

### Trigger (fire-and-forget)

In `uploadDocuments()` (`artifacts/api-server/src/services/documents.service.ts`), after the upload transaction commits — alongside the existing badge-evaluation and review-notification fire-and-forget calls (~lines 1237–1262) — kick off suggestion generation for each created document whose `DocumentFile.extractedText` is non-empty. The call is wrapped in `.catch(() => {})`; a failure can never affect the upload response.

### Generation service

New file: `artifacts/api-server/src/services/ai-suggestions.service.ts`

- Uses the `@google/genai` SDK with model `gemini-2.5-flash` (configurable via `AI_SUGGESTIONS_MODEL` env var).
- Prompt inputs: document title, description, course name, detected `language`, the full tag catalog (`id` + `name`), and `extractedText` (already capped at 50KB at extraction time).
- Uses Gemini structured output (`responseSchema`) to get `{ summary: string, tagIds: string[] }`:
  - `summary`: 2–4 sentences, written in the document's language.
  - `tagIds`: up to 5 IDs, validated server-side against the real catalog (hallucinated IDs are dropped).
- On success: upsert a `pending` row in `document_ai_suggestions`, then create a notification.
- On failure (API error, timeout, malformed/empty response): upsert a `failed` row with the error message; no notification.
- If `GEMINI_API_KEY` is unset: the service short-circuits; no row, no notification, no error.

### Notification

Reuses the existing `notify()` producer (`notifications.service.ts`).

- Type: `document.ai_suggestions_ready`
- Recipient: document owner; `subjectType: "document"`, `subjectId: <documentId>`, `url`: the document detail page.
- The web notifications page `typeLabel()` map gains this type (en + he).

## Data model

New Prisma model (migration `20260610HHMMSS_add_document_ai_suggestions`, following the existing naming convention):

```prisma
model DocumentAiSuggestion {
  id              String    @id @default(uuid())
  documentId      String    @unique
  document        Document  @relation(fields: [documentId], references: [id], onDelete: Cascade)
  summary         String    @default("")
  suggestedTagIds String[]  @default([])
  status          String    @default("pending") // pending | accepted | dismissed | failed
  error           String?
  createdAt       DateTime  @default(now())
  resolvedAt      DateTime?

  @@map("document_ai_suggestions")
}
```

Plus one new column on `Document`:

```prisma
aiSummary String @default("")
```

`documentId` is unique: one live suggestion per document. `POST /generate` (regenerate) overwrites the existing row and resets status to `pending`.

On **accept**: the summary (if accepted) is copied to `Document.aiSummary`; accepted tag IDs become `DocumentTag` rows (existing rows untouched, duplicates ignored). The uploader's own `description` is never modified.

## API

All endpoints owner-gated (document owner or admin); 404 if no suggestion exists where relevant.

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/documents/:id/ai-suggestions` | Returns the suggestion row (with resolved tag names) or 404. |
| `POST` | `/documents/:id/ai-suggestions/accept` | Body: `{ acceptSummary: boolean, tagIds: string[] }`. Partial acceptance allowed (e.g., summary only, or a subset of tags). Applies changes, sets `status: accepted`, `resolvedAt`. |
| `POST` | `/documents/:id/ai-suggestions/dismiss` | Sets `status: dismissed`, `resolvedAt`. Nothing applied. |
| `POST` | `/documents/:id/ai-suggestions/generate` | Runs generation synchronously (or kicks it off) for this document. Used as manual trigger for old documents and retry after `failed`. Requires non-empty `extractedText`; 422 otherwise. |

Zod request/response schemas added in `lib/api-zod`, client hooks in `lib/api-client-react`, following existing conventions.

## Web UI

**Review card** — on the document detail page (`artifacts/web/src/pages/document-detail.tsx`), rendered only for the owner/admin while a `pending` suggestion exists:

- Shows the proposed summary text and the suggested tags as pre-checked toggleable chips (same badge style as `EditMetadataModal`).
- A checkbox/toggle for "use this summary".
- Buttons: **Accept selected** / **Dismiss**.

**Fallback button** — when no suggestion exists or the last one `failed`, the owner sees a small "Generate AI suggestions" button (hidden entirely when the document has no extracted text or the feature is disabled server-side — the GET endpoint communicates this).

**Public display** — once accepted, `aiSummary` renders in `MetadataPanel` under the description, with a small "AI-generated summary" label (sparkle icon).

**i18n** — all new strings go into `en.json` and `he.json` under an `aiSuggestions.*` namespace; layout must be RTL-safe per the existing i18n conventions.

## Configuration

Added to the Zod env schema (`artifacts/api-server/src/lib/env.ts`):

- `GEMINI_API_KEY` — optional string; feature master switch.
- `AI_SUGGESTIONS_MODEL` — optional, default `"gemini-2.5-flash"`.

## Error handling summary

| Failure | Behavior |
|---|---|
| No `GEMINI_API_KEY` | Feature disabled; uploads unchanged; UI hides all AI elements. |
| Gemini API error / timeout | `failed` row stored with error; no notification; owner can retry via Generate button. |
| Malformed / empty model response | Treated as failure (above). |
| Hallucinated tag IDs | Silently filtered out server-side. |
| Document has no extracted text | Job skipped at trigger time; `POST /generate` returns 422. |
| Process crash mid-generation | Suggestion simply never appears; Generate button is the recovery path. |

## Testing

- **Unit:** prompt builder (includes catalog, language hint, caps text); service with mocked Gemini client — success, malformed JSON, API error, missing key short-circuit; tag-ID validation drops unknown IDs.
- **Routes:** all four endpoints — owner allowed, stranger 403, accept applies summary + tags correctly, partial accept, dismiss, generate on text-less document 422.
- **Integration:** upload with no `GEMINI_API_KEY` produces byte-identical behavior to today (no suggestion row, no notification).
