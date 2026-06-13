# Rate-Limiting & Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add IP rate-limiting to login/register, a per-user throttle on the Gemini AI generate endpoint, and conservative `helmet` security headers — all env-configurable and skipped in the test environment.

**Architecture:** A single `express-rate-limit` factory in a new middleware module produces three pre-configured limiters wired onto the three target routes. Limit breaches are routed through the existing `errorHandler` as a `429 rate_limited` HttpError. `helmet` is added once in `app.ts` with a config that preserves the cross-origin SPA + signed-URL preview flows. All counters are in-memory (per-instance) — a documented, acceptable limitation for the current deploy.

**Tech Stack:** Node + Express 5, TypeScript, `express-rate-limit` v7, `helmet` v8, zod-validated env, vitest + supertest.

**Spec:** `docs/superpowers/specs/2026-06-13-rate-limiting-security-hardening-design.md`

**Working directory:** all paths are under `artifacts/api-server/` unless noted. Run all `pnpm`/`vitest` commands from `artifacts/api-server`. Per the project's Windows setup, prefer `corepack pnpm` and ensure `.env` is loaded; tests run with `corepack pnpm test`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/errors.ts` (modify) | Add `tooManyRequests()` HttpError helper (429, `rate_limited`). |
| `src/lib/env.ts` (modify) | Add `isTest` flag + 7 rate-limit config values (all defaulted). |
| `src/middlewares/rate-limit.ts` (create) | `makeLimiter()` factory + the three exported limiters. Single responsibility: rate-limit configuration. |
| `src/middlewares/rate-limit.test.ts` (create) | Unit test for the factory (isolated mini express app, no DB). |
| `src/app.ts` (modify) | Register `helmet`. |
| `src/routes/auth.ts` (modify) | Attach login + register limiters. |
| `src/routes/ai-suggestions.ts` (modify) | Attach AI generate limiter. |
| `.env.example` (modify, repo root) | Document the new env vars. |

---

### Task 1: Install dependencies

**Files:**
- Modify: `artifacts/api-server/package.json` (via package manager)

- [ ] **Step 1: Add the runtime dependencies**

Run (from `artifacts/api-server`):
```bash
corepack pnpm add express-rate-limit helmet
```
Expected: `package.json` gains `"express-rate-limit": "^7.x"` and `"helmet": "^8.x"` under `dependencies`. Both ship their own TypeScript types, so no `@types/*` are needed.

- [ ] **Step 2: Verify the lockfile + install succeeded**

Run (from repo root):
```bash
corepack pnpm install --frozen-lockfile
```
Expected: completes with no errors; `express-rate-limit` and `helmet` resolved.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/package.json pnpm-lock.yaml
git commit -m "chore(api): add express-rate-limit and helmet"
```

---

### Task 2: Add the `tooManyRequests` error helper

**Files:**
- Modify: `artifacts/api-server/src/lib/errors.ts`

- [ ] **Step 1: Add the helper**

Append after the `conflict` export (line 21):
```typescript
export const tooManyRequests = (
  msg = "Too many requests. Please try again later.",
) => new HttpError(429, "rate_limited", msg);
```

- [ ] **Step 2: Typecheck**

Run (from `artifacts/api-server`):
```bash
corepack pnpm typecheck
```
Expected: PASS (no errors). The new export is unused for now, which is fine.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/lib/errors.ts
git commit -m "feat(api): add tooManyRequests (429) error helper"
```

---

### Task 3: Add rate-limit env config + `isTest`

**Files:**
- Modify: `artifacts/api-server/src/lib/env.ts`

- [ ] **Step 1: Add the zod schema fields**

In `envSchema` (the `z.object({...})` ending at line 83), add these fields just before the closing `})` on line 83, after the `AI_SUGGESTIONS_MODEL` line:
```typescript
  // ─── Rate limiting (design 2026-06-13) ───────────────────────────
  // Master switch; set to "false" to disable all limiters (e.g. load
  // tests). Anything other than the literal "false" leaves it enabled.
  RATE_LIMIT_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v ?? "true").trim().toLowerCase() !== "false"),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_LOGIN_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(900_000), // 15 min
  RATE_LIMIT_REGISTER_MAX: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_REGISTER_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(3_600_000), // 1 hour
  RATE_LIMIT_AI_MAX: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_AI_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60_000), // 1 min
```

- [ ] **Step 2: Add the exported values**

In the `export const env = {...}` object, add after the `aiSuggestionsModel: e.AI_SUGGESTIONS_MODEL,` line (line 151):
```typescript
  // True only under vitest / NODE_ENV=test. Used to disable rate
  // limiters so HTTP-level tests aren't throttled.
  isTest: normalizedNodeEnv === "test",
  rateLimitEnabled: e.RATE_LIMIT_ENABLED,
  rateLimitLoginMax: e.RATE_LIMIT_LOGIN_MAX,
  rateLimitLoginWindowMs: e.RATE_LIMIT_LOGIN_WINDOW_MS,
  rateLimitRegisterMax: e.RATE_LIMIT_REGISTER_MAX,
  rateLimitRegisterWindowMs: e.RATE_LIMIT_REGISTER_WINDOW_MS,
  rateLimitAiMax: e.RATE_LIMIT_AI_MAX,
  rateLimitAiWindowMs: e.RATE_LIMIT_AI_WINDOW_MS,
```

- [ ] **Step 3: Typecheck**

Run (from `artifacts/api-server`):
```bash
corepack pnpm typecheck
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/lib/env.ts
git commit -m "feat(api): add rate-limit env config and isTest flag"
```

---

### Task 4: Create the rate-limit middleware (TDD)

**Files:**
- Create: `artifacts/api-server/src/middlewares/rate-limit.test.ts`
- Create: `artifacts/api-server/src/middlewares/rate-limit.ts`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/middlewares/rate-limit.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import request from "supertest";
import { makeLimiter } from "./rate-limit";

// Build a tiny app whose single route is protected by a limiter with the
// given max. A minimal error handler mirrors the production envelope so we
// can assert the 429 body shape.
function appWith(max: number) {
  const app = express();
  const limiter = makeLimiter({ windowMs: 60_000, max, skip: () => false });
  app.get("/ping", limiter, (_req: Request, res: Response) => {
    res.json({ ok: true });
  });
  app.use(
    (err: any, _req: Request, res: Response, _next: NextFunction): void => {
      res
        .status(err?.status ?? 500)
        .json({ error: { code: err?.code, message: err?.message } });
    },
  );
  return app;
}

describe("makeLimiter", () => {
  it("allows requests up to the limit", async () => {
    const app = appWith(2);
    await request(app).get("/ping").expect(200);
    await request(app).get("/ping").expect(200);
  });

  it("returns a 429 rate_limited error once the limit is exceeded", async () => {
    const app = appWith(2);
    await request(app).get("/ping");
    await request(app).get("/ping");
    const res = await request(app).get("/ping").expect(429);
    expect(res.body.error.code).toBe("rate_limited");
    expect(res.headers["ratelimit-remaining"]).toBeDefined();
  });

  it("does not count requests when skip returns true", async () => {
    const app = express();
    const limiter = makeLimiter({ windowMs: 60_000, max: 1, skip: () => true });
    app.get("/ping", limiter, (_req: Request, res: Response) => {
      res.json({ ok: true });
    });
    await request(app).get("/ping").expect(200);
    await request(app).get("/ping").expect(200);
    await request(app).get("/ping").expect(200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `artifacts/api-server`):
```bash
corepack pnpm vitest run src/middlewares/rate-limit.test.ts
```
Expected: FAIL — `makeLimiter` cannot be imported (module `./rate-limit` does not exist yet).

- [ ] **Step 3: Implement the middleware**

Create `artifacts/api-server/src/middlewares/rate-limit.ts`:
```typescript
import {
  rateLimit,
  ipKeyGenerator,
  type RateLimitRequestHandler,
} from "express-rate-limit";
import type { Request, Response } from "express";
import { env } from "../lib/env";
import { tooManyRequests } from "../lib/errors";

interface LimiterOptions {
  windowMs: number;
  max: number;
  /** Skip counting/limiting for a request (e.g. disabled or test env). */
  skip?: (req: Request, res: Response) => boolean;
  /** When true, only failed (4xx/5xx) responses count toward the limit. */
  skipSuccessfulRequests?: boolean;
  /** Custom key. Defaults to the IPv6-safe client-IP generator. */
  keyGenerator?: (req: Request, res: Response) => string;
}

/**
 * Build an express-rate-limit middleware that emits our standard
 * `429 rate_limited` HttpError through the shared errorHandler instead of
 * the library's default response body.
 */
export function makeLimiter(opts: LimiterOptions): RateLimitRequestHandler {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: opts.skip,
    skipSuccessfulRequests: opts.skipSuccessfulRequests,
    keyGenerator: opts.keyGenerator,
    handler: (_req, _res, next) => {
      next(tooManyRequests());
    },
  });
}

// Disabled globally when the master switch is off or under test.
const skipWhenDisabled = (): boolean => !env.rateLimitEnabled || env.isTest;

/** Brute-force guard for POST /auth/login (per client IP, failures only). */
export const loginRateLimiter = makeLimiter({
  windowMs: env.rateLimitLoginWindowMs,
  max: env.rateLimitLoginMax,
  skipSuccessfulRequests: true,
  skip: skipWhenDisabled,
});

/** Flood guard for POST /auth/register (per client IP). */
export const registerRateLimiter = makeLimiter({
  windowMs: env.rateLimitRegisterWindowMs,
  max: env.rateLimitRegisterMax,
  skip: skipWhenDisabled,
});

/** Cost guard for the Gemini generate endpoint (per authenticated user). */
export const aiGenerateRateLimiter = makeLimiter({
  windowMs: env.rateLimitAiWindowMs,
  max: env.rateLimitAiMax,
  skip: skipWhenDisabled,
  keyGenerator: (req) => req.authUser?.id ?? ipKeyGenerator(req.ip ?? ""),
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `artifacts/api-server`):
```bash
corepack pnpm vitest run src/middlewares/rate-limit.test.ts
```
Expected: PASS — all three tests green.

- [ ] **Step 5: Typecheck**

Run:
```bash
corepack pnpm typecheck
```
Expected: PASS. (Note: `req.authUser` is available because `src/middlewares/auth.ts` augments `Express.Request` globally.)

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/middlewares/rate-limit.ts artifacts/api-server/src/middlewares/rate-limit.test.ts
git commit -m "feat(api): add rate-limit middleware factory and limiters"
```

---

### Task 5: Register helmet in the app

**Files:**
- Modify: `artifacts/api-server/src/app.ts`

- [ ] **Step 1: Import helmet**

Add to the imports block (after line 3, `import cookieParser from "cookie-parser";`):
```typescript
import helmet from "helmet";
```

- [ ] **Step 2: Register the middleware**

Immediately after `app.set("trust proxy", 1);` (line 14), add:
```typescript

// Security headers. CSP is left OFF (it would break the Vite SPA; can be
// reintroduced later in report-only mode). Cross-origin resource policy is
// relaxed to "cross-origin" because the web app (a different origin) loads
// document preview/thumbnail streams from this API; helmet's default
// "same-origin" would block those.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
```

- [ ] **Step 3: Typecheck**

Run (from `artifacts/api-server`):
```bash
corepack pnpm typecheck
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/app.ts
git commit -m "feat(api): add helmet security headers"
```

---

### Task 6: Wire login + register limiters

**Files:**
- Modify: `artifacts/api-server/src/routes/auth.ts`

- [ ] **Step 1: Import the limiters**

Add after line 5 (`import * as authService from "../services/auth.service";`):
```typescript
import {
  loginRateLimiter,
  registerRateLimiter,
} from "../middlewares/rate-limit";
```

- [ ] **Step 2: Attach to the register route**

Change line 27 from:
```typescript
router.post("/register", async (req, res, next) => {
```
to:
```typescript
router.post("/register", registerRateLimiter, async (req, res, next) => {
```

- [ ] **Step 3: Attach to the login route**

Change line 62 from:
```typescript
router.post("/login", async (req, res, next) => {
```
to:
```typescript
router.post("/login", loginRateLimiter, async (req, res, next) => {
```

- [ ] **Step 4: Typecheck**

Run (from `artifacts/api-server`):
```bash
corepack pnpm typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/auth.ts
git commit -m "feat(api): rate-limit login and register endpoints"
```

---

### Task 7: Wire the AI generate limiter

**Files:**
- Modify: `artifacts/api-server/src/routes/ai-suggestions.ts`

- [ ] **Step 1: Import the limiter**

Add after line 3 (`import { requireAuth } from "../middlewares/auth";`):
```typescript
import { aiGenerateRateLimiter } from "../middlewares/rate-limit";
```

- [ ] **Step 2: Attach to the generate route**

Change line 101-103 from:
```typescript
router.post(
  "/documents/:id/ai-suggestions/generate",
  requireAuth,
  async (req, res, next) => {
```
to:
```typescript
router.post(
  "/documents/:id/ai-suggestions/generate",
  requireAuth,
  aiGenerateRateLimiter,
  async (req, res, next) => {
```
(The limiter runs after `requireAuth` so `req.authUser` is populated for per-user keying.)

- [ ] **Step 3: Typecheck**

Run (from `artifacts/api-server`):
```bash
corepack pnpm typecheck
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/ai-suggestions.ts
git commit -m "feat(api): rate-limit AI suggestion generation per user"
```

---

### Task 8: Document the new env vars

**Files:**
- Modify: `.env.example` (repo root)

- [ ] **Step 1: Append the rate-limit block**

Add to the end of `.env.example` (after line 37):
```bash

# Rate limiting (design 2026-06-13). All optional; defaults shown.
# Set RATE_LIMIT_ENABLED=false to disable all limiters (e.g. load tests).
RATE_LIMIT_ENABLED=true
RATE_LIMIT_LOGIN_MAX=5
RATE_LIMIT_LOGIN_WINDOW_MS=900000
RATE_LIMIT_REGISTER_MAX=5
RATE_LIMIT_REGISTER_WINDOW_MS=3600000
RATE_LIMIT_AI_MAX=5
RATE_LIMIT_AI_WINDOW_MS=60000
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: document rate-limit env vars in .env.example"
```

---

### Task 9: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole package**

Run (from `artifacts/api-server`):
```bash
corepack pnpm typecheck
```
Expected: PASS.

- [ ] **Step 2: Run the full api-server test suite**

Run (from `artifacts/api-server`):
```bash
corepack pnpm test
```
Expected: PASS — all pre-existing tests green PLUS the new `rate-limit.test.ts` (3 tests). Because limiters `skip` in the `test` env, no existing route/service test is throttled.

- [ ] **Step 3: Build (confirms esbuild bundles the new deps)**

Run (from `artifacts/api-server`):
```bash
corepack pnpm build
```
Expected: builds `dist/index.mjs` with no errors. (The project bundles with esbuild; this confirms `express-rate-limit` and `helmet` bundle cleanly.)

- [ ] **Step 4: Manual smoke check (optional but recommended)**

Start the app per the Windows dev setup (`.\dev.ps1`), then with `RATE_LIMIT_ENABLED=true` and a low `RATE_LIMIT_LOGIN_MAX` (e.g. 2), POST wrong credentials to `/api/auth/login` 3 times. Expected: the 3rd response is `429` with body `{ "error": { "code": "rate_limited", ... } }` and `RateLimit-*` response headers. Also confirm a document preview/thumbnail still loads in the web app (verifies helmet's `crossOriginResourcePolicy` did not break cross-origin media).

- [ ] **Step 5: Final commit (if any manual-fix changes were needed)**

```bash
git add -A
git commit -m "test: verify rate-limiting and security hardening"
```
(Skip if there is nothing to commit.)

---

## Notes for the implementer

- **Per-instance counters:** the in-memory store means limits are per Cloud Run instance. This is intentional for now (see spec "Deferred / known limitations"). Do **not** add a Postgres store in this plan.
- **Why `skipSuccessfulRequests` only on login:** a legitimate user logging in repeatedly should never be locked out — only failed attempts count toward the login limit. Register and AI count all requests.
- **Express 5 compatibility:** `express-rate-limit` v7 supports Express 5. If `corepack pnpm add` resolves a version older than 7.1, pin `express-rate-limit@^7` explicitly.
- **`ipKeyGenerator`:** required for the AI limiter's IP fallback so IPv6 addresses are normalized; building a key directly from `req.ip` triggers an express-rate-limit validation error.
