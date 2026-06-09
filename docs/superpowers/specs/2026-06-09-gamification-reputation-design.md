# Gamification & Contributor Reputation — Design

**Status:** Approved design, pre-implementation
**Branch:** `feature/gamification-reputation`
**Date:** 2026-06-09

## Goal

Add a contributor reputation system to Knowledge Bank that rewards a **blend of
contribution and engagement, weighted so that *useful* contribution wins over raw
volume**. The system has four visible layers: a reputation **score**, **badges**
(achievements), a **leaderboard**, and **author credibility** shown in context
next to a user's name.

### Product decisions (locked)

- **What it rewards:** a blended points model (contribution + engagement) with
  quality weighting, so spamming low-value uploads does not win.
- **Visible surface:** all four layers — points, badges, leaderboard, and author
  credibility on documents/comments.
- **Who participates:** everyone (student, lecturer, admin) on **one** board.
  Admin is moderation-only and cannot upload, so admins naturally sit low; that
  trade-off is accepted. Soft-deleted / anonymized / non-`ACTIVE` users are
  excluded from the board.
- **Point dynamics (hybrid):** *action* points are stable while the content
  exists; *quality* points track live engagement; **moderated/hidden/deleted
  content forfeits all of its points.**

## Architecture — derived, not accumulated (Approach 2)

Reputation is a **pure function of current data**, computed in raw SQL (the same
approach as `artifacts/api-server/src/repositories/analytics.repo.ts`) and cached
in-process (mirroring the existing analytics-overview cache). There is **no
hand-maintained score column** that services increment/decrement.

Consequences:

- The hybrid point rule falls out for free: because the queries only count
  **alive & published** content (and exclude self-engagement), deleting,
  unpublishing, or moderating content automatically removes its points — no
  compensating writes in any service.
- One place defines the formula → the score cannot drift.
- **No score backfill is required** — it is computed from existing data on day
  one. Only badges need a one-time award pass for historical achievements.

### The only new persistent state: `user_badges`

Earned badges are permanent (the achievement feeling), so they *are* stored.
Badge **definitions** (the catalog) live in code, not the DB.

```prisma
model UserBadge {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  badgeKey  String   @map("badge_key")          // e.g. "prolific_uploader"
  awardedAt DateTime @default(now()) @map("awarded_at") @db.Timestamptz()
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, badgeKey], map: "user_badges_user_key_unique")  // idempotent
  @@index([userId], map: "user_badges_user_idx")
  @@map("user_badges")
}
```

One migration adds the table + the `User.badges UserBadge[]` relation. No other
schema changes.

## Scoring formula

Lives in a single config module `artifacts/api-server/src/lib/reputation.ts`,
mirroring the existing `lib/ranking.ts` weight-config pattern. v1 weights:

| Signal | Points | Type | Source (current-state only) |
|---|---|---|---|
| Published doc you uploaded | +10 each | action | `documents` where `deleted_at IS NULL AND status='published'` |
| Download your docs received | +2 each | quality | `audit_logs` `action='document.download'`, excluding self (`user_id <> uploader_id`) |
| Favorite your docs received | +3 each | quality | `documents.favorite_count` on alive docs (self-favorite excluded at source) |
| Public collection you made | +5 each | action | `study_collections` visible (`visibility='public' OR is_official`) and not hidden (`hidden_at IS NULL`), `deleted_at IS NULL` |
| Follower on your collection | +2 each | quality | `study_collections.follower_count` |
| Comment you posted | +2 each | action | `comments` where `deleted_at IS NULL` |
| Reaction your comment received | +1 each | quality | `comment_reactions`, excluding self |
| Material request you posted | +1 each | action | `material_requests` where `deleted_at IS NULL` |

**Anti-gaming rules (baked into the SQL):**

- Only alive/published content counts. Moderated (`hidden_at`/non-published) or
  deleted content contributes nothing.
- Self-downloads, self-favorites, and self-reactions are excluded.
- **Views are displayed but NOT scored** (too easy to inflate).
- All weights are constants in one file → trivially tunable without touching
  query logic.

### Levels (display flavor)

A score→level map in the same module: e.g. Novice → Contributor → Scholar →
Sage (exact thresholds set during implementation). Used purely for display
(chips, profile, leaderboard).

## Badge catalog (starter set, ~10)

Defined in code as `{ key, name, description, icon, predicate }`, where the
predicate is a threshold over the same derived stats used by scoring. Awarded by
an **idempotent** evaluator; the unique constraint prevents duplicates. Badges
are **permanent once earned** and only effectively lost if moderation removes the
qualifying content (re-evaluation simply will not re-award, but already-awarded
rows are not deleted in v1 — see Open Questions).

- **Contribution:** First Upload (1 upload) · Prolific (10 uploads) · Librarian (50 uploads)
- **Quality:** Popular (100 total downloads across your docs) · Crowd Favorite (50 favorites received) · Trusted (reach Scholar level)
- **Engagement:** Conversationalist (10 comments) · Helpful (25 reactions received) · Curator (3 public collections)

## API (reuses OpenAPI spec + orval client generation)

- `GET /leaderboard?window=all|month&limit=50` → ranked users
  `{ rank, userId, displayName, username, avatarUrl, score, level, topBadges }`.
  Cached in-process like the analytics overview.
- `GET /users/:id/reputation` → `{ score, level, rank?, breakdown, badges:
  earned[], progress: nextBadges[] }`. Public.
- Extend the **current-user / profile DTO** with `reputationScore`, `level`,
  `badges`.
- Extend the **document author** and **comment author** objects with
  `{ reputationScore, level, topBadge }`, populated via a **single batched score
  lookup** keyed by the set of author IDs in the list (no N+1).

`window=month` restricts quality/action signals to events in the trailing 30
days; `window=all` is lifetime. (Action counts for "month" use `created_at`
windows on the underlying rows.)

## UI surfaces (web, reuses existing component patterns)

1. **`/leaderboard` page** — top-3 podium + ranked table, **All-time / This
   month** tabs. Nav entry under the existing "More" dropdown. Reuses the table
   and card patterns already in the app.
2. **Profile page additions** — reputation score + level, the user's rank, and a
   **badge shelf**: earned badges shown bright, locked badges greyed with a
   progress hint toward the threshold.
3. **Home widget** — a compact "Your reputation" card + a "Top contributors"
   mini-list (reuses the `DocMiniGrid`-style layout).
4. **Author credibility** — a small **level + top-badge chip** next to the
   uploader's name on document cards and document detail, and next to comment
   authors.
5. **Reusable components** — `BadgeChip` / `ReputationBadge` with tooltips, used
   across all of the above.

## Awarding / evaluation hooks

- **Score:** no write hooks — derived on read + cache.
- **Badges:** an idempotent `evaluateBadges(userId)` is called from the *same
  service points that already maintain engagement counters* —
  `favorites.service`, the download stream path, `recordView`, and the comments
  service — for the acting user and, on engagement events, for the affected
  content's owner. Append-only and idempotent, so it cannot drift.
- **One-time backfill:** a maintenance pass evaluates badges for all existing
  users so historical achievements are granted on launch. Added as a script
  (and invoked from the migrate/seed path for the demo).

## Roles & exclusions

Everyone earns and appears on one leaderboard (decision C). Excluded from the
board: users with `status <> 'ACTIVE'`, `deleted_at` set, or `anonymized_at`
set. Admins appear but, being upload-restricted, will rank low — accepted.

## Testing

- **Pure-function tests** for `lib/reputation.ts` — weight math and level
  mapping.
- **Repo/SQL tests** (mirroring `collections.*.test.ts`): score counts only
  alive/published content, excludes self-engagement, and drops to zero when
  content is deleted or moderated.
- **Badge evaluator tests:** thresholds fire correctly, awarding is idempotent,
  and a later score drop **keeps** an already-earned badge.
- **Leaderboard tests:** ordering, window filtering (all vs month), and caching.
- **Web smoke** for the leaderboard page.

## Files (anticipated)

**New:**
- `lib/db/prisma/migrations/<ts>_user_badges/migration.sql` — `user_badges` table
- `artifacts/api-server/src/lib/reputation.ts` — weights, level map, badge catalog
- `artifacts/api-server/src/repositories/reputation.repo.ts` — derived SQL (single user, batch, leaderboard)
- `artifacts/api-server/src/services/reputation.service.ts` — scoring, badge evaluation, caching
- `artifacts/api-server/src/routes/leaderboard.ts` — leaderboard + reputation endpoints
- `artifacts/web/src/pages/leaderboard.tsx`
- `artifacts/web/src/components/reputation/*` — `BadgeChip`, `ReputationBadge`, `BadgeShelf`, home widget

**Modified:**
- `lib/db/prisma/schema.prisma` — `UserBadge` model + `User.badges` relation
- Document & comment DTO assembly — batched author reputation
- `favorites.service`, download path, `recordView`, comments service — badge eval hook
- `profile.service` / `current-user-dto` — expose reputation
- OpenAPI spec + regenerated orval clients
- `seed-demo.ts` — showcase varied scores + badges; badge backfill on seed
- Web nav ("More" dropdown), profile page, home page

## Open questions / deferred

- **Author credibility on lists** may add one batched query per document/comment
  list response. Acceptable for v1; if read latency becomes a concern, add a
  cached denormalized `reputation_score` column on `users` refreshed wholesale
  (still derived, just memoized) — explicitly **out of scope for v1**.
- **Badge revocation on moderation:** v1 keeps already-awarded badge rows even if
  the qualifying content is later removed (re-evaluation just won't re-add). True
  revocation is deferred.
- **Streaks / consistency badges** are out of scope (no login-streak infra).
- **Notifications on badge earn** (e.g. "You earned Prolific!") — nice-to-have,
  deferred; the `Notification` model could support it later.
