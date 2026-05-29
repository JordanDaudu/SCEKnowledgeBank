# Document version labels (`vX.0`) + visibility — design

**Date:** 2026-05-29
**Status:** Approved (pending spec review)

## Context

The platform already versions document files: each upload of a new version
creates a `DocumentFile` row with a monotonically increasing integer
`versionNumber`, and `Document.currentVersion` tracks the active one. Users
upload new versions from the **Versions panel** on a document's detail page,
and the **Upload History** page shows a per-document revision timeline.

Today versions are displayed as plain integers — **"v1", "v2"** — and the
version only appears in the Versions panel and the Upload History badge.

## Goal

1. Display versions in **`vX.0`** form (first upload = **v1.0**).
2. A new upload bumps to the **next whole number** (v1.0 → v2.0 → v3.0) — this
   is the existing increment behaviour; no change needed beyond display.
3. Show the current version **everywhere a document appears**: document detail
   header, browse/search cards, and the browse table.

## Approach (chosen)

**Display-only formatting.** The label `vX.0` is fully determined by the
integer `versionNumber` the system already stores, so we derive it with a
small pure helper and surface it in the UI. No server, schema, migration, or
data changes; the unused `versionLabel` column stays unused.

*Rejected alternative:* persist a semantic `versionLabel` string per file —
needs new write paths + a backfill migration and is redundant with the
integer (YAGNI). Full major.minor (v1.1) was rejected per the requirement
that every upload is a whole-number bump.

## Design

No backend changes. The document DTO already exposes `currentVersion`; the
per-version API already exposes `versionNumber`.

### Components (all in `artifacts/web`)

- **`lib/format.ts` → `formatVersion(versionNumber: number): string`** —
  returns `` `v${versionNumber}.0` ``. Single source of truth for the label.
  Guards non-positive / undefined inputs by defaulting to `1`.
- **Document detail header** (`pages/document-detail.tsx`) — a version badge
  (`v{doc.currentVersion}.0`) beside the title.
- **Browse cards** (`components/browse/DocumentCards.tsx`) — a small version
  badge on each card.
- **Browse table** (`components/browse/DocumentTable.tsx`) — a new **Version**
  column, toggleable via the existing column-visibility control (default
  visible). Shows `v{doc.currentVersion}.0`.
- **Versions panel** (`components/document-detail/VersionsPanel.tsx`) and
  **Upload History timeline** (`pages/upload-history.tsx`) — replace
  `v{versionNumber}` with `formatVersion(versionNumber)` (so history reads
  v1.0 / v2.0 / v3.0, "Current" badge unchanged).

### Upload-new-version flow

Unchanged. The Versions panel's "Upload new version" control (optional change
note), available to users who can manage the document (uploader/owner, course
lecturer, admin), already increments the integer → next `vX.0`.

## Data flow

`Document.currentVersion` / `DocumentFile.versionNumber` (already returned by
the API) → `formatVersion(...)` → rendered badge/label. No new requests.

## Testing

- Unit test for `formatVersion` (1 → "v1.0", 3 → "v3.0", 0/undefined → "v1.0").
- The version-increment behaviour is already covered by existing api-server
  tests; no new backend tests.
- Manual: upload a new version → header/cards/table/panel/history all show the
  bumped `vX.0`; column toggle hides/shows the table Version column.

## Out of scope

- Version badge on the Prep-Hub / dashboard mini-cards (`DocMiniGrid`).
- Version diff/compare; minor (v1.1) bumps; persisting `versionLabel`.

## Acceptance criteria

- Every document shows a `vX.0` label on detail, cards, and table (≥ v1.0).
- Uploading a new version increments the displayed label by one whole number
  across all surfaces.
- Versions panel + Upload History read v1.0 / v2.0 / … with the current one
  marked.
- Typecheck green; `formatVersion` unit test passes.
