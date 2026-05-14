import path from "node:path";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const isProduction = process.env.NODE_ENV === "production";

function requireSecret(name: string, devFallback: string): string {
  const v = process.env[name];
  if (v && v.length >= 16) return v;
  if (isProduction) {
    throw new Error(
      `Missing required environment variable ${name} (must be set to a strong secret in production).`,
    );
  }
  return devFallback;
}

const webOriginRaw = process.env.WEB_ORIGIN ?? "";
const webOrigins = webOriginRaw
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction,
  port: Number(process.env.PORT ?? 8080),
  webOrigins,
  sessionSecret: requireSecret(
    "SESSION_SECRET",
    "dev-session-secret-not-for-production-knowledge-bank-32chars",
  ),
  signedUrlSecret: requireSecret(
    "SIGNED_URL_SECRET",
    "dev-signed-url-secret-not-for-production-knowledge-bank-32chars",
  ),
  signedUrlTtlSeconds: num("SIGNED_URL_TTL_SECONDS", 300),
  maxUploadMb: num("MAX_UPLOAD_MB", 50),
  allowedMimeTypes: (
    process.env.ALLOWED_MIME_TYPES ??
    "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/markdown,text/csv,image/png,image/jpeg,application/zip"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  storageDriver: (process.env.STORAGE_DRIVER ?? "local") as "local" | "s3",
  storageLocalRoot: process.env.STORAGE_LOCAL_ROOT
    ? path.resolve(process.env.STORAGE_LOCAL_ROOT)
    : path.resolve(process.cwd(), ".data/storage"),
  databaseUrl: process.env.DATABASE_URL ?? "",
};
