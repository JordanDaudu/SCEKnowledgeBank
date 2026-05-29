import type { DocumentDetail as DocumentDetailDto } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { apiUrl } from "@/lib/api-url";
import { previewKindForMime } from "@/lib/preview-kind";
import PreviewFallback from "./previews/PreviewFallback";
import TextPreview from "./previews/TextPreview";
import SheetPreview from "./previews/SheetPreview";
import DocxPreview from "./previews/DocxPreview";

interface Props {
  doc: DocumentDetailDto;
  previewUrl: string | undefined;
  isPreviewLoading: boolean;
  onDownload: () => void;
}

export default function PreviewPanel({
  doc,
  previewUrl,
  isPreviewLoading,
  onDownload,
}: Props) {
  const mime = doc.file?.mimeType;
  const kind = previewKindForMime(mime);

  // pdf/image embed the signed URL directly; text/sheet/docx fetch its bytes.
  // Either way we wait for the token request before deciding the URL is absent.
  const usesIframe = kind === "pdf" || kind === "image";

  function renderBody() {
    if (kind === "unsupported") {
      return <PreviewFallback doc={doc} onDownload={onDownload} />;
    }

    if (isPreviewLoading) {
      return (
        <div className="absolute inset-0 flex items-center justify-center">
          <Skeleton className="w-full h-full" />
        </div>
      );
    }

    if (!previewUrl) {
      return (
        <PreviewFallback
          doc={doc}
          onDownload={onDownload}
          message="Preview is not available right now. Download the file to view its contents."
        />
      );
    }

    if (usesIframe) {
      return (
        <iframe
          src={apiUrl(previewUrl)}
          className="w-full h-full border-0"
          title="Document Preview"
        />
      );
    }

    if (kind === "text") {
      return (
        <TextPreview doc={doc} previewUrl={previewUrl} onDownload={onDownload} />
      );
    }
    if (kind === "sheet") {
      return (
        <SheetPreview
          doc={doc}
          previewUrl={previewUrl}
          onDownload={onDownload}
        />
      );
    }
    // kind === "docx"
    return (
      <DocxPreview doc={doc} previewUrl={previewUrl} onDownload={onDownload} />
    );
  }

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
            <span className="uppercase">
              {doc.file.mimeType.split("/").pop()}
            </span>
          </div>
        )}
      </div>
      <div className="flex-1 bg-secondary/20 relative">{renderBody()}</div>
    </div>
  );
}
