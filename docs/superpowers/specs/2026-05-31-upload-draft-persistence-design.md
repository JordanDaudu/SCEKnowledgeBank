# Upload Draft Persistence (1-minute survival across reload) — Design

**Date:** 2026-05-31
**Branch:** `feat/batch-upload-redesign` (builds on the per-file upload page)
**Status:** Design approved

## Objective

When a user has unfinished files queued on the Upload page and leaves — by
navigating away in-app, reloading, or closing the tab — restore that queue
(including the actual files and the metadata they filled in) if they return to
the Upload page within **60 seconds**. After 60 s the draft expires and is
discarded.

## Constraint that drives the design

The picked files' bytes live only in JS memory. They survive an in-app route
change but are wiped by a full reload/close, and browsers won't let JS
re-attach a previously picked file. **IndexedDB** can structured-clone
`File`/`Blob` objects, so it is the only practical store that lets the real
files survive a reload. `localStorage` can't (≈5–10 MB quota; base64 inflates
50 MB files past it), so it is not used.

## Decisions (from brainstorming)

1. **Survive a full reload/reopen** (not just in-app navigation) → IndexedDB.
2. **Last-save clock** for the TTL: the 60 s counts from the last save. In-app
   navigation refreshes it precisely on unmount; a hard reload/close is
   best-effort (the async write on `pagehide` may not land, so the minute then
   effectively counts from the last edit). No synchronous `localStorage`
   timestamp — accepted as a minor edge-case imprecision.
3. **Restore only unfinished files.** `success` items are excluded (already
   uploaded server-side).

## Module: `artifacts/web/src/lib/upload-draft-store.ts`

Single responsibility: draft persistence. Hides IndexedDB behind a small API so
the page never touches IndexedDB directly.

```
const TTL_MS = 60_000

// Pure, unit-tested:
isFresh(savedAt: number, now: number, ttlMs = TTL_MS): boolean
toDraftItems(items): DraftItem[]   // normalize what's worth saving (see below)

// IndexedDB I/O (thin wrappers):
saveDraft(items): Promise<void>     // writes { savedAt: Date.now-equiv, items: toDraftItems(items) }; clears if empty
loadDraft(): Promise<DraftItem[] | null>   // null if absent, empty, or stale per isFresh
clearDraft(): Promise<void>
```

- Storage: one IndexedDB database (e.g. `kb-upload`), one object store
  (`draft`), a single record under a fixed key holding `{ savedAt, items }`.
- A `DraftItem` carries the `File` object plus the per-file metadata
  (`courseId`, `materialType`, `categoryId`, `visibility`, `semester`,
  `academicYear`, `title`, `tagIds`), `status`, `error`/`errorCode`,
  `displayFilename`, `duplicateOf*`, and `suggestion`. The `File` is stored
  directly (IndexedDB clones it with name + type intact).

### `toDraftItems` normalization (the "what's worth saving" rule)
- Keep items whose status is `queued` or `failed`.
- An `uploading` item → saved as `queued` (its request was aborted by leaving).
- Drop `success` items entirely.
- `analyzing` is forced to `false` (no spinner restored; no re-analysis).
- If the result is empty, `saveDraft` calls `clearDraft` instead of writing.

## Wiring into `upload.tsx`

- **On mount:** `const draft = await loadDraft()`. If non-empty, map each
  `DraftItem` back into a `QueueItem` (re-wrap the stored `File`), `setItems`,
  and show a toast: *"Restored N file(s) from your previous session."* On a
  stale/empty draft, do nothing (and `loadDraft` having returned null means it
  was already treated as expired).
- **On `items` change:** debounced (~500 ms) `saveDraft(items)` (write-through,
  so the freshest state is always persisted). When nothing is worth saving it
  collapses to `clearDraft`.
- **On unmount and on `pagehide`:** best-effort final `saveDraft(items)` to
  refresh `savedAt`. (Reuses/extends the existing unmount cleanup effect.)
- **On a fully-successful batch** and on the existing post-success navigation to
  `/browse`: `clearDraft()`.

Restored `failed` items keep their error message (informative) and remain
retryable via the existing per-card retry. Restored items are not
re-analyzed; whatever `suggestion` was saved is reused.

## Privacy

File bytes sit only in the user's browser IndexedDB. The 60 s TTL plus
clear-on-complete bound exposure; on a shared machine a draft can persist up to
a minute. No server involvement.

## Testing

- **Unit (Vitest, node env):** `isFresh` (within/at/after TTL) and
  `toDraftItems` (keeps queued/failed, `uploading`→`queued`, drops `success`,
  clears `analyzing`, empty→empty). Pure functions, no IndexedDB needed.
- **E2E (Playwright):** on the upload page, add files + fill one card, reload
  the page, assert the files/metadata are restored; then advance past 60 s
  (or stub the timestamp) and assert they are not restored. Written now; run
  with the dev stack up.

## Out of scope

- Exact-to-the-second TTL on hard reload (would need a synchronous
  `localStorage` timestamp).
- Restoring already-uploaded (`success`) files.
- Cross-device / server-side draft sync.
