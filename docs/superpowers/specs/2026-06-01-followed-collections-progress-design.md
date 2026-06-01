# Followed Collections + per-user progress tracking — design

**Date:** 2026-06-01
**Status:** Approved (pending spec review)
**Branch:** feat/batch-upload-redesign (current)

## Problem

Users can follow public study collections in Prep Hub, but the follow has no
home: the Collections page (`/collections`) lists only collections the user
*owns*, and following gives no ongoing value. Separately, per-document study
progress (`reviewing` / `completed`) can today only be set on collections you
**own**, via the owner manage page (`/collections/:id`). A follower of someone
else's collection can see a "completed" checkmark on items but cannot set
their own progress.

## Goal

1. Surface a **"Followed collections"** section on the Collections page listing
   the public/official collections the current user follows.
2. Enable **per-user progress tracking** (`reviewing` / `completed` / clear) on
   a collection the user **follows but does not own** — using the same UI the
   owner manage page already has. Progress tracking remains exclusive to
   followed (or owned) collections.

## Non-goals (YAGNI)

- No inline per-card progress controls on the Collections grid.
- No new "followed" badge / card styling.
- No changes to the owner manage page (`collection-manage.tsx`).
- No follow/unfollow UX changes (the existing Follow button on the detail page
  is reused as-is).
- No notifications, no "recently followed" ordering guarantees beyond
  newest-followed-first.

## Existing building blocks (reused, not rebuilt)

- **Follow state:** `study_collection_followers` table; repo helpers
  `followCollection` / `unfollowCollection` / `listFollowedCollectionIds`.
- **Progress model:** `study_progress` (per `userId` × `documentId`,
  status `reviewing | completed`). Service `studyProgress.service.setProgress`,
  route `PUT /documents/:id/progress`, generated hook `useSetDocumentProgress`.
- **DTO progress fields:** `collectionsService.summarize` / `assembleDetail`
  already populate `progressPercent`, `completedCount`, and per-item
  `progress` for the current user — including on the public detail endpoint
  (`getPublicCollection` → `assembleDetail`).
- **Detail page:** `prep-hub-collection.tsx` already renders items and a
  "completed" checkmark; **owner manage page** `collection-manage.tsx` already
  renders the progress bar + per-item `None/Reviewing/Completed` `<Select>`.

## Architecture

### Backend

1. **`repositories/collections.repo.ts` — `listFollowedCollections(userId)`**
   - Read the user's `study_collection_followers` rows ordered by `createdAt`
     desc (newest follow first); collect `collectionId`s in that order.
   - Load the collections via the existing `fetchCollectionsByIdOrder(ids)`
     helper (preserves order, attaches `itemCount`).
   - Filter the result to collections that are still discoverable:
     `deletedAt == null && hiddenAt == null && (visibility === "public" ||
     isOfficial)`. (A collection that was unpublished/hidden after the user
     followed it should drop out of the list.)
   - Return `Array<CollectionRow & { itemCount: number }>`.

2. **`services/prep-hub.service.ts` — `listFollowed(user)`**
   - `const rows = await collectionsRepo.listFollowedCollections(user.id);`
   - `return collectionsService.summarize(rows, user);`
   - `summarize` fills `isFollowing` (true for all here), `progressPercent`,
     `completedCount`, rating/like/view counters, etc.

3. **`routes/prep-hub.ts` — `GET /prep-hub/followed`**
   - `requireAuth`. Returns `await prepHubService.listFollowed(req.authUser!)`.
   - **Registration order:** must be declared **before** the `GET
     /prep-hub/:id` route so `"followed"` is not captured as an `:id` param.

4. **OpenAPI (`lib/api-spec/openapi.yaml`)**
   - New operation `listFollowedCollections`: `GET /prep-hub/followed`,
     `200` → array of `CollectionSummary` (the existing schema used by
     `listDiscoverableCollections` / `listRecommendedCollections`).
   - Run `pnpm --filter @workspace/api-spec run codegen` to regenerate the
     React-Query hook (`useListFollowedCollections`) and Zod types.

The progress **setter** path is unchanged: the detail page calls the existing
`useSetDocumentProgress` (`PUT /documents/:id/progress`). Note its server-side
guard `permissions.canView(doc, user)` means a follower who lacks access to a
restricted document in the collection cannot set progress on that item — this
is acceptable and pre-existing behavior (they can't open that document either).

### Frontend

5. **`pages/collections.tsx` — "Followed collections" section**
   - Add `useListFollowedCollections` query (staleTime ~15s, dedicated query
     key).
   - Render a second `<section aria-label="Followed collections">` below the
     existing "My collections" section, heading **"Followed collections"**.
   - Non-empty → `<CollectionGrid collections={followed} basePath="/prep-hub"
     testid="followed-collections-grid" />`. `basePath="/prep-hub"` is required
     because followed collections are not owned — their cards must open the
     public detail view, not the owner-only manage page.
   - Empty → a one-line dashed empty state:
     "Collections you follow in Prep Hub appear here."
     (`data-testid="followed-collections-empty"`).
   - Loading → skeleton grid, mirroring the "My collections" loading state.

6. **`pages/prep-hub-collection.tsx` — progress tracking when following**
   - Compute `const canTrack = col.isFollowing && !isAdmin;`
   - Add `const progressMut = useSetDocumentProgress();` and a
     `setProgress(documentId, status)` handler that mutates and, on success,
     invalidates the collection detail query key (`refresh()` already exists;
     it also invalidates discovery/recommended — harmless).
   - When `canTrack`:
     - Render a **"Study progress"** bar above the items list:
       `{col.completedCount} of {col.itemCount} completed · {col.progressPercent}%`
       with the same bar markup as `collection-manage.tsx`
       (`role="progressbar"`, `aria-valuenow={col.progressPercent}`).
     - For each item, render a `None / Reviewing / Completed` `<Select>`
       (`data-testid="item-progress"`, value `item.progress ?? "none"`,
       mapping `none` → status `"none"` which clears progress) plus the
       completed checkmark.
   - When **not** tracking (not following, or admin): render items as today but
     **without** the completed checkmark and without the progress bar/selects —
     progress is exclusively a followed/owned-collection capability.
   - Reuse imports from the manage page pattern: `useSetDocumentProgress`,
     the `Select*` primitives, and the existing `CheckCircle2` icon.

### Data flow

```
Collections page
  └─ GET /prep-hub/followed ──► prepHubService.listFollowed
                                  └─ repo.listFollowedCollections (followers, newest first,
                                       filtered to public/official & not hidden/deleted)
                                  └─ collectionsService.summarize (isFollowing, progressPercent…)
  └─ CollectionGrid basePath="/prep-hub" ──► card click ──► /prep-hub/:id

Collection detail (/prep-hub/:id, isFollowing=true)
  └─ GET /prep-hub/:id ──► assembleDetail (per-item progress for current user)
  └─ per-item <Select> ──► PUT /documents/:id/progress (useSetDocumentProgress)
                            └─ onSuccess ──► invalidate detail query ──► bar + checkmarks update
```

## Error handling

- `GET /prep-hub/followed`: `requireAuth` → 401 when unauthenticated. Always
  returns an array (empty when the user follows nothing).
- `setProgress` from the detail page: reuse the page's existing `handleError`
  toast. A `404` (document not viewable / unknown status `400`) surfaces as a
  destructive toast; the dropdown reverts on the next query refresh.
- Followed collection that was hidden/unpublished after following: silently
  excluded by the repo filter (no error; it simply disappears from the list).

## Testing

- **`services/prep-hub.service` unit test — `listFollowed`:**
  - Returns the collections a user follows, ordered newest-followed-first.
  - Excludes collections the user does **not** follow.
  - Excludes a followed collection that is `private` (not public/official),
    `hiddenAt != null`, or soft-deleted.
  - Each returned summary has `isFollowing === true`.
- **Typecheck + codegen:** `pnpm run typecheck` clean across packages after
  regenerating the API client.
- **Manual / demo:** log in as Noa (the demo seed already has her following
  several public collections) → Collections page shows "Followed collections"
  → open one → set an item to Completed → progress bar advances.

## Rollout / migration

None. No schema change, no data migration. The demo seed already creates
follower rows, so the feature has data immediately after `pnpm seed:demo`.
