import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Clock, FileText } from "lucide-react";
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
    <div className="space-y-2" data-testid="recently-viewed-strip">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Clock className="h-3.5 w-3.5" /> Recently viewed
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {items.map((item) => (
          <Link key={item.id} href={`/documents/${item.id}`}>
            <div
              className="shrink-0 max-w-[220px] flex items-center gap-2 px-3 py-2 bg-card border rounded-md text-sm hover:border-primary/50 transition-colors cursor-pointer hover-elevate"
              data-testid="recently-viewed-item"
            >
              <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="truncate">{item.title}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
