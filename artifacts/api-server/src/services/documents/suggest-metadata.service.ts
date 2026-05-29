/**
 * Sprint-3 M4: suggest-metadata service.
 *
 * The upload form fires one of these per first-selected file. The
 * server runs the same extractor + post-processor chain it would on
 * a real upload, plus a checksum dedup probe, plus a name-match
 * against existing Tag / Category rows. We deliberately:
 *
 *   • do NOT auto-create tags or categories — the user picks from
 *     existing labels, so admins keep curatorial control.
 *   • do NOT persist anything — this endpoint is a read of the file
 *     bytes the user just selected, not a side-effectful upload.
 *   • run extraction in a separate try/catch from the dedup lookup
 *     so a flaky PDF still surfaces a duplicate banner.
 */
import { createHash } from "node:crypto";
import { db } from "@workspace/db";
import { extractMetadata } from "./metadata.service";
import { findVisibleDuplicateByChecksum, type DuplicateHit } from "./dedup.service";
import type { AuthenticatedUser } from "../../middlewares/auth";

export interface SuggestionInput {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

export interface SuggestionResult {
  /** Best-guess title — PDF metadata title, else filename stem. */
  title?: string;
  /**
   * Where `title` came from, so the UI can convey confidence:
   *   - "metadata" → extracted from the file's embedded title (high)
   *   - "filename" → derived from the filename stem (low)
   * Undefined when no title could be suggested.
   */
  titleSource?: "metadata" | "filename";
  /** ISO-639-1 short code; undefined when undetected. */
  language?: string;
  /** Top content terms by frequency; empty when nothing extractable. */
  keywords: string[];
  /** Existing Tag rows whose name overlaps a keyword. */
  tags: Array<{ id: string; name: string }>;
  /** Existing Category whose name overlaps a keyword. */
  category?: { id: string; name: string };
  /** Set when an identical-checksum doc is already visible to the user. */
  duplicate?: DuplicateHit;
}

/**
 * Strip the extension off a filename and humanise the stem for use as
 * a suggested title: `mech_201-lecture-3.pdf` → `Mech 201 Lecture 3`.
 * Whitespace collapsed; very short stems fall through unchanged so we
 * don't suggest "" or "1" as a title.
 */
function humaniseFilename(filename: string): string | undefined {
  const stem = filename.includes(".")
    ? filename.slice(0, filename.lastIndexOf("."))
    : filename;
  const cleaned = stem
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 2) return undefined;
  // Title-case each whitespace-delimited word; leave existing camelCase
  // tokens (e.g. "MECH201") alone so we don't mangle codes.
  return cleaned
    .split(" ")
    .map((w) =>
      /^[A-Z0-9]+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(" ");
}

/**
 * Look up existing Tag rows whose name (case-insensitive) exactly
 * matches any keyword. We cap the SQL OR to avoid pathological
 * queries on noisy text — the keyword list is already small (≤8) but
 * adding a guard is cheap insurance.
 */
async function matchTags(
  keywords: string[],
): Promise<Array<{ id: string; name: string }>> {
  if (keywords.length === 0) return [];
  const terms = keywords.slice(0, 16);
  const rows = await db.tag.findMany({
    where: {
      OR: terms.map((t) => ({ name: { equals: t, mode: "insensitive" as const } })),
    },
    select: { id: true, name: true },
    take: 8,
  });
  return rows;
}

/**
 * Same shape as `matchTags`, but for Categories. Returns the first
 * hit — the upload form only renders a single suggested category.
 */
async function matchCategory(
  keywords: string[],
): Promise<{ id: string; name: string } | undefined> {
  if (keywords.length === 0) return undefined;
  const terms = keywords.slice(0, 16);
  const row = await db.category.findFirst({
    where: {
      OR: terms.map((t) => ({ name: { equals: t, mode: "insensitive" as const } })),
    },
    select: { id: true, name: true },
  });
  return row ?? undefined;
}

export async function suggestForUpload(
  input: SuggestionInput,
  user: AuthenticatedUser,
): Promise<SuggestionResult> {
  // Run extraction and dedup concurrently — they don't depend on each
  // other and both are bounded by their own timeouts/IO.
  const checksum = createHash("sha256").update(input.buffer).digest("hex");
  const [extracted, duplicate] = await Promise.all([
    extractMetadata({
      buffer: input.buffer,
      mimeType: input.mimeType,
      filename: input.filename,
    }),
    findVisibleDuplicateByChecksum(checksum, user),
  ]);

  const keywords = extracted.keywords ?? [];
  const [tags, category] = await Promise.all([
    matchTags(keywords),
    matchCategory(keywords),
  ]);

  const result: SuggestionResult = { keywords, tags };
  const metadataTitle = extracted.detectedTitle?.trim();
  if (metadataTitle) {
    result.title = metadataTitle;
    result.titleSource = "metadata";
  } else {
    const fromName = humaniseFilename(input.filename);
    if (fromName) {
      result.title = fromName;
      result.titleSource = "filename";
    }
  }
  if (extracted.language) result.language = extracted.language;
  if (category) result.category = category;
  if (duplicate) result.duplicate = duplicate;
  return result;
}
