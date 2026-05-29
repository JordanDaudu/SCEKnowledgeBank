import type { DocumentDetail as DocumentDetailDto } from "@workspace/api-client-react";
import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import PreviewFallback from "./PreviewFallback";
import { usePreviewContent } from "./usePreviewContent";

interface Props {
  doc: DocumentDetailDto;
  previewUrl: string | undefined;
  onDownload: () => void;
}

/**
 * Renders DOCX documents to HTML using docx-preview (lazy-loaded so the
 * library is code-split out of the initial bundle). The library injects the
 * rendered document, including its own styles, into the container element.
 */
export default function DocxPreview({ doc, previewUrl, onDownload }: Props) {
  const { data, loading, error } = usePreviewContent(previewUrl, "arrayBuffer");
  const containerRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);
  const [renderError, setRenderError] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!data || !container) return;
    let cancelled = false;
    setRendered(false);
    setRenderError(false);
    container.innerHTML = "";

    (async () => {
      try {
        const { renderAsync } = await import("docx-preview");
        await renderAsync(data, container, undefined, {
          className: "docx",
          inWrapper: true,
        });
        if (!cancelled) setRendered(true);
      } catch {
        if (!cancelled) setRenderError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [data]);

  if (error || renderError || (!loading && !data)) {
    return (
      <PreviewFallback
        doc={doc}
        onDownload={onDownload}
        message="Could not render this document for preview. Download it to view its contents."
      />
    );
  }

  return (
    <div className="absolute inset-0 overflow-auto bg-secondary/30">
      <div
        ref={containerRef}
        data-testid="docx-preview"
        className="flex flex-col items-center py-6"
      />
      {(loading || !rendered) && (
        <div className="absolute inset-0 p-4">
          <Skeleton className="w-full h-full" />
        </div>
      )}
    </div>
  );
}
