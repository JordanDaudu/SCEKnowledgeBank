# Design: Dark mode (Light / Dark / System)

Date: 2026-05-29
Status: Approved (design); pending implementation

## Problem

The app ships a complete dark palette in `index.css` (full `.dark {…}`
token block + the Tailwind v4 `@custom-variant dark` + dark overrides for
`.course-tag`/`.material-tag`), and `next-themes` is already a dependency
that `components/ui/sonner.tsx` already reads via `useTheme`. But nothing
toggles the `.dark` class on `<html>` and there is no UI control, so dark
mode is unreachable.

## Decision

Wire `next-themes` and add a Light/Dark/System toggle. No new dependency,
no token changes — just the toggle mechanism, a control, and an anti-flash
script.

## Architecture (web only)

1. **Provider** — wrap the app in next-themes' `ThemeProvider`:
   `attribute="class"`, `defaultTheme="system"`, `enableSystem`,
   `disableTransitionOnChange`, `storageKey="kb-theme"`. Placed in
   `App.tsx` as the outermost provider so the `Toaster` (sonner) inside it
   picks up `useTheme` and themes toasts automatically. next-themes
   adds/removes `dark` on `document.documentElement`, which the existing
   CSS consumes.

2. **Anti-flash script** — an inline IIFE in `index.html` `<head>`, before
   the module script, that reads `kb-theme` from `localStorage` (falling
   back to `prefers-color-scheme`) and adds `.dark` to `<html>` before
   first paint, so dark-mode users see no white flash. Wrapped in
   try/catch; mirrors next-themes' storage key/values.

3. **`ThemeToggle` control** — `src/components/theme-toggle.tsx`: a
   `Button variant="ghost" size="icon"` showing a Sun (light) / Moon
   (dark) icon that cross-fades via the `dark:` variant, opening a
   `DropdownMenu` with Light / Dark / System items (each with its lucide
   icon — Sun/Moon/Laptop — and a check on the active `theme`). Calls
   `setTheme(value)`. Rendered in the `Layout` header's right-side control
   group, next to `NotificationBell`, visible on all screen sizes.

4. **Spot-check pass** — click through the main screens in dark mode and
   fix any hardcoded `bg-white`/`text-black`/literal colors that don't use
   the token system. The new preview panels render documents/spreadsheets
   on their natural white page (correct); their chrome already uses tokens.

## Data flow

Toggle → `setTheme(value)` → next-themes writes `localStorage["kb-theme"]`
and sets/removes `.dark` on `<html>` → CSS custom properties switch →
whole UI (and toasts) re-themes instantly. On load, the inline script
applies the class pre-paint; the provider then takes over and stays in
sync (incl. live OS changes when in System mode).

## Error handling

The anti-flash script is wrapped in try/catch (private-mode / disabled
`localStorage` falls through to light). next-themes handles missing
`matchMedia` gracefully.

## Testing

This is configuration + UI glue around next-themes (a well-tested
library); there is no meaningful pure unit to test without contrivance, so
verification is manual in the browser, consistent with the rest of the web
UI:
- Toggle Light → Dark → System; confirm the UI re-themes each time.
- Reload; confirm the choice persists (no flash in dark).
- Set OS to dark with theme = System; confirm the app is dark.
- Confirm a toast (e.g. after favoriting) matches the active theme.

## Out of scope

A theme control on the login/register pages (they are still themed, just
without the toggle there) — easy follow-up. No changes to the dark palette
itself.
