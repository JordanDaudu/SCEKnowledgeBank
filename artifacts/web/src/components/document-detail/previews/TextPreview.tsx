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
      <div className="p-4">
        <Skeleton className="h-40 w-full" />
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

  // Grows to fit the content up to a max, then scrolls — short notes don't
  // leave a tall empty void.
  return (
    <pre
      data-testid="text-preview"
      className="max-h-[640px] overflow-auto p-4 text-sm leading-relaxed whitespace-pre-wrap break-words font-mono bg-background"
    >
      {data}
    </pre>
  );
}
