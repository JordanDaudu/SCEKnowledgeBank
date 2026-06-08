import { useRef, useState } from "react";
import {
  useListDocumentVersions,
  useUploadDocumentVersion,
  useRestoreDocumentVersion,
  getDocumentDownloadToken,
  getListDocumentVersionsQueryKey,
  getGetDocumentQueryKey,
  getGetMyStorageQuotaQueryKey,
  type DocumentVersion,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Upload, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/api-url";
import { useTranslation } from "react-i18next";
import { formatVersion } from "@/lib/format";

interface Props {
  documentId: string;
  canManage: boolean;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

export default function VersionsPanel({ documentId, canManage }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [changeNote, setChangeNote] = useState("");

  const versionsKey = getListDocumentVersionsQueryKey(documentId);
  const { data: versions, isLoading } = useListDocumentVersions(documentId, {
    query: { queryKey: versionsKey, enabled: !!documentId },
  });

  const uploadMut = useUploadDocumentVersion();
  const restoreMut = useRestoreDocumentVersion();

  const invalidateAfterMutation = () => {
    queryClient.invalidateQueries({ queryKey: versionsKey });
    queryClient.invalidateQueries({
      queryKey: getGetDocumentQueryKey(documentId),
    });
    queryClient.invalidateQueries({
      queryKey: getGetMyStorageQuotaQueryKey(),
    });
  };

  const handleFilePicked: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const note = changeNote.trim();
    // orval generates the FormData for us from this typed body shape.
    const body: { file: File; changeNote?: string } = { file: f };
    if (note) body.changeNote = note;
    uploadMut.mutate(
      { id: documentId, data: body },
      {
        onSuccess: () => {
          setChangeNote("");
          if (fileInputRef.current) fileInputRef.current.value = "";
          toast({ title: t("uploads.newVersionUploaded") });
          invalidateAfterMutation();
        },
        onError: (err) => {
          toast({
            variant: "destructive",
            title: t("versions.uploadFailed"),
            description: err instanceof Error ? err.message : t("versions.tryAgain"),
          });
        },
      },
    );
  };

  const handleRestore = (v: DocumentVersion) => {
    if (
      !confirm(t("versions.restoreConfirm", { version: formatVersion(v.versionNumber) }))
    ) {
      return;
    }
    restoreMut.mutate(
      { id: documentId, versionId: v.id },
      {
        onSuccess: () => {
          toast({ title: t("versions.restored", { version: formatVersion(v.versionNumber) }) });
          invalidateAfterMutation();
        },
        onError: (err) => {
          toast({
            variant: "destructive",
            title: t("versions.restoreFailed"),
            description: err instanceof Error ? err.message : t("versions.tryAgain"),
          });
        },
      },
    );
  };

  const handleDownloadVersion = async (v: DocumentVersion) => {
    try {
      const t = await getDocumentDownloadToken(documentId);
      const sep = t.url.includes("?") ? "&" : "?";
      window.open(
        apiUrl(`${t.url}${sep}versionId=${encodeURIComponent(v.id)}`),
        "_blank",
      );
    } catch {
      toast({
        variant: "destructive",
        title: t("documentDetail.downloadFailed"),
        description: t("uploads.couldNotDownload"),
      });
    }
  };

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{t("versions.title")}</h3>
        {versions && versions.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {t("versions.totalCount", { count: versions.length })}
          </span>
        )}
      </div>

      {canManage && (
        <div className="space-y-2 border-b pb-4">
          <label className="block text-xs font-medium text-muted-foreground">
            {t("versions.changeNote")}
          </label>
          <input
            type="text"
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
            maxLength={500}
            placeholder={t("versions.changeNotePlaceholder")}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            disabled={uploadMut.isPending}
          />
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFilePicked}
            className="hidden"
            disabled={uploadMut.isPending}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            disabled={uploadMut.isPending}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploadMut.isPending ? (
              <>
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                {t("upload.uploading")}
              </>
            ) : (
              <>
                <Upload className="me-2 h-4 w-4" />
                {t("versions.uploadNewVersion")}
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t("versions.uploadHint")}
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !versions || versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("versions.noVersions")}</p>
      ) : (
        <ul className="space-y-3">
          {versions.map((v) => (
            <li
              key={v.id}
              className="flex flex-col gap-2 rounded-md border bg-background px-3 py-2 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{formatVersion(v.versionNumber)}</span>
                  {v.isCurrent && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                      {t("uploads.current")}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {formatBytes(v.sizeBytes)}
                  </span>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {v.originalFilename}
                </p>
                <p className="text-xs text-muted-foreground">
                  {v.uploader?.displayName ?? t("uploads.unknown")} ·{" "}
                  {formatWhen(v.uploadedAt)}
                </p>
                {v.changeNote && (
                  <p className="text-xs italic text-muted-foreground">
                    "{v.changeNote}"
                  </p>
                )}
              </div>
              <div className="flex gap-2 sm:flex-col">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleDownloadVersion(v)}
                >
                  {t("uploads.download")}
                </Button>
                {canManage && !v.isCurrent && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={restoreMut.isPending}
                    onClick={() => handleRestore(v)}
                  >
                    {t("versions.restore")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
