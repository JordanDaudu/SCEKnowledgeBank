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
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/api-url";
import PreviewPanel from "@/components/document-detail/PreviewPanel";
import MetadataPanel from "@/components/document-detail/MetadataPanel";
import EditMetadataModal from "@/components/document-detail/EditMetadataModal";
import CommentsThread from "@/components/document-detail/CommentsThread";

const RECENTLY_VIEWED_KEY = "kb:recently-viewed";
const RECENTLY_VIEWED_CAP = 8;

interface RecentItem {
  id: string;
  title: string;
}

function appendRecentlyViewed(item: RecentItem) {
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

  const isAdmin = user?.roles?.includes("admin");
  const isUploader = user?.id === doc?.uploader?.id;
  const canEdit = isAdmin || isUploader;

  // Persist this document into the recently-viewed list (read by browse page)
  useEffect(() => {
    if (!doc) return;
    appendRecentlyViewed({ id: doc.id, title: doc.title });
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
        <MetadataPanel
          doc={doc}
          canEdit={!!canEdit}
          onEdit={() => setEditOpen(true)}
          onToggleStatus={handleToggleStatus}
          onDelete={handleDeleteDoc}
          onDownload={handleDownload}
          isStatusUpdating={updateDocMutation.isPending}
          isDeleting={deleteDocMutation.isPending}
        />

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
    </div>
  );
}
