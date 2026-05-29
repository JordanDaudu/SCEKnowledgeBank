import { useParams, useLocation } from "wouter";
import {
  useGetDocument,
  useGetDocumentPreviewToken,
  getDocumentDownloadToken,
  useUpdateDocument,
  useDeleteDocument,
  useGetCurrentUser,
  getGetDocumentQueryKey,
  getGetDocumentPreviewTokenQueryKey,
  useSubmitDocumentForReview,
  useApproveDocument,
  useRejectDocument,
  useFavoriteDocument,
  useUnfavoriteDocument,
  getListMyFavoritesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/api-url";
import PreviewPanel from "@/components/document-detail/PreviewPanel";
import MetadataPanel from "@/components/document-detail/MetadataPanel";
import EditMetadataModal from "@/components/document-detail/EditMetadataModal";
import { RejectDialog } from "@/components/document-detail/RejectDialog";
import CommentsThread from "@/components/document-detail/CommentsThread";
import VersionsPanel from "@/components/document-detail/VersionsPanel";
import {
  getGetMyStorageQuotaQueryKey,
} from "@workspace/api-client-react";
import { Heart } from "lucide-react";
import { AddToCollection } from "@/components/add-to-collection";

// Recently-viewed history is server-backed (task #29): visiting a
// document calls `GET /documents/:id`, which records a row in
// `view_history` via the documents service. `RecentlyViewedStrip`
// reads from `/documents/recent`, so this page no longer needs to
// mirror anything into `localStorage` — the API is the source of
// truth, and `localStorage` only survives as the strip's offline
// fallback.
const RECENTLY_VIEWED_KEY = "kb:recently-viewed";
const RECENTLY_VIEWED_CAP = 8;

interface RecentItem {
  id: string;
  title: string;
}

/**
 * Best-effort write to the offline fallback used by
 * `RecentlyViewedStrip` when `/documents/recent` errors. Never the
 * source of truth.
 */
function appendRecentlyViewedFallback(item: RecentItem) {
  try {
    const raw = localStorage.getItem(RECENTLY_VIEWED_KEY);
    const list: RecentItem[] = raw ? JSON.parse(raw) : [];
    const filtered = Array.isArray(list)
      ? list.filter(
          (it): it is RecentItem =>
            it && typeof it.id === "string" && typeof it.title === "string" && it.id !== item.id,
        )
      : [];
    const next = [item, ...filtered].slice(0, RECENTLY_VIEWED_CAP);
    localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function isPreviewableInIframe(mime: string | undefined): boolean {
  if (!mime) return false;
  if (mime === "application/pdf") return true;
  if (mime.startsWith("image/")) return true;
  return false;
}

export default function DocumentDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetCurrentUser();

  const { data: doc, isLoading: isDocLoading } = useGetDocument(id, {
    query: { enabled: !!id, queryKey: getGetDocumentQueryKey(id) },
  });

  const mime = doc?.file?.mimeType;
  const isPdf = mime === "application/pdf";
  const canIframe = isPreviewableInIframe(mime);

  const { data: previewToken, isLoading: isPreviewLoading } = useGetDocumentPreviewToken(id, {
    query: {
      enabled: !!id && canIframe,
      queryKey: getGetDocumentPreviewTokenQueryKey(id),
    },
  });

  const updateDocMutation = useUpdateDocument();
  const deleteDocMutation = useDeleteDocument();

  const [editOpen, setEditOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  // Sprint-3 M2 review workflow mutations. All three invalidate the
  // doc query on success so the badge/permissions flip in place
  // (server is authoritative — flags like canSubmitForReview/canReview
  // are recomputed by `assembleDocuments` against the new status).
  const submitReviewMutation = useSubmitDocumentForReview();
  const approveMutation = useApproveDocument();
  const rejectMutation = useRejectDocument();

  // Sprint-3 M6 — favorites also subscribe the viewer to new comments
  // on this doc (notification type `document.activity`). Server is
  // source of truth for `isFavorited`; we invalidate the doc query so
  // the next render reflects the change.
  const favoriteMutation = useFavoriteDocument();
  const unfavoriteMutation = useUnfavoriteDocument();
  const isFavoritePending =
    favoriteMutation.isPending || unfavoriteMutation.isPending;
  const handleToggleFavorite = () => {
    if (!doc) return;
    const action = doc.isFavorited ? unfavoriteMutation : favoriteMutation;
    action.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetDocumentQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListMyFavoritesQueryKey() });
          toast({
            title: doc.isFavorited ? "Removed from favorites" : "Added to favorites",
          });
        },
        onError: () =>
          toast({ variant: "destructive", title: "Could not update favorite" }),
      },
    );
  };
  const isReviewMutating =
    submitReviewMutation.isPending ||
    approveMutation.isPending ||
    rejectMutation.isPending;

  const invalidateDoc = () =>
    queryClient.invalidateQueries({ queryKey: getGetDocumentQueryKey(id) });

  const handleSubmitForReview = () => {
    submitReviewMutation.mutate(
      { id },
      {
        onSuccess: () => {
          invalidateDoc();
          toast({ title: "Submitted for review" });
        },
        onError: () =>
          toast({
            variant: "destructive",
            title: "Could not submit for review",
          }),
      },
    );
  };
  const handleApprove = () => {
    approveMutation.mutate(
      { id },
      {
        onSuccess: () => {
          invalidateDoc();
          toast({ title: "Document approved" });
        },
        onError: () =>
          toast({ variant: "destructive", title: "Could not approve" }),
      },
    );
  };
  const handleReject = (reason: string) => {
    rejectMutation.mutate(
      { id, data: { reason } },
      {
        onSuccess: () => {
          invalidateDoc();
          setRejectOpen(false);
          toast({ title: "Document rejected" });
        },
        onError: () =>
          toast({ variant: "destructive", title: "Could not reject" }),
      },
    );
  };

  // Sprint-2 audit: gate UI off the server-issued permission flags
  // rather than a role/uploader heuristic. The server is the source of
  // truth (course-aware, restricted-visibility-aware) — guessing on the
  // client risks showing affordances the API will refuse, or hiding
  // affordances the user actually has via course membership.
  const canEdit = !!doc?.permissions?.canEdit;
  const canDelete = !!doc?.permissions?.canDelete;

  // Persist this document into the recently-viewed list (read by browse page)
  useEffect(() => {
    if (!doc) return;
    appendRecentlyViewedFallback({ id: doc.id, title: doc.title });
  }, [doc]);

  const handleDownload = async () => {
    try {
      const data = await getDocumentDownloadToken(id);
      window.open(apiUrl(data.url), "_blank");
    } catch {
      toast({ variant: "destructive", title: "Download failed", description: "Could not generate download link." });
    }
  };

  const handleDeleteDoc = () => {
    if (!confirm("Are you sure you want to delete this document? This cannot be undone.")) return;
    deleteDocMutation.mutate({ id }, {
      onSuccess: () => {
        // US-10: deleting a doc releases its bytes from the uploader's
        // quota server-side. Invalidate the snapshot so the upload page
        // re-renders with the freed space immediately.
        queryClient.invalidateQueries({
          queryKey: getGetMyStorageQuotaQueryKey(),
        });
        toast({ title: "Document deleted" });
        setLocation("/browse");
      },
    });
  };

  const handleToggleStatus = () => {
    if (!doc) return;
    const newStatus = doc.status === "published" ? "archived" : "published";
    updateDocMutation.mutate({ id, data: { status: newStatus } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetDocumentQueryKey(id) });
        toast({ title: `Document ${newStatus}` });
      },
    });
  };

  if (isDocLoading) {
    return <div className="space-y-6"><Skeleton className="h-12 w-2/3" /><Skeleton className="h-[600px] w-full" /></div>;
  }

  if (!doc) {
    return <div className="text-center py-20">Document not found</div>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* Left Column: Preview */}
      <div className="lg:col-span-2 space-y-6">
        <PreviewPanel
          doc={doc}
          previewUrl={previewToken?.url}
          isPreviewLoading={isPreviewLoading}
          onDownload={handleDownload}
        />
      </div>

      {/* Right Column: Metadata & Comments */}
      <div className="space-y-6">
        <div className="space-y-1">
          <button
            type="button"
            onClick={handleToggleFavorite}
            disabled={isFavoritePending}
            aria-pressed={!!doc.isFavorited}
            data-testid="favorite-toggle"
            title={
              doc.isFavorited
                ? "Remove from favorites"
                : "Add to favorites (also notifies you of new comments)"
            }
            className={
              "inline-flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors " +
              (doc.isFavorited
                ? "bg-primary/10 border-primary/40 text-primary"
                : "bg-background hover:bg-accent")
            }
          >
            <Heart
              className={"h-4 w-4 " + (doc.isFavorited ? "fill-current" : "")}
              aria-hidden
            />
            <span>{doc.isFavorited ? "Favorited" : "Favorite"}</span>
          </button>
          <p className="px-1 text-xs text-muted-foreground">
            {doc.isFavorited
              ? "Saved to your favorites — you'll be notified of new comments."
              : "Save to your favorites and get notified of new comments."}
          </p>
          <AddToCollection documentId={doc.id} />
        </div>
        <MetadataPanel
          doc={doc}
          canEdit={canEdit}
          canDelete={canDelete}
          onEdit={() => setEditOpen(true)}
          onToggleStatus={handleToggleStatus}
          onDelete={handleDeleteDoc}
          onDownload={handleDownload}
          isStatusUpdating={updateDocMutation.isPending}
          isDeleting={deleteDocMutation.isPending}
          onSubmitForReview={handleSubmitForReview}
          onApprove={handleApprove}
          onReject={() => setRejectOpen(true)}
          isReviewMutating={isReviewMutating}
        />

        <VersionsPanel documentId={id} canManage={canEdit} />

        <CommentsThread
          documentId={id}
          commentCount={doc.commentCount}
          isPdf={isPdf}
        />
      </div>

      {canEdit && (
        <EditMetadataModal
          open={editOpen}
          onOpenChange={setEditOpen}
          docId={id}
          doc={doc}
        />
      )}

      <RejectDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        onConfirm={handleReject}
        isSubmitting={rejectMutation.isPending}
      />
    </div>
  );
}
