import {
  FileText,
  FileImage,
  FileSpreadsheet,
  Presentation,
  File as FileIcon,
  FileArchive,
  FileType2,
  type LucideIcon,
} from "lucide-react";

/**
 * Mirrors `FallbackIconType` from the API. Kept in sync with
 * `artifacts/api-server/src/services/documents/metadata.service.ts`
 * (the server is the source of truth — it derives the bucket from
 * the file's MIME type and includes it in the DTO).
 */
export type FallbackIconType =
  | "pdf"
  | "image"
  | "doc"
  | "slides"
  | "sheet"
  | "text"
  | "archive"
  | "unknown";

export function iconForFallbackType(t: FallbackIconType | undefined): LucideIcon {
  switch (t) {
    case "pdf":
      return FileType2;
    case "image":
      return FileImage;
    case "slides":
      return Presentation;
    case "sheet":
      return FileSpreadsheet;
    case "text":
    case "doc":
      return FileText;
    case "archive":
      return FileArchive;
    default:
      return FileIcon;
  }
}
