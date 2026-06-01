import { describe, expect, it } from "vitest";
import { isRestrictedFilename } from "./restricted-files";

describe("isRestrictedFilename", () => {
  it("flags restricted extensions (case-insensitive)", () => {
    expect(isRestrictedFilename("payload.exe")).toBe(true);
    expect(isRestrictedFilename("Archive.ZIP")).toBe(true);
    expect(isRestrictedFilename("rom.iso")).toBe(true);
    expect(isRestrictedFilename("app.apk")).toBe(true);
  });
  it("does not flag normal types", () => {
    expect(isRestrictedFilename("notes.pdf")).toBe(false);
    expect(isRestrictedFilename("slides.pptx")).toBe(false);
    expect(isRestrictedFilename("image.png")).toBe(false);
  });
  it("handles no-extension and dotfiles", () => {
    expect(isRestrictedFilename("README")).toBe(false);
    expect(isRestrictedFilename("archive.")).toBe(false);
  });
});
