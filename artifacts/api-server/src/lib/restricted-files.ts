import { env } from "./env";

/**
 * A file is "restricted" (always requires admin approval) iff its extension is in
 * the configured restricted set. Recomputed on demand — no DB column.
 */
export function isRestrictedFilename(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return false;
  const ext = name.slice(dot + 1).toLowerCase();
  return env.restrictedFileExtensions.includes(ext);
}
