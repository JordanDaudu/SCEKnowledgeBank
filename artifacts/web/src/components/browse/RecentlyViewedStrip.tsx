import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Clock, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useListRecentDocuments } from "@workspace/api-client-react";

interface RecentItem {
  id: string;
  title: string;
}

const STORAGE_KEY = "kb:recently-viewed";

function readLocalRecent(): RecentItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (it): it is RecentItem =>
        it && typeof it.id === "string" && typeof it.title === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Server-backed Recently Viewed strip (task #29).
 *
 * The list is now sourced from `/api/documents/recent` so it follows
 * the user across devices and respects current visibility — documents
 * the user can no longer access are filtered server-side and disappear
 * from the strip on the next refresh. `localStorage` is kept only as
 * a fallback for when the API errors (e.g. offline / proxy hiccup).
 */
export default function RecentlyViewedStrip() {
  const { t } = useTranslation();
  const { data, isError } = useListRecentDocuments({ limit: 8 });

  const [fallback, setFallback] = useState<RecentItem[]>([]);
  useEffect(() => {
    if (isError) setFallback(readLocalRecent());
  }, [isError]);

  const items: RecentItem[] = isError
    ? fallback
    : (data ?? []).map((d) => ({ id: d.id, title: d.title }));

  if (items.length === 0) return null;

  return (
    <div
      className="rounded-xl border border-border/60 bg-card p-3 space-y-2.5"
      data-testid="recently-viewed-strip"
    >
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider px-0.5">
        <div className="h-5 w-5 rounded bg-primary/8 flex items-center justify-center">
          <Clock className="h-3 w-3 text-primary" />
        </div>
        {t("home.continueReading")}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-0.5 -mx-0.5 px-0.5">
        {items.map((item) => (
          <Link key={item.id} href={`/documents/${item.id}`}>
            <div
              className="shrink-0 max-w-[200px] flex items-center gap-2 px-3 py-2 bg-background border border-border/70 rounded-lg text-sm hover:border-primary/50 hover:bg-primary/3 transition-all cursor-pointer hover-elevate"
              data-testid="recently-viewed-item"
            >
              <FileText className="h-3.5 w-3.5 text-primary/70 shrink-0" />
              <span className="truncate text-xs font-medium">{item.title}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
