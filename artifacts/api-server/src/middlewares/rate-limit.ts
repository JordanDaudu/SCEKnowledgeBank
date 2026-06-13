import { rateLimit, type RateLimitRequestHandler } from "express-rate-limit";
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
  // The AI generate route runs requireAuth first, so authUser is always
  // present here; the IP fallback is just defensive.
  keyGenerator: (req) => req.authUser?.id ?? req.ip ?? "anonymous",
});
