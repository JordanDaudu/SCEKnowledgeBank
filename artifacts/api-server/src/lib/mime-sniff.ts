// Lightweight magic-byte sniffing for the file types we accept.
// Returns true when the buffer's leading bytes match the claimed mime type
// (or look reasonable for text/plain etc.). Returns false on a clear mismatch.

type MimeKind =
  | "pdf"
  | "png"
  | "jpeg"
  | "zip-office"
  | "doc-old"
  | "text"
  | "unknown";

function detect(buf: Buffer): MimeKind {
  if (buf.length >= 4 && buf.slice(0, 4).toString("ascii") === "%PDF") return "pdf";
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  )
    return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return "jpeg";
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b) return "zip-office"; // ZIP / docx / xlsx / pptx
  if (
    buf.length >= 8 &&
    buf[0] === 0xd0 &&
    buf[1] === 0xcf &&
    buf[2] === 0x11 &&
    buf[3] === 0xe0
  )
    return "doc-old"; // legacy .doc/.xls/.ppt
  // Heuristic: if mostly printable ASCII / UTF-8 then text-like
  const sample = buf.subarray(0, Math.min(buf.length, 4096));
  let printable = 0;
  for (const b of sample) {
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126)) printable++;
  }
  if (sample.length > 0 && printable / sample.length > 0.9) return "text";
  return "unknown";
}

export function mimeMatchesContent(declared: string, buf: Buffer): boolean {
  const kind = detect(buf);
  if (kind === "unknown") return false;
  switch (declared) {
    case "application/pdf":
      return kind === "pdf";
    case "image/png":
      return kind === "png";
    case "image/jpeg":
      return kind === "jpeg";
    case "application/zip":
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return kind === "zip-office";
    case "application/msword":
    case "application/vnd.ms-powerpoint":
    case "application/vnd.ms-excel":
      return kind === "doc-old";
    case "text/plain":
    case "text/markdown":
    case "text/csv":
      return kind === "text";
    default:
      return false;
  }
}
