import path from "node:path";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: process.env.NODE_ENV === "production",
  port: Number(process.env.PORT ?? 8080),
  webOrigin: process.env.WEB_ORIGIN ?? "",
  sessionSecret:
    process.env.SESSION_SECRET ??
    "dev-session-secret-change-me-for-production-knowledge-bank",
  signedUrlSecret:
    process.env.SIGNED_URL_SECRET ??
    "dev-signed-url-secret-change-me-for-production-knowledge-bank",
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
