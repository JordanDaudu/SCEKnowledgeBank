import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useListMyCollections,
  getListMyCollectionsQueryKey,
  useCreateCollection,
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
  useSearchDocumentsV2,
  getSearchDocumentsV2QueryKey,
  type Document,
  type StudyCollectionSummary,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { DocMiniGrid } from "@/components/doc-mini-grid";
import {
  GraduationCap,
  Plus,
  PlayCircle,
  Heart,
  Clock,
  FolderOpen,
  Sparkles,
  Users,
  Compass,
  Search,
  X,
} from "lucide-react";

const KIND_LABEL: Record<string, string> = {
  collection: "Collection",
  exam_prep: "Exam prep",
  revision: "Revision",
  semester: "Semester",
  learning_path: "Learning path",
};

/** A study-bundle (collection) card with progress + follower count, reused
 *  across My collections, Suggested bundles, and Discover. */
function BundleCard({ c }: { c: StudyCollectionSummary }) {
  return (
    <Link href={`/prep-hub/${c.id}`}>
      <Card className="hover-elevate h-full cursor-pointer transition-colors">
        <CardContent className="flex h-full flex-col p-4">
          <div className="mb-2 flex items-start justify-between gap-2">
            <FolderOpen className="h-5 w-5 text-primary" />
            <div className="flex items-center gap-1.5">
              {c.isOfficial && (
                <Badge variant="outline" className="border-primary/40 text-[10px] text-primary">
                  Official
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px]">
                {KIND_LABEL[c.kind] ?? c.kind}
              </Badge>
            </div>
          </div>
          <h3 className="font-serif font-semibold leading-snug text-foreground">
            {c.title}
          </h3>
          {c.description && (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {c.description}
            </p>
          )}
          {c.progressPercent > 0 && (
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${c.progressPercent}%` }}
              />
            </div>
          )}
          <div className="mt-auto flex items-center gap-3 pt-2 text-xs text-muted-foreground tabular-nums">
            <span>
              {c.itemCount} {c.itemCount === 1 ? "document" : "documents"}
            </span>
            {c.followerCount > 0 && (
              <span className="inline-flex items-center gap-1" title="Followers">
                <Users className="h-3 w-3" />
                {c.followerCount}
              </span>
            )}
            {c.progressPercent > 0 && <span>{c.progressPercent}% done</span>}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function BundleGrid({
  collections,
  testid,
}: {
  collections: StudyCollectionSummary[];
  testid?: string;
}) {
  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      data-testid={testid}
    >
      {collections.map((c) => (
        <BundleCard key={c.id} c={c} />
      ))}
    </div>
  );
}

/** Discover shared/official bundles, sortable by popularity or recency (US-55). */
function DiscoverBundles() {
  const [sort, setSort] = useState<"popular" | "recent">("popular");
  const params = { sort } as const;
  const { data } = useListDiscoverableCollections(params, {
    query: {
      queryKey: getListDiscoverableCollectionsQueryKey(params),
      staleTime: 30_000,
    },
  });
  if (!data || data.length === 0) return null;
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
      <BundleGrid collections={data} testid="discover-grid" />
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

function CreateCollectionDialog() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("collection");
  const [visibility, setVisibility] = useState<"private" | "shared">("private");
  const [picked, setPicked] = useState<{ id: string; title: string }[]>([]);
  const [q, setQ] = useState("");
  const createMut = useCreateCollection();

  const searchParams = { q: q.trim() || undefined, page: 1, pageSize: 8 } as const;
  const { data: searchResults } = useSearchDocumentsV2(searchParams, {
    query: {
      queryKey: getSearchDocumentsV2QueryKey(searchParams),
      enabled: open && q.trim().length >= 2,
      staleTime: 15_000,
    },
  });
  const pickedIds = new Set(picked.map((p) => p.id));
  const togglePick = (d: { id: string; title: string }) =>
    setPicked((prev) =>
      prev.some((p) => p.id === d.id)
        ? prev.filter((p) => p.id !== d.id)
        : [...prev, { id: d.id, title: d.title }],
    );

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    createMut.mutate(
      {
        data: {
          title: t,
          kind: kind as "collection" | "exam_prep" | "revision" | "semester" | "learning_path",
          visibility,
          ...(picked.length > 0 ? { documentIds: picked.map((p) => p.id) } : {}),
        },
      },
      {
        onSuccess: (col) => {
          queryClient.invalidateQueries({ queryKey: getListMyCollectionsQueryKey() });
          setOpen(false);
          setTitle("");
          setKind("collection");
          setVisibility("private");
          setPicked([]);
          setQ("");
          navigate(`/prep-hub/${col.id}`);
        },
        onError: () =>
          toast({ variant: "destructive", title: "Could not create collection" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-1.5" data-testid="new-collection">
          <Plus className="h-4 w-4" /> New collection
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New study collection</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. CS101 Final Prep"
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="collection">Collection</SelectItem>
              <SelectItem value="exam_prep">Exam prep</SelectItem>
              <SelectItem value="revision">Revision</SelectItem>
              <SelectItem value="semester">Semester</SelectItem>
            </SelectContent>
          </Select>
          <Select value={visibility} onValueChange={(v) => setVisibility(v as "private" | "shared")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="private">Private — only you</SelectItem>
              <SelectItem value="shared">Shared — others can discover &amp; follow</SelectItem>
            </SelectContent>
          </Select>

          {/* Multi-select materials to seed the bundle (US-51) */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              Add materials (optional)
            </label>
            {picked.length > 0 && (
              <div className="flex flex-wrap gap-1.5" data-testid="picked-materials">
                {picked.map((p) => (
                  <span
                    key={p.id}
                    className="inline-flex max-w-[16rem] items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                  >
                    <span className="truncate">{p.title}</span>
                    <button
                      type="button"
                      onClick={() => togglePick(p)}
                      aria-label={`Remove ${p.title}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search documents to add…"
                className="pl-8"
              />
            </div>
            {q.trim().length >= 2 && (
              <div className="max-h-40 divide-y overflow-auto rounded-md border">
                {(searchResults?.items ?? [])
                  .filter((d) => !pickedIds.has(d.id))
                  .map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => togglePick({ id: d.id, title: d.title })}
                      className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <span className="truncate">{d.title}</span>
                      <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                {searchResults &&
                  searchResults.items.filter((d) => !pickedIds.has(d.id)).length === 0 && (
                    <p className="px-2 py-2 text-xs text-muted-foreground">No matches.</p>
                  )}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={submit}
            disabled={!title.trim() || createMut.isPending}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PrepHub() {
  const { data: collections, isLoading } = useListMyCollections({
    query: { queryKey: getListMyCollectionsQueryKey(), staleTime: 15_000 },
  });
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
            Organize your study materials into collections and track your progress.
          </p>
        </div>
        <CreateCollectionDialog />
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
          <BundleGrid collections={recommendedBundles} testid="suggested-grid" />
        </section>
      )}

      {/* Collections */}
      <section aria-label="My collections">
        <h2 className="mb-3 font-serif text-xl font-bold text-foreground">
          My collections
        </h2>
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        ) : collections && collections.length > 0 ? (
          <BundleGrid collections={collections} testid="collections-grid" />
        ) : (
          <div
            className="rounded-xl border border-dashed bg-card py-16 text-center"
            data-testid="prep-hub-empty"
          >
            <GraduationCap className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="text-muted-foreground">
              No collections yet. Create one to start organizing your study materials.
            </p>
          </div>
        )}
      </section>

      {/* Discover shared/official bundles, ranked (US-55) */}
      <DiscoverBundles />
    </div>
  );
}
