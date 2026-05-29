import type { DocumentDetail as DocumentDetailDto } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import PreviewFallback from "./PreviewFallback";
import { usePreviewContent } from "./usePreviewContent";

interface Props {
  doc: DocumentDetailDto;
  previewUrl: string | undefined;
  onDownload: () => void;
}

/**
 * Renders plain-text and Markdown documents as scrollable monospace text.
 * Markdown is shown as source (no formatting) — safe and dependency-free.
 */
export default function TextPreview({ doc, previewUrl, onDownload }: Props) {
  const { data, loading, error } = usePreviewContent(previewUrl, "text");

  if (loading) {
    return (
      <div className="absolute inset-0 p-4">
        <Skeleton className="w-full h-full" />
      </div>
    );
  }

  if (error || data === null) {
    return (
      <PreviewFallback
        doc={doc}
        onDownload={onDownload}
        message="Could not load this file for preview. Download it to view its contents."
      />
    );
  }

  return (
    <pre
      data-testid="text-preview"
      className="absolute inset-0 overflow-auto p-4 text-sm leading-relaxed whitespace-pre-wrap break-words font-mono bg-background"
    >
      {data}
    </pre>
  );
}
