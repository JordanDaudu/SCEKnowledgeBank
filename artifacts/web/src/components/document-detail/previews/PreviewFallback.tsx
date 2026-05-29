import type { DocumentDetail as DocumentDetailDto } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Download, FileQuestion } from "lucide-react";
import { apiUrl } from "@/lib/api-url";
import {
  iconForFallbackType,
  type FallbackIconType,
} from "@/lib/fallback-icon";

interface Props {
  doc: DocumentDetailDto;
  onDownload: () => void;
  /** Overrides the default "not supported" explanation (e.g. on render error). */
  message?: string;
}

/**
 * Shown when a document cannot be previewed in the browser — either the type
 * has no client-side renderer (PowerPoint, legacy Office, ZIP) or a renderer
 * failed. Offers a thumbnail/icon and a Download button.
 */
export default function PreviewFallback({ doc, onDownload, message }: Props) {
  const mime = doc.file?.mimeType;
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center text-center p-8"
      data-testid="preview-unavailable"
    >
      {doc.thumbnailUrl ? (
        <img
          src={apiUrl(doc.thumbnailUrl)}
          alt=""
          aria-hidden="true"
          className="max-h-40 max-w-40 mb-4 rounded-md border"
        />
      ) : (
        (() => {
          const Icon = doc.fallbackIconType
            ? iconForFallbackType(doc.fallbackIconType as FallbackIconType)
            : FileQuestion;
          return (
            <div className="bg-secondary p-4 rounded-full mb-4">
              <Icon className="h-10 w-10 text-muted-foreground" />
            </div>
          );
        })()
      )}
      <h3 className="font-serif font-semibold text-lg mb-1">
        Preview unavailable
      </h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">
        {message ??
          ((mime
            ? `In-browser preview is not supported for ${mime}.`
            : "This file type cannot be previewed in the browser.") +
            " Download the file to view its contents.")}
      </p>
      <Button onClick={onDownload}>
        <Download className="mr-2 h-4 w-4" /> Download file
      </Button>
    </div>
  );
}
