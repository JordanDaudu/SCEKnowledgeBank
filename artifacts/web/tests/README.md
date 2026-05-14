# Web e2e tests

Playwright tests for the `@workspace/web` artifact. Covers the four scenarios
from task #13:

1. Selecting a >50 MB file shows the inline size error before any network call.
2. A valid file upload shows queued → uploading → success with a green badge.
3. Re-uploading the same filename surfaces the server's
   `Uploaded as foo (2).txt` rename notice.
4. Browse filters (`q`, `materialType`) round-trip through the URL across a
   hard refresh.

## Running

The web and API workflows must be running first. From the repo root:

```bash
pnpm --filter @workspace/web run test:e2e
```

Configuration:

- `PLAYWRIGHT_BASE_URL` — override the web URL (default `http://localhost:22333`).
- `WEB_PORT` — convenience override for the default base URL's port.
- `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE` — auto-set on Replit; points
  Playwright at the Nix-provided Chromium binary so we don't depend on
  `playwright install`'s headless-shell (which is missing system libs on NixOS).

## Login

Tests sign in as the seeded lecturer demo account (`lecturer@demo` /
`demo1234`). Adjust `loginAsLecturer` in `upload-and-browse.spec.ts` if seed
credentials change.

## Notes

- The oversized-file case writes a 52 MB zero buffer to a temp file because
  Playwright caps in-memory `setInputFiles` buffers at 50 MB.
- The duplicate-filename case relies on the server's `uniquify()` rename. It
  uses a unique `dup-<uuid>` base name per run so it's idempotent against the
  shared dev DB.
