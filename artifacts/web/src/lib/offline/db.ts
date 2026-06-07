/**
 * IndexedDB store for offline-cached favorite documents.
 *
 * Two object stores keyed by documentId:
 *  - `meta`  — light metadata for rendering the "Saved offline" list without
 *              loading file bytes into memory.
 *  - `blobs` — the actual file bytes, fetched while online and replayed
 *              offline via object URLs.
 *
 * Kept separate so listing the saved items doesn't pull every (potentially
 * large) blob into memory.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface OfflineMeta {
  documentId: string;
  /** Current file id — used to detect a new version so we re-cache. */
  fileId: string;
  title: string;
  materialType: string;
  courseCode?: string;
  courseTitle?: string;
  filename: string;
  mimeType: string;
  /** Cached blob size in bytes. */
  size: number;
  /** Epoch ms when this was cached. */
  cachedAt: number;
}

interface OfflineDB extends DBSchema {
  meta: { key: string; value: OfflineMeta };
  blobs: { key: string; value: Blob };
}

let dbPromise: Promise<IDBPDatabase<OfflineDB>> | null = null;

function getDb(): Promise<IDBPDatabase<OfflineDB>> {
  if (!dbPromise) {
    dbPromise = openDB<OfflineDB>("kb-offline", 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
        if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
      },
    });
  }
  return dbPromise;
}

export async function putOffline(meta: OfflineMeta, blob: Blob): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["meta", "blobs"], "readwrite");
  await tx.objectStore("meta").put(meta, meta.documentId);
  await tx.objectStore("blobs").put(blob, meta.documentId);
  await tx.done;
}

export async function deleteOffline(documentId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["meta", "blobs"], "readwrite");
  await tx.objectStore("meta").delete(documentId);
  await tx.objectStore("blobs").delete(documentId);
  await tx.done;
}

export async function listOfflineMeta(): Promise<OfflineMeta[]> {
  return (await getDb()).getAll("meta");
}

export async function getOfflineBlob(documentId: string): Promise<Blob | undefined> {
  return (await getDb()).get("blobs", documentId);
}

export async function clearOffline(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["meta", "blobs"], "readwrite");
  await tx.objectStore("meta").clear();
  await tx.objectStore("blobs").clear();
  await tx.done;
}

export async function totalOfflineBytes(): Promise<number> {
  const all = await listOfflineMeta();
  return all.reduce((sum, m) => sum + m.size, 0);
}
