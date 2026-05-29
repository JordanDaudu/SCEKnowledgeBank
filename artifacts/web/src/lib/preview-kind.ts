/**
 * The kind of in-browser preview a document's MIME type maps to.
 *
 * Single source of truth for how `PreviewPanel` decides which renderer to
 * use, and for whether `document-detail` should request a preview token at
 * all (`unsupported` skips it and shows the download fallback). Kept pure so
 * it can be unit-tested in isolation.
 */
export type PreviewKind =
  | "pdf"
  | "image"
  | "text"
  | "sheet"
  | "docx"
  | "unsupported";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLS_MIME = "application/vnd.ms-excel";

export function previewKindForMime(mime: string | undefined): PreviewKind {
  if (!mime) return "unsupported";

  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";

  if (mime === "text/plain" || mime === "text/markdown") return "text";

  // CSV and both Excel formats render as tables via SheetJS.
  if (mime === "text/csv" || mime === XLS_MIME || mime === XLSX_MIME) {
    return "sheet";
  }

  if (mime === DOCX_MIME) return "docx";

  // PowerPoint, legacy binary Word/PowerPoint, ZIP, and anything else have
  // no dependable client-side renderer — fall back to download.
  return "unsupported";
}
