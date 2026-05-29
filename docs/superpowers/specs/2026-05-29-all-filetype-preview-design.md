# Design: In-browser preview for more file types (client-side)

Date: 2026-05-29
Status: Approved (design); pending implementation

## Problem

Document preview only works for PDF and images. Every other uploadable
type (Word, Excel, CSV, text, Markdown, PowerPoint, legacy Office, ZIP)
falls through to a "Preview unavailable — download to view" panel. The
user wants previews to work for as many types as possible **without**
converting files server-side, **without** creating duplicate/converted
copies, and **without** changing how originals are stored or downloaded.

## Decision (Option A — client-side rendering)

Render supported types directly in the browser from the **original file
bytes**, fetched from the existing signed preview URL. No backend
changes, no server conversion, no temporary or duplicate files, and the
original always downloads in its native format.

### Coverage

| MIME type (stored) | Kind | Renderer |
|---|---|---|
| `application/pdf` | `pdf` | iframe (existing) |
| `image/png`, `image/jpeg` | `image` | iframe (existing) |
| `text/plain`, `text/markdown` | `text` | fetch text → scrollable monospace `<pre>` |
| `text/csv` | `sheet` | SheetJS → HTML table |
| `application/vnd.ms-excel` (`.xls`) | `sheet` | SheetJS → tabbed HTML tables |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (`.xlsx`) | `sheet` | SheetJS → tabbed HTML tables |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (`.docx`) | `docx` | docx-preview → rendered HTML |
| `application/msword` (`.doc`) | `unsupported` | fallback (no reliable client renderer for legacy binary) |
| `application/vnd.ms-powerpoint` (`.ppt`) | `unsupported` | fallback |
| `application/vnd.openxmlformats-officedocument.presentationml.presentation` (`.pptx`) | `unsupported` | fallback |
| `application/zip` | `unsupported` | fallback |
| anything else / missing | `unsupported` | fallback |

Markdown renders as **source text** for now (safe, zero extra deps);
formatted Markdown is a possible follow-up. PowerPoint, legacy binary
Office, and ZIP keep the existing download fallback — there is no
dependable client-side renderer for them (full coverage of those would
require server conversion, explicitly out of scope).

## Architecture

All changes are confined to `artifacts/web`.

### New: `src/lib/preview-kind.ts` (pure, unit-tested)

```ts
export type PreviewKind = "pdf" | "image" | "text" | "sheet" | "docx" | "unsupported";
export function previewKindForMime(mime: string | undefined): PreviewKind;
```

Single source of truth for the dispatch decision. Pure function → TDD'd
with vitest. Replaces the two duplicated `isPreviewableInIframe` helpers
(in `PreviewPanel.tsx` and `document-detail.tsx`); both call sites use
`previewKindForMime` instead.

### Changed: `src/pages/document-detail.tsx`

The preview token query is currently gated on `canIframe` (pdf/image
only). Broaden it: fetch the token whenever
`previewKindForMime(mime) !== "unsupported"`, since the text/sheet/docx
renderers also need the signed URL to fetch bytes. `unsupported` skips
the token request (shows fallback immediately).

### Changed: `src/components/document-detail/PreviewPanel.tsx`

Becomes a dispatcher. Keeps the existing header chrome (filename, size,
type). Body switches on `previewKindForMime(mime)`:
- `pdf` / `image` → iframe of `apiUrl(previewUrl)` (unchanged behavior)
- `text` → `<TextPreview previewUrl=... />`
- `sheet` → `<SheetPreview previewUrl=... />`
- `docx` → `<DocxPreview previewUrl=... />`
- `unsupported` → `<PreviewFallback doc=... onDownload=... />`

### New renderer components: `src/components/document-detail/previews/`

- `PreviewFallback.tsx` — the existing "Preview unavailable" panel
  (thumbnail/icon + Download), extracted so renderers can reuse it on
  error. Keeps `data-testid="preview-unavailable"`.
- `usePreviewContent.ts` — small hook: `fetch(apiUrl(previewUrl))` →
  returns `{ data, error, loading }` as text or `ArrayBuffer`. Aborts on
  unmount/url-change via `AbortController`.
- `TextPreview.tsx` — fetch as text → scrollable `<pre>`; loading
  skeleton; error → `PreviewFallback`.
- `SheetPreview.tsx` — fetch as ArrayBuffer → `await import("xlsx")` →
  parse workbook → render each sheet as an HTML `<table>` with a tab
  switcher when multiple sheets. Lazy import so the lib is code-split.
- `DocxPreview.tsx` — fetch as ArrayBuffer → `await import("docx-preview")`
  → `renderAsync(buffer, containerRef.current)`. Lazy import. Error →
  `PreviewFallback`.

Every renderer shows a loading state while fetching/parsing and degrades
to `PreviewFallback` on any fetch/parse failure, so a malformed file can
never crash the page.

### Dependencies (web devDependencies)

- `docx-preview` — DOCX → HTML.
- `xlsx` (SheetJS) — XLSX/XLS/CSV → tables.
- `vitest` — unit-test runner for the web package (none today).

Both render libs are lazy-loaded via dynamic `import()`, so they do not
enter the initial bundle. All are mature packages that satisfy the
workspace `minimumReleaseAge: 1440` supply-chain policy.

## Testing

- **Unit (TDD, vitest):** `preview-kind.test.ts` — exhaustive
  MIME→kind cases for every allowed type plus `undefined`/unknown.
  Add a minimal `vitest.config.ts` (node env) and a `test` script to
  `artifacts/web/package.json` so `pnpm -r run test` picks it up.
- **Manual (browser):** upload one file per kind (txt, md, csv, xlsx,
  docx) and confirm it previews; confirm pptx/doc/ppt/zip still show the
  fallback; confirm originals still download in native format.
- Renderer components are integration-level (real fetch + third-party
  rendering) and are not unit-tested; covered by manual verification.

## Out of scope

Server-side conversion (Option B), formatted Markdown rendering,
PowerPoint/legacy-Office/ZIP previews, ZIP content listing. Each is a
clean follow-up if wanted later.
