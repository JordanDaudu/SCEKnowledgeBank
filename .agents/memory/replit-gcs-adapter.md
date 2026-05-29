---
name: Replit GCS adapter shape
description: Gotchas for using Replit Object Storage from a bundled Node service — sidecar auth, PRIVATE_OBJECT_DIR parsing, and why @google-cloud/* must be a direct dep of the consuming artifact.
---

# Sidecar auth

Replit Object Storage is GCS under the hood, but credentials come from a localhost sidecar at `http://127.0.0.1:1106` (token endpoint at `/token`, credential source at `/credential`). The `Storage` client is constructed with an `external_account` credential pointing at the sidecar — no service-account JSON, no keys to manage. See `lib/storage/src/gcs-adapter.ts` for the canonical wiring (copied from `.local/skills/object-storage/templates/api-server/src/lib/objectStorage.ts`).

# PRIVATE_OBJECT_DIR format

Replit injects `PRIVATE_OBJECT_DIR` in the form `"/<bucket>/<prefix>"`. Always strip the leading slash before splitting on `/`. The first segment is the bucket name; the rest is the prefix that must be prepended to every logical key. Empty `prefix` is valid (whole bucket).

# Bundling vs runtime deps

`artifacts/api-server/build.mjs` externalizes `@google-cloud/*` (the package uses dynamic require for sibling `.proto` files and native bits, so it can't be bundled). The runtime must therefore have `@google-cloud/storage` in `node_modules`.

**Why:** Adding the package only to `@workspace/storage` (the workspace lib that owns the adapter) is **not enough** — esbuild bundles the workspace lib into the artifact but leaves the external import unresolved at runtime. Result: `ERR_MODULE_NOT_FOUND: Cannot find package '@google-cloud/storage'` on first boot.

**How to apply:** Whenever a new artifact wires up `getStorage()` with the GCS driver, add `@google-cloud/storage` as a direct dependency of that artifact's `package.json` (in addition to the workspace lib), then rebuild. The dev workflow surfaces this failure immediately because it does a fresh `pnpm run build && pnpm run start` on restart.
