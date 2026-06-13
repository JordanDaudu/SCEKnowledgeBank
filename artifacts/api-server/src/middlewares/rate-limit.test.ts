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
