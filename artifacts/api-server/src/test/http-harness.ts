import express, { type Express, type IRouter } from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachUser } from "../middlewares/auth";
import { errorHandler, notFoundHandler } from "../middlewares/error";

/**
 * Builds an API app for HTTP-level (route) tests. It mirrors the middleware
 * chain in `src/app.ts` — cookie parsing, JSON/urlencoded bodies, session,
 * `attachUser`, the not-found/error handlers — but swaps the Postgres-backed
 * session store for an in-memory one.
 *
 * Only the router under test is mounted (rather than the full `/api` router),
 * so tests stay hermetic and need no database: as long as the test mocks the
 * services that router calls (`vi.mock("../services/...")`), the real
 * services — and their `@workspace/db` imports — never load. This matches the
 * suite's repo-mocking convention for unit tests.
 *
 * To exercise authenticated routes, mock `loadAuthenticatedUser` from
 * `../services/auth.service` and use {@link authedAgent}, which seeds a session
 * via the test-only login route below.
 *
 * @param basePath where to mount the router, e.g. `"/api/auth"`.
 * @param router the router under test.
 */
export function createTestApp(basePath: string, router: IRouter): Express {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(
    session({
      name: "kb.sid",
      secret: "test-session-secret-at-least-16-characters",
      resave: false,
      saveUninitialized: false,
    }),
  );

  // Test-only helper route: seeds `req.session.userId` so suites can
  // authenticate without real credentials. Registered before `attachUser` so
  // it does not itself require a loaded user.
  app.post("/__test__/login", (req, res, next) => {
    req.session.userId = (req.body as { userId?: string })?.userId;
    req.session.save((err) => (err ? next(err) : res.json({ ok: true })));
  });

  app.use(attachUser);
  app.use(basePath, router);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

/**
 * Returns a supertest agent carrying a session cookie for `userId`. The caller
 * must have mocked `loadAuthenticatedUser` to resolve a user for that id, since
 * `attachUser` calls it on every authenticated request.
 */
export async function authedAgent(
  app: Express,
  userId: string,
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  await agent.post("/__test__/login").send({ userId }).expect(200);
  return agent;
}
