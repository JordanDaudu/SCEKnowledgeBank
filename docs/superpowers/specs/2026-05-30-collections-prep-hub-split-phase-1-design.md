# Collections / Prep Hub Split — Phase 1 Design

**Date:** 2026-05-30
**Status:** Approved (design)
**Scope:** Phase 1 of 4 — structural split & access control. Later phases
(engagement, discovery/search, admin moderation) are out of scope here and
listed in §11.

---

## 1. Background & Motivation

The current "Prep Hub" feature mixes two unrelated responsibilities on one
surface:

1. **Creating and managing** bundles of existing study materials.
2. **Discovering and engaging** with bundles created by other users.

It is backed by a single `study_collections` table and a single
`collections.service.ts` / `collections.repo.ts`, exposed under
`/api/collections/*`, and rendered by one `/prep-hub` page that contains both
the create dialog and the discovery sections. Admins are currently hidden from
Prep Hub entirely.

We are separating these into two modules:

- **Collections** — a personal workspace (students + lecturers) for creating
  and organizing bundles of *already-approved* platform materials.
- **Prep Hub** — a community discovery surface (students + lecturers + admins)
  for browsing public collections.

Phase 1 establishes the module boundaries (frontend, backend service, routes),
inverts admin access, renames the `shared` visibility to `public`, and adds the
collection metadata the spec requires. It deliberately does **not** add new
engagement systems (likes, ratings, comments, etc.) — those are later phases.

### What already exists (do not rebuild)

- `study_collections` (bundle metadata), `study_collection_items` (ordered join
  to existing `documents` — references, never file copies), and
  `study_collection_followers` (follow = save, feeds popularity).
- `collections.service.ts` + `collections.repo.ts` + `lib/collection-popularity.ts`
  (`popularityScore = followers×3 + items`, denormalized).
- Routes under `/api/collections/*`: list-mine, create, discover, detail,
  update, delete, item add/remove/note, reorder, follow/unfollow, plus
  `/me/recommended-collections`.
- Web: `prep-hub.tsx` (create + discover mixed), `collection-detail.tsx`,
  `add-to-collection.tsx`. Nav defined in `components/layout.tsx`; route guard
  in `components/auth-guard.tsx`; current user via `useGetCurrentUser()`.
- Documents have a full Postgres FTS stack (`tsvector` + GIN + triggers).
  **Collections do not** — collection FTS is Phase 3, not Phase 1.

---

## 2. Goals & Non-Goals

### Goals (Phase 1)

- Split into two independent modules with clear ownership: **Collections**
  (create/manage) and **Prep Hub** (discovery).
- Split the backend along the same seam: keep CRUD/ownership/visibility/items
  in `collections.service.ts` (`/api/collections/*`); extract discovery / follow
  / recommend into a new `prep-hub.service.ts` (`/api/prep-hub/*`).
- Invert access: admins lose the Collections workspace; admins gain read-only
  Prep Hub.
- Rename visibility value `shared` → `public` (keep `private`), with a safe data
  migration.
- Add collection metadata: Subject (= existing Category), Exam Name (new
  free-text), Semester + Academic Year (reuse document enum), Tags (reuse the
  tags table via a new join).
- Add **Duplicate** (clone metadata + items as a new private draft) and
  **Share** (copy link to the Prep Hub page) to the Collections module.
- No data loss; existing collections become Collections, existing public
  (formerly `shared`) ones appear in Prep Hub automatically.

### Non-Goals (Phase 1)

- Likes, 1–5 ratings, bookmarks distinct from follow, collection-level views,
  comments on collections.
- The 7-section discovery homepage, collection full-text search, the
  configurable 40/20/15/15/10 ranking formula, trending.
- Admin moderation (hide/unpublish, comment moderation, analytics).

---

## 3. Architecture & Module Boundaries

| Concern | Collections (create/manage) | Prep Hub (discovery) |
|---|---|---|
| Backend service | `collections.service.ts` | **new** `prep-hub.service.ts` |
| API routes | `/api/collections/*` | **new** `/api/prep-hub/*` |
| Web routes | `/collections`, `/collections/:id` (manage) | `/prep-hub`, `/prep-hub/:id` (read-only) |
| Nav visibility | student + lecturer (**not admin**) | student + lecturer + **admin** |
| Data access | `collections.repo.ts` (shared by both services) |

**Boundary rule:** the *service* is the module boundary. `collections.repo.ts`
is the shared data-access layer and may be called by both services; this avoids
duplicating SQL. `prep-hub.service.ts` must not perform create/update/delete of
collections or items — it is read + follow only in Phase 1.

---

## 4. Data Model Changes

One Prisma migration in `lib/db/prisma/`. All changes are additive except the
in-place visibility value rename (a data `UPDATE`, not a column change).

### 4.1 `study_collections` (alter)

Add:

- `categoryId String? @map("category_id") @db.Uuid` — **Subject**, FK →
  `categories(id)` `onDelete: SetNull`.
- `examName String? @map("exam_name")` — **Exam Name**, optional free text.
- `semester String? @map("semester")` — `fall | spring | summer` (text, matches
  the document semester convention; no DB enum, consistent with existing
  string-enum style).
- `academicYear Int? @map("academic_year")` — optional.

Keep unchanged: `kind`, `isOfficial`, `popularityScore`, `examDate`,
`visibility` (column stays; only its *values* change), `courseId`, soft-delete
`deletedAt`.

New indexes:

- `@@index([categoryId], map: "study_collections_category_idx")`

### 4.2 `study_collection_tags` (new join)

Mirrors `document_tags`:

```prisma
model StudyCollectionTag {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  collectionId String   @map("collection_id") @db.Uuid
  tagId        String   @map("tag_id") @db.Uuid
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz()

  collection StudyCollection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  tag        Tag             @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@unique([collectionId, tagId], map: "study_collection_tags_unique")
  @@index([tagId], map: "study_collection_tags_tag_idx")
  @@map("study_collection_tags")
}
```

Add the inverse relations on `StudyCollection` (`tags StudyCollectionTag[]`),
`Tag`, and `Category` as needed for Prisma.

### 4.3 Visibility rename (data migration)

In the same migration, after schema changes:

```sql
UPDATE "study_collections" SET "visibility" = 'public' WHERE "visibility" = 'shared';
```

The visibility value set becomes `private | public`. `isOfficial = true`
collections remain discoverable (treated as public for discovery) regardless of
the `visibility` value, preserving today's behavior.

### 4.4 Migration safety

- Additive columns are nullable → no backfill required for existing rows.
- The visibility `UPDATE` is idempotent and touches only `shared` rows.
- Followers and items are untouched → preserved.
- Existing collections automatically become Collections (same table); formerly
  `shared` collections become `public` and therefore appear in Prep Hub.

---

## 5. Access Control

### 5.1 Role helper

Add `canUseCollections(user): boolean = isStudent(user) || isLecturer(user)`
(explicitly **false** for admins) in `permissions.service.ts` (the central
permissions module, which currently has no collection rules).

### 5.2 Enforcement

- **Collections write/manage** (`POST /api/collections`, `PATCH`, `DELETE`,
  all item endpoints, `PUT order`, `POST :id/duplicate`): require
  `canUseCollections(user)` → otherwise `403`. Management additionally requires
  **ownership** (`collection.ownerId === user.id`). The current
  admin-can-manage-any-collection override is **removed**.
- **Collections read** (`GET /api/collections`, `GET /api/collections/:id`):
  gated by `canUseCollections` first, so admins receive a `403` here (not an
  empty list) — they have no workspace. For non-admins it is owner-scoped (a
  manage view).
- **Prep Hub read** (`GET /api/prep-hub/collections`, `GET
  /api/prep-hub/collections/:id`): all authenticated roles incl. admin.
- **Follow/unfollow** (`/api/prep-hub/collections/:id/follow`): student +
  lecturer only (a personal study affordance). Admins are read-only in Prep Hub;
  moderation is Phase 4.
- **Web:** `AddToCollection` (on document detail) is gated to non-admin.

### 5.3 Visibility behavior

- `private` → visible only to owner; never appears in Prep Hub or
  recommendations.
- `public` → appears in Prep Hub discovery and recommendations. No approval
  process (the materials inside are already platform-approved; a collection is
  only an organizational grouping).
- Changing `private → public` makes the collection appear in Prep Hub
  immediately — the discovery query already filters on visibility, so no extra
  publish step is needed.

---

## 6. Backend Changes

### 6.1 `collections.service.ts` (Collections module)

Retains: `createCollection`, `listForOwner`, `getById` (owner-only manage DTO),
`updateCollection` (now also persists categoryId, examName, semester,
academicYear, tag set, and visibility `public|private`), `softDelete`,
`addItem` / `removeItem` / `updateItemNote`, `reorderItems`.

Adds:

- `duplicateCollection(id, user)` — owner-only. Creates a new collection owned by
  the user with copied title (suffixed e.g. "(copy)"), description, kind,
  category, exam name, semester, academic year, tags, and item list (documentIds
  + notes + order). New collection is **private** and has zero followers /
  `popularityScore` recomputed from items only.

Metadata persistence: create/update validate `categoryId` exists (if provided),
`semester ∈ {fall,spring,summer}` (if provided), and resolve `tagIds` against the
tags table, writing the `study_collection_tags` join (replace-set semantics on
update).

### 6.2 `prep-hub.service.ts` (new — Prep Hub module)

Moves out of `collections.service.ts`:

- `listDiscoverable({ sort, courseId, limit })` — public **or** isOfficial,
  not deleted; sort popular|recent.
- `getPublicCollection(id, user)` — read-only community DTO; 404 if the
  collection is not public/official (private collections must never appear).
- `followCollection` / `unfollowCollection` (idempotent; recompute popularity).
- `getRecommendedCollections(user)` — by interest courses, excluding own +
  followed.

Reuses `collections.repo.ts` for all data access and
`recommendations.service.getInterestCourseIds`.

### 6.3 Routes

**`routes/collections.ts`** (`/api/collections`):

| Method | Path | Notes |
|---|---|---|
| GET | `/` | my collections (owner) |
| POST | `/` | create (canUseCollections) |
| GET | `/:id` | manage DTO (owner-only) |
| PATCH | `/:id` | update metadata + visibility (owner) |
| DELETE | `/:id` | soft-delete (owner) |
| POST | `/:id/duplicate` | **new** (owner) |
| POST | `/:id/items` | add item (owner) |
| DELETE | `/:id/items/:documentId` | remove item (owner) |
| PATCH | `/:id/items/:documentId` | item note (owner) |
| PUT | `/:id/order` | reorder (owner) |

**`routes/prep-hub.ts`** (new, `/api/prep-hub`):

| Method | Path | Notes |
|---|---|---|
| GET | `/collections` | discover (all roles) |
| GET | `/collections/:id` | public read-only detail (all roles) |
| POST | `/collections/:id/follow` | follow (student/lecturer) |
| DELETE | `/collections/:id/follow` | unfollow (student/lecturer) |
| GET | `/recommended` | recommended (student/lecturer) |

The old `/api/collections/discover`, `/api/collections/:id/follow`, and
`/me/recommended-collections` routes are **removed** (migrated to `/api/prep-hub/*`).

### 6.4 OpenAPI + generated clients

Update `lib/api-spec/openapi.yaml` (new prep-hub paths, new collection metadata
fields on request/response schemas, duplicate endpoint, removed legacy paths).
Regenerate `@workspace/api-zod` and `@workspace/api-client-react`. The web app
consumes the regenerated hooks (e.g. `useListDiscoverableCollections` →
prep-hub-namespaced equivalent).

---

## 7. Frontend Changes

### 7.1 Navigation (`components/layout.tsx`)

Invert the current gating:

- **Prep Hub** nav item: visible to **all** authenticated users (remove the
  current `!isAdmin` guard).
- **Collections** nav item (new): visible to `student || lecturer` only (hidden
  from admin).

Resulting nav: Student/Lecturer → … Materials, **Collections**, **Prep Hub** …;
Admin → … Materials, **Prep Hub** … (no Collections).

### 7.2 Routes (`App.tsx`)

- `/collections` → new `collections.tsx` (my list + create).
- `/collections/:id` → new `collection-manage.tsx` (owner manage view).
- `/prep-hub` → `prep-hub.tsx` (discovery only).
- `/prep-hub/:id` → new `prep-hub-collection.tsx` (read-only community view).

Collections routes use `AuthGuard` with a non-admin gate (add a `requireRole`
or equivalent check so admins are redirected/denied).

### 7.3 Pages & components

- **`collections.tsx`** (new): my-collections list + `CreateCollectionDialog`
  (moved out of `prep-hub.tsx`), extended with metadata inputs — Subject
  (Category select), Exam Name (text), Semester (select) + Academic Year, Tags
  (multi-select against the tags taxonomy). Visibility select uses
  `private | public`.
- **`collection-manage.tsx`** (new, evolved from `collection-detail.tsx`):
  edit metadata, add/remove/reorder materials, visibility toggle, **Duplicate**,
  **Share** (copy `/prep-hub/:id` link), delete. Materials are selected from the
  approved repository via the existing document search picker — **no file
  uploads** inside Collections.
- **`prep-hub.tsx`**: discovery sections + quick lanes + recommended; the create
  dialog is removed.
- **`prep-hub-collection.tsx`** (new): read-only ordered materials list (each
  linking to its original document record — no duplication), popularity, follow
  button. Engagement UI (likes/ratings/comments) is added here in later phases.
- **`add-to-collection.tsx`**: unchanged behavior, but hidden for admins.

---

## 8. User Flows

**Create a personal collection:** Student/Lecturer → Collections → Create →
fill metadata + add approved materials → Save as Private.

**Publish:** Collections → open collection → set visibility Public → it appears
in Prep Hub automatically.

**Discover:** Any user → Prep Hub → browse/sort → open a public collection →
view its materials (Phase 1). Like/rate/comment/bookmark arrive in Phase 2.

---

## 9. Migration Strategy

1. Apply the Prisma migration (additive columns + `study_collection_tags` +
   indexes + `UPDATE … SET visibility='public' WHERE visibility='shared'`).
2. Regenerate the Prisma client and the OpenAPI-derived packages.
3. No row-level backfill needed for new metadata (nullable). Followers/items
   preserved. Formerly-`shared` collections are now `public` and discoverable in
   Prep Hub.
4. Deploy backend (new routes) and web (new nav/routes) together; the legacy
   routes are removed in the same release, so client + server ship in lockstep.

---

## 10. Testing

Backend (vitest, following existing service/repo test patterns):

- Access control: admin receives 403 on create/update/delete/items/duplicate;
  non-owner student receives 403 on manage; owner succeeds.
- Prep Hub: discover returns only `public`/`isOfficial`, never `private`;
  `getPublicCollection` 404s on a private collection.
- Visibility rename migration: a `shared` row becomes `public` and remains
  discoverable; a `private` row is untouched.
- Duplicate: clones metadata + items + tags as a new **private** collection
  owned by the caller, with copied notes/order and reset followers.
- Metadata persistence: create/update round-trips categoryId, examName,
  semester, academicYear, and the tag set; invalid category/semester rejected.

Web:

- Role-based nav smoke: student/lecturer see Collections + Prep Hub; admin sees
  Prep Hub but not Collections; admin hitting `/collections` is denied.
- Create-with-metadata: the create dialog persists the new fields.

---

## 11. Out of Scope — Later Phases

- **Phase 2 — Engagement:** likes, 1–5 ratings (one active rating/user,
  recompute average), bookmarks distinct from follow, collection-level views
  (total + unique), comments (create/edit/delete own; timestamps; optional
  replies/reactions later).
- **Phase 3 — Discovery & search:** the 7-section homepage (Popular, Highest
  Rated, Most Viewed, New, Course, Exam, Trending), collection full-text search
  (reuse the document FTS stack: tsvector + GIN + triggers over title /
  description / tags / course / subject / exam / creator), the configurable
  ranking formula (40% relevance + 20% rating + 15% likes + 15% saves + 10%
  views), trending by recent engagement growth.
- **Phase 4 — Admin moderation:** view/remove/hide/unpublish public collections,
  moderate comments, review collection analytics. Admins cannot create/edit user
  collections or access private collections.

---

## 12. Risks & Mitigations

- **Generated-client churn:** moving discovery to `/api/prep-hub/*` regenerates
  hooks and touches every call site. Mitigation: do the OpenAPI change + regen
  as one step, then fix call sites against the compiler.
- **Hidden admin reliance on managing collections:** removing the admin override
  could surprise existing admin flows. Mitigation: there is no admin-facing
  Collections UI today (admins were hidden from Prep Hub), so impact is limited
  to direct API use; covered by the new 403 tests.
- **Visibility value drift:** any code or seed referencing the literal `shared`
  must be updated to `public`. Mitigation: grep for `"shared"` across
  api-server, web, and seeds during implementation.
```
