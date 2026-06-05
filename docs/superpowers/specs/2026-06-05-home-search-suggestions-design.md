# Home Search Suggestions (Autocomplete) — Design

**Date:** 2026-06-05
**Status:** Approved

## Goal

As a user types in the home-page search box, show live suggestions matching the
typed text — courses, tags, people (uploaders), and matching documents.
Selecting a suggestion navigates intelligently.

## Current state

- The home `SearchBar` (only used on `/`) just routes Enter → `/browse?q=…`.
- A working endpoint `GET /v2/documents/autocomplete` (operationId
  `searchAutocomplete`, hook `useSearchAutocomplete`) already returns substring
  matches for **tags, courses, uploaders** with per-item document counts,
  visibility-scoped.
- It does **not** return matching documents. A `useDebounce` hook exists.

## Changes

### Backend — add documents to autocomplete

- `documents.repo.ts` `findAutocomplete`: add a fourth query returning documents
  whose `title` (or `description`) matches the term (`ILIKE %term%`), respecting
  the same `visibilitySql` scope, ordered by prefix-match-first then recency,
  limited by `limit`. Return `documents: Array<{ id, title }>`. Extend the
  `AutocompleteHits` type.
- `search.service.ts` `AutocompleteResult`: add `documents: Array<{ id, title }>`
  and pass it through.
- OpenAPI `SearchAutocomplete` schema: add a required `documents` array of a new
  `AutocompleteDocumentHit` schema `{ id, title }`. Regenerate the typed client.

No new endpoint — the existing `searchAutocomplete` response simply gains a
`documents` field.

### Frontend — suggestions dropdown in `SearchBar`

- Debounce the input (250 ms via `useDebounce`). When the debounced query length
  ≥ 2, call `useSearchAutocomplete({ q, limit: 5 })` (enabled only when open and
  long enough).
- Render a dropdown panel under the input with grouped sections in order:
  **Documents**, **Courses**, **Tags**, **People**. Each row shows an icon, the
  label (course shows `code — title`; document shows title; tag shows name;
  person shows display name), and (where present) the document count.
- **Smart navigation** on select:
  - Document → `/documents/:id`
  - Course → `/browse?courseId=:id`
  - Tag → `/browse?tagIds=:id`
  - Person → `/browse?uploaderId=:id`
  - Free-text Enter (no highlighted row) → `/browse?q=…` (unchanged)
- Keyboard: ArrowUp/Down move a highlight across the flattened list, Enter
  selects the highlighted row (or runs text search if none), Escape closes.
  Close on outside-click / blur; reopen on focus when there is a query.
- Empty/loading states: while fetching show nothing jarring; if the query is
  long enough and there are zero hits, show a muted "No matches — press Enter to
  search".

## Testing / Verification

- A service/repo test that `autocomplete` returns matching documents (title
  substring) alongside courses/tags, visibility-scoped.
- `pnpm --filter @workspace/web run typecheck` + build stay clean.
- Manual: typing a course code (e.g. `CS101`) shows the course and any
  matching documents; clicking each navigates correctly.

## Out of Scope (YAGNI)

- Adding suggestions to the `/browse` search input (home only, per request).
- Fuzzy/trigram ranking for documents (simple ILIKE substring + recency is
  enough here; the full `/browse` search already does rank-aware FTS).
- Recent-search history / saved searches.
