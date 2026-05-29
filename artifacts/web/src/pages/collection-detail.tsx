import { useParams, useLocation, Link } from "wouter";
import {
  useGetCollection,
  getGetCollectionQueryKey,
  useRemoveCollectionItem,
  useReorderCollection,
  useDeleteCollection,
  useSetDocumentProgress,
  useFollowCollection,
  useUnfollowCollection,
  getListMyCollectionsQueryKey,
  type StudyCollectionItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatMaterialType } from "@/lib/material-types";
import {
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  Trash2,
  FolderOpen,
  CheckCircle2,
  Heart,
  Users,
  TrendingUp,
} from "lucide-react";

const KIND_LABEL: Record<string, string> = {
  collection: "Collection",
  exam_prep: "Exam prep",
  revision: "Revision",
  semester: "Semester",
  learning_path: "Learning path",
};

export default function CollectionDetail() {
  const { id = "" } = useParams();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const key = getGetCollectionQueryKey(id);
  const { data: col, isLoading } = useGetCollection(id, {
    query: { queryKey: key, enabled: !!id },
  });

  const removeMut = useRemoveCollectionItem();
  const reorderMut = useReorderCollection();
  const deleteMut = useDeleteCollection();
  const progressMut = useSetDocumentProgress();
  const followMut = useFollowCollection();
  const unfollowMut = useUnfollowCollection();

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const toggleFollow = () => {
    if (!col) return;
    const mut = col.isFollowing ? unfollowMut : followMut;
    mut.mutate({ id }, { onSuccess: refresh });
  };

  const items = col?.items ?? [];
  const orderedIds = items.map((i) => i.document.id);

  const move = (index: number, dir: -1 | 1) => {
    const next = [...orderedIds];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    reorderMut.mutate(
      { id, data: { documentIds: next } },
      { onSuccess: refresh },
    );
  };

  const remove = (documentId: string) =>
    removeMut.mutate({ id, documentId }, { onSuccess: refresh });

  const setProgress = (documentId: string, status: string) =>
    progressMut.mutate(
      { id: documentId, data: { status: status as "reviewing" | "completed" | "none" } },
      { onSuccess: refresh },
    );

  const deleteCollection = () => {
    if (!confirm("Delete this collection? The documents themselves are not deleted.")) return;
    deleteMut.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Collection deleted" });
          queryClient.invalidateQueries({ queryKey: getListMyCollectionsQueryKey() });
          navigate("/prep-hub");
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (!col) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        Collection not found.{" "}
        <Link href="/prep-hub" className="text-primary hover:underline">
          Back to Prep Hub
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href="/prep-hub"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Prep Hub
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <FolderOpen className="h-6 w-6 text-primary" />
            <h1 className="font-serif text-3xl font-bold text-foreground">{col.title}</h1>
            <Badge variant="outline">{KIND_LABEL[col.kind] ?? col.kind}</Badge>
          </div>
          {col.description && (
            <p className="text-muted-foreground">{col.description}</p>
          )}
          <p className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
            <span>
              {col.itemCount} {col.itemCount === 1 ? "document" : "documents"}
            </span>
            <span className="inline-flex items-center gap-1" title="Followers">
              <Users className="h-3.5 w-3.5" />
              {col.followerCount}
            </span>
            <span
              className="inline-flex items-center gap-1 text-primary/80"
              title="Popularity score (followers × 3 + materials)"
            >
              <TrendingUp className="h-3.5 w-3.5" />
              {col.popularityScore}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={col.isFollowing ? "secondary" : "default"}
            size="sm"
            className="gap-1.5"
            disabled={followMut.isPending || unfollowMut.isPending}
            onClick={toggleFollow}
            data-testid="collection-follow"
          >
            <Heart className={"h-4 w-4 " + (col.isFollowing ? "fill-current" : "")} />
            {col.isFollowing ? "Following" : "Follow"}
          </Button>
          <Button variant="outline" size="sm" className="gap-1 text-destructive" onClick={deleteCollection}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        </div>
      </div>

      {col.itemCount > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">Study progress</span>
            <span className="text-muted-foreground tabular-nums">
              {col.completedCount} of {col.itemCount} completed ·{" "}
              {col.progressPercent}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${col.progressPercent}%` }}
              role="progressbar"
              aria-valuenow={col.progressPercent}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card py-16 text-center" data-testid="collection-empty">
          <p className="text-muted-foreground">
            This collection is empty. Open a document and use{" "}
            <span className="font-medium">"Add to collection"</span>, or{" "}
            <Link href="/browse" className="text-primary hover:underline">
              browse the library
            </Link>
            .
          </p>
        </div>
      ) : (
        <ul className="space-y-2" data-testid="collection-items">
          {items.map((item: StudyCollectionItem, index: number) => (
            <li key={item.document.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center gap-3 p-3">
                  <div className="flex flex-col">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      disabled={index === 0 || reorderMut.isPending}
                      onClick={() => move(index, -1)}
                      aria-label="Move up"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      disabled={index === items.length - 1 || reorderMut.isPending}
                      onClick={() => move(index, 1)}
                      aria-label="Move down"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/documents/${item.document.id}`}
                        className="truncate font-medium hover:text-primary"
                      >
                        {item.document.title}
                      </Link>
                      {item.progress === "completed" && (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatMaterialType(item.document.materialType)}
                      {item.document.course ? ` · ${item.document.course.code}` : ""}
                    </p>
                    {item.note && (
                      <p className="mt-0.5 text-xs italic text-muted-foreground">"{item.note}"</p>
                    )}
                  </div>
                  <Select
                    value={item.progress ?? "none"}
                    onValueChange={(v) => setProgress(item.document.id, v)}
                  >
                    <SelectTrigger className="h-8 w-32" data-testid="item-progress">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not started</SelectItem>
                      <SelectItem value="reviewing">Reviewing</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    disabled={removeMut.isPending}
                    onClick={() => remove(item.document.id)}
                    aria-label="Remove from collection"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
