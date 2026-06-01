---
name: Seed demo conventions
description: Non-obvious field names and type constraints in seed-demo.ts that catch future edits.
---

## CommentReaction field
The field is `kind` (a string like `"like"`), NOT `emoji`. The unique index is on `(commentId, userId, kind)`. Passing `emoji` causes TS2741 at typecheck.

## ensureRequest status type
The `status` field in `ensureRequest` must be widened to include all valid transitions:
`"open" | "in_progress" | "fulfilled" | "closed"`.

## DocSpec review fields
`DocSpec` interface has optional `status?` and `reviewReason?`. Both must be passed to `db.document.create` in `ensureDocument`. The `else` branch converges status+reviewReason on re-runs so the seed is idempotent.

## Verify check count
As of the Prep Hub collection-seed work: **23 checks** in seed-demo.verify.ts (was 22 at Sprint-3 completion; +1 for the public Prep Hub collections check). When adding new checks, update:
1. The verify script itself.
2. The `replit.md` seed:demo:verify description line.
3. The regression baselines table in replit.md.

**Why:** The check count is the single authoritative measure of demo-data health; replit.md serves as the project's operational source of truth so it must stay in sync.
