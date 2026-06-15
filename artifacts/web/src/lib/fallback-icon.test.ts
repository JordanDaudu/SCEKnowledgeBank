import { describe, it, expect } from "vitest";
import {
  FileText,
  FileImage,
  FileSpreadsheet,
  Presentation,
  File as FileIcon,
  FileArchive,
  FileType2,
} from "lucide-react";
import { iconForFallbackType } from "./fallback-icon";

describe("iconForFallbackType", () => {
  it("maps each known bucket to its icon", () => {
    expect(iconForFallbackType("pdf")).toBe(FileType2);
    expect(iconForFallbackType("image")).toBe(FileImage);
    expect(iconForFallbackType("slides")).toBe(Presentation);
    expect(iconForFallbackType("sheet")).toBe(FileSpreadsheet);
    expect(iconForFallbackType("archive")).toBe(FileArchive);
  });

  it("maps both text and doc to the document icon", () => {
    expect(iconForFallbackType("text")).toBe(FileText);
    expect(iconForFallbackType("doc")).toBe(FileText);
  });

  it("falls back to the generic file icon for unknown/undefined", () => {
    expect(iconForFallbackType("unknown")).toBe(FileIcon);
    expect(iconForFallbackType(undefined)).toBe(FileIcon);
  });
});
