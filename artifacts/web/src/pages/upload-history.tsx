import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useGetCurrentUser,
  useSearchDocumentsV2,
  getSearchDocumentsV2QueryKey,
  useListDocumentVersions,
  getListDocumentVersionsQueryKey,
  useUploadDocumentVersion,
  useDeleteDocumentVersion,
  useDeleteDocument,
  getDocumentDownloadToken,
  type SearchDocumentsV2Params,
  type DocumentVersion,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/document-detail/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { formatBytes, formatDateTime, formatVersion } from "@/lib/format";
import { apiUrl } from "@/lib/api-url";
import { triggerDownload } from "@/lib/download";
import {
  History,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  Heart,
  FileStack,
  Upload,
  Loader2,
  Trash2,
} from "lucide-react";

/**
 * Phase 4 — Upload History.
 *
 * A per-user lifecycle view: the documents you've uploaded, each with its
 * status, current version, engagement, and an expandable revision timeline.
 * Reuses the existing search (scoped to the current user as uploader) and the
 * per-document versions API — no new endpoints.
 */
function RevisionTimeline({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const versionsKey = getListDocumentVersionsQueryKey(documentId);
  const { data: versions, isLoading } = useListDocumentVersions(documentId, {
    query: { queryKey: versionsKey },
  });
  const deleteMut = useDeleteDocumentVersion();

  const handleDelete = (v: DocumentVersion) => {
    if (
      !confirm(
        t("uploads.deleteVersionConfirm", { version: formatVersion(v.versionNumber) }),
      )
    ) {
      return;
    }
    deleteMut.mutate(
      { id: documentId, versionId: v.id },
      {
        onSuccess: () => {
          toast({ title: t("uploads.deletedVersion", { version: formatVersion(v.versionNumber) }) });
          queryClient.invalidateQueries({ queryKey: versionsKey });
        },
        onError: (err) =>
          toast({
            variant: "destructive",
            title: t("uploads.couldNotDeleteVersion"),
            description: err instanceof Error ? err.message : undefined,
          }),
      },
    );
  };

  const downloadVersion = async (v: DocumentVersion) => {
    try {
      const t = await getDocumentDownloadToken(documentId);
      const sep = t.url.includes("?") ? "&" : "?";
      triggerDownload(
        apiUrl(`${t.url}${sep}versionId=${encodeURIComponent(v.id)}`),
      );
    } catch {
      toast({ variant: "destructive", title: t("uploads.couldNotDownload") });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2 pl-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-2/3" />
      </div>
    );
  }
  if (!versions || versions.length === 0) {
    return <p className="pl-4 text-xs text-muted-foreground">{t("uploads.noVersionHistory")}</p>;
  }

  return (
    <ol className="relative space-y-4 border-l border-border pl-5">
      {versions.map((v) => (
        <li key={v.id} className="relative" data-testid="revision-entry">
          <span
            className={
              "absolute -left-[1.45rem] top-1 h-3 w-3 rounded-full border-2 border-background " +
              (v.isCurrent ? "bg-primary" : "bg-muted-foreground/40")
            }
            aria-hidden
          />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{formatVersion(v.versionNumber)}</span>
            {v.isCurrent && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                {t("uploads.current")}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {formatBytes(v.sizeBytes)}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 gap-1 px-2 text-xs"
              onClick={() => downloadVersion(v)}
            >
              <Download className="h-3 w-3" />
              {t("uploads.download")}
            </Button>
            {!v.isCurrent && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
                disabled={deleteMut.isPending}
                onClick={() => handleDelete(v)}
                data-testid="delete-version"
                title={t("uploads.deleteVersionTitle")}
              >
                <Trash2 className="h-3 w-3" />
                {t("uploads.delete")}
              </Button>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">{v.originalFilename}</p>
          <p className="text-xs text-muted-foreground">
            {v.uploader?.displayName ?? t("uploads.unknown")} · {formatDateTime(v.uploadedAt)}
          </p>
          {v.changeNote && (
            <p className="text-xs italic text-muted-foreground">"{v.changeNote}"</p>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * "Upload new version" for one of the user's own documents. Asks for a file
 * only — the new file becomes the next version of the existing document, so
 * all of its metadata (title/course/tags/…) is kept and the version bumps
 * automatically. Reuses the same endpoint as the document-detail Versions
 * panel; the server enforces canManageVersions.
 */
function UploadVersionButton({
  documentId,
  onUploaded,
}: {
  documentId: string;
  onUploaded: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadMut = useUploadDocumentVersion();

  const handlePick: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    if (inputRef.current) inputRef.current.value = ""; // allow re-picking same file
    if (!file) return;
    uploadMut.mutate(
      { id: documentId, data: { file } },
      {
        onSuccess: () => {
          toast({ title: t("uploads.newVersionUploaded") });
          onUploaded();
        },
        onError: (err) =>
          toast({
            variant: "destructive",
            title: t("uploads.couldNotUploadVersion"),
            description: err instanceof Error ? err.message : undefined,
          }),
      },
    );
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={handlePick}
        disabled={uploadMut.isPending}
        data-testid="upload-version-input"
      />
      <Button
        variant="outline"
        size="sm"
        className="gap-1"
        disabled={uploadMut.isPending}
        onClick={() => inputRef.current?.click()}
        data-testid="upload-version"
        title={t("uploads.newVersionTitle")}
      >
        {uploadMut.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        {t("uploads.newVersion")}
      </Button>
    </>
  );
}

/**
 * Permanently delete one of the user's own documents. The server enforces
 * canDelete (owner/admin/lecturer) and performs an irreversible hard delete,
 * so this only ever appears on the user's own uploads here.
 */
function DeleteUploadButton({
  documentId,
  title,
  onDeleted,
}: {
  documentId: string;
  title: string;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const deleteMut = useDeleteDocument();

  const handleDelete = () => {
    deleteMut.mutate(
      { id: documentId },
      {
        onSuccess: () => {
          toast({ title: t("uploads.documentDeleted") });
          onDeleted();
        },
        onError: (err) =>
          toast({
            variant: "destructive",
            title: t("uploads.couldNotDeleteDoc"),
            description: err instanceof Error ? err.message : undefined,
          }),
      },
    );
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="gap-1 text-muted-foreground hover:text-destructive"
          disabled={deleteMut.isPending}
          data-testid="delete-document"
          title={t("uploads.deleteDocTitle")}
        >
          {deleteMut.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          {t("uploads.delete")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("uploads.deleteConfirmTitle", { title })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("uploads.deleteConfirmDesc")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("uploads.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="confirm-delete-document"
          >
            {t("uploads.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function UploadHistory() {
  const { t } = useTranslation();
  const { data: user } = useGetCurrentUser();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const params = useMemo<SearchDocumentsV2Params>(
    () => ({ uploaderId: user?.id, sort: "recent", page: 1, pageSize: 50 }),
    [user?.id],
  );
  const { data: page, isLoading } = useSearchDocumentsV2(params, {
    query: {
      queryKey: getSearchDocumentsV2QueryKey(params),
      enabled: !!user?.id,
      staleTime: 30_000,
    },
  });

  // After a new version uploads, refresh the list (version badge) and the
  // document's versions timeline.
  const onVersionUploaded = (documentId: string) => {
    queryClient.invalidateQueries({ queryKey: getSearchDocumentsV2QueryKey(params) });
    queryClient.invalidateQueries({
      queryKey: getListDocumentVersionsQueryKey(documentId),
    });
  };

  // After a permanent delete, drop the row from the list.
  const onDocDeleted = () => {
    queryClient.invalidateQueries({ queryKey: getSearchDocumentsV2QueryKey(params) });
  };

  const docs = page?.items ?? [];
  const totalVersions = docs.reduce((n, d) => n + (d.currentVersion ?? 1), 0);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1 flex items-center gap-2.5">
          <div className="shrink-0 rounded-lg bg-primary/10 p-1.5">
            <History className="h-5 w-5 text-primary" />
          </div>
          <h1 className="font-serif text-3xl font-bold text-foreground">{t("uploads.title")}</h1>
        </div>
        <p className="text-muted-foreground">
          {t("uploads.subtitle")}
        </p>
      </div>

      {/* Summary */}
      {!isLoading && docs.length > 0 && (
        <div className="flex flex-wrap gap-4">
          <div className="rounded-lg border bg-card px-4 py-3">
            <div className="text-2xl font-semibold tabular-nums">{page?.total ?? docs.length}</div>
            <div className="text-xs text-muted-foreground">{t("uploads.documentsUploaded")}</div>
          </div>
          <div className="rounded-lg border bg-card px-4 py-3">
            <div className="text-2xl font-semibold tabular-nums">{totalVersions}</div>
            <div className="text-xs text-muted-foreground">{t("uploads.totalVersions")}</div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : docs.length === 0 ? (
        <div
          className="rounded-xl border border-dashed bg-card py-20 text-center"
          data-testid="upload-history-empty"
        >
          <FileStack className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
          <p className="text-muted-foreground">{t("uploads.empty")}</p>
          <Link
            href="/upload"
            className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
          >
            {t("uploads.uploadFirst")}
          </Link>
        </div>
      ) : (
        <ul className="space-y-3" data-testid="upload-history-list">
          {docs.map((doc) => {
            const isOpen = expanded.has(doc.id);
            const versionCount = doc.currentVersion ?? 1;
            return (
              <li key={doc.id}>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/documents/${doc.id}`}
                            className="font-serif text-base font-semibold text-foreground hover:text-primary"
                          >
                            {doc.title}
                          </Link>
                          {doc.status && doc.status !== "published" && (
                            <StatusBadge status={doc.status} />
                          )}
                          <span
                            className="rounded bg-secondary px-1.5 py-0.5 text-xs font-medium tabular-nums"
                            title={t("uploads.currentVersion")}
                          >
                            {formatVersion(versionCount)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t("uploads.uploadedUpdated", { uploaded: formatDateTime(doc.createdAt), updated: formatDateTime(doc.updatedAt) })}
                        </p>
                        <div className="flex items-center gap-3 pt-0.5 text-xs text-muted-foreground tabular-nums">
                          <span className="inline-flex items-center gap-1">
                            <Eye className="h-3.5 w-3.5" />
                            {doc.viewCount ?? 0}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Download className="h-3.5 w-3.5" />
                            {doc.downloadCount ?? 0}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Heart className="h-3.5 w-3.5" />
                            {doc.favoriteCount ?? 0}
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <UploadVersionButton
                          documentId={doc.id}
                          onUploaded={() => onVersionUploaded(doc.id)}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1"
                          onClick={() => toggle(doc.id)}
                          aria-expanded={isOpen}
                          data-testid="toggle-versions"
                        >
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                          {versionCount > 1 ? t("uploads.versionsCount", { count: versionCount }) : t("uploads.history")}
                        </Button>
                        <DeleteUploadButton
                          documentId={doc.id}
                          title={doc.title}
                          onDeleted={onDocDeleted}
                        />
                      </div>
                    </div>

                    {isOpen && (
                      <div className="mt-4 border-t pt-4">
                        <RevisionTimeline documentId={doc.id} />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
