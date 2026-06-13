import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { sessionMiddleware } from "./middlewares/session";
import { attachUser } from "./middlewares/auth";
import { errorHandler, notFoundHandler } from "./middlewares/error";
import { env } from "./lib/env";

const app: Express = express();

app.set("trust proxy", 1);

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

app.use(
  pinoHttp({
    logger,
    // Sprint-3 M7 log-hygiene: drop the per-request 2xx noise to
    // `debug` so a normal dev run is quiet. Anything 4xx/5xx still
    // surfaces at warn/error.
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "debug";
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(
  cors({
    origin: (origin, cb) => {
      // Same-origin or non-browser (no Origin header) is allowed.
      if (!origin) return cb(null, true);
      if (env.webOrigins.length === 0) {
        // No allowlist configured: dev convenience only.
        if (env.isProduction) return cb(new Error("CORS: origin not allowed"));
        return cb(null, true);
      }
      if (env.webOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("CORS: origin not allowed"));
    },
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);
app.use(attachUser);

app.use("/api", router);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
