# Collections / Prep Hub Split — Phase 2 Design (Engagement)

**Date:** 2026-05-30
**Status:** Approved (design)
**Scope:** Phase 2 of 4 — community **engagement** on public collections:
1–5 star ratings, binary likes, collection-level views (total + unique), and
flat comments (with owner notification). Discovery/search & ranking (Phase 3)
and admin moderation (Phase 4) remain out of scope (see §11).

**Prior phase:** `2026-05-30-collections-prep-hub-split-phase-1-design.md`
(structural split, access control, `shared`→`public`, metadata, duplicate).

---

## 1. Background & Motivation

Phase 1 split the feature into **Collections** (owner workspace; create/manage;
students + lecturers) and **Prep Hub** (community discovery; all roles incl.
admin read-only). The Prep Hub read-only collection view
(`prep-hub-collection.tsx`) currently shows a collection's materials, follower
count, and a follow button — but offers no way to express *quality* or
*discussion*. Phase 1 explicitly deferred engagement (design §11).

Phase 2 adds the community engagement layer to **public** collections:

- **Ratings** (1–5 stars) — the primary quality signal; one active rating per
  user, exposed as an average + count.
- **Likes** (binary) — a lightweight positive signal, distinct from rating.
- **Views** (total + unique) — passive popularity signal, recorded when a user
  opens the Prep Hub read-only view.
- **Comments** (flat) — create / edit-own / delete-own, with an in-app
  notification to the collection owner on a new comment.

All four are **store-only** signals in Phase 2: they are persisted and surfaced
in the UI but do **not** change `popularityScore` or discovery ordering. The
configurable ranking formula that consumes them is Phase 3.

### What already exists (reuse, do not rebuild)

- **Denormalized-counter pattern.** `documents.viewCount/downloadCount/
  favoriteCount` are maintained incrementally (O(1) per event) in a
  `db.$transaction`, alongside the event row. We mirror this exactly.
- **Per-feature engagement tables.** `DocumentFavorite` (user↔document unique),
  `CommentReaction` (user+kind unique), `MaterialViewHistory` (append-per-view).
  The codebase favors one purpose-built table per signal over a polymorphic
  table.
- **`Comment` model** — `(documentId, authorId, parentId?, body, pageNumber?,
  createdAt, updatedAt, deletedAt)` with soft-delete and `comments_document_
  created_idx`. Phase-2 collection comments mirror it minus `parentId`,
  `pageNumber`, and reactions.
- **Notification bus** — `notify(...)` inserts a `Notification`
  `(recipientId, actorId?, type, subjectType, subjectId, body, url?)` with a
  per-`(recipient, type, subjectType, subjectId)` dedup unique key.
- **`recordView` / `tryRecordView`** (`viewHistory.repo.ts`) — event row +
  counter bump in one transaction; the `try*` variant swallows errors so view
  recording is never fatal to the request.
- **Phase-1 access helper** `permissions.canUseCollections(user)` — `true` for
  students + lecturers, `false` for admins. Engagement writes reuse it.
- **DTO assembly** — `collections.service.summarize` / `assembleDetail` build
  the summary/detail DTOs with batched (no-N+1) enrichment. Phase-2 enrichment
  hangs off the same helpers.

---

## 2. Goals & Non-Goals

### Goals (Phase 2)

- Persist and surface four engagement signals on **public** collections:
  ratings (1–5), likes (binary), views (total + unique), flat comments.
- Maintain denormalized counters transactionally (`likeCount`, `ratingCount`,
  `ratingSum`, `viewCount`, `commentCount` on `study_collections`).
- Notify the collection owner when a non-owner comments.
- Enforce access: like / rate / comment are **student + lecturer** only; admins
  are **read-only**; owners cannot like or rate their own collection.
- Keep the module boundary from Phase 1: discovery/follow/recommend stay in
  `prep-hub.service.ts`; engagement lives in new focused modules; collection
  CRUD stays in `collections.service.ts`.
- No change to `popularityScore` or discovery ordering.

### Non-Goals (Phase 2)

- **Ranking** — folding likes/ratings/views into `popularityScore`, the
  configurable 40/20/15/15/10 formula, trending, the 7-section discovery
  homepage, collection full-text search. (Phase 3.)
- **Admin moderation** — hide/unpublish, deleting *others'* comments,
  engagement analytics. (Phase 4.)
- **Bookmarks distinct from follow** — `follow` already serves as "save"; a
  second save concept is YAGNI and intentionally dropped.
- **Threaded replies** and **comment reactions** — flat comments only; these
  are a later increment.
- Editing/deleting **other users'** comments (only own; moderation is Phase 4).

---

## 3. Architecture & Module Boundaries

The Phase-1 boundary rule holds: **the service is the module boundary; the repo
is the shared data layer.** Engagement is community interaction on *public*
collections, so its routes live under the **Prep Hub** namespace
(`/api/prep-hub/*`). To keep files focused (and easy to test), engagement is
split into two new service/repo pairs rather than bloating
`prep-hub.service.ts`:

| Concern | Module | Routes |
|---|---|---|
| Discovery / follow / recommend (Phase 1) | `prep-hub.service.ts` | `/api/prep-hub/*` |
| Collection CRUD / items / metadata (Phase 1) | `collections.service.ts` | `/api/collections/*` |
| Likes, ratings, views | **new** `collection-engagement.service.ts` + `collection-engagement.repo.ts` | `/api/prep-hub/collections/:id/{like,rating}` |
| Comments (+ owner notification) | **new** `collection-comments.service.ts` + `collection-comments.repo.ts` | `/api/prep-hub/collections/:id/comments`, `/api/prep-hub/collections/comments/:commentId` |

**Boundary rules:**

- Engagement services operate only on collections that are **public or
  official** (`prep-hub.service.isPublic`). Private collections never accept or
  expose engagement — same 404-not-403 rule as `getPublicCollection`.
- Engagement services **must not** mutate collection rows except the
  denormalized counter columns (`likeCount` etc.), maintained transactionally
  with the event row.
- View recording is invoked from the existing
  `prep-hub.service.getPublicCollection` (non-fatal), not from a dedicated
  client call — opening the read-only view *is* the view.
- DTO enrichment reuses `collections.service`: the engagement counters and the
  viewer's own state (`isLiked`, `myRating`) are added to the existing
  `CollectionSummaryDTO`/`CollectionDetailDTO` via batched lookups, preserving
  the no-N+1 property of `summarize`.

---

## 4. Data Model Changes

One additive Prisma migration in `lib/db/prisma/`. Four new tables + five new
nullable-defaulted counter columns on `study_collections`. No destructive
changes; no backfill required (all counters default to 0 and existing
collections have no engagement yet).

### 4.1 `study_collections` (alter) — denormalized counters

Add (all `Int @default(0)`):

- `likeCount` `@map("like_count")` — count of `study_collection_likes` rows.
- `ratingCount` `@map("rating_count")` — count of `study_collection_ratings`.
- `ratingSum` `@map("rating_sum")` — sum of rating values; **average =
  ratingCount > 0 ? ratingSum / ratingCount : 0** (computed in the DTO, never
  stored). Storing sum + count (not a float average) keeps the running average
  exact under add/change/clear.
- `viewCount` `@map("view_count")` — **total** views (every open, including
  repeats). Unique views are computed on demand (§4.4).
- `commentCount` `@map("comment_count")` — count of **non-deleted** comments.

No new index is required for the counters in Phase 2 (no ORDER BY on them until
Phase 3 ranking). Keep the existing `study_collections_visibility_popularity_idx`.

### 4.2 `study_collection_likes` (new) — mirrors `DocumentFavorite`

```prisma
model StudyCollectionLike {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  collectionId String   @map("collection_id") @db.Uuid
  userId       String   @map("user_id") @db.Uuid
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz()

  collection StudyCollection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  user       User            @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([collectionId, userId], map: "study_collection_likes_unique")
  @@index([userId], map: "study_collection_likes_user_idx")
  @@map("study_collection_likes")
}
```

### 4.3 `study_collection_ratings` (new)

```prisma
model StudyCollectionRating {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  collectionId String   @map("collection_id") @db.Uuid
  userId       String   @map("user_id") @db.Uuid
  value        Int      // 1..5, validated in the service
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt    DateTime @default(now()) @map("updated_at") @db.Timestamptz()

  collection StudyCollection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  user       User            @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([collectionId, userId], map: "study_collection_ratings_unique")
  @@index([userId], map: "study_collection_ratings_user_idx")
  @@map("study_collection_ratings")
}
```

One active rating per user per collection (the unique key); re-rating is an
**upsert** that adjusts `ratingSum` by `(new - old)`.

### 4.4 `study_collection_views` (new) — mirrors `MaterialViewHistory`

```prisma
model StudyCollectionView {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  collectionId String   @map("collection_id") @db.Uuid
  userId       String   @map("user_id") @db.Uuid
  viewedAt     DateTime @default(now()) @map("viewed_at") @db.Timestamptz()

  collection StudyCollection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  user       User            @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([collectionId], map: "study_collection_views_collection_idx")
  @@index([userId, viewedAt], map: "study_collection_views_user_viewed_idx")
  @@map("study_collection_views")
}
```

- **Total views** = `study_collections.viewCount` (denormalized; bumped on every
  recorded open).
- **Unique views** = `COUNT(DISTINCT user_id)` over `study_collection_views`,
  computed on demand for the single collection in the **detail** DTO only
  (cheap, one collection). Not denormalized and not shown on summary cards in
  Phase 2 — mirrors how documents compute view counts via `groupBy` rather than
  maintaining a unique-views column.

### 4.5 `study_collection_comments` (new) — mirrors `Comment` (flat)

```prisma
model StudyCollectionComment {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  collectionId String    @map("collection_id") @db.Uuid
  authorId     String    @map("author_id") @db.Uuid
  body         String
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt    DateTime  @default(now()) @map("updated_at") @db.Timestamptz()
  deletedAt    DateTime? @map("deleted_at") @db.Timestamptz()

  collection StudyCollection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  author     User            @relation(fields: [authorId], references: [id], onDelete: Restrict)

  @@index([collectionId, createdAt], map: "study_collection_comments_collection_created_idx")
  @@index([authorId], map: "study_collection_comments_author_idx")
  @@map("study_collection_comments")
}
```

No `parentId` (flat), no `pageNumber`, no reactions. Soft-delete via
`deletedAt`; `author` uses `onDelete: Restrict` to match `Comment`.

### 4.6 Inverse relations

Add to `StudyCollection`: `likes`, `ratings`, `views`, `comments`. Add to
`User`: `collectionLikes`, `collectionRatings`, `collectionViews`,
`collectionComments`.

### 4.7 Migration safety

- All changes additive; counters default 0; new tables empty → no backfill.
- No change to `popularityScore`, items, followers, visibility, or any Phase-1
  behavior.

---

## 5. Access Control

### 5.1 Who can do what

| Action | Student | Lecturer | Admin | Owner (of the collection) |
|---|---|---|---|---|
| View counts / read comments | ✓ | ✓ | ✓ (read-only) | ✓ |
| Record a view (passive) | ✓ | ✓ | ✓ | ✓ |
| Like / unlike | ✓ | ✓ | ✗ (403) | ✗ self-like (400) |
| Rate / clear rating | ✓ | ✓ | ✗ (403) | ✗ self-rate (400) |
| Comment (create) | ✓ | ✓ | ✗ (403) | ✓ (allowed) |
| Edit / delete a comment | own only | own only | ✗ (403) | own only |

- **Engagement writes** (like, rate, comment create/edit/delete) require
  `permissions.canUseCollections(user)` → admins get `403`. Mirrors the Phase-1
  `requireFollowAccess` middleware.
- **Self-engagement:** a collection owner **cannot like or rate** their own
  collection (these feed Phase-3 quality ranking — block self-inflation) →
  `400 badRequest`. An owner **can comment** on their own collection (answering
  questions); self-comment simply skips the owner notification (§7).
- **Target gating:** every engagement endpoint first loads the collection and
  requires it to be **public or official** (`isPublic`), else `404` (never
  reveal a private collection's existence) — identical to
  `getPublicCollection`.
- **View recording:** invoked inside `getPublicCollection` for any authenticated
  viewer (incl. admin/owner). Non-fatal: failures are swallowed
  (`tryRecordView` semantics).
- **Comment edit/delete:** author-only (`comment.authorId === user.id`), else
  `403`. Admin moderation of others' comments is Phase 4.

### 5.2 Visibility transitions

If a public collection is later set private (owner action in Collections),
existing engagement rows are retained but become inaccessible via Prep Hub
(the `isPublic` gate 404s). If re-published, the prior engagement reappears.
This needs no special handling — the gate is evaluated per request.

---

## 6. Backend Changes

### 6.1 `collection-engagement.repo.ts` (new)

Data access for likes / ratings / views, each maintaining the denormalized
counter in the same `db.$transaction` as the event row:

- `likeCollection(collectionId, userId)` → insert-if-absent; on insert,
  `likeCount += 1`. Returns whether a row was created (idempotent).
- `unlikeCollection(collectionId, userId)` → delete-if-present; on delete,
  `likeCount -= 1`.
- `isLiked(collectionId, userId)` / `listLikedCollectionIds(userId, ids)` /
  `countLikesForCollections(ids)` — viewer state + batched enrichment.
- `setRating(collectionId, userId, value)` → upsert; adjust `ratingCount` /
  `ratingSum` by the delta (new rating: `+1`/`+value`; changed: `0`/`+Δ`).
- `clearRating(collectionId, userId)` → delete-if-present; `ratingCount -= 1`,
  `ratingSum -= oldValue`.
- `getMyRating(collectionId, userId)` / `listMyRatings(userId, ids)` —
  viewer's own rating(s).
- `recordView(collectionId, userId)` / `tryRecordView(...)` → append a
  `study_collection_views` row + `viewCount += 1`, in one transaction;
  `tryRecordView` swallows errors.
- `countUniqueViews(collectionId)` → `COUNT(DISTINCT user_id)` for the detail
  DTO.

All counter mutations are scoped with `where: { id: collectionId }` and the
event-row write so a single failure rolls back both — counters never drift.

### 6.2 `collection-engagement.service.ts` (new)

- `likeCollection` / `unlikeCollection` — load + `isPublic` gate, block
  self-like, call repo, return the refreshed detail DTO (via
  `collectionsService.assembleDetail`, which now includes engagement fields).
- `rateCollection(id, user, value)` — validate `value ∈ 1..5`, `isPublic` gate,
  block self-rate, upsert; return refreshed detail.
- `clearRating(id, user)` — clear + return refreshed detail.
- `recordView(id, user)` — thin wrapper over the repo's `tryRecordView`, called
  by `prep-hub.service.getPublicCollection`.

### 6.3 `collection-comments.repo.ts` + `collection-comments.service.ts` (new)

Repo: `createComment`, `listComments(collectionId)` (non-deleted, oldest-first,
with author join), `findCommentById`, `updateCommentBody`, `softDeleteComment`,
plus `commentCount` maintenance (`+1` on create, `-1` on soft-delete, in a
transaction with the row write).

Service:

- `listComments(id, user)` — `isPublic` gate; returns `CollectionCommentDTO[]`
  with an `editable` flag (`authorId === user.id`).
- `createComment(id, user, body)` — `canUseCollections` + `isPublic` gate;
  validate non-empty/trimmed body; insert; **notify owner** unless
  `author === owner` (§7); return the new `CollectionCommentDTO`.
- `editComment(commentId, user, body)` — author-only; update body + `updatedAt`.
- `deleteComment(commentId, user)` — author-only; soft-delete + `commentCount -= 1`.

### 6.4 Routes

**`routes/prep-hub.ts`** (extend; reuse the existing `requireFollowAccess`
middleware, renamed conceptually to "engagement access" but functionally the
same `canUseCollections` check — keep the existing handler name to minimize
churn):

| Method | Path | Access |
|---|---|---|
| POST | `/prep-hub/collections/:id/like` | student/lecturer |
| DELETE | `/prep-hub/collections/:id/like` | student/lecturer |
| PUT | `/prep-hub/collections/:id/rating` | student/lecturer |
| DELETE | `/prep-hub/collections/:id/rating` | student/lecturer |
| GET | `/prep-hub/collections/:id/comments` | all roles (read) |
| POST | `/prep-hub/collections/:id/comments` | student/lecturer |
| PATCH | `/prep-hub/collections/comments/:commentId` | author only |
| DELETE | `/prep-hub/collections/comments/:commentId` | author only |

`PUT /rating` body: `{ value: 1..5 }`. `POST /comments` body: `{ body: string }`.
The comment `:commentId` routes are mounted under `/collections/comments/...`
(not `/collections/:id/...`) because a comment id is globally unique and the
collection is resolved from the comment.

### 6.5 OpenAPI + generated clients

Update `lib/api-spec/openapi.yaml`:

- Add to `StudyCollectionSummary` (and therefore detail): `likeCount`,
  `isLiked`, `ratingCount`, `ratingAverage`, `myRating` (nullable int),
  `viewCount`, `commentCount`. Add `uniqueViewCount` to the detail schema only.
- New `StudyCollectionComment` schema `{ id, collectionId, author{ id,
  displayName }, body, createdAt, updatedAt, editable }`.
- New paths (tagged `prep-hub`): like (POST/DELETE), rating (PUT/DELETE),
  comments (GET/POST list, PATCH/DELETE by id) with operationIds
  `likeCollection`, `unlikeCollection`, `rateCollection`, `clearCollectionRating`,
  `listCollectionComments`, `createCollectionComment`, `editCollectionComment`,
  `deleteCollectionComment`.

Regenerate `@workspace/api-zod` + `@workspace/api-client-react` (orval). New
hooks: `useLikeCollection`, `useRateCollection`, `useListCollectionComments`,
`useCreateCollectionComment`, etc.

---

## 7. Notifications

On a new comment by a **non-owner**:

```
notify({
  recipientId: collection.ownerId,
  actorId:     commenter.id,
  type:        "collection.comment",
  subjectType: "study_collection",
  subjectId:   collection.id,
  body:        `${commenter.displayName} commented on "${collection.title}"`,
  url:         `/prep-hub/${collection.id}`,
})
```

- **Self-comment** (author === owner) does **not** notify.
- The existing per-`(recipient, type, subjectType, subjectId)` dedup means a
  second comment on the same collection won't create a new unread row until the
  owner reads the first — identical to the document-activity dedup behavior;
  acceptable for Phase 2 (a richer per-comment notification is a later
  increment).

---

## 8. Frontend Changes

All engagement UI lives on the **Prep Hub read-only community view**
(`prep-hub-collection.tsx`). The owner manage view (`collection-manage.tsx`) is
**unchanged** — owners don't engage with their own collection there.

### 8.1 `prep-hub-collection.tsx` (extend)

- **Rating widget** — 5-star control showing the average + count; the viewer's
  own star selection sets/clears their rating (`useRateCollection` /
  `useClearCollectionRating`). Hidden / read-only for admins and for the owner
  (owner sees the average but cannot set a star).
- **Like button** — toggle + count (`useLikeCollection` / `useUnlikeCollection`).
  Hidden for admins; disabled for the owner.
- **View count** — display total views (and unique on the detail) as passive
  text; no control.
- **Comments section** — list (oldest-first) with author + timestamp; a compose
  box for students/lecturers; inline edit + delete on the viewer's own comments.
  Hidden compose/actions for admins. Mirrors the document comments UI patterns.

### 8.2 Discovery cards (`prep-hub.tsx` / shared `CollectionCard`)

Surface lightweight counts on each card: rating average (stars), like count,
comment count. View count optional. Read-only; no actions on cards.

### 8.3 Admin read-only

Admins see all counts + the average + the comment thread, but **no** rating
control, like button, or compose box (engagement actions are
`canUseCollections`-gated and hidden client-side too).

---

## 9. Migration Strategy

1. Apply the additive Prisma migration (4 tables + 5 counter columns +
   indexes). No backfill (counters default 0; new tables empty).
2. Regenerate the Prisma client and the OpenAPI-derived packages.
3. Deploy backend (new routes) + web (engagement UI) together; no legacy routes
   are removed, so this is purely additive to Phase 1.

---

## 10. Testing

Backend (vitest; follow the `favorites` / `reactions` / `*.fts` test patterns —
unique suffix, direct `db` row setup, `afterAll` cleanup, `.env` loaded):

- **Counters:** like/unlike adjusts `likeCount` and is idempotent; rate then
  re-rate adjusts `ratingSum`/`ratingCount` so the average is exact; clear
  rating restores them; recordView bumps `viewCount` and appends a row; unique
  views = distinct users.
- **Access control:** admin gets `403` on like/rate/comment; owner gets `400` on
  self-like and self-rate but `201` on self-comment; a non-author gets `403`
  editing/deleting a comment; engagement on a private collection `404`s.
- **Comments:** create/list (non-deleted, ordered), edit-own updates body +
  `updatedAt`, delete-own soft-deletes and decrements `commentCount`; `editable`
  flag correct per viewer.
- **Notification:** a non-owner comment notifies the owner with the right
  `type`/`subject`/`url`; a self-comment does not.
- **DTO enrichment:** summary/detail expose `likeCount`, `isLiked`,
  `ratingCount`, `ratingAverage`, `myRating`, `viewCount`, `commentCount`
  (+ `uniqueViewCount` on detail); batched enrichment stays N+1-free.

Web:

- Engagement UI renders on the Prep Hub read-only view; rating/like/compose are
  hidden for admins. (Extend the existing web smoke where practical;
  full-typecheck is the primary gate, per Phase-1 convention.)

---

## 11. Out of Scope — Later Phases

- **Phase 3 — Discovery & ranking:** fold likes/ratings/views into
  `popularityScore`; the configurable 40% relevance + 20% rating + 15% likes +
  15% saves + 10% views formula; the 7-section discovery homepage (Popular,
  Highest Rated, Most Viewed, New, Course, Exam, Trending); collection
  full-text search; trending by recent engagement growth.
- **Phase 4 — Admin moderation:** view/remove/hide/unpublish public
  collections, moderate (delete) others' comments, engagement analytics.
- **Deferred increments:** threaded comment replies, comment reactions,
  per-comment notifications (vs. the deduped per-collection one), bookmarks
  distinct from follow.

---

## 12. Risks & Mitigations

- **Counter drift.** Mitigation: every counter mutation shares a
  `db.$transaction` with its event-row write (mirrors documents); tests assert
  add/change/clear arithmetic.
- **Generated-client churn.** Mitigation: do the OpenAPI change + regen as one
  task, then fix web call sites against the compiler (same playbook as Phase 1
  B5).
- **`prep-hub.service` bloat.** Mitigation: engagement lives in two new focused
  service/repo pairs; `prep-hub.service` only gains the `recordView` call inside
  `getPublicCollection`.
- **Self-engagement skewing ranking.** Mitigation: owners are blocked from
  liking/rating their own collection at the service layer (covered by tests).
- **Notification dedup hiding repeat comments.** Accepted for Phase 2 and
  documented (§7); a per-comment notification is a later increment.
```
