# Upload Draft Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the Upload page's unfinished file queue (files + metadata) to IndexedDB so it is restored if the user returns to the Upload page within 60 seconds, surviving a full reload/reopen.

**Architecture:** A dedicated `upload-draft-store.ts` module hides IndexedDB behind `saveDraft`/`loadDraft`/`clearDraft`, with two pure, unit-tested helpers (`isFresh` TTL check, `toDraftItems` normalization). `upload.tsx` restores on mount, write-through-saves (debounced) on every `items` change, and does a final best-effort save on unmount/`pagehide`. Only `queued`/`failed` items are kept; `uploading`→`queued`; `success` dropped.

**Tech Stack:** Vite + React 19 + TypeScript; IndexedDB (browser) for Blob-capable storage; Vitest (node env) for pure helpers; Playwright for the reload E2E.

**Branch:** `feat/batch-upload-redesign` (this builds on the per-file upload page).

---

## File Structure

- **Create** `artifacts/web/src/lib/upload-draft-store.ts` — draft persistence (IndexedDB I/O + pure `isFresh`/`toDraftItems`).
- **Create** `artifacts/web/src/lib/upload-draft-store.test.ts` — unit tests for the pure helpers.
- **Modify** `artifacts/web/src/pages/upload.tsx` — restore on mount, debounced write-through, unmount/`pagehide` save.
- **Modify** `artifacts/web/tests/upload-and-browse.spec.ts` — add a reload-restore E2E.

---

## Task 1: Draft store module + pure-helper tests

**Files:**
- Create: `artifacts/web/src/lib/upload-draft-store.ts`
- Test: `artifacts/web/src/lib/upload-draft-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `artifacts/web/src/lib/upload-draft-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isFresh, toDraftItems, type DraftSource } from "./upload-draft-store";

const FILE = {} as unknown as File; // toDraftItems passes the File through untouched

function src(over: Partial<DraftSource> = {}): DraftSource {
  return {
    id: "i1",
    file: FILE,
    filename: "a.pdf",
    sizeBytes: 10,
    courseId: "",
    materialType: "",
    categoryId: "",
    visibility: "public",
    semester: "",
    academicYear: "2026",
    title: "",
    tagIds: [],
    status: "queued",
    suggestion: null,
    ...over,
  };
}

describe("isFresh", () => {
  it("is true within the TTL and false past it", () => {
    expect(isFresh(1_000, 1_000, 60_000)).toBe(true); // same instant
    expect(isFresh(1_000, 60_000 + 1_000, 60_000)).toBe(true); // exactly at TTL
    expect(isFresh(1_000, 60_001 + 1_000, 60_000)).toBe(false); // 1ms past TTL
  });
  it("treats a future savedAt (clock skew) as not fresh", () => {
    expect(isFresh(5_000, 1_000, 60_000)).toBe(false);
  });
});

describe("toDraftItems", () => {
  it("keeps queued and failed items", () => {
    const out = toDraftItems([
      src({ id: "a", status: "queued" }),
      src({ id: "b", status: "failed", error: "Course is required" }),
    ]);
    expect(out.map((i) => i.id)).toEqual(["a", "b"]);
    expect(out[1].error).toBe("Course is required");
  });

  it("normalizes an interrupted uploading item back to queued and clears its error", () => {
    const out = toDraftItems([
      src({ id: "u", status: "uploading", error: "boom", errorCode: "network" }),
    ]);
    expect(out[0].status).toBe("queued");
    expect(out[0].error).toBeUndefined();
    expect(out[0].errorCode).toBeUndefined();
  });

  it("drops already-uploaded (success) items", () => {
    const out = toDraftItems([
      src({ id: "ok", status: "success" }),
      src({ id: "q", status: "queued" }),
    ]);
    expect(out.map((i) => i.id)).toEqual(["q"]);
  });

  it("carries the editable metadata and suggestion through", () => {
    const out = toDraftItems([
      src({ courseId: "c1", materialType: "exam", tagIds: ["t1"], suggestion: { keywords: [], tags: [] } as never }),
    ]);
    expect(out[0].courseId).toBe("c1");
    expect(out[0].materialType).toBe("exam");
    expect(out[0].tagIds).toEqual(["t1"]);
    expect(out[0].suggestion).toEqual({ keywords: [], tags: [] });
  });

  it("returns an empty array when nothing is worth saving", () => {
    expect(toDraftItems([src({ status: "success" })])).toEqual([]);
    expect(toDraftItems([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/web exec vitest run src/lib/upload-draft-store.test.ts`
Expected: FAIL — cannot find module `./upload-draft-store`.

- [ ] **Step 3: Write the implementation**

Create `artifacts/web/src/lib/upload-draft-store.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/web exec vitest run src/lib/upload-draft-store.test.ts`
Expected: PASS (all `isFresh` + `toDraftItems` cases).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @workspace/web exec tsc --noEmit`
Expected: clean (no errors).

- [ ] **Step 6: Commit**

```bash
git add artifacts/web/src/lib/upload-draft-store.ts artifacts/web/src/lib/upload-draft-store.test.ts
git commit -m "feat(web): IndexedDB upload-draft store (save/load/clear + pure helpers)"
```

---

## Task 2: Wire restore + write-through into the upload page

**Files:**
- Modify: `artifacts/web/src/pages/upload.tsx`

- [ ] **Step 1: Import the store**

In `artifacts/web/src/pages/upload.tsx`, add after the `upload-analysis` import block (currently ends around line 33):

```tsx
import {
  saveDraft,
  loadDraft,
  type DraftItem,
} from "@/lib/upload-draft-store";
```

- [ ] **Step 2: Add refs + restore + write-through + unmount/pagehide save**

The component currently has this effect (around lines 115-124):

```tsx
  const analysisAbortsRef = useRef<Map<string, AbortController>>(new Map());

  // Abort any in-flight analysis requests if the user navigates away.
  useEffect(() => {
    const aborts = analysisAbortsRef.current;
    return () => {
      for (const controller of aborts.values()) controller.abort();
      aborts.clear();
    };
  }, []);
```

Replace that whole block with:

```tsx
  const analysisAbortsRef = useRef<Map<string, AbortController>>(new Map());
  // Always-current snapshot of `items` for the unmount/pagehide save, whose
  // effect closure would otherwise capture a stale `items` value.
  const itemsRef = useRef<QueueItem[]>([]);
  // Gate write-through until the initial restore attempt has finished, so the
  // empty starting `items` can't clear a freshly-loaded draft.
  const hydratedRef = useRef(false);

  // Restore a recent draft on mount (files + metadata survive reloads).
  useEffect(() => {
    let cancelled = false;
    loadDraft()
      .then((draft: DraftItem[] | null) => {
        if (cancelled || !draft || draft.length === 0) return;
        const restored: QueueItem[] = draft.map((d) => ({
          ...d,
          progress: 0,
          analyzing: false,
        }));
        setItems(restored);
        toast({
          title: `Restored ${restored.length} file${restored.length === 1 ? "" : "s"} from your previous session.`,
        });
      })
      .catch(() => {})
      .finally(() => {
        hydratedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced write-through: the freshest queue is always persisted.
  useEffect(() => {
    if (!hydratedRef.current) return;
    const t = setTimeout(() => {
      void saveDraft(items);
    }, 500);
    return () => clearTimeout(t);
  }, [items]);

  // Abort in-flight analysis AND save a final draft when leaving (SPA unmount
  // or a hard reload/close via pagehide). itemsRef holds the latest queue.
  useEffect(() => {
    const aborts = analysisAbortsRef.current;
    const onPageHide = () => {
      void saveDraft(itemsRef.current);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      for (const controller of aborts.values()) controller.abort();
      aborts.clear();
      void saveDraft(itemsRef.current);
    };
  }, []);
```

- [ ] **Step 3: Keep `itemsRef` in sync**

Immediately after the `const [items, setItems] = useState<QueueItem[]>([]);` line (currently line 127), add:

```tsx
  itemsRef.current = items;
```

(Assigning a ref during render is safe here — it is a plain mirror of the latest `items`, read only by the leave-time save.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @workspace/web exec tsc --noEmit`
Expected: clean. (Note: `itemsRef`/`hydratedRef` are declared above where `items`/`setItems`/`QueueItem` are used; `useState`/`useRef` declarations are fine to reference `QueueItem` since it is a module-level type. `setItems` is referenced inside the restore effect, which runs after the `useState` call at runtime — declaration order in the function body has `analysisAbortsRef`/effects BEFORE `useState`, so MOVE the three new effects to sit AFTER the `const [items, setItems] = useState...` and `itemsRef.current = items;` lines to avoid using `items`/`setItems` before their declaration. Place: refs (`itemsRef`, `hydratedRef`) may stay with `analysisAbortsRef`; the three `useEffect`s and `itemsRef.current = items;` go right after the `useState` line. Verify with tsc.)

- [ ] **Step 5: Run web unit tests**

Run: `pnpm --filter @workspace/web run test`
Expected: PASS (existing + draft-store tests).

- [ ] **Step 6: Commit**

```bash
git add artifacts/web/src/pages/upload.tsx
git commit -m "feat(web): restore upload queue from draft; write-through persist on change/leave"
```

---

## Task 3: Reload-restore E2E + verification

**Files:**
- Modify: `artifacts/web/tests/upload-and-browse.spec.ts`

- [ ] **Step 1: Add the E2E test**

In `artifacts/web/tests/upload-and-browse.spec.ts`, add this test inside `test.describe("upload page", ...)`:

```ts
  test("restores the queue after a full page reload (within the TTL)", async ({
    page,
  }) => {
    await page.goto("/upload");
    const input = page.locator(
      '[data-testid="upload-dropzone"] input[type="file"]',
    );
    const name = `draft-${randomUUID().slice(0, 8)}.txt`;
    await input.setInputFiles({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from(`draft ${randomUUID()}`),
    });

    // One card present; fill its required fields so we can assert metadata
    // survives too.
    await expect(page.locator('[data-testid^="upload-item-"]')).toHaveCount(1);
    await fillCardCourseAndType(page, 0);

    // Give the debounced write-through (500ms) time to persist to IndexedDB.
    await page.waitForTimeout(900);

    await page.reload();

    // The card returns with the same file and the Material Type still set.
    await expect(page.locator('[data-testid^="upload-item-"]')).toHaveCount(1, {
      timeout: 10_000,
    });
    await expect(page.getByText(name)).toBeVisible();
    await expect(
      page.locator('[data-testid="card-type-select"]'),
    ).toContainText(/lecture notes/i);
  });
```

- [ ] **Step 2: Run the E2E (needs the dev stack)**

Run (requires API + web dev servers + seeded DB up, e.g. via `.\dev.ps1`): `pnpm --filter @workspace/web run test:e2e`
Expected: PASS, including the new reload-restore test.
If the dev servers/DB are not available in this environment, do NOT fake a pass — report that the E2E could not be executed here and must be run during integration; confirm the spec file still typechecks against existing patterns by inspection.

- [ ] **Step 3: Commit**

```bash
git add artifacts/web/tests/upload-and-browse.spec.ts
git commit -m "test(web): E2E for upload-draft restore across reload"
```

- [ ] **Step 4: Final verification sweep**

Run: `pnpm --filter @workspace/web exec tsc --noEmit` → clean.
Run: `pnpm --filter @workspace/web run test` → all pass.

---

## Self-Review (against the spec)

**Spec coverage:**
- IndexedDB store with `saveDraft`/`loadDraft`/`clearDraft` + pure `isFresh`/`toDraftItems` → Task 1. ✓
- Survive full reload (File bytes in IndexedDB) → Task 1 stores `File` directly; Task 3 E2E reloads. ✓
- 60 s TTL, last-save clock → `isFresh` + `DRAFT_TTL_MS`; write-through stamps `savedAt` each save; final save on leave refreshes it. ✓
- Restore only unfinished (`queued`/`failed`; `uploading`→`queued`; drop `success`) → `toDraftItems` (Task 1) + tests. ✓
- Restore on mount + toast → Task 2 restore effect. ✓
- Debounced write-through + clear when empty → Task 2 effect + `saveDraft` empties to `clearDraft`. ✓
- Unmount + `pagehide` save → Task 2 leave effect with `itemsRef`. ✓
- Clear on fully-successful batch → covered implicitly: all-`success` → `toDraftItems` empty → `saveDraft` calls `clearDraft` (write-through + leave save). ✓
- Privacy / best-effort (no throw) → `openDb` returns null & all tx handlers resolve on error. ✓
- Tests: pure-helper unit + reload E2E → Tasks 1 & 3. ✓

**Placeholder scan:** none — every code step is complete; commands have expected output.

**Type consistency:** `DraftSource`/`DraftItem` (Task 1) reused in Task 2's import; `loadDraft(): Promise<DraftItem[] | null>` matches Task 2 usage; `toDraftItems(items: DraftSource[])` and the page's `QueueItem` (extends `CardItem` extends `ItemMeta`, plus `file`/`filename`/`sizeBytes`/`status`/`suggestion`) structurally satisfies `DraftSource`. `saveDraft(items)` accepts `QueueItem[]`. ✓

**Note on declaration order (Task 2):** ensure the three new `useEffect`s and `itemsRef.current = items;` are placed AFTER `const [items, setItems] = useState...`; `itemsRef`/`hydratedRef`/`analysisAbortsRef` refs can be declared earlier. `tsc` in Step 4 will catch any use-before-declaration.
