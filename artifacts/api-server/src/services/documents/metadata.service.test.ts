import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  extractMetadata,
  fallbackIconFor,
} from "./metadata.service";

describe("fallbackIconFor", () => {
  it("maps known mime types to the right bucket", () => {
    expect(fallbackIconFor("application/pdf")).toBe("pdf");
    expect(fallbackIconFor("image/png")).toBe("image");
    expect(fallbackIconFor("image/jpeg")).toBe("image");
    expect(fallbackIconFor("text/plain")).toBe("text");
    expect(fallbackIconFor("text/markdown")).toBe("text");
    expect(fallbackIconFor("text/csv")).toBe("text");
    expect(fallbackIconFor(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )).toBe("doc");
    expect(fallbackIconFor(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    )).toBe("slides");
    expect(fallbackIconFor(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )).toBe("sheet");
    expect(fallbackIconFor("application/zip")).toBe("archive");
    expect(fallbackIconFor("application/x-unknown")).toBe("unknown");
    expect(fallbackIconFor(undefined)).toBe("unknown");
  });
});

describe("extractMetadata — text handlers", () => {
  it("extracts plain text and reports presence", async () => {
    const text = "Hello world\nThis is a CSV-ish sample,row,1\n";
    const meta = await extractMetadata({
      buffer: Buffer.from(text, "utf8"),
      mimeType: "text/plain",
      filename: "a.txt",
    });
    expect(meta.extractedText).toBe(text);
  });

  it("truncates very long text inputs", async () => {
    const huge = "x".repeat(200_000);
    const meta = await extractMetadata({
      buffer: Buffer.from(huge),
      mimeType: "text/plain",
      filename: "big.txt",
    });
    expect(meta.extractedText!.length).toBeLessThanOrEqual(50_000);
  });

  it("ignores empty/whitespace-only text", async () => {
    const meta = await extractMetadata({
      buffer: Buffer.from("   \n  \n"),
      mimeType: "text/plain",
      filename: "blank.txt",
    });
    expect(meta.extractedText).toBeUndefined();
  });
});

describe("extractMetadata — image handler", () => {
  it("populates dimensions and produces a thumbnail JPEG for PNG inputs", async () => {
    const png = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 255, g: 128, b: 0 },
      },
    })
      .png()
      .toBuffer();

    const meta = await extractMetadata({
      buffer: png,
      mimeType: "image/png",
      filename: "x.png",
    });
    expect(meta.imageWidth).toBe(800);
    expect(meta.imageHeight).toBe(600);
    expect(meta.thumbnail).toBeDefined();
    expect(meta.thumbnail!.mimeType).toBe("image/jpeg");
    // Thumb should be appreciably smaller than the original 800x600.
    expect(meta.thumbnail!.body.length).toBeLessThan(png.length);
    // And its bytes should start with the JPEG magic (FF D8).
    expect(meta.thumbnail!.body[0]).toBe(0xff);
    expect(meta.thumbnail!.body[1]).toBe(0xd8);
  });

  it("caps thumbnail dimensions to the configured maximum", async () => {
    const png = await sharp({
      create: {
        width: 2000,
        height: 1000,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();
    const meta = await extractMetadata({
      buffer: png,
      mimeType: "image/png",
      filename: "wide.png",
    });
    const thumbMeta = await sharp(meta.thumbnail!.body).metadata();
    expect(thumbMeta.width).toBeLessThanOrEqual(400);
    expect(thumbMeta.height).toBeLessThanOrEqual(400);
  });
});

describe("extractMetadata — failure resilience", () => {
  it("never throws on a corrupt PDF buffer; returns empty metadata", async () => {
    const meta = await extractMetadata({
      buffer: Buffer.from("definitely not a pdf"),
      mimeType: "application/pdf",
      filename: "fake.pdf",
    });
    // Both pageCount and extractedText should be absent — but the
    // promise must resolve, never reject.
    expect(meta.pageCount).toBeUndefined();
    expect(meta.thumbnail).toBeUndefined();
  });

  it("returns empty metadata for unsupported mime types", async () => {
    const meta = await extractMetadata({
      buffer: Buffer.from([0, 1, 2, 3]),
      mimeType: "application/octet-stream",
      filename: "x.bin",
    });
    expect(meta).toEqual({});
  });

  it("returns empty metadata when extraction exceeds the timeout", async () => {
    // Sharp on a 1-byte buffer will reject quickly, but the contract
    // we care about is that the timeout itself never throws to the
    // caller. We exercise that with an unreasonably short budget.
    const meta = await extractMetadata({
      buffer: Buffer.from([0]),
      mimeType: "image/png",
      filename: "tiny.png",
      timeoutMs: 1,
    });
    expect(meta.thumbnail).toBeUndefined();
  });
});
