import {
  useSearchDocumentsV2,
  getSearchDocumentsV2QueryKey,
  type SearchDocumentsV2Params,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { DocMiniGrid } from "@/components/doc-mini-grid";
import { SectionHeader } from "@/components/section-header";
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
      <SectionHeader
        icon={TrendingUp}
        title="Trending this week"
        actionHref="/browse?sort=trending"
      />
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
