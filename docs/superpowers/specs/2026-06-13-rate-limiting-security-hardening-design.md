# Rate-Limiting & Security Hardening — Design

**Date:** 2026-06-13
**Status:** Approved (design), pending implementation plan
**Scope:** API server (`artifacts/api-server`) only. No frontend changes required.

## Goal

Close three security gaps in the API:

1. **Login brute-force** — `POST /auth/login` and `POST /auth/register` have no rate limiting, allowing unlimited credential-stuffing / account-flood attempts.
2. **Gemini/AI cost abuse** — `POST /documents/:id/ai-suggestions/generate` calls the paid Gemini API with no per-user throttle; a single user can spam it.
3. **Missing HTTP security headers** — no `helmet`; the app ships no clickjacking / HSTS / nosniff protection.

Out of scope (explicitly chosen): account lockout tables, CAPTCHA, email verification, durable per-user daily AI quotas, distributed rate-limit store. These were considered and deferred to keep the change small. See "Deferred / known limitations".

## Current state (verified)

- Express 5 app in `src/app.ts`; `app.set("trust proxy", 1)` already present (line 14) → correct client IP behind Cloud Run / reverse proxy.
- Middleware order: cors → cookieParser → `express.json({limit:"2mb"})` → urlencoded → session → `attachUser` → routers → `errorHandler` (last).
- Login (`src/services/auth.service.ts`): bcrypt (`bcryptjs`, 10 rounds), case-insensitive email lookup, **generic `unauthorized("Invalid credentials")`** for both unknown-user and bad-password (no user enumeration), audit log on success. No rate limit, no lockout.
- Session cookies (`src/middlewares/session.ts`): `httpOnly`, `secure` in prod, `sameSite` none(prod)/lax(dev), 14-day rolling. Good.
- AI generate (`src/routes/ai-suggestions.ts`): `requireAuth` + ownership check. No per-user throttle, no timeout, no cost cap.
- Env (`src/lib/env.ts`): zod-validated, production-enforced secrets, `isProduction` helper. No `isTest` helper yet.
- No `express-rate-limit`, no `helmet` in `package.json`.
- Tests: vitest + supertest. Unit tests mock `env` and repos.

## Approach

Lightweight, in-memory `express-rate-limit` limiters applied to the three endpoints, plus `helmet` with a conservative config. All limits are env-configurable with safe defaults so behavior is unchanged if no new env vars are set. Limiters are skipped in the `test` environment so the existing suite is unaffected.

## Components

### 1. Dependencies (api-server `package.json`)

- `express-rate-limit` (v7.x)
- `helmet` (v8.x)

### 2. New module: `src/middlewares/rate-limit.ts`

Exports a small set of pre-configured limiters built from a shared factory.

```
makeLimiter({ windowMs, max, keyBy, skipSuccessfulRequests? })
```

- `standardHeaders: true`, `legacyHeaders: false`.
- `skip`: returns `true` when `!env.rateLimitEnabled` OR `env.isTest` → limiter is a no-op in tests / when disabled.
- `handler`: instead of express-rate-limit's default response, calls `next(...)` with an httpError-style error so the response flows through the existing `errorHandler` (consistent JSON shape). Status **429**, code **`rate_limited`**, generic message, and include `retryAfter` seconds.
- `keyGenerator`:
  - login/register → client IP (default generator; works with `trust proxy`). Use express-rate-limit's IPv6-safe `ipKeyGenerator` helper.
  - AI → authenticated user id (`req.authUser?.id`) with IP fallback via the IPv6-safe helper.

Exported limiters:

| Export | Endpoint | Default window | Default max | Notes |
|---|---|---|---|---|
| `loginRateLimiter` | `POST /auth/login` | 15 min | 5 | `skipSuccessfulRequests: true` — only failed (4xx) attempts count, so a legit user is never penalized |
| `registerRateLimiter` | `POST /auth/register` | 1 hour | 5 | per IP |
| `aiGenerateRateLimiter` | `POST /documents/:id/ai-suggestions/generate` | 1 min | 5 | per authed user |

### 3. Env config (`src/lib/env.ts`)

Add (zod, all with defaults — nothing breaks if unset):

- `RATE_LIMIT_ENABLED` (boolean, default `true`)
- `RATE_LIMIT_LOGIN_MAX` (int, default `5`), `RATE_LIMIT_LOGIN_WINDOW_MS` (int, default `900000`)
- `RATE_LIMIT_REGISTER_MAX` (int, default `5`), `RATE_LIMIT_REGISTER_WINDOW_MS` (int, default `3600000`)
- `RATE_LIMIT_AI_MAX` (int, default `5`), `RATE_LIMIT_AI_WINDOW_MS` (int, default `60000`)

Also add an `isTest` helper (derived from `NODE_ENV === "test"`) alongside the existing `isProduction`.

### 4. Helmet (`src/app.ts`)

`app.use(helmet({ ... }))` placed early (after `trust proxy`, around the cors/parser block). Conservative config:

- `contentSecurityPolicy: false` — CSP would break the Vite SPA; deferred (can be added later in report-only mode).
- `crossOriginResourcePolicy: { policy: "cross-origin" }` — **critical**: the web app loads document preview/thumbnail streams from the API on a different origin; helmet's default `same-origin` CORP would block those cross-origin `<img>`/preview loads.
- `crossOriginEmbedderPolicy: false`.
- Retained protections: HSTS (prod), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, referrer policy.

### 5. Wiring

- `src/routes/auth.ts`: attach `loginRateLimiter` to the `/login` route and `registerRateLimiter` to the `/register` route, before the handlers.
- `src/routes/ai-suggestions.ts`: attach `aiGenerateRateLimiter` to the `/:id/ai-suggestions/generate` route, before `requireAuth`'s handler chain (order: limiter can run before or after auth; placing after `requireAuth` lets us key by user id — `attachUser` already populated `req.authUser` globally, so keying by user works regardless. Place the limiter so `req.authUser` is available for the key generator).

## Data flow

```
request → helmet headers set → (route) limiter checks counter
  ├─ under limit → next() → normal handler
  └─ over limit  → handler() → next(rateLimitedError) → errorHandler → 429 JSON {code:"rate_limited", retryAfter}
```

No DB writes. Counters live in the limiter's in-memory store per process.

## Error handling

429 responses use the existing `errorHandler` convention (same JSON envelope as other API errors, no stack traces in prod). The frontend already renders API error messages, so a 429 surfaces as a normal toast ("too many attempts, try again later") with **no frontend changes**.

## Testing

- **New** `src/middlewares/rate-limit.test.ts`: mount a minimal `express()` app with a `max: 2` limiter via supertest; assert the 3rd request returns 429, that `RateLimit-*` headers are present, and that the error body matches the `rate_limited` shape. Isolated — no DB, no full app.
- Confirm the existing vitest suite stays green: limiters `skip` in `test` env, so auth/AI tests that hit these endpoints repeatedly are unaffected.
- Typecheck must pass across packages.

## Deferred / known limitations

- **In-memory, per-instance counters.** On a single Cloud Run instance limits are exact. If the service scales to N instances, each keeps its own counter, so an attacker effectively gets up to N× the limit. **Upgrade path (no API change):** swap the limiter `store` for a Postgres-backed store (`rate-limit-postgresql`) using the existing `pool`. Documented, not implemented.
- No account lockout / CAPTCHA / email verification (chosen).
- No durable per-user daily AI quota — only a short-window throttle. A user could still accumulate calls slowly over a day. (Chosen; daily quota is the documented next step if cost becomes a concern.)
- No Gemini request timeout added in this pass (was mentioned as a "quota" tier extra; out of the chosen lightweight scope). Can be added to `getClient()` later.

## Files

**New**
- `artifacts/api-server/src/middlewares/rate-limit.ts`
- `artifacts/api-server/src/middlewares/rate-limit.test.ts`

**Modified**
- `artifacts/api-server/package.json` (deps)
- `artifacts/api-server/src/lib/env.ts` (rate-limit vars + `isTest`)
- `artifacts/api-server/src/app.ts` (helmet)
- `artifacts/api-server/src/routes/auth.ts` (login/register limiters)
- `artifacts/api-server/src/routes/ai-suggestions.ts` (AI limiter)
- `.env.example` and/or deploy docs (document new env vars)
