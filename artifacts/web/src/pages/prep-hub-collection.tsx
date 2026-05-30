import { useParams, Link } from "wouter";
import {
  useGetPublicCollection,
  getGetPublicCollectionQueryKey,
  useFollowCollection,
  useUnfollowCollection,
  useGetCurrentUser,
  useListCategories,
  useListTags,
  type StudyCollectionItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMaterialType } from "@/lib/material-types";
import { KIND_LABEL } from "@/components/collections/CollectionCard";
import {
  ChevronLeft,
  FolderOpen,
  CheckCircle2,
  Heart,
  Users,
  TrendingUp,
} from "lucide-react";

export default function PrepHubCollection() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();

  const key = getGetPublicCollectionQueryKey(id);
  const { data: col, isLoading } = useGetPublicCollection(id, {
    query: { queryKey: key, enabled: !!id },
  });
  const { data: user } = useGetCurrentUser();
  const { data: categories } = useListCategories();
  const { data: tags } = useListTags();

  const followMut = useFollowCollection();
  const unfollowMut = useUnfollowCollection();

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const toggleFollow = () => {
    if (!col) return;
    const mut = col.isFollowing ? unfollowMut : followMut;
    mut.mutate({ id }, { onSuccess: refresh });
  };

  const isAdmin = user?.roles?.includes("admin") ?? false;

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

  const categoryName = col.categoryId
    ? categories?.find((c) => c.id === col.categoryId)?.name
    : undefined;
  const tagNames = (col.tagIds ?? [])
    .map((tid) => tags?.find((t) => t.id === tid)?.name)
    .filter((n): n is string => !!n);
  const semesterLabel = col.semester
    ? col.semester.charAt(0).toUpperCase() + col.semester.slice(1)
    : undefined;
  const hasMeta =
    !!categoryName ||
    !!col.examName ||
    !!semesterLabel ||
    !!col.academicYear ||
    tagNames.length > 0;

  const items = col.items ?? [];

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
          {col.description && <p className="text-muted-foreground">{col.description}</p>}
          {hasMeta && (
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {categoryName && (
                <span>
                  Subject: <span className="text-foreground">{categoryName}</span>
                </span>
              )}
              {col.examName && (
                <span>
                  Exam: <span className="text-foreground">{col.examName}</span>
                </span>
              )}
              {(semesterLabel || col.academicYear) && (
                <span>
                  {semesterLabel}
                  {semesterLabel && col.academicYear ? " " : ""}
                  {col.academicYear ?? ""}
                </span>
              )}
              {tagNames.length > 0 && (
                <span className="flex flex-wrap items-center gap-1">
                  {tagNames.map((n) => (
                    <Badge key={n} variant="secondary" className="text-[10px]">
                      {n}
                    </Badge>
                  ))}
                </span>
              )}
            </p>
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
        {!isAdmin && (
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
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card py-16 text-center" data-testid="collection-empty">
          <p className="text-muted-foreground">This collection has no materials yet.</p>
        </div>
      ) : (
        <ul className="space-y-2" data-testid="collection-items">
          {items.map((item: StudyCollectionItem) => (
            <li key={item.document.id}>
              <Link href={`/documents/${item.document.id}`}>
                <Card className="hover-elevate cursor-pointer transition-colors">
                  <CardContent className="flex flex-wrap items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{item.document.title}</span>
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
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
