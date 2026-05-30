import { useState } from "react";
import { Link } from "wouter";
import {
  useListCollectionModeration,
  getListCollectionModerationQueryKey,
  useHideCollection,
  useUnhideCollection,
  type StudyCollectionSummary,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Eye,
  EyeOff,
  Loader2,
  ShieldCheck,
  Heart,
  MessageSquare,
  Star,
  BookOpen,
  Users,
} from "lucide-react";

export default function AdminPrepHubModeration() {
  const [showHiddenOnly, setShowHiddenOnly] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, error } = useListCollectionModeration();
  const hideMut = useHideCollection();
  const unhideMut = useUnhideCollection();

  const handleError = (err: unknown) => {
    const data = (err as { data?: { error?: { message?: string } } })?.data;
    const message =
      data?.error?.message ?? (err as Error)?.message ?? "Something went wrong";
    toast({ variant: "destructive", title: "Action failed", description: message });
  };

  const invalidateModeration = () => {
    queryClient.invalidateQueries({
      queryKey: getListCollectionModerationQueryKey(),
    });
  };

  const handleHide = (col: StudyCollectionSummary) => {
    const reason = prompt("Optional reason for hiding this collection:") ?? "";
    hideMut.mutate(
      { id: col.id, data: { reason: reason.trim() || undefined } },
      { onSuccess: invalidateModeration, onError: handleError },
    );
  };

  const handleUnhide = (col: StudyCollectionSummary) => {
    unhideMut.mutate(
      { id: col.id },
      { onSuccess: invalidateModeration, onError: handleError },
    );
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container mx-auto p-6">
        <p className="text-rose-600">Failed to load moderation list.</p>
      </div>
    );
  }

  const { collections, stats } = data;
  const displayed = showHiddenOnly
    ? collections.filter((c) => c.hiddenAt)
    : collections;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-serif font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" /> Prep Hub Moderation
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {stats.totalPublic} public · {stats.totalHidden} hidden
          </p>
        </div>

        {/* Filter toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none text-sm font-medium">
          <input
            type="checkbox"
            checked={showHiddenOnly}
            onChange={(e) => setShowHiddenOnly(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          Show only hidden
        </label>
      </div>

      {/* List */}
      {displayed.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card py-16 text-center">
          <p className="text-muted-foreground">
            {showHiddenOnly ? "No hidden collections." : "No collections found."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {displayed.map((col) => (
            <CollectionRow
              key={col.id}
              col={col}
              onHide={handleHide}
              onUnhide={handleUnhide}
              hideLoading={hideMut.isPending}
              unhideLoading={unhideMut.isPending}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CollectionRow({
  col,
  onHide,
  onUnhide,
  hideLoading,
  unhideLoading,
}: {
  col: StudyCollectionSummary;
  onHide: (col: StudyCollectionSummary) => void;
  onUnhide: (col: StudyCollectionSummary) => void;
  hideLoading: boolean;
  unhideLoading: boolean;
}) {
  return (
    <li>
      <Card className={col.hiddenAt ? "border-destructive/40 bg-destructive/5" : undefined}>
        <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
          {/* Left: title + metadata */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/prep-hub/${col.id}`}
                className="font-medium hover:underline hover:text-primary transition-colors truncate"
              >
                {col.title}
              </Link>
              {col.hiddenAt && (
                <Badge
                  variant="outline"
                  className="border-destructive/60 text-destructive bg-destructive/10 shrink-0"
                >
                  <EyeOff className="h-3 w-3 mr-1" />
                  Hidden
                </Badge>
              )}
            </div>

            {col.hiddenAt && col.hiddenReason && (
              <p className="mt-0.5 text-xs text-muted-foreground italic">
                Reason: {col.hiddenReason}
              </p>
            )}

            {/* Engagement stats */}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1" title="Documents">
                <BookOpen className="h-3.5 w-3.5" />
                {col.itemCount} {col.itemCount === 1 ? "doc" : "docs"}
              </span>
              <span className="inline-flex items-center gap-1" title="Followers">
                <Users className="h-3.5 w-3.5" />
                {col.followerCount}
              </span>
              <span className="inline-flex items-center gap-1" title="Likes">
                <Heart className="h-3.5 w-3.5" />
                {col.likeCount}
              </span>
              <span className="inline-flex items-center gap-1" title="Rating">
                <Star className="h-3.5 w-3.5" />
                {col.ratingAverage > 0 ? col.ratingAverage.toFixed(1) : "—"}{" "}
                ({col.ratingCount})
              </span>
              <span className="inline-flex items-center gap-1" title="Comments">
                <MessageSquare className="h-3.5 w-3.5" />
                {col.commentCount}
              </span>
              <span className="inline-flex items-center gap-1" title="Views">
                <Eye className="h-3.5 w-3.5" />
                {col.viewCount} views
              </span>
            </div>
          </div>

          {/* Right: action button */}
          <div className="shrink-0">
            {col.hiddenAt ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={unhideLoading}
                onClick={() => onUnhide(col)}
              >
                <Eye className="h-4 w-4" />
                Unhide
              </Button>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                className="gap-1.5"
                disabled={hideLoading}
                onClick={() => onHide(col)}
              >
                <EyeOff className="h-4 w-4" />
                Hide
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </li>
  );
}
