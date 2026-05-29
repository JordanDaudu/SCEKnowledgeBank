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
} from "lucide-react";

const KIND_LABEL: Record<string, string> = {
  collection: "Collection",
  exam_prep: "Exam prep",
  revision: "Revision",
  semester: "Semester",
};

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
  const createMut = useCreateCollection();

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    createMut.mutate(
      { data: { title: t, kind: kind as "collection" | "exam_prep" | "revision" | "semester" } },
      {
        onSuccess: (col) => {
          queryClient.invalidateQueries({ queryKey: getListMyCollectionsQueryKey() });
          setOpen(false);
          setTitle("");
          setKind("collection");
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
          <div
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="collections-grid"
          >
            {collections.map((c: StudyCollectionSummary) => (
              <Link key={c.id} href={`/prep-hub/${c.id}`}>
                <Card className="hover-elevate h-full cursor-pointer transition-colors">
                  <CardContent className="flex h-full flex-col p-4">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <FolderOpen className="h-5 w-5 text-primary" />
                      <Badge variant="outline" className="text-[10px]">
                        {KIND_LABEL[c.kind] ?? c.kind}
                      </Badge>
                    </div>
                    <h3 className="font-serif font-semibold leading-snug text-foreground">
                      {c.title}
                    </h3>
                    {c.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {c.description}
                      </p>
                    )}
                    <p className="mt-auto pt-2 text-xs text-muted-foreground">
                      {c.itemCount} {c.itemCount === 1 ? "document" : "documents"}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
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
    </div>
  );
}
