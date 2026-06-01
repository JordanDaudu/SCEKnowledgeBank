import type { SuggestMetadataResponse } from "@workspace/api-client-react";
import type { ItemMeta } from "./upload-analysis";

const DB_NAME = "kb-upload";
const STORE = "draft";
const KEY = "current";
export const DRAFT_TTL_MS = 60_000;

/** The lifecycle states a queue item can be in (mirrors the upload page). */
type ItemStatus = "queued" | "uploading" | "success" | "failed";

/**
 * Input shape accepted by `toDraftItems` — structurally satisfied by the upload
 * page's `QueueItem` (which has extra runtime-only fields like `progress`/
 * `analyzing` that we intentionally do not persist).
 */
export interface DraftSource extends ItemMeta {
  id: string;
  file: File;
  filename: string;
  sizeBytes: number;
  status: ItemStatus;
  error?: string;
  errorCode?: string;
  displayFilename?: string;
  duplicateOfDocumentId?: string;
  duplicateOfTitle?: string;
  suggestion?: SuggestMetadataResponse | null;
}

/** What we persist per file. Status is narrowed to the resumable states. */
export interface DraftItem extends ItemMeta {
  id: string;
  file: File;
  filename: string;
  sizeBytes: number;
  status: "queued" | "failed";
  error?: string;
  errorCode?: string;
  displayFilename?: string;
  duplicateOfDocumentId?: string;
  duplicateOfTitle?: string;
  suggestion?: SuggestMetadataResponse | null;
}

interface DraftRecord {
  savedAt: number;
  items: DraftItem[];
}

/** TTL check (pure). Fresh = saved in the past and within `ttlMs`. */
export function isFresh(savedAt: number, now: number, ttlMs = DRAFT_TTL_MS): boolean {
  const age = now - savedAt;
  return age >= 0 && age <= ttlMs;
}

/**
 * Normalize the live queue into what's worth resuming (pure):
 *  - keep `queued` and `failed`; an interrupted `uploading` → `queued`
 *    (its request was aborted by leaving) with its transient error cleared,
 *  - drop `success` (already uploaded server-side),
 *  - carry only the persistable fields (no `progress`/`analyzing`).
 */
export function toDraftItems(items: DraftSource[]): DraftItem[] {
  const out: DraftItem[] = [];
  for (const it of items) {
    if (it.status === "success") continue;
    const interrupted = it.status === "uploading";
    out.push({
      id: it.id,
      file: it.file,
      filename: it.filename,
      sizeBytes: it.sizeBytes,
      courseId: it.courseId,
      materialType: it.materialType,
      categoryId: it.categoryId,
      visibility: it.visibility,
      semester: it.semester,
      academicYear: it.academicYear,
      title: it.title,
      tagIds: it.tagIds,
      status: interrupted ? "queued" : (it.status as "queued" | "failed"),
      error: interrupted ? undefined : it.error,
      errorCode: interrupted ? undefined : it.errorCode,
      displayFilename: it.displayFilename,
      duplicateOfDocumentId: it.duplicateOfDocumentId,
      duplicateOfTitle: it.duplicateOfTitle,
      suggestion: it.suggestion ?? null,
    });
  }
  return out;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null); // never throw — persistence is best-effort
  });
}

/** Write-through save. Clears the draft when nothing is worth saving. */
export async function saveDraft(items: DraftSource[]): Promise<void> {
  const draftItems = toDraftItems(items);
  if (draftItems.length === 0) {
    await clearDraft();
    return;
  }
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      const record: DraftRecord = { savedAt: Date.now(), items: draftItems };
      tx.objectStore(STORE).put(record, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}

/** Returns the saved items if a non-empty, non-stale draft exists, else null. */
export async function loadDraft(): Promise<DraftItem[] | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const record = await new Promise<DraftRecord | undefined>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result as DraftRecord | undefined);
      req.onerror = () => resolve(undefined);
    });
    if (!record || !Array.isArray(record.items) || record.items.length === 0) {
      return null;
    }
    if (!isFresh(record.savedAt, Date.now())) {
      await clearDraft();
      return null;
    }
    return record.items;
  } finally {
    db.close();
  }
}

export async function clearDraft(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}
