import session, { type SessionOptions } from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";
import { env } from "../lib/env";

const PgStore = connectPgSimple(session);

export const sessionMiddleware = session({
  store: new PgStore({
    pool,
    tableName: "session",
    createTableIfMissing: false,
  }),
  name: "kb.sid",
  secret: env.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    // "none" is required for the session cookie to ride cross-site XHR between
    // the web origin (kb-web…run.app) and the API origin (kb-api…run.app),
    // which browsers treat as different sites. "none" REQUIRES secure:true,
    // which production already sets. Stay on "lax" in dev (http localhost,
    // where browsers reject sameSite:none without https).
    sameSite: env.isProduction ? "none" : "lax",
    secure: env.isProduction,
    maxAge: 1000 * 60 * 60 * 24 * 14,
  },
} as SessionOptions);

declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}
