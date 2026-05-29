import { Link } from "wouter";
import {
  useSearchDocumentsV2,
  getSearchDocumentsV2QueryKey,
  type SearchDocumentsV2Params,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { DocMiniGrid } from "@/components/doc-mini-grid";
import { TrendingUp } from "lucide-react";

/**
 * Phase 8 — Trending assets widget (also the home "trending" widget deferred
 * from Phase 2). Reuses the ranking engine via the `trending` sort, which is
 * engagement weighted by a short recency half-life.
 */
export function TrendingDocuments() {
  const params: SearchDocumentsV2Params = { sort: "trending", page: 1, pageSize: 6 };
  const { data, isLoading } = useSearchDocumentsV2(params, {
    query: { queryKey: getSearchDocumentsV2QueryKey(params), staleTime: 60_000 },
  });

  if (!isLoading && (!data || data.items.length === 0)) return null;

  return (
    <section aria-label="Trending">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-serif text-xl font-bold text-foreground">
          <TrendingUp className="h-5 w-5 text-primary" />
          Trending this week
        </h2>
        <Link
          href="/browse?sort=trending"
          className="text-sm font-medium text-primary hover:underline"
        >
          View all
        </Link>
      </div>
      {isLoading ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : (
        <DocMiniGrid docs={data!.items} />
      )}
    </section>
  );
}
