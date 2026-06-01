# Followed Collections + per-user progress tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Followed collections" section to the Collections page, and enable the existing per-user study-progress UI (`reviewing`/`completed`) on collections the user follows but does not own.

**Architecture:** One new read endpoint (`GET /prep-hub/followed`) backed by a repo helper that lists the user's followed public/official collections, run through the existing `summarize()` DTO assembler. The Collections page renders the new list with the existing `CollectionGrid`; the public collection detail page (`/prep-hub/:id`) gains the owner-manage-page progress UI, gated behind `isFollowing`. The progress *setter* reuses the existing `PUT /documents/:id/progress` endpoint and `useSetDocumentProgress` hook — no new write path.

**Tech Stack:** TypeScript, Express, Prisma/Postgres, Zod, OpenAPI + orval codegen, React, TanStack Query, wouter, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-01-followed-collections-progress-design.md`

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `artifacts/api-server/src/repositories/collections.repo.ts` | Modify | Add `listFollowedCollections(userId)` — followed, public/official, not hidden/deleted, newest-followed first. |
| `artifacts/api-server/src/services/prep-hub.service.ts` | Modify | Add `listFollowed(user)` — repo rows → `summarize()`. |
| `artifacts/api-server/src/services/prep-hub.followed.test.ts` | Create | Integration test for `listFollowed`. |
| `artifacts/api-server/src/routes/prep-hub.ts` | Modify | Add `GET /prep-hub/followed`. |
| `lib/api-spec/openapi.yaml` | Modify | Add `listFollowedCollections` operation. |
| `lib/api-zod/*`, `lib/api-client-react/*` | Generated | `useListFollowedCollections` hook (via codegen — do not hand-edit). |
| `artifacts/web/src/pages/collections.tsx` | Modify | Render the "Followed collections" section. |
| `artifacts/web/src/pages/prep-hub-collection.tsx` | Modify | Progress bar + per-item `reviewing/completed` Select, gated by `isFollowing`. |

---

### Task 1: Backend — `listFollowed` (repo + service) via failing test

**Files:**
- Test: `artifacts/api-server/src/services/prep-hub.followed.test.ts`
- Modify: `artifacts/api-server/src/repositories/collections.repo.ts` (add after `recommendCollections`, around line 517)
- Modify: `artifacts/api-server/src/services/prep-hub.service.ts` (add after `listTrending`, around line 56)

This task uses TDD at the integration level, matching the existing `prep-hub.discovery.test.ts` (tests run against a real DB).

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/services/prep-hub.followed.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { createCollection } from "./collections.service";
import { listFollowed } from "./prep-hub.service";

const SX = `_phfol_${Date.now().toString(36)}`;
let viewer: AuthenticatedUser; // the follower
let owner: AuthenticatedUser; // owns the collections
let publicOldId: string;
let publicNewId: string;
let privateId: string;
let hiddenId: string;
let unfollowedId: string;

beforeAll(async () => {
  const v = await db.user.create({
    data: { email: `v${SX}@demo`, passwordHash: "x", displayName: `V${SX}`, isActive: true },
  });
  const o = await db.user.create({
    data: { email: `o${SX}@demo`, passwordHash: "x", displayName: `O${SX}`, isActive: true },
  });
  viewer = { id: v.id, roles: ["student"], enrollments: [] } as unknown as AuthenticatedUser;
  owner = { id: o.id, roles: ["student"], enrollments: [] } as unknown as AuthenticatedUser;

  publicOldId = (await createCollection(owner, { title: `Old ${SX}`, visibility: "public" })).id;
  publicNewId = (await createCollection(owner, { title: `New ${SX}`, visibility: "public" })).id;
  privateId = (await createCollection(owner, { title: `Priv ${SX}`, visibility: "private" })).id;
  hiddenId = (await createCollection(owner, { title: `Hid ${SX}`, visibility: "public" })).id;
  unfollowedId = (await createCollection(owner, { title: `Unf ${SX}`, visibility: "public" })).id;

  // Hide one collection AFTER it was followed.
  await db.studyCollection.update({ where: { id: hiddenId }, data: { hiddenAt: new Date() } });

  // viewer follows four of the five (not `unfollowedId`); control createdAt so
  // publicNewId is the most-recent follow.
  const base = Date.now();
  await db.studyCollectionFollower.createMany({
    data: [
      { collectionId: publicOldId, userId: v.id, createdAt: new Date(base - 60_000) },
      { collectionId: publicNewId, userId: v.id, createdAt: new Date(base - 10_000) },
      { collectionId: privateId, userId: v.id, createdAt: new Date(base - 30_000) },
      { collectionId: hiddenId, userId: v.id, createdAt: new Date(base - 20_000) },
    ],
  });
});

afterAll(async () => {
  await db.studyCollection.deleteMany({ where: { ownerId: owner.id } });
  await db.user.deleteMany({ where: { id: { in: [viewer.id, owner.id] } } });
});

describe("prep-hub.service listFollowed", () => {
  it("returns followed public collections, newest-followed first", async () => {
    const rows = await listFollowed(viewer);
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual([publicNewId, publicOldId]);
  });

  it("excludes private, hidden, and not-followed collections", async () => {
    const ids = (await listFollowed(viewer)).map((r) => r.id);
    expect(ids).not.toContain(privateId);
    expect(ids).not.toContain(hiddenId);
    expect(ids).not.toContain(unfollowedId);
  });

  it("marks every returned collection as followed", async () => {
    const rows = await listFollowed(viewer);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.isFollowing)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from repo root):
```
corepack pnpm --filter @workspace/api-server exec vitest run src/services/prep-hub.followed.test.ts
```
Expected: FAIL — `listFollowed` is not exported from `./prep-hub.service` (import/type error or "listFollowed is not a function").

> Note: a Postgres DB must be reachable (this machine: load `.env` first so `DATABASE_URL` points at `localhost:5433`). In PowerShell:
> `Get-Content .env | ForEach-Object { if ($_ -match '^\s*([^#=]+)=(.*)$') { Set-Item -Path "env:$($matches[1].Trim())" -Value $matches[2].Trim() } }`

- [ ] **Step 3: Implement the repo helper**

In `artifacts/api-server/src/repositories/collections.repo.ts`, add immediately after the `recommendCollections` function (it ends around line 517, just before the `// ─── Tags ───` comment). It reuses the existing `fetchCollectionsByIdOrder` helper and the `db` import already at the top of the file:

```typescript
/** Public/official collections the user follows, ordered newest-followed
 *  first. Drops any that were since made private, hidden, or soft-deleted. */
export async function listFollowedCollections(
  userId: string,
): Promise<Array<CollectionRow & { itemCount: number }>> {
  const follows = await db.studyCollectionFollower.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { collectionId: true },
  });
  const rows = await fetchCollectionsByIdOrder(follows.map((f) => f.collectionId));
  return rows.filter(
    (c) =>
      c.deletedAt == null &&
      c.hiddenAt == null &&
      (c.visibility === "public" || c.isOfficial),
  );
}
```

- [ ] **Step 4: Implement the service function**

In `artifacts/api-server/src/services/prep-hub.service.ts`, add after the `listTrending` function (ends around line 56), before `getPublicCollection`. It uses the already-imported `collectionsRepo`, `collectionsService`, `AuthenticatedUser`, and `CollectionSummaryDTO`:

```typescript
export async function listFollowed(
  user: AuthenticatedUser,
): Promise<CollectionSummaryDTO[]> {
  const rows = await collectionsRepo.listFollowedCollections(user.id);
  return collectionsService.summarize(rows, user);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:
```
corepack pnpm --filter @workspace/api-server exec vitest run src/services/prep-hub.followed.test.ts
```
Expected: PASS — all three tests green.

- [ ] **Step 6: Commit**

```
git add artifacts/api-server/src/repositories/collections.repo.ts artifacts/api-server/src/services/prep-hub.service.ts artifacts/api-server/src/services/prep-hub.followed.test.ts
git commit -m "feat(api): list followed public collections (repo + service + test)"
```

---

### Task 2: Backend — route + OpenAPI + codegen

**Files:**
- Modify: `artifacts/api-server/src/routes/prep-hub.ts:53-59` (add handler right after the `/prep-hub/recommended` handler, before `/prep-hub/collections/:id`)
- Modify: `lib/api-spec/openapi.yaml:1289` (add operation after the `/prep-hub/recommended` block, before `/prep-hub/collections/{id}`)

- [ ] **Step 1: Add the route handler**

In `artifacts/api-server/src/routes/prep-hub.ts`, insert directly after the `/prep-hub/recommended` handler (the block ending at line 59) and before `router.get("/prep-hub/collections/:id", ...)`:

```typescript
router.get("/prep-hub/followed", requireAuth, async (req, res, next) => {
  try {
    res.json(await prepHubService.listFollowed(req.authUser!));
  } catch (err) {
    next(err);
  }
});
```

(`"followed"` is a distinct static segment from `"collections"`, so it does not collide with the `/prep-hub/collections/:id` param route.)

- [ ] **Step 2: Add the OpenAPI operation**

In `lib/api-spec/openapi.yaml`, insert this block immediately after the `/prep-hub/recommended:` operation (which ends at line 1289) and before `/prep-hub/collections/{id}:`. Match the existing 2-space indentation under `paths:`:

```yaml
  /prep-hub/followed:
    get:
      operationId: listFollowedCollections
      tags: [prep-hub]
      summary: Public/official collections the current user follows
      responses:
        "200":
          description: Collections
          content:
            application/json:
              schema: { type: array, items: { $ref: "#/components/schemas/StudyCollectionSummary" } }
```

- [ ] **Step 3: Regenerate the API client**

Run:
```
corepack pnpm --filter @workspace/api-spec run codegen
```
Expected: regenerates `lib/api-zod` and `lib/api-client-react`. Confirm the hook now exists:
```
corepack pnpm exec grep -rl "useListFollowedCollections" lib/api-client-react/src/generated
```
Expected: prints `lib/api-client-react/src/generated/api.ts`.

- [ ] **Step 4: Typecheck the backend + generated libs**

Run:
```
corepack pnpm run typecheck
```
Expected: PASS (all packages). This confirms the route, service, and generated client all line up.

- [ ] **Step 5: Commit**

```
git add artifacts/api-server/src/routes/prep-hub.ts lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react
git commit -m "feat(api): GET /prep-hub/followed endpoint + generated client hook"
```

---

### Task 3: Frontend — "Followed collections" section on the Collections page

**Files:**
- Modify: `artifacts/web/src/pages/collections.tsx:3-7` (imports) and `:178-205` (sections)

No component test framework exists for this page (the repo verifies the web app via typecheck + Playwright smoke + manual demo); this task is verified by typecheck and the manual check in Task 5.

- [ ] **Step 1: Add the followed-collections query hook imports**

In `artifacts/web/src/pages/collections.tsx`, replace the existing api-client import block (lines 3–7):

```typescript
import {
  useListMyCollections,
  getListMyCollectionsQueryKey,
  useCreateCollection,
} from "@workspace/api-client-react";
```

with:

```typescript
import {
  useListMyCollections,
  getListMyCollectionsQueryKey,
  useCreateCollection,
  useListFollowedCollections,
  getListFollowedCollectionsQueryKey,
} from "@workspace/api-client-react";
```

- [ ] **Step 2: Fetch followed collections in the `Collections` component**

In the `Collections()` component, directly below the existing `useListMyCollections` call (currently lines 157–159), add:

```typescript
  const { data: followed, isLoading: followedLoading } = useListFollowedCollections({
    query: { queryKey: getListFollowedCollectionsQueryKey(), staleTime: 15_000 },
  });
```

- [ ] **Step 3: Render the "Followed collections" section**

In `collections.tsx`, immediately after the closing `</section>` of the "My collections" section (currently line 205) and before the final `</div>`, insert:

```tsx
      <section aria-label="Followed collections">
        <h2 className="mb-3 font-serif text-xl font-bold text-foreground">
          Followed collections
        </h2>
        {followedLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        ) : followed && followed.length > 0 ? (
          <CollectionGrid
            collections={followed}
            basePath="/prep-hub"
            testid="followed-collections-grid"
          />
        ) : (
          <div
            className="rounded-xl border border-dashed bg-card py-12 text-center"
            data-testid="followed-collections-empty"
          >
            <p className="text-sm text-muted-foreground">
              Collections you follow in Prep Hub appear here.
            </p>
          </div>
        )}
      </section>
```

(`Skeleton`, `CollectionGrid`, and the section wrapper pattern are already imported/used in this file. `basePath="/prep-hub"` makes followed cards open the public detail view rather than the owner-only manage page.)

- [ ] **Step 4: Typecheck**

Run:
```
corepack pnpm --filter @workspace/web run typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add artifacts/web/src/pages/collections.tsx
git commit -m "feat(web): Followed collections section on the Collections page"
```

---

### Task 4: Frontend — progress tracking on followed collection detail page

**Files:**
- Modify: `artifacts/web/src/pages/prep-hub-collection.tsx` — imports (lines 1–39), handlers (lines 53–148), and the items list (lines 330–362).

The detail page currently wraps each item's whole card in a `<Link>` to the document and shows a completed checkmark unconditionally. This task switches to the owner-manage-page item layout (title is the link; checkmark + progress `<Select>` appear only when tracking) so a `<Select>` is not nested inside an `<a>`. Per the spec, the checkmark and progress bar are hidden for non-followers.

- [ ] **Step 1: Add the progress hook + Select imports**

In `artifacts/web/src/pages/prep-hub-collection.tsx`, add `useSetDocumentProgress` to the `@workspace/api-client-react` import block (it currently ends with `type StudyCollectionItem,` at line 18):

```typescript
  useHideCollection,
  useUnhideCollection,
  useSetDocumentProgress,
  type StudyCollectionItem,
} from "@workspace/api-client-react";
```

Then add the Select primitives import directly below the existing `import { Skeleton } ...` line (line 24):

```typescript
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
```

- [ ] **Step 2: Add the progress mutation + handler**

In the component, add the mutation alongside the other `...Mut` declarations — directly after `const unhideMut = useUnhideCollection();` (line 60):

```typescript
  const progressMut = useSetDocumentProgress();
```

Then add the handler directly after the existing `handleError` function (which ends at line 79):

```typescript
  const setProgress = (documentId: string, status: string) =>
    progressMut.mutate(
      { id: documentId, data: { status: status as "reviewing" | "completed" | "none" } },
      { onSuccess: refresh, onError: handleError },
    );
```

- [ ] **Step 3: Compute `canTrack`**

Find `const items = col.items ?? [];` (line 148) and add the gate right after it:

```typescript
  const items = col.items ?? [];
  const canTrack = col.isFollowing && !isAdmin;
```

(`isAdmin` is computed at line 110; `col` is guaranteed non-null here by the `if (!col)` guard above.)

- [ ] **Step 4: Add the "Study progress" bar before the items list**

Immediately before the `{items.length === 0 ? (` block (line 330), insert:

```tsx
      {canTrack && col.itemCount > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">Study progress</span>
            <span className="text-muted-foreground tabular-nums">
              {col.completedCount} of {col.itemCount} completed · {col.progressPercent}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${col.progressPercent}%` }}
              role="progressbar"
              aria-valuenow={col.progressPercent}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </div>
      )}
```

- [ ] **Step 5: Replace the items list rendering**

Replace the entire items block (currently lines 330–362, the `{items.length === 0 ? ( ... ) : ( <ul ...>...</ul> )}` expression) with:

```tsx
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card py-16 text-center" data-testid="collection-empty">
          <p className="text-muted-foreground">This collection has no materials yet.</p>
        </div>
      ) : (
        <ul className="space-y-2" data-testid="collection-items">
          {items.map((item: StudyCollectionItem) => (
            <li key={item.document.id}>
              <Card className={canTrack ? "" : "hover-elevate transition-colors"}>
                <CardContent className="flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/documents/${item.document.id}`}
                        className="truncate font-medium hover:text-primary"
                      >
                        {item.document.title}
                      </Link>
                      {canTrack && item.progress === "completed" && (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatMaterialType(item.document.materialType)}
                      {item.document.course ? ` · ${item.document.course.code}` : ""}
                    </p>
                    {item.note && (
                      <p className="mt-0.5 text-xs italic text-muted-foreground">"{item.note}"</p>
                    )}
                  </div>
                  {canTrack && (
                    <Select
                      value={item.progress ?? "none"}
                      onValueChange={(v) => setProgress(item.document.id, v)}
                    >
                      <SelectTrigger className="h-8 w-32" data-testid="item-progress">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not started</SelectItem>
                        <SelectItem value="reviewing">Reviewing</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
```

(`Card`, `CardContent`, `Link`, `CheckCircle2`, and `formatMaterialType` are all already imported in this file. The item title is now the link target for both tracking and non-tracking views — matching the owner manage page; the whole-card link affordance is intentionally dropped.)

- [ ] **Step 6: Typecheck**

Run:
```
corepack pnpm --filter @workspace/web run typecheck
```
Expected: PASS.

- [ ] **Step 7: Commit**

```
git add artifacts/web/src/pages/prep-hub-collection.tsx
git commit -m "feat(web): track study progress on followed collections (detail page)"
```

---

### Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck**

Run:
```
corepack pnpm run typecheck
```
Expected: PASS across all packages.

- [ ] **Step 2: Run the api-server unit/service tests**

Run (load `.env` first so `DATABASE_URL` is set — see Task 1 Step 2 note):
```
corepack pnpm --filter @workspace/api-server run test
```
Expected: all tests pass, including the new `prep-hub.followed.test.ts`.

- [ ] **Step 3: Manual demo check**

Ensure the demo seed has run (`corepack pnpm --filter @workspace/api-server run seed`) and both servers are up (`.\dev.ps1`). Then:
1. Log in as `noa.student@knowledgebank.demo` / `Demo1234!` (the seed has Noa following several public collections).
2. Go to **Collections** (`/collections`) → confirm a **"Followed collections"** section lists the collections Noa follows, below "My collections".
3. Click a followed collection → it opens the Prep Hub detail view (`/prep-hub/:id`) with a **Following** state, a **Study progress** bar, and a per-item **Not started / Reviewing / Completed** dropdown.
4. Set one item to **Completed** → the checkmark appears and the progress bar advances.
5. Log in as a user who does **not** follow a given public collection, open it, and confirm **no** progress bar, dropdowns, or checkmarks appear.

- [ ] **Step 4: Final confirmation**

Report results (typecheck, test counts, manual check). No commit — all code was committed in Tasks 1–4.

---

## Self-Review

**Spec coverage:**
- "Followed collections" section on Collections page → Task 3. ✓
- Progress tracking on followed (not owned) collections → Task 4. ✓
- Backend list endpoint (repo + service + route + OpenAPI) → Tasks 1–2. ✓
- Hide checkmark/bar for non-followers → Task 4 Steps 4–5 (`canTrack` gate). ✓
- Exclude private/hidden/deleted/non-followed; newest-followed order → Task 1 (repo filter + test). ✓
- Unit test for `listFollowed` → Task 1. ✓
- No seed change needed (demo already seeds follows) → noted; Task 5 Step 3 relies on it. ✓

**Type consistency:** `listFollowedCollections` (repo) → `listFollowed` (service) → operationId `listFollowedCollections` → hook `useListFollowedCollections` / `getListFollowedCollectionsQueryKey`. Status union `"reviewing" | "completed" | "none"` matches `useSetDocumentProgress`/`SetProgressRequest` and the owner manage page. `canTrack = col.isFollowing && !isAdmin` referenced consistently in Steps 3–5.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has expected output.
