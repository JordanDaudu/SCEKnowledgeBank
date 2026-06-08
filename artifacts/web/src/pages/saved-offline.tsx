import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useTranslation } from "react-i18next";
import { formatBytes, formatDateTime } from "@/lib/format";
import {
  listOfflineMeta,
  getOfflineBlob,
  clearOffline,
  type OfflineMeta,
} from "@/lib/offline/db";
import { syncFavoritesForOffline } from "@/lib/offline/sync";
import {
  DownloadCloud,
  ExternalLink,
  FileStack,
  Loader2,
  RefreshCw,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";

export default function SavedOffline() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const online = useOnlineStatus();
  const [items, setItems] = useState<OfflineMeta[] | null>(null);
  const [syncing, setSyncing] = useState(false);

  const reload = useCallback(async () => {
    const meta = await listOfflineMeta();
    meta.sort((a, b) => b.cachedAt - a.cachedAt);
    setItems(meta);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleRefresh = async () => {
    if (!online) return;
    setSyncing(true);
    try {
      const r = await syncFavoritesForOffline();
      await reload();
      toast({
        title: t("savedOffline.cacheUpdated"),
        description: r.skipped
          ? t("savedOffline.cacheUpdatedDescSkipped", { cached: r.cached, removed: r.removed, skipped: r.skipped })
          : t("savedOffline.cacheUpdatedDesc", { cached: r.cached, removed: r.removed }),
      });
    } catch {
      toast({ variant: "destructive", title: t("savedOffline.cacheUpdateFailed") });
    } finally {
      setSyncing(false);
    }
  };

  const handleClear = async () => {
    if (!confirm(t("savedOffline.clearConfirm"))) return;
    await clearOffline();
    await reload();
    toast({ title: t("savedOffline.cacheCleared") });
  };

  const open = async (m: OfflineMeta) => {
    const blob = await getOfflineBlob(m.documentId);
    if (!blob) {
      toast({ variant: "destructive", title: t("savedOffline.noLongerCached") });
      void reload();
      return;
    }
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    // Revoke after a grace period so the new tab has time to load it.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const totalBytes = (items ?? []).reduce((s, m) => s + m.size, 0);

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1 flex items-center gap-2.5">
          <div className="shrink-0 rounded-lg bg-primary/10 p-1.5">
            <DownloadCloud className="h-5 w-5 text-primary" />
          </div>
          <h1 className="font-serif text-3xl font-bold text-foreground">{t("savedOffline.title")}</h1>
        </div>
        <p className="text-muted-foreground">
          {t("savedOffline.subtitle")}
        </p>
      </div>

      {/* Status + actions */}
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium " +
            (online
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-amber-500/10 text-amber-600 dark:text-amber-400")
          }
        >
          {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {online ? t("savedOffline.online") : t("savedOffline.offline")}
        </span>
        {items && items.length > 0 && (
          <span className="text-sm text-muted-foreground tabular-nums">
            {t("savedOffline.itemCount", { count: items.length })} · {formatBytes(totalBytes)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={!online || syncing}
            onClick={handleRefresh}
            title={online ? t("savedOffline.updateOnlineTitle") : t("savedOffline.updateOfflineTitle")}
          >
            {syncing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t("savedOffline.update")}
          </Button>
          {items && items.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-muted-foreground hover:text-destructive"
              onClick={handleClear}
            >
              <Trash2 className="h-4 w-4" />
              {t("savedOffline.clear")}
            </Button>
          )}
        </div>
      </div>

      {items === null ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card py-20 text-center">
          <FileStack className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
          <p className="text-muted-foreground">
            {t("savedOffline.empty")}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((m) => (
            <li key={m.documentId}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0 space-y-1">
                    <p className="font-serif text-base font-semibold text-foreground truncate">
                      {m.title}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {m.courseCode ? `${m.courseCode} · ` : ""}
                      {m.materialType} · {m.filename} · {formatBytes(m.size)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("savedOffline.savedAt", { date: formatDateTime(new Date(m.cachedAt).toISOString()) })}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" className="gap-1 shrink-0" onClick={() => open(m)}>
                    <ExternalLink className="h-4 w-4" />
                    {t("savedOffline.open")}
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
