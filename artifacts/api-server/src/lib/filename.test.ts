import { describe, it, expect } from "vitest";
import { decodeMultipartFilename, contentDisposition } from "./filename";

// multer/busboy decode the multipart Content-Disposition filename as latin1,
// so a browser-sent UTF-8 name arrives as its UTF-8 bytes reinterpreted as
// latin1. This reproduces that mangling.
function mangle(utf8Name: string): string {
  return Buffer.from(utf8Name, "utf8").toString("latin1");
}

describe("decodeMultipartFilename", () => {
  it("leaves plain ASCII names unchanged", () => {
    expect(decodeMultipartFilename("lecture-notes.pdf")).toBe(
      "lecture-notes.pdf",
    );
  });

  it("recovers a Hebrew filename mangled by latin1 decoding", () => {
    const hebrew = "סיכום הרצאה.pdf";
    expect(decodeMultipartFilename(mangle(hebrew))).toBe(hebrew);
  });

  it("recovers mixed Hebrew + ASCII + digits", () => {
    const name = "תרגיל 3 - Algorithms.docx";
    expect(decodeMultipartFilename(mangle(name))).toBe(name);
  });

  it("recovers other UTF-8 scripts too (e.g. accented Latin)", () => {
    const name = "résumé café.pdf";
    expect(decodeMultipartFilename(mangle(name))).toBe(name);
  });

  it("handles empty and falsy input safely", () => {
    expect(decodeMultipartFilename("")).toBe("");
  });

  it("leaves a genuine non-UTF-8 latin1 name untouched (no corruption)", () => {
    // A lone 0xE9 ('é' in latin1) is not valid UTF-8; re-decoding would yield
    // U+FFFD, so the original must be preserved instead.
    const latin1Name = "caf\xe9.pdf";
    expect(decodeMultipartFilename(latin1Name)).toBe(latin1Name);
  });
});

describe("contentDisposition", () => {
  it("uses a plain quoted filename for ASCII names", () => {
    const h = contentDisposition("attachment", "report.pdf");
    expect(h).toContain('attachment; filename="report.pdf"');
    expect(h).toContain("filename*=UTF-8''report.pdf");
  });

  it("keeps an ASCII fallback and a UTF-8 filename* for Hebrew names", () => {
    const h = contentDisposition("attachment", "סיכום.pdf");
    // ASCII fallback replaces non-ASCII with underscores but keeps extension
    expect(h).toMatch(/filename="_+\.pdf"/);
    // filename* carries the real name, percent-encoded UTF-8
    const encoded = encodeURIComponent("סיכום.pdf");
    expect(h).toContain(`filename*=UTF-8''${encoded}`);
  });

  it("percent-escapes RFC 5987 reserved characters in filename*", () => {
    const h = contentDisposition("inline", "a'(b)*.pdf");
    expect(h).not.toMatch(/filename\*=UTF-8''[^;]*['()*]/);
  });

  it("never emits an empty ASCII fallback", () => {
    const h = contentDisposition("attachment", "סיכום");
    expect(h).not.toContain('filename=""');
  });
});
