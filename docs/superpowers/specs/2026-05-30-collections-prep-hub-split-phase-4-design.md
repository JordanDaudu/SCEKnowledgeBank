# Collections / Prep Hub Split — Phase 4 Design (Admin Moderation)

**Date:** 2026-05-30
**Status:** Approved (design)
**Scope:** Phase 4 of 4 — **admin moderation** of public study collections: a
reversible "hide/unhide" for collections, admin removal of any collection
comment, a lean moderation list + stats page, and inline admin controls on the
Prep Hub view. This is the FINAL phase of the epic.

**Prior phases:**
- Phase 1 — structural split, access control, `shared`→`public`, metadata, duplicate.
- Phase 2 — engagement (ratings, likes, views, comments).
- Phase 3 — discovery & ranking (FTS, weighted ranking, trending, sectioned homepage).

---

## 1. Background & Motivation

Since Phase 1, admins are **read-only** in Prep Hub (`canUseCollections` is
false for admins; they browse but cannot create/manage collections or engage).
The epic always reserved **moderation** for this final phase. Phase 4 gives
admins the ability to keep the public discovery surface clean without destroying
users' work or touching private collections:

- **Hide/unhide a public collection** — a reversible moderator action that
  removes a collection from all public surfaces (discovery, search, trending,
  recommendations, public detail) while the owner keeps it in their workspace,
  flagged "hidden by a moderator".
- **Remove any collection comment** — extend the Phase-2 author-only delete with
  an admin override (soft-delete + audit).
- **Moderation oversight** — a lean admin list of public/hidden collections with
  small stats, plus the moderation actions flowing into the existing admin
  activity feed.

### What already exists (reuse, do not rebuild)

- **Admin role check** `permissions.isAdmin(user)` and the
  `requireCollectionsAccess` middleware pattern (`src/middlewares/`). There is no
  `requireAdmin` middleware yet — Phase 4 adds one (admin routes today gate
  inside the service, e.g. `analytics.getAdminOverview`).
- **Audit trail** `audit.service.record(actorUserId, action, entityType,
  entityId, metadata)` + the role-scoped `listActivity` projection (admins see
  every action). Moderation events recorded here surface in the existing admin
  Activity feed with no extra read code.
- **Soft-delete**: `study_collections.deletedAt` and
  `study_collection_comments.deletedAt` already exist; `commentsRepo.softDeleteComment`
  already decrements `study_collections.commentCount` transactionally.
- **The public gate** lives in three places that Phase 4 tightens:
  `collections.repo` (`listDiscoverable`/`listTrending` raw SQL,
  `recommendCollections` ORM `where`), and the `isPublic` helpers in
  `prep-hub.service`, `collection-engagement.service`, `collection-comments.service`.
- **DTO assembly** (`collections.service.toSummary`/`summarize`/`assembleDetail`)
  reads straight off `CollectionRow`; the new `hiddenAt`/`hiddenReason` ride
  along the same way the Phase-2/3 columns do.
- **Web**: the Prep Hub read-only view (`prep-hub-collection.tsx`), the owner
  manage view (`collection-manage.tsx`), and the admin nav "More" menu /
  `AuthGuard blockAdmin` route gating from Phase 1.

---

## 2. Goals & Non-Goals

### Goals (Phase 4)

- A reversible moderation flag (`hiddenAt`/`hiddenBy`/`hiddenReason`) on
  `study_collections`; hidden collections are excluded from every public surface
  but preserved for the owner.
- Admins can hide/unhide any public/official collection and remove any
  collection comment; every action is audited.
- Admins (and only admins) can still **view** a hidden collection's detail (to
  review/unhide it); all other roles get a 404.
- A lean admin moderation list page (public + hidden collections, hide/unhide,
  stats) + inline admin controls on the Prep Hub collection view + a
  "hidden by a moderator" banner in the owner's workspace.
- No change to Phase 1–3 behavior for non-admins beyond hidden collections
  disappearing from public surfaces.

### Non-Goals (Phase 4)

- **Hard takedown / deletion** of a user's collection by an admin (declined —
  hide is reversible and sufficient).
- **Appeals workflow**, automated/ML moderation, content-policy classification.
- Admins creating/editing user collections or accessing **private** collections
  (still forbidden — moderation is public-content only).
- Per-section/trending caching, ranking changes, new analytics charts beyond the
  lean stats block.

---

## 3. Architecture & Module Boundaries

Phase 4 adds an admin-only moderation module alongside the existing seams. The
"hidden" gate is enforced in the shared data layer + the service `isPublic`
helpers, so every public surface honors it uniformly.

| Concern | Module |
|---|---|
| `requireAdmin` middleware | **new** `src/middlewares/require-admin.ts` |
| Hide/unhide writes, moderation list, counts | `collections.repo.ts` (extended) |
| Moderation orchestration (hide/unhide/remove-comment/list) + audit | **new** `src/services/moderation.service.ts` |
| Admin moderation routes | **new** `src/routes/moderation.ts` (`/api/admin/collections/*`) |
| The hidden-gate tightening | `collections.repo` queries + `prep-hub`/`collection-engagement`/`collection-comments` service `isPublic` helpers |
| Admin moderation list page + inline controls + owner banner | web: new `pages/admin-prep-hub-moderation.tsx`, `prep-hub-collection.tsx`, `collection-manage.tsx` |

**Boundary rules:** `moderation.service` is the only writer of the hidden flag
and the only place an admin can delete a non-owned comment. It records an audit
event for every action. Admin gating is enforced at the route (`requireAdmin`)
*and* the service stays defensive (re-checks `isAdmin`) so a future caller can't
bypass it. The moderation service does not touch private collections (it
operates on public/official rows; a hide request for a non-public collection is
a 404).

---

## 4. Data Model Changes

One additive Prisma migration. Schema-visible additions to `StudyCollection`:

- `hiddenAt DateTime? @map("hidden_at") @db.Timestamptz()` — when set, the
  collection is hidden from all public surfaces.
- `hiddenBy String? @map("hidden_by") @db.Uuid` — the moderating admin's id.
  Stored as a plain uuid with **no FK relation** (matching the schema's existing
  no-FK precedents like `parentDocumentId`), to avoid a new `User` inverse
  relation.
- `hiddenReason String? @map("hidden_reason")` — optional free-text reason shown
  to the owner + admin.

Index: `@@index([hiddenAt], map: "study_collections_hidden_at_idx")` to support
the moderation list's hidden filter.

`CollectionRow` (repo) gains `hiddenAt: Date | null`, `hiddenBy: string | null`,
`hiddenReason: string | null`. All additive; existing rows default to NULL
(not hidden); no backfill.

---

## 5. The Hidden Gate

A collection is **publicly visible** iff:
`deletedAt IS NULL AND (visibility = 'public' OR isOfficial) AND hiddenAt IS NULL`.

Enforcement points (all add the `hiddenAt IS NULL` clause):

- `collections.repo.listDiscoverable` — raw-SQL `WHERE` (search + all sorts).
- `collections.repo.listTrending` — raw-SQL `WHERE`.
- `collections.repo.recommendCollections` — Prisma `where: { hiddenAt: null }`.
- `collection-engagement.service` + `collection-comments.service` `isPublic`
  helpers → a hidden collection rejects like/rate/comment for **everyone** (404;
  admins are already engagement-blocked).

**The one role exception — viewing:** `prep-hub.service.getPublicCollection`:
- public/official **and not hidden** → returned to any authenticated user.
- public/official **and hidden** → returned **only if the viewer is an admin**
  (so they can review/unhide); otherwise `404` (never reveal a hidden item).
- not public/official → `404` (unchanged).

The detail/summary DTOs expose `hiddenAt`/`hiddenReason` so the admin view shows
the status + an Unhide control, and the owner workspace shows the banner.

---

## 6. Backend Changes

### 6.1 `requireAdmin` middleware (new)

`src/middlewares/require-admin.ts` — mirrors `requireCollectionsAccess`:
`if (!permissions.isAdmin(req.authUser)) return next(forbidden(...)); next();`

### 6.2 `collections.repo.ts` (extended)

- `CollectionRow` gains `hiddenAt`/`hiddenBy`/`hiddenReason`.
- `hideCollection(id, adminId, reason)` — set `hiddenAt = now()`,
  `hiddenBy = adminId`, `hiddenReason = reason ?? null`, bump `updatedAt`.
- `unhideCollection(id)` — clear `hiddenAt`/`hiddenBy`/`hiddenReason`.
- `listForModeration({ includeHidden, limit })` — public/official rows (and,
  when `includeHidden`, hidden ones too), newest-first, with `_count.items`.
- `countPublicCollections()` / `countHiddenCollections()` — for the stats block.
- Add `hiddenAt IS NULL` to `listDiscoverable`/`listTrending`; add
  `hiddenAt: null` to `recommendCollections`'s `where`.

### 6.3 `moderation.service.ts` (new, admin-only)

```
hideCollection(admin, id, reason?)   → load public/official-or-404; repo.hideCollection;
                                        audit "collection.hidden"; return detail DTO
unhideCollection(admin, id)          → load-or-404; repo.unhideCollection;
                                        audit "collection.unhidden"; return detail DTO
removeComment(admin, commentId)      → load comment-or-404; commentsRepo.softDeleteComment
                                        (decrements commentCount); audit "collection.comment.removed"
listModeration(admin, { includeHidden, limit }) → { collections: CollectionSummaryDTO[],
                                        stats: { totalPublic, totalHidden } }
```
Every function calls `permissions.isAdmin(admin)` first (defensive; `false` →
`forbidden`). `hideCollection`/`unhideCollection` 404 on a non-public/non-official
or missing collection. Audit metadata includes `{ reason }` where relevant.
DTOs are built via the existing `collections.service` helpers (now carrying
`hiddenAt`/`hiddenReason`).

### 6.4 Routes — `routes/moderation.ts` (new), `/api/admin/collections/*`

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/admin/collections/moderation` | `?includeHidden&limit` | `{ collections, stats }` |
| POST | `/admin/collections/:id/hide` | `{ reason?: string }` | `StudyCollectionDetail` |
| POST | `/admin/collections/:id/unhide` | — | `StudyCollectionDetail` |
| DELETE | `/admin/collections/comments/:commentId` | — | `204` |

All `requireAuth` + `requireAdmin`. Registered in `routes/index.ts`.

### 6.5 OpenAPI + generated clients

Add `hiddenAt`/`hiddenReason` to `StudyCollectionSummary` (and therefore
detail). Add a `CollectionModerationList` schema (`{ collections:
StudyCollectionSummary[], stats: { totalPublic, totalHidden } }`). Add the four
`/admin/collections/*` paths (`operationId`s `listCollectionModeration`,
`hideCollection`, `unhideCollection`, `removeCollectionComment`), tag
`moderation`. Regenerate `@workspace/api-zod` + `@workspace/api-client-react`
(new hooks `useListCollectionModeration`, `useHideCollection`,
`useUnhideCollection`, `useRemoveCollectionComment`).

---

## 7. Frontend Changes

### 7.1 Prep Hub collection view (`prep-hub-collection.tsx`) — inline admin controls

- For admins only: a **Hide**/**Unhide** button in the header (Hide opens a small
  reason prompt → `useHideCollection({ id, data: { reason } })`; Unhide →
  `useUnhideCollection({ id })`), and a **Remove** action on each comment
  (`useRemoveCollectionComment({ commentId })`). Invalidate the collection +
  comments queries on success.
- When the collection is hidden, render a "Hidden from Prep Hub — {reason}"
  banner (admins reach this view; students never do — they get a 404/redirect).
- Engagement controls remain hidden for admins (unchanged).

### 7.2 Admin moderation list page (new)

`pages/admin-prep-hub-moderation.tsx`, route `/admin/prep-hub-moderation`
guarded admin-only (reuse the Phase-1 `AuthGuard` admin gating; this is the
inverse of `blockAdmin`). Lists public collections (toggle to include hidden),
each row showing title/owner/engagement + a Hide/Unhide action and a link to the
Prep Hub view; a small stats header (`totalPublic`, `totalHidden`). Add a nav
entry in the admin "More" menu (`layout.tsx`).

### 7.3 Owner workspace banner (`collection-manage.tsx`)

When the owner's collection has `hiddenAt` set, show a read-only banner:
"Hidden from Prep Hub by a moderator{: reason}." The owner cannot unhide (only
admins can); they can still edit/delete their own collection.

---

## 8. Testing

Backend (vitest, DB-backed, `.env` loaded):

- **Repo**: hide sets `hiddenAt`/`hiddenBy`/`hiddenReason`; unhide clears them;
  `listDiscoverable`/`listTrending`/`recommendCollections` exclude a hidden
  collection; `listForModeration` includes it when `includeHidden`.
- **Service access**: a non-admin gets `forbidden` from `hideCollection`/
  `unhideCollection`/`removeComment`/`listModeration`.
- **View exception**: `getPublicCollection` of a hidden collection → 404 for a
  student, returns it for an admin (with `hiddenAt` set in the DTO).
- **Engagement gate**: like/rate/comment on a hidden collection → 404.
- **Comment removal**: admin `removeComment` soft-deletes any comment, decrements
  `commentCount`, and records `collection.comment.removed`.
- **Audit**: `collection.hidden`/`collection.unhidden` events recorded with the
  admin actor + reason.
- **Stats**: `listModeration` returns correct `totalPublic`/`totalHidden`.

Web: typecheck-gated; manual smoke — admin hides a public collection (it
disappears from discovery/search and the owner sees the banner), admin unhides
it (it returns), admin removes a comment, the moderation page lists + toggles
hidden, a student gets 404 on a hidden collection.

---

## 9. Migration Strategy

1. Apply the additive migration (`hidden_at`/`hidden_by`/`hidden_reason` +
   index). No backfill (NULL = not hidden).
2. Regenerate the Prisma client + the OpenAPI-derived packages.
3. Deploy backend (gate tightening + admin routes) + web together; purely
   additive for non-admins (existing public collections are all unhidden).

---

## 10. Risks & Mitigations

- **Gate gaps** (a hidden collection leaking through one surface). Mitigation:
  the gate is a single clause (`hiddenAt IS NULL`) added to every public query +
  the `isPublic` helpers; covered by per-surface exclusion tests.
- **Admin-view exception logic** (admins must see hidden, others must not).
  Mitigation: the exception lives only in `getPublicCollection`, explicitly
  tested for both roles.
- **commentCount drift on admin removal.** Mitigation: reuse
  `commentsRepo.softDeleteComment` (already transactional); a second removal of
  an already-deleted comment is guarded by the load-or-404.
- **Generated-client churn.** Mitigation: OpenAPI change + regen as one task,
  fix call sites against the compiler (the Phase 1–3 playbook).
- **Admins bypassing into private collections.** Mitigation: moderation
  operates only on public/official rows (hide/unhide 404 otherwise); private
  remains owner-only as before.

---

## 11. Out of Scope / Epic Complete

With Phase 4 the Collections / Prep Hub epic is complete. Permanently out of
scope / deferred: hard admin takedown of user collections, appeals workflow,
automated moderation, runtime-tunable ranking weights, discovery caching,
trigram/typo search fallback.
