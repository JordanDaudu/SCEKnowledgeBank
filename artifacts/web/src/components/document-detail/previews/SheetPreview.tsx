import type { DocumentDetail as DocumentDetailDto } from "@workspace/api-client-react";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import PreviewFallback from "./PreviewFallback";
import { usePreviewContent } from "./usePreviewContent";
import { useTranslation } from "react-i18next";

interface Props {
  doc: DocumentDetailDto;
  previewUrl: string | undefined;
  onDownload: () => void;
}

interface ParsedSheet {
  name: string;
  rows: (string | number | boolean | null)[][];
  truncated: boolean;
}

// Guardrail: a huge spreadsheet would lock up the DOM. Show the first N rows
// and tell the user the rest is in the downloadable original.
const MAX_ROWS = 500;

/**
 * Renders CSV / XLS / XLSX as HTML tables using SheetJS (lazy-loaded so the
 * library is code-split out of the initial bundle). One tab per worksheet.
 */
export default function SheetPreview({ doc, previewUrl, onDownload }: Props) {
  const { t } = useTranslation();
  const { data, loading, error } = usePreviewContent(previewUrl, "arrayBuffer");
  const [sheets, setSheets] = useState<ParsedSheet[] | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    setParsing(true);
    setParseError(false);
    setSheets(null);

    (async () => {
      try {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(new Uint8Array(data), { type: "array" });
        const parsed: ParsedSheet[] = wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name];
          const allRows = XLSX.utils.sheet_to_json<
            (string | number | boolean | null)[]
          >(ws, { header: 1, blankrows: false, defval: "" });
          return {
            name,
            rows: allRows.slice(0, MAX_ROWS),
            truncated: allRows.length > MAX_ROWS,
          };
        });
        if (!cancelled) {
          setSheets(parsed);
          setActive(0);
          setParsing(false);
        }
      } catch {
        if (!cancelled) {
          setParseError(true);
          setParsing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [data]);

  if (loading || parsing) {
    return (
      <div className="absolute inset-0 p-4">
        <Skeleton className="w-full h-full" />
      </div>
    );
  }

  if (error || parseError || !sheets || sheets.length === 0) {
    return (
      <PreviewFallback
        doc={doc}
        onDownload={onDownload}
        message={t("preview.couldNotRenderSheet")}
      />
    );
  }

  const sheet = sheets[active] ?? sheets[0];

  return (
    <div className="absolute inset-0 flex flex-col bg-background">
      {sheets.length > 1 && (
        <div className="flex gap-1 overflow-x-auto border-b p-2 bg-muted/30">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              onClick={() => setActive(i)}
              className={
                "px-3 py-1 text-xs rounded-md whitespace-nowrap transition-colors " +
                (i === active
                  ? "bg-primary/10 text-primary border border-primary/40"
                  : "hover:bg-accent border border-transparent")
              }
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-auto" data-testid="sheet-preview">
        <table className="border-collapse text-sm">
          <tbody>
            {sheet.rows.map((row, r) => (
              <tr key={r} className={r === 0 ? "bg-muted/50 font-medium" : ""}>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className="border px-2 py-1 align-top whitespace-pre-wrap"
                  >
                    {cell === null ? "" : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sheet.truncated && (
        <div className="border-t p-2 text-xs text-muted-foreground bg-muted/30">
          {t("preview.showingFirstRows", { count: MAX_ROWS })}
        </div>
      )}
    </div>
  );
}
