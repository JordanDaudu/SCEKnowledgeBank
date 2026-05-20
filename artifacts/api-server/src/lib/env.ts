import path from "node:path";
import { z } from "zod";

const DEFAULT_ALLOWED_MIME_TYPES =
  "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/markdown,text/csv,image/png,image/jpeg,application/zip";

const DEV_SESSION_SECRET =
  "dev-session-secret-not-for-production-knowledge-bank-32chars";
const DEV_SIGNED_URL_SECRET =
  "dev-signed-url-secret-not-for-production-knowledge-bank-32chars";

// Derive production strictly from a normalised NODE_ENV so accidental
// whitespace ("production ") or typos ("Production") cannot silently drop us
// into the dev-fallback path that allows weak secrets.
const normalizedNodeEnv = (process.env.NODE_ENV ?? "development")
  .trim()
  .toLowerCase();
const isProduction = normalizedNodeEnv === "production";

const csvList = z
  .string()
  .transform((s) =>
    s
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  );

function requiredSecret(name: string, devFallback: string) {
  return z
    .string()
    .optional()
    .transform((v, ctx) => {
      const trimmed = (v ?? "").trim();
      if (trimmed.length >= 16) return trimmed;
      if (isProduction) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing required environment variable ${name} (must be a strong secret of at least 16 chars in production).`,
        });
        return z.NEVER;
      }
      return devFallback;
    });
}

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  WEB_ORIGIN: z.string().optional().default(""),
  DATABASE_URL: z.string().default(""),

  SESSION_SECRET: requiredSecret("SESSION_SECRET", DEV_SESSION_SECRET),
  SIGNED_URL_SECRET: requiredSecret("SIGNED_URL_SECRET", DEV_SIGNED_URL_SECRET),

  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(50),
  // Server-wide default per-user storage quota (in MB). Individual users
  // can override via `users.quota_bytes`; when NULL this value is used.
  DEFAULT_USER_STORAGE_QUOTA_MB: z.coerce.number().int().positive().default(500),

  ALLOWED_MIME_TYPES: csvList.default(DEFAULT_ALLOWED_MIME_TYPES),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_ROOT: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}
const e = parsed.data;

export const env = {
  nodeEnv: e.NODE_ENV,
  isProduction,
  port: e.PORT,
  webOrigins: e.WEB_ORIGIN.split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  databaseUrl: e.DATABASE_URL,
  sessionSecret: e.SESSION_SECRET,
  signedUrlSecret: e.SIGNED_URL_SECRET,
  signedUrlTtlSeconds: e.SIGNED_URL_TTL_SECONDS,
  maxUploadMb: e.MAX_UPLOAD_MB,
  defaultUserStorageQuotaBytes:
    BigInt(e.DEFAULT_USER_STORAGE_QUOTA_MB) * BigInt(1024 * 1024),
  allowedMimeTypes: e.ALLOWED_MIME_TYPES,
  storageDriver: e.STORAGE_DRIVER,
  storageLocalRoot: e.STORAGE_LOCAL_ROOT
    ? path.resolve(e.STORAGE_LOCAL_ROOT)
    : path.resolve(process.cwd(), ".data/storage"),
};
