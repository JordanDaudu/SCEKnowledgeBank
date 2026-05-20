import { useEffect, useMemo, useState } from "react";
import type { DocumentPage } from "@workspace/api-client-react";

/**
 * Snapshot the currently displayed page of documents so background refetches
 * don't swap items under the user's cursor. Surfaces a "new documents
 * available" flag instead, which the caller can clear by calling `showLatest`.
 */
export function useDocumentSnapshot(
  pageData: DocumentPage | undefined,
  paramsKeySource: unknown,
) {
  const paramsKey = useMemo(() => JSON.stringify(paramsKeySource), [paramsKeySource]);
  const [displayedData, setDisplayedData] = useState<DocumentPage | undefined>(undefined);
  const [displayedKey, setDisplayedKey] = useState<string>(paramsKey);
  const [hasNewDocuments, setHasNewDocuments] = useState(false);

  useEffect(() => {
    if (paramsKey !== displayedKey) {
      setDisplayedData(undefined);
      setDisplayedKey(paramsKey);
      setHasNewDocuments(false);
    }
  }, [paramsKey, displayedKey]);

  useEffect(() => {
    if (!pageData) return;
    if (paramsKey !== displayedKey) return;
    if (!displayedData) {
      setDisplayedData(pageData);
      return;
    }
    const sameItems =
      displayedData.items.length === pageData.items.length &&
      displayedData.items.every((d, i) => d.id === pageData.items[i]?.id);
    if (!sameItems || displayedData.total !== pageData.total) {
      if (displayedData.items.length === 0) {
        setDisplayedData(pageData);
        setHasNewDocuments(false);
      } else {
        setHasNewDocuments(true);
      }
    }
  }, [pageData, paramsKey, displayedKey, displayedData]);

  const showLatest = () => {
    if (pageData) setDisplayedData(pageData);
    setHasNewDocuments(false);
  };

  return { displayedData, hasNewDocuments, showLatest };
}
