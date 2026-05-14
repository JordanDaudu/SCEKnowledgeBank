# Upload + Browse e2e test plan

Run via the `testing` skill's `runTest()` harness (Playwright-based subagent).
Covers the nontrivial client logic on `/upload` and the URL-state sync on
`/browse`. See `.local/skills/testing/SKILL.md` for how to invoke.

## What it covers

1. Selecting a too-large file (>50 MB) shows an inline size error from the
   client-side validator with no network call to `/api/documents/upload`.
2. Uploading a valid `text/plain` file shows a queued → uploading → success
   transition and a green "Uploaded" badge, plus a success toast.
3. Re-uploading a file whose name already exists for the same user surfaces the
   server-side rename notice ("Uploaded as `foo (2).txt` to avoid duplicate
   name.") with `data-testid="upload-rename"`.
4. Browse filters (`q`, `materialType`) are written to the URL and restored
   after a hard refresh, including the "Active:" filter chip strip.

## Login

Quick-login as the lecturer demo account by clicking the "Lecturer" button on
`/login` (sets the session cookie via `POST /api/auth/login` with
`lecturer@demo` / `demo1234`).

## Selectors

- Dropzone (hidden file input lives inside it): `[data-testid="upload-dropzone"] input[type=file]`
  — use `setInputFiles`, do NOT click the dropzone (opens OS chooser).
- Queue items by status: `[data-testid="upload-item-queued|uploading|success|failed"]`.
- Per-item error: `[data-testid="upload-error"]`.
- Rename notice: `[data-testid="upload-rename"]`.
- Submit button: `[data-testid="upload-submit"]`.
- Browse search: `[data-testid="browse-search"]`.

## Notes for the test author

- The server mime-sniffs uploads. A real `.txt` file with `text/plain` passes;
  a zero-buffer `.pdf` will be rejected as `mime_mismatch`. For the oversized
  case, the validator runs before any network call, so the buffer can be
  anything — only the size matters.
- Generate unique base filenames with `nanoid` so duplicate-name detection
  works deterministically across runs against the shared dev DB.
- After a successful upload the page redirects to `/browse` after ~1.5 s;
  navigate back to `/upload` before running the duplicate-name case.

The full step-by-step plan that was last run successfully lives in this file's
git history; copy it into `runTest({ testPlan })` to re-run.
