# Collections / Prep Hub Split — Phase 3 Design (Discovery & Ranking)

**Date:** 2026-05-30
**Status:** Approved (design)
**Scope:** Phase 3 of 4 — **discovery & ranking** for public study collections:
a collection full-text-search stack, a configurable weighted ranking score, a
trailing-window "trending" signal, and a 7-section discovery homepage. Admin
moderation/analytics remain out of scope (Phase 4, §11).

**Prior phases:**
- `2026-05-30-collections-prep-hub-split-phase-1-design.md` (structural split,
  access control, `shared`→`public`, metadata, duplicate).
- `2026-05-30-collections-prep-hub-split-phase-2-design.md` (engagement:
  ratings, likes, views, comments — all **store-only** signals).

---

## 1. Background & Motivation

Phase 1 split the feature into **Collections** (owner workspace) and **Prep
Hub** (community discovery). Phase 2 added engagement signals — `ratingCount`/
`ratingSum`, `likeCount`, `viewCount`, `commentCount` (denormalized on
`study_collections`) plus the follower set — but explicitly left them
**store-only**: discovery still offers only `popular` (= `followers×3 + items`)
and `recent` sorts, and there is **no collection search at all**.

Phase 3 turns those signals into discovery:

- **Collection full-text search** — collections currently have no FTS. Add the
  same stack documents already use (a trigger-maintained `search_text` haystack
  + a `STORED` `search_vector tsvector` + GIN index), searchable over title,
  description, tags, course, subject (category), exam name, and creator.
- **Configurable ranking score** — a weighted blend of relevance + rating +
  likes + saves + views (40/20/15/15/10), defined in a constants module, that
  drives both search-result ranking and the "Popular" ordering.
- **Trending** — a trailing-window count of recent engagement events (the
  Phase-2 event tables carry timestamps), surfacing collections with genuine
  recent activity rather than just new ones.
- **7-section discovery homepage** — Popular, Highest Rated, Most Viewed, New,
  Trending, For-your-courses, Upcoming-exams.

### What already exists (reuse, do not rebuild)

- **Document FTS stack** (`migrations/20260520160000_documents_fts` +
  `…170000_…_triggers`): `documents.search_text TEXT`, `search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(search_text,''))) STORED`,
  a `documents_search_vector_gin_idx`, a `kb_compute_doc_search_text(uuid)` SQL
  helper, a BEFORE-INSERT/UPDATE trigger on the row, and AFTER triggers on the
  join/parent tables (`document_tags`, `document_files`, `tags`, `courses`) that
  refresh the haystack. **Phase 3 mirrors this for `study_collections`.**
- **Read-time FTS query** (`documents.repo.ts`): `plainto_tsquery`/prefix
  tsquery + `ts_rank`, an `ftsOrderBySql` (relevance-first), `baseScore`/
  `trendingScore` SQL, and an `orderBySql` switch over sort keys. **Phase 3
  mirrors these idioms for collections.**
- **Ranking constants module** (`lib/ranking.ts`): weights + half-lives in one
  file; the math lives in repo SQL. **Phase 3 adds a sibling
  `lib/collection-ranking.ts`.**
- **`lib/collection-popularity.ts`**: `computePopularity(followers, items)` —
  the existing `popularityScore`. **Unchanged**; the new combined score is
  separate and used for ranking/search.
- **Discovery plumbing**: `collections.repo.listDiscoverable({ sort, courseId,
  limit })`, `prep-hub.service.listDiscoverable`, `GET /api/prep-hub/collections`,
  and `GET /api/prep-hub/recommended` (interest-course scoped) +
  `recommendations.service.getInterestCourseIds`. **Phase 3 extends these.**
- **Web search UX**: the Browse page's debounced search box + `<mark>` headline
  highlight (document search). **Phase 3 reuses the pattern on Prep Hub.**

---

## 2. Goals & Non-Goals

### Goals (Phase 3)

- Add a collection FTS stack (haystack + `search_vector` + GIN + triggers),
  searchable over title / description / tags / course / subject / exam /
  creator, kept in sync by DB triggers (never written by the app).
- Add a configurable weighted ranking score (40% relevance + 20% rating + 15%
  likes + 15% saves + 10% views) in `lib/collection-ranking.ts`, computed in SQL
  over the Phase-2 denormalized columns + a new denormalized `followerCount`.
- Add a trailing-window "trending" signal computed from the Phase-2 event tables.
- Extend `GET /api/prep-hub/collections` with a `q` (search) param and the sort
  keys `popular | recent | rating | views | new | trending | exam`.
- Build the 7-section discovery homepage + a search bar on the Prep Hub page.
- No change to Phase-2 write/engagement behavior, to `popularityScore`, or to
  access control.

### Non-Goals (Phase 3)

- **Admin moderation / analytics** (hide/unpublish, moderate comments,
  engagement dashboards). (Phase 4.)
- **Runtime-tunable weights / admin settings UI** — weights are compile-time
  constants (tunable in one file).
- **Per-section caching / materialized trending** — computed live; optimize
  later only if needed.
- **Trigram / typo-tolerant fallback** for collection search — FTS prefix +
  `websearch_to_tsquery` only in Phase 3 (the document-style trigram fallback
  can be added later).
- Searching **private** collections, or exposing engagement on them — the
  public/official gate from Phase 1/2 is unchanged.

---

## 3. Architecture & Module Boundaries

Phase 3 is read-path only; it touches no write/engagement code. The module seam
from Phases 1–2 holds: discovery lives in `prep-hub.service.ts`; the shared
data-access + SQL lives in `collections.repo.ts`; ranking policy is isolated in
a new constants module.

| Concern | Module |
|---|---|
| Ranking weights/scales/half-life constants | **new** `artifacts/api-server/src/lib/collection-ranking.ts` |
| FTS query, combined-score SQL, sort variants, trending query | `collections.repo.ts` (extended) |
| Discover/search/trending orchestration | `prep-hub.service.ts` (extended) |
| Routes (`q` + expanded `sort`) | `routes/prep-hub.ts` (extended) |
| FTS haystack + triggers + `followerCount` + indexes | one additive Prisma migration |
| Discovery homepage + search UI | `artifacts/web/src/pages/prep-hub.tsx` (extended) + small components |

**Boundary rules:** the combined score and trending are computed in SQL in the
repo (no per-request GROUP BY for the score — it reads denormalized columns).
The constants module is pure (no DB) and unit-testable. The FTS haystack is
**only** written by DB triggers — the service/repo never set `search_text`.

---

## 4. Data Model Changes

One additive Prisma migration. The `search_vector` generated column and the
triggers are **raw SQL** appended to the generated migration (Prisma cannot
express generated columns / triggers), exactly as the document FTS migrations
do. Prisma-schema-visible additions: `study_collections.searchText String?`
(`@map("search_text")`) and `followerCount Int @default(0)`
(`@map("follower_count")`). The `search_vector` column is **not** mapped in the
Prisma schema (it is DB-managed; the document schema follows the same
convention — `search_vector` is invisible to Prisma).

### 4.1 `study_collections` (alter)

- `searchText String? @map("search_text")` — the FTS haystack (trigger-written).
- `followerCount Int @default(0) @map("follower_count")` — denormalized save
  count, maintained transactionally on follow/unfollow (so ranking SQL reads a
  column instead of a per-row subquery). Backfilled in the migration from
  `study_collection_followers`.
- Raw SQL (appended): `search_vector tsvector GENERATED ALWAYS AS
  (to_tsvector('english', coalesce(search_text, ''))) STORED` + GIN index
  `study_collections_search_vector_gin_idx`.

### 4.2 FTS haystack + triggers (raw SQL)

A `kb_compute_collection_search_text(uuid)` SQL helper aggregating, for a
collection: title, description, exam_name, course (code/title/lecturer),
category (name), tag names (via `study_collection_tags`), and the owner's
`display_name`. A BEFORE INSERT/UPDATE trigger on `study_collections` (of
title/description/exam_name/course_id/category_id/owner_id) sets `search_text`
inline; AFTER triggers refresh it when related rows change:

| Source table | Event | Refresh |
|---|---|---|
| `study_collections` | BEFORE INSERT/UPDATE (title, description, exam_name, course_id, category_id, owner_id) | inline `NEW.search_text` |
| `study_collection_tags` | AFTER INSERT/DELETE/UPDATE | owning collection(s) |
| `tags` | AFTER UPDATE OF name | collections linked via the join |
| `courses` | AFTER UPDATE OF code/title/lecturer_name | collections with that course |
| `categories` | AFTER UPDATE OF name | collections with that category |
| `users` | AFTER UPDATE OF display_name | collections owned by that user |

Initial backfill: `UPDATE study_collections SET search_text =
kb_compute_collection_search_text(id);`

### 4.3 Event-table indexes (for trending)

Trailing-window trending scans recent rows in the Phase-2 event tables. Add
`createdAt` (and `viewedAt`) indexes where missing so the window filter is
indexable: `study_collection_likes(created_at)`,
`study_collection_followers(created_at)`,
`study_collection_comments(created_at)` (the `(collection_id, created_at)` index
already exists — reuse it), and `study_collection_views(viewed_at)` (the
`(user_id, viewed_at)` index already exists; add a standalone `viewed_at` or a
`(collection_id, viewed_at)` index for the grouped window scan). Minimal,
additive.

### 4.4 Migration safety

All additive; `followerCount` backfilled from the followers table; `search_text`
backfilled via the helper; `search_vector` is generated. No change to
`popularityScore`, engagement counters, items, or access. The Prisma client is
regenerated; trigram/GIN safety-net re-creation follows the document-migration
convention (Prisma drops non-expressible indexes on each generated migration, so
the raw SQL re-creates them).

---

## 5. Ranking

### 5.1 Constants module — `lib/collection-ranking.ts`

```ts
export const COLLECTION_RANKING = {
  // Weighted blend (sums to 1.0). Tune here.
  relevanceWeight: 0.40,
  ratingWeight:    0.20,
  likeWeight:      0.15,
  saveWeight:      0.15,
  viewWeight:      0.10,
  // Soft-cap scales for ln-normalising unbounded counts to ~[0,1]:
  //   norm(x) = ln(1+x) / ln(1+SCALE), clamped to [0,1].
  likeScale: 50,
  saveScale: 50,
  viewScale: 500,
  // Bayesian prior for the Highest-Rated section so a single 5★ can't top a
  // many-rating high average:  adj = (ratingSum + priorWeight*priorMean) /
  //                                  (ratingCount + priorWeight)
  ratingPriorMean:   3.5,
  ratingPriorWeight: 5,
  // Trending: trailing window + per-event weights.
  trendingWindowDays: 7,
  trendingViewWeight: 1.0,
  trendingLikeWeight: 3.0,
  trendingFollowWeight: 4.0,
  trendingCommentWeight: 2.0,
} as const;
```

(Scales are starting values, tunable in this file.)

### 5.2 Combined score (SQL)

Used for `sort=popular` (no query) and for **search** ranking (`q` present).
Higher = better; computed in SQL in the repo:

```
S =  relevanceWeight * R
   + ratingWeight    * (rating_sum::float / NULLIF(rating_count,0) / 5)      -- 0..1, 0 when no ratings
   + likeWeight      * LEAST(ln(1+like_count)    / ln(1+likeScale), 1)
   + saveWeight      * LEAST(ln(1+follower_count)/ ln(1+saveScale), 1)
   + viewWeight      * LEAST(ln(1+view_count)    / ln(1+viewScale), 1)
```

where `R` (relevance) is:
- **q present:** `LEAST(ts_rank(search_vector, websearch_to_tsquery('english', q)) , …)` mapped to [0,1] via `rank / (rank + 1)`.
- **q absent (browse):** `0`. The constant-0 relevance term lowers every row
  equally, so the engagement components still order "Popular" correctly (no
  renormalisation needed for an ORDER BY).

Coalesce nulls to 0 (`rating_count = 0 → 0`). All weights/scales come from the
constants module (injected into the SQL by the repo).

### 5.3 Section → ordering

| Section | Ordering |
|---|---|
| **Search** (`q`) | combined score `S` desc (relevance-weighted); FTS `WHERE search_vector @@ websearch_to_tsquery(...)` |
| **Popular** (`popular`, default) | combined score `S` desc (q-less) |
| **Highest Rated** (`rating`) | Bayesian-adjusted rating desc, tie-break `rating_count` desc |
| **Most Viewed** (`views`) | `view_count` desc |
| **New** (`new`) | `created_at` desc |
| **Trending** (`trending`) | trailing-window engagement score desc (§5.4) |
| **Upcoming exams** (`exam`) | `exam_date` asc, **`exam_date > now()` only** |
| **For your courses** | existing `GET /api/prep-hub/recommended` (interest-course scoped) |

All sections keep the Phase-1/2 visibility gate: `deletedAt IS NULL AND
(visibility='public' OR is_official)`.

### 5.4 Trending (trailing window)

A repo raw-SQL query: for each public/official collection, the weighted count of
engagement events in the last `trendingWindowDays`:

```
score = trendingViewWeight    * (views    in window)
      + trendingLikeWeight    * (likes    in window)
      + trendingFollowWeight  * (follows  in window)
      + trendingCommentWeight * (comments in window)
```

computed by unioning per-table windowed counts grouped by `collection_id`,
joined back to the visible collections, ordered desc, limited to N. Collections
with zero in-window activity are excluded (so a brand-new but unengaged
collection does not "trend"). The window cutoff is passed as a parameter
(`now - interval`), keeping the query deterministic/testable.

---

## 6. Backend Changes

### 6.1 `collections.repo.ts`

- `CollectionRow` gains `searchText: string | null` and `followerCount: number`
  (read off the row).
- Extend `DiscoverSort` to `"popular" | "recent" | "rating" | "views" | "new" |
  "trending" | "exam"` (`recent` kept as an alias of `new` for back-compat with
  Phase-1 callers).
- `listDiscoverable({ sort, q?, courseId?, limit })`: when `q` is present, add
  the FTS predicate + rank into the combined score and order by `S`; otherwise
  order per the sort table (§5.3). The combined-score expression is built from
  the constants module. `exam` adds `exam_date > now()`.
- `listTrending({ since, limit })`: the §5.4 query.
- `followerCount` maintenance: in the follow/unfollow repo path, bump/lower
  `follower_count` in the same transaction as the follower row write (mirrors the
  Phase-2 counter pattern), and keep the existing `popularityScore` recompute.

### 6.2 `prep-hub.service.ts`

- `listDiscoverable(user, { sort?, q?, courseId?, limit? })` — thread `q` and the
  expanded `sort` through to the repo; trim/normalise `q`; reuse
  `collectionsService.summarize` for the DTOs (which already carry the Phase-2
  fields; `followerCount` now comes off the row).
- `listTrending(user, limit?)` — call the repo trending query (cutoff =
  `now - trendingWindowDays`), then `summarize`.
- `getRecommendedCollections` (For-your-courses) — unchanged.

### 6.3 Routes — `routes/prep-hub.ts`

- Extend the discover query schema: add `q: z.string().trim().min(1).max(100).optional()`
  and widen `sort` to the new enum. Add a `GET /api/prep-hub/trending`
  (`operationId: listTrendingCollections`, optional `limit`). Everything stays
  `requireAuth` (read; all roles incl. admin).

### 6.4 OpenAPI + generated clients

Add `q` + the expanded `sort` enum to the discover operation; add the
`/prep-hub/trending` path (`listTrendingCollections`). Regenerate
`@workspace/api-zod` + `@workspace/api-client-react`. New/updated hooks:
`useListDiscoverableCollections` (now takes `q`/`sort`), `useListTrendingCollections`.

---

## 7. Frontend Changes (`prep-hub.tsx`)

The Prep Hub discovery page becomes a sectioned homepage with search:

- **Search bar** — debounced (≈300 ms, like Browse). When non-empty, the page
  switches to a **ranked results** view (`useListDiscoverableCollections({ q })`)
  with `<mark>` headline highlight reused from document search; clearing it
  returns to the sectioned homepage.
- **Sections** (each a labeled lane/grid, hidden when empty):
  Popular, Highest Rated, Most Viewed, New, Trending — each
  `useListDiscoverableCollections({ sort })`; **Trending** via
  `useListTrendingCollections()`; **For your courses** via
  `useListRecommendedCollections()`; **Upcoming exams** via `…({ sort: "exam" })`.
- Cards reuse the Phase-2 `CollectionCard` (with engagement counts) /
  `DocMiniGrid`-style layout. Admins see all sections read-only (no engagement
  actions, per Phase 2). "For your courses" is naturally empty for admins.

No change to the owner Collections workspace or the read-only collection view.

---

## 8. Testing

Backend (vitest; DB-backed, `.env` loaded; follow the `*.fts.test.ts` /
`*.ranking.test.ts` patterns):

- **FTS**: a collection matches on each haystack source — title, description,
  tag name, course code/title, category name, exam name, owner display name;
  trigger propagation when a tag/course/category name or owner name changes, and
  when a tag link is added/removed; a private collection never matches.
- **Ranking**: the combined score orders a higher-engagement collection above a
  lower one with the same relevance; the relevance term dominates on a strong
  text match; q-less ordering is stable.
- **Sections**: `rating` uses the Bayesian adjustment (a single 5★ ranks below a
  many-rating high average); `views`/`new`/`exam` order correctly; `exam`
  excludes past `exam_date`.
- **Trending**: events inside the window count (weighted); events outside the
  window are excluded; a zero-activity collection does not appear.
- **`followerCount`**: follow/unfollow maintains the column; backfill matches the
  follower table.
- **Constants module**: pure unit tests for `norm`/Bayesian helpers if extracted.

Web: typecheck-gated (per the Phase-1/2 convention); manual smoke — search ranks
results, each homepage section renders/hides correctly.

---

## 9. Migration Strategy

1. Apply the additive migration (search_text + generated search_vector + GIN +
   triggers + helper fn; `follower_count` + backfill; event-table indexes;
   search_text backfill).
2. Regenerate the Prisma client + the OpenAPI-derived packages.
3. Deploy backend (new query params/route) + web (sectioned homepage) together —
   purely additive; the Phase-1 `sort=popular|recent` callers keep working.

---

## 10. Risks & Mitigations

- **Trigger fan-out gaps** (the document FTS needed a follow-up migration for
  join-table UPDATEs). Mitigation: cover INSERT/UPDATE/DELETE on
  `study_collection_tags` and name-UPDATE on tags/courses/categories/users from
  the start; test propagation explicitly.
- **Heterogeneous ranking signals.** Mitigation: ln-dampen counts to a fixed
  scale (stateless, no per-result-set normalisation) and map relevance to [0,1];
  weights/scales isolated in the constants module and covered by ordering tests.
- **Trending query cost.** Mitigation: windowed + indexed event scans, top-N
  only; live compute is fine at this scale (caching deferred, §2).
- **Generated-client churn.** Mitigation: OpenAPI change + regen as one task,
  fix call sites against the compiler (Phase-1/2 playbook).
- **`followerCount` drift.** Mitigation: maintained in the same transaction as
  the follower row write; backfilled; covered by a test.

---

## 11. Out of Scope — Later Phases

- **Phase 4 — Admin moderation:** view/remove/hide/unpublish public collections,
  moderate comments, engagement analytics dashboards.
- **Deferred:** runtime-tunable ranking weights / admin settings UI, per-section
  or trending caching / materialization, trigram/typo-tolerant collection-search
  fallback, search filters (by subject/exam/semester) beyond free-text + sort.
```
