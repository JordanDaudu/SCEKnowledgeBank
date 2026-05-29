import { describe, it, expect } from "vitest";
import { previewKindForMime } from "./preview-kind";

describe("previewKindForMime", () => {
  it("maps PDF to pdf", () => {
    expect(previewKindForMime("application/pdf")).toBe("pdf");
  });

  it("maps images to image", () => {
    expect(previewKindForMime("image/png")).toBe("image");
    expect(previewKindForMime("image/jpeg")).toBe("image");
  });

  it("maps plain text and markdown to text", () => {
    expect(previewKindForMime("text/plain")).toBe("text");
    expect(previewKindForMime("text/markdown")).toBe("text");
  });

  it("maps CSV and Excel (xls/xlsx) to sheet", () => {
    expect(previewKindForMime("text/csv")).toBe("sheet");
    expect(previewKindForMime("application/vnd.ms-excel")).toBe("sheet");
    expect(
      previewKindForMime(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe("sheet");
  });

  it("maps DOCX to docx", () => {
    expect(
      previewKindForMime(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe("docx");
  });

  it("maps PowerPoint, legacy Word, and ZIP to unsupported", () => {
    expect(previewKindForMime("application/msword")).toBe("unsupported");
    expect(previewKindForMime("application/vnd.ms-powerpoint")).toBe(
      "unsupported",
    );
    expect(
      previewKindForMime(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ),
    ).toBe("unsupported");
    expect(previewKindForMime("application/zip")).toBe("unsupported");
  });

  it("maps undefined and unknown types to unsupported", () => {
    expect(previewKindForMime(undefined)).toBe("unsupported");
    expect(previewKindForMime("application/octet-stream")).toBe("unsupported");
    expect(previewKindForMime("")).toBe("unsupported");
  });
});
