import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useGetCurrentUser,
  useSearchDocumentsV2,
  getSearchDocumentsV2QueryKey,
  useListDocumentVersions,
  getListDocumentVersionsQueryKey,
  getDocumentDownloadToken,
  type SearchDocumentsV2Params,
  type DocumentVersion,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/document-detail/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { formatBytes, formatDateTime, formatVersion } from "@/lib/format";
import { apiUrl } from "@/lib/api-url";
import {
  History,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  Heart,
  FileStack,
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
  const { toast } = useToast();
  const { data: versions, isLoading } = useListDocumentVersions(documentId, {
    query: { queryKey: getListDocumentVersionsQueryKey(documentId) },
  });

  const downloadVersion = async (v: DocumentVersion) => {
    try {
      const t = await getDocumentDownloadToken(documentId);
      const sep = t.url.includes("?") ? "&" : "?";
      window.open(
        apiUrl(`${t.url}${sep}versionId=${encodeURIComponent(v.id)}`),
        "_blank",
      );
    } catch {
      toast({ variant: "destructive", title: "Could not generate download link." });
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
    return <p className="pl-4 text-xs text-muted-foreground">No version history.</p>;
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
                Current
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
              Download
            </Button>
          </div>
          <p className="truncate text-xs text-muted-foreground">{v.originalFilename}</p>
          <p className="text-xs text-muted-foreground">
            {v.uploader?.displayName ?? "Unknown"} · {formatDateTime(v.uploadedAt)}
          </p>
          {v.changeNote && (
            <p className="text-xs italic text-muted-foreground">"{v.changeNote}"</p>
          )}
        </li>
      ))}
    </ol>
  );
}

export default function UploadHistory() {
  const { data: user } = useGetCurrentUser();
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
          <h1 className="font-serif text-3xl font-bold text-foreground">Upload History</h1>
        </div>
        <p className="text-muted-foreground">
          Your uploaded materials and their revision history. Open a document to
          edit it or upload a new version.
        </p>
      </div>

      {/* Summary */}
      {!isLoading && docs.length > 0 && (
        <div className="flex flex-wrap gap-4">
          <div className="rounded-lg border bg-card px-4 py-3">
            <div className="text-2xl font-semibold tabular-nums">{page?.total ?? docs.length}</div>
            <div className="text-xs text-muted-foreground">Documents uploaded</div>
          </div>
          <div className="rounded-lg border bg-card px-4 py-3">
            <div className="text-2xl font-semibold tabular-nums">{totalVersions}</div>
            <div className="text-xs text-muted-foreground">Total versions</div>
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
          <p className="text-muted-foreground">You haven't uploaded anything yet.</p>
          <Link
            href="/upload"
            className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
          >
            Upload your first document →
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
                            title="Current version"
                          >
                            {formatVersion(versionCount)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Uploaded {formatDateTime(doc.createdAt)} · Updated{" "}
                          {formatDateTime(doc.updatedAt)}
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
                        {versionCount > 1 ? `${versionCount} versions` : "History"}
                      </Button>
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
