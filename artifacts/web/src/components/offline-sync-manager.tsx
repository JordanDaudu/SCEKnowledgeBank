import { useEffect } from "react";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { syncFavoritesForOffline } from "@/lib/offline/sync";

// Throttle so navigation/online flapping can't hammer the API.
let lastRun = 0;
const THROTTLE_MS = 60_000;

function maybeSync() {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  const now = Date.now();
  if (now - lastRun < THROTTLE_MS) return;
  lastRun = now;
  // Fire-and-forget. When logged out, listMyFavorites 401s — ignored.
  void syncFavoritesForOffline().catch(() => {});
}

/**
 * Mounted once at the app root. Keeps the offline cache of favorited
 * documents in sync whenever the app is online (on load and when the
 * connection returns). Renders nothing.
 */
export function OfflineSyncManager(): null {
  const online = useOnlineStatus();
  useEffect(() => {
    if (online) maybeSync();
  }, [online]);
  return null;
}
