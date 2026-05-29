# Design: Home page hierarchy pass

Date: 2026-05-29
Status: Approved (design); pending implementation

## Problem

The Home page is a flat stack of equal-weight bands (`space-y-8`, every
section a `text-2xl` serif header), so nothing leads the eye. It also uses
its own `renderDocumentCard` — a plainer card (FileText icon, no
material-type colour, no engagement) — so "Continue reading" / "Latest
additions" look duller than and inconsistent with the Browse cards. That
local card is the duplicate flagged in the Phase 9 review.

## Decision

Introduce a clear visual hierarchy and reuse the shared card so Home feels
designed and consistent. No data/routing changes.

## Architecture (web only)

### Changed: `src/components/browse/DocumentCards.tsx`

Add an optional `columns` prop (`3 | 4`, default `4`) controlling the grid
(`lg:grid-cols-3` vs `xl:grid-cols-4`). Browse omits it → unchanged. Home's
promoted band passes `3` for larger cards.

### New: `src/components/section-header.tsx`

Presentational `SectionHeader`:
```ts
interface SectionHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  actionHref?: string;
  actionLabel?: string;   // default "View all"
  size?: "lg" | "md";     // lg = promoted (text-2xl), md = secondary (text-xl)
}
```
Renders the icon + serif title (+ optional subtitle line) on the left and an
optional "View all →" link on the right. Used by all Home content sections.

### Changed: `src/pages/home.tsx`

- Remove the local `renderDocumentCard` and `STATUS_BADGE`; render documents
  via `<DocumentCards items={…} />` (material-type system). Keep the existing
  loading-skeleton and empty-state branches around it.
- Restructure the body into two zones with distinct spacing:
  - **Utility zone** (directly under the hero, tighter `space-y-4`): Quick
    actions + contextual status (MySubmissions / ReviewQueueSummary /
    AdminInsights / StorageCard / ContinueStudying). No large serif headers —
    these are tools/alerts.
  - **Discovery zone** (separated by larger top spacing): document sections
    using `SectionHeader`.
- **Promote "Continue reading"**: `SectionHeader size="lg"` + subtitle +
  `<DocumentCards columns={3} />` (larger cards).
- **Demote** "Latest additions" and "Trending this week": `SectionHeader
  size="md"` + "View all", `columns={4}`.
- Trim hero vertical padding slightly.

## Unchanged

AdminInsights, TrendingDocuments, ContinueStudyingWidget, MySubmissions /
ReviewQueueSummary / StorageCard logic, data fetching, routing, and the
Browse page. Home cards pass no `favoritedIds` (hearts render unfilled, as
today).

## Testing

Layout/presentation only — no meaningful pure logic to unit-test. Verify
visually in the browser across roles (student, admin) in light + dark:
clear tier descent (hero → utility → discovery), promoted "Continue
reading" reads as primary, cards match Browse, nothing regressed.

## Out of scope

Fetching favorites on Home; changing the widgets' internals; Browse layout;
the remaining review items (#7 filters, #8 empty/loading states).
