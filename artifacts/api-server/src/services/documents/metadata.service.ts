import sharp from "sharp";
import { logger } from "../../lib/logger";
import { detectLanguage, extractKeywords } from "./intelligence.service";

// `pdf-parse` pulls in pdf.js display code at import time, which
// references browser globals like `DOMMatrix`. We only need it inside
// the PDF handler, so import it lazily — keeps server startup green
// even when @napi-rs/canvas isn't installed.
async function loadPdfParse(): Promise<typeof import("pdf-parse")> {
  return import("pdf-parse");
}

/**
 * Extracted-metadata payload produced by the per-type handlers below
 * and persisted onto `DocumentFile`. Every field is independently
 * optional: an extractor may populate some but not others (e.g. a
 * thumbnail-only image, or a PDF whose text is encrypted but whose
 * page count is readable). On total failure the service returns
 * `EMPTY_METADATA` and the caller falls back to a generic icon.
 */
export interface ExtractedMetadata {
  extractedText?: string;
  pageCount?: number;
  detectedTitle?: string;
  author?: string;
  imageWidth?: number;
  imageHeight?: number;
  /** Raw thumbnail bytes; caller is responsible for writing them to storage. */
  thumbnail?: { body: Buffer; mimeType: string };
  // ── Smart-metadata post-processors (Sprint-3 M4) ──────────────
  // Populated by `runPostProcessors` after the per-MIME extractor
  // returns. Both depend solely on `extractedText`, so a file whose
  // extractor only produced page-count or image-dims will leave them
  // undefined — the keyword/language columns will simply be NULL.
  language?: string;
  keywords?: string[];
}

export const EMPTY_METADATA: ExtractedMetadata = {};

/**
 * Hard per-file timeout. Extraction runs inline on the upload request,
 * so we cannot let a malformed PDF (or sharp pipeline) wedge the
 * worker indefinitely. 10 s is comfortably above legitimate PDF
 * extraction times for 50 MB documents on this hardware while still
 * keeping the upload responsive on the worst case.
 */
const DEFAULT_TIMEOUT_MS = 10_000;

/** Cap stored text so a multi-thousand-page PDF cannot blow up the row. */
const MAX_EXTRACTED_TEXT_BYTES = 50_000;

const THUMBNAIL_MAX_DIM = 400;

function truncateText(text: string): string {
  if (text.length <= MAX_EXTRACTED_TEXT_BYTES) return text;
  return text.slice(0, MAX_EXTRACTED_TEXT_BYTES);
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label}: timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// ─── Per-type handlers ────────────────────────────────────────────

async function extractPdf(buf: Buffer): Promise<ExtractedMetadata> {
  const { PDFParse } = await loadPdfParse();
  const parser = new PDFParse({ data: buf });
  try {
    const [info, text] = await Promise.all([
      parser.getInfo(),
      parser.getText(),
    ]);
    const out: ExtractedMetadata = {};
    const pageCount = info?.total ?? text?.total;
    if (typeof pageCount === "number" && pageCount > 0) out.pageCount = pageCount;
    const concatenated =
      text?.text ||
      (text?.pages?.map((p) => p.text).filter(Boolean).join("\n\n") ?? "");
    if (concatenated) out.extractedText = truncateText(concatenated);
    const meta = info?.info as Record<string, unknown> | undefined;
    if (meta) {
      const t = meta.Title;
      if (typeof t === "string" && t.trim()) out.detectedTitle = t.trim();
      const a = meta.Author;
      if (typeof a === "string" && a.trim()) out.author = a.trim();
    }
    return out;
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extractImage(
  buf: Buffer,
  mimeType: string,
): Promise<ExtractedMetadata> {
  const img = sharp(buf, { failOn: "none" });
  const meta = await img.metadata();
  const out: ExtractedMetadata = {};
  if (typeof meta.width === "number") out.imageWidth = meta.width;
  if (typeof meta.height === "number") out.imageHeight = meta.height;

  // Thumbnail: cap to 400x400 keeping aspect ratio. JPEG keeps the
  // payload small; for PNGs with transparency we'd ideally keep PNG,
  // but every file type in our allow-list works fine with a flattened
  // JPEG thumb and the wins on size matter more than perfect alpha.
  const thumbBuf = await sharp(buf, { failOn: "none" })
    .rotate()
    .resize({
      width: THUMBNAIL_MAX_DIM,
      height: THUMBNAIL_MAX_DIM,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 78 })
    .toBuffer();
  out.thumbnail = { body: thumbBuf, mimeType: "image/jpeg" };
  void mimeType;
  return out;
}

function extractText(buf: Buffer): ExtractedMetadata {
  // Strip a UTF-8 BOM if present and decode lossily so a stray
  // non-UTF-8 byte cannot poison the column.
  const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });
  const text = decoder.decode(buf);
  if (!text.trim()) return EMPTY_METADATA;
  return { extractedText: truncateText(text) };
}

// ─── Post-processor chain (Sprint-3 M4) ───────────────────────────
//
// Pluggable transforms that run *after* the per-MIME extractor. They
// only depend on the cross-format `extractedText` field, so adding a
// new processor doesn't require touching every extractor above.
// Failures are swallowed individually — one bad post-processor must
// not blank out the page-count or thumbnail the extractor produced.

type PostProcessor = (input: ExtractedMetadata) => Partial<ExtractedMetadata>;

const POST_PROCESSORS: PostProcessor[] = [
  (m) => {
    if (!m.extractedText) return {};
    const lang = detectLanguage(m.extractedText);
    return lang ? { language: lang } : {};
  },
  (m) => {
    if (!m.extractedText) return {};
    const kws = extractKeywords(m.extractedText);
    return kws.length > 0 ? { keywords: kws } : {};
  },
];

function runPostProcessors(m: ExtractedMetadata): ExtractedMetadata {
  let out = m;
  for (const p of POST_PROCESSORS) {
    try {
      out = { ...out, ...p(out) };
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "metadata post-processor failed; skipping",
      );
    }
  }
  return out;
}

// ─── Dispatcher ───────────────────────────────────────────────────

/**
 * Run the appropriate extractor for `mimeType` against `buffer`,
 * wrapped in a per-file timeout. **Never throws** — on timeout, on
 * unsupported MIME, on any extractor error, returns `EMPTY_METADATA`
 * and logs the failure. The upload pipeline relies on this so a bad
 * PDF cannot cascade into a 5xx.
 */
export async function extractMetadata(args: {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  timeoutMs?: number;
}): Promise<ExtractedMetadata> {
  const { buffer, mimeType, filename } = args;
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let base: ExtractedMetadata;
  try {
    if (mimeType === "application/pdf") {
      base = await withTimeout(extractPdf(buffer), timeoutMs, "pdf extract");
    } else if (mimeType.startsWith("image/")) {
      base = await withTimeout(
        extractImage(buffer, mimeType),
        timeoutMs,
        "image extract",
      );
    } else if (
      mimeType === "text/plain" ||
      mimeType === "text/markdown" ||
      mimeType === "text/csv"
    ) {
      // No external work, but still bound it just in case Buffer is enormous.
      base = await withTimeout(
        Promise.resolve(extractText(buffer)),
        timeoutMs,
        "text extract",
      );
    } else {
      base = EMPTY_METADATA;
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), mimeType, filename },
      "metadata extraction failed; falling back to empty metadata",
    );
    base = EMPTY_METADATA;
  }
  return runPostProcessors(base);
}

// ─── Fallback-icon mapping ────────────────────────────────────────

export type FallbackIconType =
  | "pdf"
  | "image"
  | "doc"
  | "slides"
  | "sheet"
  | "text"
  | "archive"
  | "unknown";

/**
 * Pure mapping from a MIME type to one of a small set of bucket icons
 * the frontend renders when no thumbnail is available. Kept in the
 * API so the DTO and the seed scripts derive the same value; the web
 * client has its own copy in `lib/fallback-icon.ts` to keep the
 * component import-graph clean.
 */
export function fallbackIconFor(mimeType: string | undefined): FallbackIconType {
  if (!mimeType) return "unknown";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  if (
    mimeType === "application/msword" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "doc";
  }
  if (
    mimeType === "application/vnd.ms-powerpoint" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return "slides";
  }
  if (
    mimeType === "application/vnd.ms-excel" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return "sheet";
  }
  if (
    mimeType === "text/plain" ||
    mimeType === "text/markdown" ||
    mimeType === "text/csv"
  ) {
    return "text";
  }
  if (
    mimeType === "application/zip" ||
    mimeType === "application/x-tar" ||
    mimeType === "application/gzip"
  ) {
    return "archive";
  }
  return "unknown";
}
