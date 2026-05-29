/**
 * Recover a multipart upload filename that was decoded as latin1.
 *
 * multer (via busboy, whose `defParamCharset` defaults to "latin1") exposes
 * `file.originalname` as the raw Content-Disposition filename bytes
 * reinterpreted as latin1. Browsers send those bytes as UTF-8, so a non-ASCII
 * name (e.g. Hebrew "סיכום.pdf") arrives mojibake'd. Reinterpreting the latin1
 * bytes back as UTF-8 restores it. ASCII is unaffected (identical in both
 * encodings).
 *
 * Guard: if the bytes don't form valid UTF-8 (a genuinely latin1 name), the
 * re-decode would introduce U+FFFD — in that case we keep the original rather
 * than corrupt it.
 */
export function decodeMultipartFilename(name: string): string {
  if (!name) return name;
  const decoded = Buffer.from(name, "latin1").toString("utf8");
  if (decoded.includes("�") && !name.includes("�")) return name;
  return decoded;
}

/**
 * Build a `Content-Disposition` header value that survives non-ASCII (e.g.
 * Hebrew) filenames. Emits both a sanitised ASCII `filename=` fallback for
 * legacy clients and an RFC 5987 `filename*=UTF-8''…` parameter that modern
 * browsers use to restore the real UTF-8 name.
 */
export function contentDisposition(
  disposition: "inline" | "attachment",
  filename: string,
): string {
  const ascii = filename.replace(/[^A-Za-z0-9._-]/g, "_") || "download";
  // encodeURIComponent leaves !'()*~ unescaped; RFC 5987 ext-value requires
  // escaping the attr-char exclusions, so finish the job for ' ( ) *.
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
