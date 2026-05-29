# Design: Material-type card system

Date: 2026-05-29
Status: Approved (design); pending implementation

## Problem

A document card's leading icon is derived from the *file format*
(`fallbackIconType`: pdf/image/doc/…), so in a library that's almost all
PDFs every card shows the same icon — useless for scanning. The material
type (the dimension users actually scan by — exam vs slides vs summary) is
shown only as a monochrome neutral pill. Cards across Browse, Home, and
Prep Hub all look alike.

## Decision

Give each of the 9 material types a consistent **icon + muted color**, and
surface it everywhere a document appears. The brand green remains the
identity color (nav, primary actions, links); this categorical palette is a
separate, intentional system kept muted/desaturated and dark-mode aware.

### Mapping (icon + Tailwind color family)

| value | label | icon | color |
|---|---|---|---|
| lecture-notes | Lecture Notes | NotebookPen | indigo |
| problem-set | Problem Set | ListChecks | violet |
| exam | Exam | GraduationCap | rose |
| syllabus | Syllabus | ScrollText | teal |
| slides | Slides | Presentation | amber |
| project-report | Project Report | FileBarChart | cyan |
| textbook | Textbook | BookMarked | stone |
| review-notes | Review Notes | Highlighter | fuchsia |
| cheat-sheet | Cheat Sheet | Zap | yellow |
| *(unknown)* | — | FileText | muted (neutral tokens) |

## Architecture (web only)

### New: `src/lib/material-type-style.ts` (pure, unit-tested)

```ts
import type { LucideIcon } from "lucide-react";
export interface MaterialTypeStyle {
  icon: LucideIcon;
  tile: string; // icon-container classes: tinted bg + text, + dark variants
  tag: string;  // pill classes: bg + text + border, + dark variants
}
export function materialTypeStyle(value: string | undefined): MaterialTypeStyle;
```

- Class strings are written out **literally** per type (no interpolated
  color names) so Tailwind's scanner includes them in the build.
- `tile` pattern: `bg-{c}-100 text-{c}-700 dark:bg-{c}-950/40 dark:text-{c}-300`.
- `tag` pattern: `bg-{c}-50 text-{c}-700 border-{c}-200 dark:bg-{c}-950/40 dark:text-{c}-300 dark:border-{c}-900/50`.
- Unknown/unmapped → neutral (`bg-muted text-muted-foreground …`) + `FileText`.

### Changed: `src/components/browse/DocumentCards.tsx`

- Leading tile: when there is **no** server thumbnail, render the
  material-type icon inside a `tile`-tinted box (replaces the file-format
  `iconForFallbackType`). Real thumbnails still take precedence.
- Footer type pill: use `tag` classes instead of the monochrome
  `.material-tag`.

### Changed: `src/components/doc-mini-grid.tsx`

- Add a small `tile`-tinted material-type icon before each title (cards are
  plain text today). Lifts Home dashboard widgets and Prep Hub lanes at once.

## Unchanged

Real thumbnails, `StatusBadge`, `course-tag`, engagement counts, version
pill, layout/spacing. The `fallbackIconType` icon still backs the preview
fallback and other non-card uses.

## Testing

- **Unit (TDD, vitest):** `material-type-style.test.ts` — every value in
  `MATERIAL_TYPE_VALUES` returns a defined icon and non-empty, non-default
  `tile`/`tag`; an unknown value returns the neutral default; the default's
  classes differ from any mapped type's.
- **Manual:** Browse / Home / Prep Hub in light + dark — confirm types are
  visually distinct, colors are muted, and dark variants read correctly.

## Out of scope

Recoloring StatusBadge or course tags; changing the table view; any layout
restructure (that's the separate Home-hierarchy item).
