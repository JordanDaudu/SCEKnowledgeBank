import { describe, expect, it } from "vitest";
import { mimeMatchesContent } from "./mime-sniff";

describe("mimeMatchesContent", () => {
  it("accepts PDF magic bytes for application/pdf", () => {
    const buf = Buffer.from("%PDF-1.7\n...");
    expect(mimeMatchesContent("application/pdf", buf)).toBe(true);
  });

  it("rejects a PDF claim when bytes are not a PDF", () => {
    const buf = Buffer.from("not a pdf");
    expect(mimeMatchesContent("application/pdf", buf)).toBe(false);
  });

  it("accepts PNG magic bytes for image/png", () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(mimeMatchesContent("image/png", buf)).toBe(true);
  });

  it("accepts JPEG magic bytes for image/jpeg", () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    expect(mimeMatchesContent("image/jpeg", buf)).toBe(true);
  });

  it("treats docx/zip-office signatures as a match for docx mime", () => {
    const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(
      mimeMatchesContent(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buf,
      ),
    ).toBe(true);
  });

  it("treats printable ASCII as text/plain", () => {
    const buf = Buffer.from("Hello world, this is plain text.\n");
    expect(mimeMatchesContent("text/plain", buf)).toBe(true);
  });

  it("rejects unknown mime types", () => {
    const buf = Buffer.from("%PDF-1.4");
    expect(mimeMatchesContent("application/x-weird", buf)).toBe(false);
  });
});
