---
name: api-server production env requirements
description: Knowledge Bank api-server fails fast at boot in production if certain secrets are missing or weak. Dev has fallbacks; prod does not.
---

# api-server production env requirements

`artifacts/api-server/src/lib/env.ts` parses `process.env` once at boot
through Zod. In production it enforces that several secrets be present
and "strong" (≥16 chars). If any are missing/weak the process exits
with `Invalid environment configuration: ...` before the HTTP server
binds, so the deployment health check sees no port open and reports
"not all artifact ports opened within timeout".

**Why:** dev convenience defaults would silently ship a guessable
HMAC key for `/preview` and `/download` signed URLs if we didn't
fail fast in prod.

**How to apply:** When the user reports "deployment failed" / "publish
failed" / "app won't start in prod", first action is `fetch_deployment_logs`
and grep for `Invalid environment configuration`. If you see it, list the
missing keys to the user and use `requestEnvVar({requestType:"secret"})`
— do NOT try to set the value yourself or write a default into code.

Known required prod secrets: `SIGNED_URL_SECRET`, `SESSION_SECRET`.
Dev defaults are hardcoded in env.ts for both. The full list lives in
`.env.example`.
