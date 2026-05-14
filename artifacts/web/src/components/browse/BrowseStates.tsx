import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, AlertTriangle, RefreshCw, LayoutGrid, List } from "lucide-react";

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
    <div className="flex justify-center mt-8 gap-2">
      <Button variant="outline" disabled={page === 1} onClick={() => onChange(page - 1)}>
        Previous
      </Button>
      <div className="flex items-center px-4 text-sm font-medium">
        Page {page} of {totalPages}
      </div>
      <Button variant="outline" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
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
      <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4 opacity-50" />
      <h3 className="text-lg font-medium">No materials found</h3>
      <p className="text-muted-foreground mt-2 max-w-md mx-auto">
        Nothing has been uploaded yet. Be the first to share.
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
      <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4 opacity-50" />
      <h3 className="text-lg font-medium">No results</h3>
      <p className="text-muted-foreground mt-2 max-w-md mx-auto">
        Try clearing filters or broadening your search.
      </p>
      <Button variant="outline" className="mt-6" onClick={onClear}>
        Clear filters
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
      <AlertTriangle className="h-10 w-10 mx-auto text-destructive mb-3" />
      <h3 className="text-lg font-medium">Something went wrong</h3>
      <p className="text-muted-foreground mt-2 max-w-md mx-auto">
        We couldn't load the document list. Please try again.
      </p>
      <Button variant="outline" className="mt-6 gap-2" onClick={onRetry}>
        <RefreshCw className="h-4 w-4" /> Retry
      </Button>
    </div>
  );
}
