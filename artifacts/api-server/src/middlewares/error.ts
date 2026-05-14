import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: "not_found", message: "Not found" } });
}

function isZodError(err: unknown): err is { issues: unknown[]; flatten?: () => unknown } {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: string }).name === "ZodError" &&
    Array.isArray((err as { issues?: unknown }).issues)
  );
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }
  if (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: string }).name === "MulterError"
  ) {
    const code = (err as { code?: string }).code;
    const status = code === "LIMIT_FILE_SIZE" ? 413 : 400;
    res.status(status).json({
      error: {
        code: code === "LIMIT_FILE_SIZE" ? "file_too_large" : "upload_error",
        message:
          (err as { message?: string }).message || "File upload error",
      },
    });
    return;
  }
  if (isZodError(err)) {
    res.status(400).json({
      error: {
        code: "validation_error",
        message: "Invalid request",
        details: typeof err.flatten === "function" ? err.flatten() : err.issues,
      },
    });
    return;
  }
  logger.error({ err }, "Unhandled error");
  res
    .status(500)
    .json({ error: { code: "internal", message: "Internal server error" } });
}
