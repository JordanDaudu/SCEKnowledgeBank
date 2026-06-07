/**
 * Offline-cache sync engine.
 *
 * Mirrors the user's favorites into IndexedDB so they can be opened with no
 * network. Runs while online: downloads new/changed favorites' files, removes
 * un-favorited ones, and stays within a storage budget (skipping — not
 * evicting — when full, surfacing the skip count). The file bytes are fetched
 * via the same signed preview URL the in-app viewer uses.
 */
import {
  listMyFavorites,
  getDocumentPreviewToken,
} from "@workspace/api-client-react";
import { apiUrl } from "@/lib/api-url";
import {
  deleteOffline,
  listOfflineMeta,
  putOffline,
  totalOfflineBytes,
  type OfflineMeta,
} from "./db";

/** Don't cache a single file larger than this. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Total offline cache budget across all saved favorites. */
const BUDGET_BYTES = 200 * 1024 * 1024;

export interface SyncResult {
  cached: number;
  removed: number;
  skipped: number;
  totalBytes: number;
}

let inFlight: Promise<SyncResult> | null = null;

/** Sync favorites into the offline cache. Coalesces concurrent calls. */
export function syncFavoritesForOffline(): Promise<SyncResult> {
  if (!inFlight) {
    inFlight = run().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function run(): Promise<SyncResult> {
  const favorites = await listMyFavorites();
  const favIds = new Set(favorites.map((f) => f.id));
  const existing = new Map(
    (await listOfflineMeta()).map((m) => [m.documentId, m]),
  );

  // 1. Drop anything no longer favorited.
  let removed = 0;
  for (const id of existing.keys()) {
    if (!favIds.has(id)) {
      await deleteOffline(id);
      removed++;
    }
  }

  // 2. Cache new / changed favorites within the budget.
  let used = await totalOfflineBytes();
  let cached = 0;
  let skipped = 0;

  for (const doc of favorites) {
    const file = doc.file;
    if (!file) {
      skipped++;
      continue;
    }
    const prev = existing.get(doc.id);
    if (prev && prev.fileId === file.id) continue; // already cached, unchanged
    if (file.sizeBytes > MAX_FILE_BYTES) {
      skipped++;
      continue;
    }
    // Re-caching a changed version reclaims the old blob's bytes.
    const projected = used + file.sizeBytes - (prev?.size ?? 0);
    if (projected > BUDGET_BYTES) {
      skipped++;
      continue;
    }
    try {
      const token = await getDocumentPreviewToken(doc.id);
      const res = await fetch(apiUrl(token.url));
      if (!res.ok) {
        skipped++;
        continue;
      }
      const blob = await res.blob();
      const meta: OfflineMeta = {
        documentId: doc.id,
        fileId: file.id,
        title: doc.title,
        materialType: doc.materialType,
        courseCode: doc.course?.code,
        courseTitle: doc.course?.title,
        filename: file.displayFilename,
        mimeType: file.mimeType,
        size: blob.size,
        cachedAt: Date.now(),
      };
      await putOffline(meta, blob);
      used = used + blob.size - (prev?.size ?? 0);
      cached++;
    } catch {
      skipped++;
    }
  }

  return { cached, removed, skipped, totalBytes: await totalOfflineBytes() };
}
