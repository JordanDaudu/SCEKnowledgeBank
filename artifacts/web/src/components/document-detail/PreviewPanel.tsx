import type { DocumentDetail as DocumentDetailDto } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Download, FileQuestion } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { apiUrl } from "@/lib/api-url";
import {
  iconForFallbackType,
  type FallbackIconType,
} from "@/lib/fallback-icon";

function isPreviewableInIframe(mime: string | undefined): boolean {
  if (!mime) return false;
  if (mime === "application/pdf") return true;
  if (mime.startsWith("image/")) return true;
  return false;
}

interface Props {
  doc: DocumentDetailDto;
  previewUrl: string | undefined;
  isPreviewLoading: boolean;
  onDownload: () => void;
}

export default function PreviewPanel({ doc, previewUrl, isPreviewLoading, onDownload }: Props) {
  const mime = doc.file?.mimeType;
  const canIframe = isPreviewableInIframe(mime);

  return (
    <div className="bg-card border rounded-xl overflow-hidden shadow-sm flex flex-col h-[700px]">
      <div className="border-b p-3 bg-muted/30 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <FileText className="h-4 w-4 text-primary" />
          {doc.file?.originalFilename || "Document Preview"}
        </div>
        {doc.file && (
          <div className="text-xs text-muted-foreground flex gap-3">
            <span>{formatBytes(doc.file.sizeBytes)}</span>
            <span className="uppercase">{doc.file.mimeType.split("/").pop()}</span>
          </div>
        )}
      </div>
      <div className="flex-1 bg-secondary/20 relative">
        {!canIframe ? (
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
                  ? iconForFallbackType(
                      doc.fallbackIconType as FallbackIconType,
                    )
                  : FileQuestion;
                return (
                  <div className="bg-secondary p-4 rounded-full mb-4">
                    <Icon className="h-10 w-10 text-muted-foreground" />
                  </div>
                );
              })()
            )}
            <h3 className="font-serif font-semibold text-lg mb-1">Preview unavailable</h3>
            <p className="text-sm text-muted-foreground max-w-sm mb-6">
              {mime
                ? `In-browser preview is not supported for ${mime}.`
                : "This file type cannot be previewed in the browser."}
              {" "}Download the file to view its contents.
            </p>
            <Button onClick={onDownload}>
              <Download className="mr-2 h-4 w-4" /> Download file
            </Button>
          </div>
        ) : isPreviewLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Skeleton className="w-full h-full" />
          </div>
        ) : previewUrl ? (
          <iframe
            src={apiUrl(previewUrl)}
            className="w-full h-full border-0"
            title="Document Preview"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            Preview not available
          </div>
        )}
      </div>
    </div>
  );
}
