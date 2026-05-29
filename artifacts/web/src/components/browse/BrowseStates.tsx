import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, AlertTriangle, RefreshCw, LayoutGrid, List, Search } from "lucide-react";

export type BrowseView = "cards" | "table";

export function BrowseViewToggle({
  view,
  onChange,
}: {
  view: BrowseView;
  onChange: (v: BrowseView) => void;
}) {
  return (
    <div className="flex gap-1 border rounded-md p-0.5 bg-background" role="group" aria-label="View mode">
      <Button
        variant={view === "cards" ? "secondary" : "ghost"}
        size="sm"
        className="h-8 w-8 p-0"
        onClick={() => onChange("cards")}
        aria-label="Card view"
        aria-pressed={view === "cards"}
        data-testid="browse-view-cards"
      >
        <LayoutGrid className="h-4 w-4" />
      </Button>
      <Button
        variant={view === "table" ? "secondary" : "ghost"}
        size="sm"
        className="h-8 w-8 p-0"
        onClick={() => onChange("table")}
        aria-label="Table view"
        aria-pressed={view === "table"}
        data-testid="browse-view-table"
      >
        <List className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function NewDocsBanner({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div
      className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2"
      data-testid="browse-new-docs-banner"
    >
      <p className="text-sm text-foreground">New documents available</p>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        className="gap-1.5 text-primary hover:text-primary"
        data-testid="browse-new-docs-refresh"
      >
        <RefreshCw className="h-3.5 w-3.5" /> Refresh
      </Button>
    </div>
  );
}

export function BrowsePagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="flex justify-center items-center mt-8 gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={page === 1}
        onClick={() => onChange(page - 1)}
        className="px-4"
      >
        Previous
      </Button>
      <div className="flex items-center gap-1 px-2">
        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
          let pg: number;
          if (totalPages <= 5) {
            pg = i + 1;
          } else if (page <= 3) {
            pg = i + 1;
          } else if (page >= totalPages - 2) {
            pg = totalPages - 4 + i;
          } else {
            pg = page - 2 + i;
          }
          return (
            <button
              key={pg}
              type="button"
              onClick={() => onChange(pg)}
              className={`h-8 w-8 rounded-md text-sm font-medium transition-colors ${
                pg === page
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {pg}
            </button>
          );
        })}
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        className="px-4"
      >
        Next
      </Button>
    </div>
  );
}

export function BrowseLoading({ view = "cards" }: { view?: "cards" | "table" }) {
  if (view === "table") {
    return (
      <div className="space-y-2" data-testid="browse-loading">
        {Array(8).fill(0).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-md" />)}
      </div>
    );
  }
  return (
    <div
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
      data-testid="browse-loading"
    >
      {Array(8).fill(0).map((_, i) => <Skeleton key={i} className="h-48 w-full rounded-xl" />)}
    </div>
  );
}

export function BrowseEmpty() {
  return (
    <div
      className="text-center py-20 bg-card border border-dashed rounded-xl"
      data-testid="browse-empty"
    >
      <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-primary/8 flex items-center justify-center">
        <BookOpen className="h-7 w-7 text-primary/60" />
      </div>
      <h3 className="text-lg font-semibold text-foreground">No materials yet</h3>
      <p className="text-muted-foreground mt-2 max-w-sm mx-auto text-sm">
        Nothing has been uploaded yet. Be the first to share course materials with the community.
      </p>
    </div>
  );
}

export function BrowseNoResults({ onClear }: { onClear: () => void }) {
  return (
    <div
      className="text-center py-20 bg-card border border-dashed rounded-xl"
      data-testid="browse-empty"
    >
      <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-sky-50 dark:bg-sky-950/30 flex items-center justify-center">
        <Search className="h-7 w-7 text-sky-500 dark:text-sky-400" />
      </div>
      <h3 className="text-lg font-semibold text-foreground">No results found</h3>
      <p className="text-muted-foreground mt-2 max-w-sm mx-auto text-sm">
        Try broadening your search or adjusting the active filters.
      </p>
      <Button variant="outline" className="mt-6" onClick={onClear}>
        Clear all filters
      </Button>
    </div>
  );
}

export function BrowseError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="text-center py-16 bg-card border border-dashed rounded-xl"
      data-testid="browse-error"
    >
      <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-destructive/8 flex items-center justify-center">
        <AlertTriangle className="h-7 w-7 text-destructive/70" />
      </div>
      <h3 className="text-lg font-semibold text-foreground">Something went wrong</h3>
      <p className="text-muted-foreground mt-2 max-w-sm mx-auto text-sm">
        We couldn't load the document list. Please try again.
      </p>
      <Button variant="outline" className="mt-6 gap-2" onClick={onRetry}>
        <RefreshCw className="h-4 w-4" /> Retry
      </Button>
    </div>
  );
}
