import { useState } from "react";
import {
  useListContinueStudying,
  getListContinueStudyingQueryKey,
  useListMyFavorites,
  getListMyFavoritesQueryKey,
  useListRecentDocuments,
  getListRecentDocumentsQueryKey,
  useListRecommendations,
  getListRecommendationsQueryKey,
  useListRecommendedCollections,
  getListRecommendedCollectionsQueryKey,
  useListDiscoverableCollections,
  getListDiscoverableCollectionsQueryKey,
  type Document,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DocMiniGrid } from "@/components/doc-mini-grid";
import { CollectionGrid } from "@/components/collections/CollectionCard";
import {
  GraduationCap,
  PlayCircle,
  Heart,
  Clock,
  Sparkles,
  Compass,
} from "lucide-react";

/** Discover public/official bundles, sortable by popularity or recency (US-55). */
function DiscoverBundles() {
  const [sort, setSort] = useState<"popular" | "recent">("popular");
  const params = { sort } as const;
  const { data, isLoading } = useListDiscoverableCollections(params, {
    query: {
      queryKey: getListDiscoverableCollectionsQueryKey(params),
      staleTime: 30_000,
    },
  });
  // Always render the section (and its ranking control) so the sort options
  // are visible even before any bundle has been shared.
  return (
    <section aria-label="Discover bundles">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-serif text-xl font-bold text-foreground">
          <Compass className="h-5 w-5 text-primary" />
          Discover bundles
        </h2>
        <Select value={sort} onValueChange={(v) => setSort(v as "popular" | "recent")}>
          <SelectTrigger className="h-8 w-40" data-testid="discover-sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="popular">Most popular</SelectItem>
            <SelectItem value="recent">Recently updated</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : data && data.length > 0 ? (
        <CollectionGrid collections={data} basePath="/prep-hub" testid="discover-grid" />
      ) : (
        <div
          className="rounded-xl border border-dashed bg-card py-12 text-center"
          data-testid="discover-empty"
        >
          <Compass className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            No shared bundles yet. Create a collection and set it to{" "}
            <span className="font-medium">Public</span> to make it discoverable
            and rankable here.
          </p>
        </div>
      )}
    </section>
  );
}

/** Compact horizontal list of documents for a Quick Access lane. */
function QuickLane({
  title,
  icon: Icon,
  docs,
}: {
  title: string;
  icon: typeof Clock;
  docs: Document[] | undefined;
}) {
  if (!docs || docs.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
        <Icon className="h-4 w-4" />
        {title}
      </h3>
      <DocMiniGrid docs={docs} />
    </div>
  );
}

export default function PrepHub() {
  const { data: continueDocs } = useListContinueStudying({
    query: { queryKey: getListContinueStudyingQueryKey(), staleTime: 15_000 },
  });
  const { data: favorites } = useListMyFavorites({
    query: { queryKey: getListMyFavoritesQueryKey(), staleTime: 30_000 },
  });
  const recentParams = { limit: 6 };
  const { data: recent } = useListRecentDocuments(recentParams, {
    query: { queryKey: getListRecentDocumentsQueryKey(recentParams), staleTime: 30_000 },
  });
  const { data: recommended } = useListRecommendations({
    query: { queryKey: getListRecommendationsQueryKey(), staleTime: 60_000 },
  });
  const { data: recommendedBundles } = useListRecommendedCollections({
    query: {
      queryKey: getListRecommendedCollectionsQueryKey(),
      staleTime: 60_000,
    },
  });

  const hasQuickAccess =
    (recommended?.length ?? 0) > 0 ||
    (continueDocs?.length ?? 0) > 0 ||
    (favorites?.length ?? 0) > 0 ||
    (recent?.length ?? 0) > 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2.5">
            <div className="shrink-0 rounded-lg bg-primary/10 p-1.5">
              <GraduationCap className="h-5 w-5 text-primary" />
            </div>
            <h1 className="font-serif text-3xl font-bold text-foreground">Prep Hub</h1>
          </div>
          <p className="text-muted-foreground">
            Discover and follow study collections shared by the community.
          </p>
        </div>
      </div>

      {/* Quick Access */}
      {hasQuickAccess && (
        <section className="space-y-4" aria-label="Quick access">
          <QuickLane title="Recommended for you" icon={Sparkles} docs={recommended} />
          <QuickLane title="Continue studying" icon={PlayCircle} docs={continueDocs} />
          <QuickLane title="Saved" icon={Heart} docs={favorites} />
          <QuickLane title="Recently viewed" icon={Clock} docs={recent} />
        </section>
      )}

      {/* Suggested bundles by course (US-62) */}
      {recommendedBundles && recommendedBundles.length > 0 && (
        <section aria-label="Suggested bundles">
          <h2 className="mb-3 flex items-center gap-2 font-serif text-xl font-bold text-foreground">
            <Sparkles className="h-5 w-5 text-primary" />
            Suggested bundles
          </h2>
          <CollectionGrid
            collections={recommendedBundles}
            basePath="/prep-hub"
            testid="suggested-grid"
          />
        </section>
      )}

      {/* Discover public/official bundles, ranked (US-55) */}
      <DiscoverBundles />
    </div>
  );
}
