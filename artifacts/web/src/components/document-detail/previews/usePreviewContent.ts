import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/api-url";

interface PreviewContentState<T> {
  data: T | null;
  loading: boolean;
  error: boolean;
}

/**
 * Fetches the raw bytes of a document from its signed preview URL so a
 * client-side renderer (text / SheetJS / docx-preview) can display them.
 * The original file is never modified; this is the same URL the PDF/image
 * iframe points at, just read into memory instead of embedded.
 *
 * Aborts the in-flight request on unmount or when `previewUrl` changes, so
 * navigating between documents can't render a stale file.
 */
export function usePreviewContent(
  previewUrl: string | undefined,
  as: "text",
): PreviewContentState<string>;
export function usePreviewContent(
  previewUrl: string | undefined,
  as: "arrayBuffer",
): PreviewContentState<ArrayBuffer>;
export function usePreviewContent(
  previewUrl: string | undefined,
  as: "text" | "arrayBuffer",
): PreviewContentState<string | ArrayBuffer> {
  const [state, setState] = useState<PreviewContentState<string | ArrayBuffer>>(
    { data: null, loading: !!previewUrl, error: false },
  );

  useEffect(() => {
    if (!previewUrl) {
      setState({ data: null, loading: false, error: false });
      return;
    }

    const controller = new AbortController();
    setState({ data: null, loading: true, error: false });

    fetch(apiUrl(previewUrl), { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Preview fetch failed: ${res.status}`);
        return as === "text" ? res.text() : res.arrayBuffer();
      })
      .then((data) => setState({ data, loading: false, error: false }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({ data: null, loading: false, error: true });
      });

    return () => controller.abort();
  }, [previewUrl, as]);

  return state;
}
