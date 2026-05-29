import type { MouseEvent } from "react";
import { Link } from "wouter";
import {
  type Document,
  useFavoriteDocument,
  useUnfavoriteDocument,
  getListMyFavoritesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/document-detail/StatusBadge";
import { formatDateTime } from "@/lib/format";
import { formatMaterialType } from "@/lib/material-types";
import { apiUrl } from "@/lib/api-url";
import {
  iconForFallbackType,
  type FallbackIconType,
} from "@/lib/fallback-icon";
import { renderSnippetHtml } from "@/lib/snippet";
import { cn } from "@/lib/utils";
import { Eye, Download, Heart } from "lucide-react";

interface Props {
  items: (Document & { headline?: string })[];
  /** Ids the current user has favorited, so cards can show toggle state. */
  favoritedIds?: Set<string>;
}

/**
 * Per-card favorite (heart) toggle. Lives inside the card's <Link>, so it
 * stops click propagation to avoid navigating when toggling. Invalidates the
 * document lists (to refresh favorite counts) and the favorites query.
 */
function CardFavoriteButton({
  documentId,
  favoriteCount,
  favorited,
}: {
  documentId: string;
  favoriteCount: number;
  favorited: boolean;
}) {
  const queryClient = useQueryClient();
  const favoriteMutation = useFavoriteDocument();
  const unfavoriteMutation = useUnfavoriteDocument();
  const pending = favoriteMutation.isPending || unfavoriteMutation.isPending;

  const toggle = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    const action = favorited ? unfavoriteMutation : favoriteMutation;
    action.mutate(
      { id: documentId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            predicate: (query) =>
              typeof query.queryKey[0] === "string" &&
              query.queryKey[0].includes("documents"),
          });
          queryClient.invalidateQueries({
            queryKey: getListMyFavoritesQueryKey(),
          });
        },
      },
    );
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={favorited}
      title={favorited ? "Remove from favorites" : "Add to favorites"}
      data-testid="card-favorite-toggle"
      className="inline-flex items-center gap-1 rounded px-1 hover:text-primary transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Heart
        className={"h-3.5 w-3.5 " + (favorited ? "fill-current text-primary" : "")}
      />
      {favoriteCount}
    </button>
  );
}

export default function DocumentCards({ items, favoritedIds }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {items.map((doc) => {
        const Icon = iconForFallbackType(
          doc.fallbackIconType as FallbackIconType | undefined,
        );
        const showStatus = doc.status && doc.status !== "published";
        return (
          <Link key={doc.id} href={`/documents/${doc.id}`}>
            <Card
              className={cn(
                "hover:border-primary/40 transition-all cursor-pointer h-full hover-elevate flex flex-col group",
                showStatus && doc.status === "rejected" && "border-l-2 border-l-rose-300",
                showStatus && doc.status === "pending_review" && "border-l-2 border-l-amber-300",
              )}
            >
              <CardContent className="p-5 flex flex-col flex-1">
                {/* Header row: icon + course tag */}
                <div className="flex justify-between items-start mb-3">
                  {doc.thumbnailUrl ? (
                    <img
                      src={apiUrl(doc.thumbnailUrl)}
                      alt=""
                      aria-hidden="true"
                      loading="lazy"
                      className="h-11 w-11 object-cover rounded-md border bg-secondary"
                      data-testid="doc-thumbnail"
                    />
                  ) : (
                    <div
                      className="bg-primary/8 p-2 rounded-md text-primary group-hover:bg-primary/12 transition-colors"
                      data-testid="doc-fallback-icon"
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                  )}
                  {doc.course && (
                    <span className="course-tag inline-flex items-center rounded border px-2 py-0.5 text-xs">
                      {doc.course.code}
                    </span>
                  )}
                </div>

                {/* Title */}
                <h3 className="font-serif font-semibold text-[0.95rem] leading-snug line-clamp-2 mb-2 text-foreground group-hover:text-primary/90 transition-colors">
                  {doc.title}
                </h3>

                {/* Snippet or description */}
                {doc.headline ? (
                  <p
                    className="text-sm text-muted-foreground line-clamp-2 mb-3 [&_mark]:bg-amber-200/70 [&_mark]:text-foreground [&_mark]:rounded-sm [&_mark]:px-0.5"
                    data-testid="doc-snippet"
                    dangerouslySetInnerHTML={{ __html: renderSnippetHtml(doc.headline) }}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                    {doc.description}
                  </p>
                )}

                {/* Engagement indicators (Refinement Phase 2) */}
                <div
                  className="flex items-center gap-3 mb-3 text-xs text-muted-foreground tabular-nums"
                  data-testid="doc-engagement"
                >
                  <span className="inline-flex items-center gap-1" title="Views">
                    <Eye className="h-3.5 w-3.5" />
                    {doc.viewCount ?? 0}
                  </span>
                  <span className="inline-flex items-center gap-1" title="Downloads">
                    <Download className="h-3.5 w-3.5" />
                    {doc.downloadCount ?? 0}
                  </span>
                  <CardFavoriteButton
                    documentId={doc.id}
                    favoriteCount={doc.favoriteCount ?? 0}
                    favorited={favoritedIds?.has(doc.id) ?? false}
                  />
                </div>

                {/* Footer: material type + status + date */}
                <div className="mt-auto flex justify-between items-center pt-2 gap-2 border-t border-border/50">
                  <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                    <span className="material-tag inline-flex items-center rounded border px-2 py-0.5 text-xs capitalize">
                      {formatMaterialType(doc.materialType)}
                    </span>
                    {showStatus && <StatusBadge status={doc.status} />}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                    {formatDateTime(doc.createdAt)}
                  </span>
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
