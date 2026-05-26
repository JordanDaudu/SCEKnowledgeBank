---
name: Storage not-found mapping
description: Why missing-blob storage errors in document streaming routes must be translated to 404, and how the bug masquerades as a CSP/framing issue.
---

# Rule

Any code path that streams bytes from the storage adapter to an HTTP response (preview, download, thumbnail) MUST catch storage-not-found errors and throw `notFound(...)`. Driver-portable detector:

- local adapter: `err.code === "ENOENT"` (from `fs.createReadStream`)
- GCS adapter: synthesises `err.code === "ENOENT"` via a pre-`exists()` check, but a race / direct call can still surface a Google API error whose numeric `.code` is `404`.

**Why:** Without this, a missing blob propagates to the global error middleware as a 500. In an `<iframe>` preview, Chrome (and only Chrome — Safari/Firefox show the JSON) renders the JSON body as its generic "This page has been blocked" interstitial. The symptom looks identical to a CSP / X-Frame-Options / COEP problem, and you can burn hours hardening framing headers when the actual cause is the storage backend being empty (stateless autoscale deploy, out-of-band delete, driver switch that didn't migrate blobs).

**How to apply:** When adding any new streaming route, wrap `getStream(...)` in try/catch and use the shared `isStorageNotFound(err)` helper in `documents.service.ts`. Returning a clean 404 also lets the SPA fall back to its no-preview/no-thumb UI instead of showing the browser interstitial.
