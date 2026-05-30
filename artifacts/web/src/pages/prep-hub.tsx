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
  useListTrendingCollections,
  getListTrendingCollectionsQueryKey,
  type Document,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { CollectionGrid } from "@/components/collections/CollectionCard";
import { DiscoverySection } from "@/components/collections/DiscoverySection";
import { DocMiniGrid } from "@/components/doc-mini-grid";
import { useDebounce } from "@/hooks/use-debounce";
import {
  GraduationCap,
  PlayCircle,
  Heart,
  Clock,
  Sparkles,
  Compass,
  Search,
  TrendingUp,
  Star,
  Eye,
  PlusCircle,
  CalendarClock,
} from "lucide-react";

/** Search results section — rendered instead of the normal page when a query is active. */
function SearchResults({ q }: { q: string }) {
  const params = { q };
  const { data, isLoading } = useListDiscoverableCollections(params, {
    query: {
      queryKey: getListDiscoverableCollectionsQueryKey(params),
      staleTime: 15_000,
    },
  });

  return (
    <section aria-label="Search results">
      <h2 className="mb-3 flex items-center gap-2 font-serif text-xl font-bold text-foreground">
        <Search className="h-5 w-5 text-primary" />
        Search results
      </h2>
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : data && data.length > 0 ? (
        <CollectionGrid collections={data} basePath="/prep-hub" testid="search-results-grid" />
      ) : (
        <div
          className="rounded-xl border border-dashed bg-card py-12 text-center"
          data-testid="search-results-empty"
        >
          <Search className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            No collections match &ldquo;{q}&rdquo;.
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
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedQ = useDebounce(searchQuery, 300);
  const isSearching = debouncedQ.trim().length > 0;

  // ── Quick Access (document lanes) ──────────────────────────────────────
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

  const hasQuickAccess =
    (recommended?.length ?? 0) > 0 ||
    (continueDocs?.length ?? 0) > 0 ||
    (favorites?.length ?? 0) > 0 ||
    (recent?.length ?? 0) > 0;

  // ── Discovery sections (collection bundles) ────────────────────────────
  const trendingParams = { limit: 12 };
  const { data: trendingBundles, isLoading: trendingLoading } = useListTrendingCollections(
    trendingParams,
    {
      query: {
        queryKey: getListTrendingCollectionsQueryKey(trendingParams),
        staleTime: 30_000,
      },
    },
  );

  const popularParams = { sort: "popular" as const, limit: 12 };
  const { data: popularBundles, isLoading: popularLoading } = useListDiscoverableCollections(
    popularParams,
    {
      query: {
        queryKey: getListDiscoverableCollectionsQueryKey(popularParams),
        staleTime: 30_000,
      },
    },
  );

  const ratingParams = { sort: "rating" as const, limit: 12 };
  const { data: ratingBundles, isLoading: ratingLoading } = useListDiscoverableCollections(
    ratingParams,
    {
      query: {
        queryKey: getListDiscoverableCollectionsQueryKey(ratingParams),
        staleTime: 30_000,
      },
    },
  );

  const viewsParams = { sort: "views" as const, limit: 12 };
  const { data: viewsBundles, isLoading: viewsLoading } = useListDiscoverableCollections(
    viewsParams,
    {
      query: {
        queryKey: getListDiscoverableCollectionsQueryKey(viewsParams),
        staleTime: 30_000,
      },
    },
  );

  const newParams = { sort: "new" as const, limit: 12 };
  const { data: newBundles, isLoading: newLoading } = useListDiscoverableCollections(newParams, {
    query: {
      queryKey: getListDiscoverableCollectionsQueryKey(newParams),
      staleTime: 30_000,
    },
  });

  const examParams = { sort: "exam" as const, limit: 12 };
  const { data: examBundles, isLoading: examLoading } = useListDiscoverableCollections(examParams, {
    query: {
      queryKey: getListDiscoverableCollectionsQueryKey(examParams),
      staleTime: 30_000,
    },
  });

  const { data: recommendedBundles, isLoading: recommendedBundlesLoading } =
    useListRecommendedCollections({
      query: {
        queryKey: getListRecommendedCollectionsQueryKey(),
        staleTime: 60_000,
      },
    });

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

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search collections..."
          className="pl-9 bg-background"
          data-testid="prep-hub-search"
        />
      </div>

      {isSearching ? (
        <SearchResults q={debouncedQ.trim()} />
      ) : (
        <>
          {/* Quick Access — document lanes (continue studying, saved, recent) */}
          {hasQuickAccess && (
            <section className="space-y-4" aria-label="Quick access">
              <QuickLane title="Recommended for you" icon={Sparkles} docs={recommended} />
              <QuickLane title="Continue studying" icon={PlayCircle} docs={continueDocs} />
              <QuickLane title="Saved" icon={Heart} docs={favorites} />
              <QuickLane title="Recently viewed" icon={Clock} docs={recent} />
            </section>
          )}

          {/* 7 discovery sections — each hides itself when empty */}
          <DiscoverySection
            title="Trending"
            icon={<TrendingUp className="h-5 w-5 text-primary" />}
            collections={trendingBundles}
            isLoading={trendingLoading}
            testid="trending-grid"
          />

          <DiscoverySection
            title="Popular"
            icon={<Compass className="h-5 w-5 text-primary" />}
            collections={popularBundles}
            isLoading={popularLoading}
            testid="popular-grid"
          />

          <DiscoverySection
            title="Highest Rated"
            icon={<Star className="h-5 w-5 text-primary" />}
            collections={ratingBundles}
            isLoading={ratingLoading}
            testid="rating-grid"
          />

          <DiscoverySection
            title="Most Viewed"
            icon={<Eye className="h-5 w-5 text-primary" />}
            collections={viewsBundles}
            isLoading={viewsLoading}
            testid="views-grid"
          />

          <DiscoverySection
            title="New"
            icon={<PlusCircle className="h-5 w-5 text-primary" />}
            collections={newBundles}
            isLoading={newLoading}
            testid="new-grid"
          />

          <DiscoverySection
            title="Upcoming Exams"
            icon={<CalendarClock className="h-5 w-5 text-primary" />}
            collections={examBundles}
            isLoading={examLoading}
            testid="exam-grid"
          />

          <DiscoverySection
            title="For You / Your Courses"
            icon={<Sparkles className="h-5 w-5 text-primary" />}
            collections={recommendedBundles}
            isLoading={recommendedBundlesLoading}
            testid="recommended-grid"
          />
        </>
      )}
    </div>
  );
}
