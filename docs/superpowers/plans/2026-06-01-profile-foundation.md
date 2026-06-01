# Profile Foundation & Account Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/profile` page for personal account management — editable unique `username`, avatar upload/replace/remove, read-only email/role/joined-date — with backend-enforced role/email immutability and audit logging.

**Architecture:** Three nullable columns on `User` (`username`, `avatarStoragePath`, `avatarMimeType`) via one hand-authored SQL migration (matching the repo's migration convention) with a username backfill + partial unique index. Pure username rules live in a testable module; a `profile.service` handles username availability/change; an `avatar.service` reuses the existing `sharp` + storage-adapter patterns. A new `profile` router exposes `PATCH /me/profile`, `GET /me/username-available`, `PUT/DELETE /me/avatar`, and `GET /users/:id/avatar`. The current-user DTO (`/auth/me`) gains `username`, `avatarUrl`, `createdAt`. A React `/profile` page consumes it.

**Tech Stack:** TypeScript, Express, Prisma/Postgres, Zod, `multer` (memory storage), `sharp`, OpenAPI + orval codegen, React, TanStack Query, wouter, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-01-profile-foundation-design.md`

**Environment note (Windows dev):** the DB is Docker Postgres on `localhost:5433`. Before any DB-touching command (`vitest`, migrate, seed), load `.env` in the same PowerShell call:
`Get-Content .env | ForEach-Object { if ($_ -match '^\s*([^#=]+)=(.*)$') { Set-Item -Path "env:$($matches[1].Trim())" -Value $matches[2].Trim() } }`
After the API source changes, the running API must be restarted from the **package dir** (`corepack pnpm --filter @workspace/api-server run start`) so local storage resolves correctly.

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `lib/db/prisma/schema.prisma` | Modify | Add 3 nullable `User` columns. |
| `lib/db/prisma/migrations/20260601000000_profile_foundation/migration.sql` | Create | Add columns, backfill username, partial unique index. |
| `artifacts/api-server/src/lib/username.ts` | Create | Pure: canonicalize + validate + reserved set. |
| `artifacts/api-server/src/lib/username.test.ts` | Create | Unit tests (no DB). |
| `artifacts/api-server/src/lib/profile-guard.ts` | Create | Pure: detect forbidden profile keys + map to audit action. |
| `artifacts/api-server/src/lib/profile-guard.test.ts` | Create | Unit tests (no DB). |
| `artifacts/api-server/src/lib/current-user-dto.ts` | Create | Shared CurrentUser DTO shaper (DRY for `/me` + profile). |
| `artifacts/api-server/src/repositories/users.repo.ts` | Modify | username/avatar queries; extend select + `UserWithRoles`. |
| `artifacts/api-server/src/middlewares/auth.ts` | Modify | `AuthenticatedUser` gains `username`, `avatarStoragePath`, `createdAt`. |
| `artifacts/api-server/src/services/auth.service.ts` | Modify | Map new fields in `loadAuthenticatedUser`. |
| `artifacts/api-server/src/services/profile.service.ts` | Create | Username availability + change (+ audit). |
| `artifacts/api-server/src/services/profile.service.test.ts` | Create | Service tests (real DB) incl. uniqueness. |
| `artifacts/api-server/src/services/avatar.service.ts` | Create | Validate/normalize/store/remove/stream avatar (+ audit). |
| `artifacts/api-server/src/services/avatar.service.test.ts` | Create | Service tests (real DB). |
| `artifacts/api-server/src/routes/profile.ts` | Create | The 5 endpoints + tamper-audit. |
| `artifacts/api-server/src/routes/index.ts` | Modify | Mount the profile router. |
| `artifacts/api-server/src/routes/auth.ts` | Modify | `/me` uses the shared DTO shaper. |
| `lib/api-spec/openapi.yaml` | Modify | Extend `CurrentUser`; add 4 JSON ops. |
| `lib/api-zod/*`, `lib/api-client-react/*` | Generated | New hooks via codegen (do not hand-edit). |
| `artifacts/web/src/pages/profile.tsx` | Create | The Profile page. |
| `artifacts/web/src/App.tsx` | Modify | `/profile` route. |
| `artifacts/web/src/components/layout.tsx` | Modify | Profile link in the user menu. |
| `artifacts/web/src/lib/activity-format.ts` | Modify | Labels for new audit actions. |

---

### Task 1: Database — columns, backfill, unique index

**Files:**
- Modify: `lib/db/prisma/schema.prisma` (the `User` model)
- Create: `lib/db/prisma/migrations/20260601000000_profile_foundation/migration.sql`

- [ ] **Step 1: Add the three columns to the Prisma `User` model**

In `lib/db/prisma/schema.prisma`, inside `model User { ... }`, add these lines next to the other scalar fields (e.g. just after the `department` field):

```prisma
  username          String?   @map("username")
  avatarStoragePath String?   @map("avatar_storage_path")
  avatarMimeType    String?   @map("avatar_mime_type")
```

(The partial unique index is created in raw SQL below — Prisma cannot express `WHERE deleted_at IS NULL`, exactly like the existing email index, so do **not** add `@unique` here.)

- [ ] **Step 2: Create the migration SQL**

Create `lib/db/prisma/migrations/20260601000000_profile_foundation/migration.sql` with:

```sql
-- Profile foundation: username + avatar columns.
ALTER TABLE "users" ADD COLUMN "username" TEXT;
ALTER TABLE "users" ADD COLUMN "avatar_storage_path" TEXT;
ALTER TABLE "users" ADD COLUMN "avatar_mime_type" TEXT;

-- Backfill username from the email local-part, canonicalized to [a-z0-9_], capped at 30.
UPDATE "users"
SET "username" = left(
  regexp_replace(lower(split_part("email", '@', 1)), '[^a-z0-9_]', '_', 'g'),
  30
)
WHERE "deleted_at" IS NULL AND "username" IS NULL;

-- Enforce the 3-char minimum by right-padding short values.
UPDATE "users"
SET "username" = rpad("username", 3, '_')
WHERE "deleted_at" IS NULL AND char_length("username") < 3;

-- Deterministically de-duplicate collisions with a numeric suffix.
WITH ranked AS (
  SELECT "id", "username",
         row_number() OVER (PARTITION BY "username" ORDER BY "created_at", "id") AS rn
  FROM "users"
  WHERE "deleted_at" IS NULL
)
UPDATE "users" u
SET "username" = left(ranked."username", 27) || '_' || ranked.rn
FROM ranked
WHERE u."id" = ranked."id" AND ranked.rn > 1;

-- Case-insensitive-by-storage uniqueness, soft-delete aware (mirrors the email index).
CREATE UNIQUE INDEX "users_username_unique" ON "users" ("username") WHERE "deleted_at" IS NULL;
```

- [ ] **Step 3: Apply the migration and regenerate the Prisma client**

Run (PowerShell, `.env` loaded — see the Environment note):
```
corepack pnpm --filter @workspace/db run migrate
corepack pnpm --filter @workspace/db run generate
```
Expected: migrate reports the `20260601000000_profile_foundation` migration applied; generate completes (a Windows EPERM on `query_engine-windows.dll.node` is harmless if a node process holds it — re-run if needed).

- [ ] **Step 4: Verify columns + backfill**

Run:
```
docker exec sceknowledgebank-db-1 psql -U knowledge_bank -d knowledge_bank -c "SELECT email, username FROM users WHERE deleted_at IS NULL ORDER BY created_at LIMIT 12;"
```
Expected: every row has a non-null, unique `username` derived from its email (e.g. `noa.student@knowledgebank.demo` → `noa_student`).

- [ ] **Step 5: Commit**

```
git add lib/db/prisma/schema.prisma lib/db/prisma/migrations/20260601000000_profile_foundation/
git commit -m "feat(db): add User.username + avatar columns, backfill + unique index"
```

---

### Task 2: Pure username rules

**Files:**
- Create: `artifacts/api-server/src/lib/username.ts`
- Create: `artifacts/api-server/src/lib/username.test.ts`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/username.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { canonicalizeUsername, validateUsername, RESERVED_USERNAMES } from "./username";

describe("canonicalizeUsername", () => {
  it("trims and lowercases", () => {
    expect(canonicalizeUsername("  Noa_Student  ")).toBe("noa_student");
  });
});

describe("validateUsername", () => {
  it("accepts a valid handle and returns the canonical value", () => {
    expect(validateUsername("Noa_Student")).toEqual({ ok: true, value: "noa_student" });
  });
  it("rejects too-short / too-long / bad chars as invalid", () => {
    expect(validateUsername("ab")).toEqual({ ok: false, reason: "invalid" });
    expect(validateUsername("a".repeat(31))).toEqual({ ok: false, reason: "invalid" });
    expect(validateUsername("has space")).toEqual({ ok: false, reason: "invalid" });
    expect(validateUsername("dash-no")).toEqual({ ok: false, reason: "invalid" });
  });
  it("rejects reserved names (case-insensitive)", () => {
    expect(validateUsername("Admin")).toEqual({ ok: false, reason: "reserved" });
    expect(validateUsername("support")).toEqual({ ok: false, reason: "reserved" });
  });
  it("exposes the reserved set", () => {
    expect(RESERVED_USERNAMES.has("admin")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm --filter @workspace/api-server exec vitest run src/lib/username.test.ts`
Expected: FAIL — cannot import from `./username` (module not found).

- [ ] **Step 3: Implement the module**

Create `artifacts/api-server/src/lib/username.ts`:

```typescript
/**
 * Pure username rules (no DB). Usernames are stored canonical-lowercase, so
 * uniqueness is case-insensitive by storage. Uniqueness itself is checked
 * against the DB in profile.service.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "admin", "administrator", "system", "support", "root", "api", "me",
  "null", "undefined", "anonymous", "moderator", "staff", "help",
  "about", "settings", "profile", "user", "users",
]);

const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

export function canonicalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export type UsernameValidation =
  | { ok: true; value: string }
  | { ok: false; reason: "invalid" | "reserved" };

export function validateUsername(raw: string): UsernameValidation {
  const value = canonicalizeUsername(raw);
  if (!USERNAME_RE.test(value)) return { ok: false, reason: "invalid" };
  if (RESERVED_USERNAMES.has(value)) return { ok: false, reason: "reserved" };
  return { ok: true, value };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `corepack pnpm --filter @workspace/api-server exec vitest run src/lib/username.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```
git add artifacts/api-server/src/lib/username.ts artifacts/api-server/src/lib/username.test.ts
git commit -m "feat(api): pure username canonicalize + validate + reserved set"
```

---

### Task 3: Pure profile-tamper guard

**Files:**
- Create: `artifacts/api-server/src/lib/profile-guard.ts`
- Create: `artifacts/api-server/src/lib/profile-guard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/profile-guard.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { forbiddenProfileKey, auditActionForForbiddenKey } from "./profile-guard";

describe("forbiddenProfileKey", () => {
  it("returns null when only allowed keys are present", () => {
    expect(forbiddenProfileKey({ username: "noa_x" })).toBeNull();
  });
  it("detects role/email/status/id keys", () => {
    expect(forbiddenProfileKey({ role: "admin" })).toBe("role");
    expect(forbiddenProfileKey({ username: "x", email: "a@b.c" })).toBe("email");
    expect(forbiddenProfileKey({ status: "ACTIVE" })).toBe("status");
    expect(forbiddenProfileKey({ primaryRoleId: "x" })).toBe("primaryRoleId");
  });
});

describe("auditActionForForbiddenKey", () => {
  it("maps keys to the right audit action", () => {
    expect(auditActionForForbiddenKey("role")).toBe("user.role_change_attempt");
    expect(auditActionForForbiddenKey("primaryRoleId")).toBe("user.role_change_attempt");
    expect(auditActionForForbiddenKey("email")).toBe("user.email_change_attempt");
    expect(auditActionForForbiddenKey("status")).toBe("user.profile_tamper_attempt");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm --filter @workspace/api-server exec vitest run src/lib/profile-guard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `artifacts/api-server/src/lib/profile-guard.ts`:

```typescript
/**
 * Defence-in-depth for PATCH /me/profile: the only writable field is
 * `username`. Any attempt to send a protected field is rejected AND audited.
 */
const ROLE_KEYS = ["role", "roles", "primaryRole", "primaryRoleId", "roleId"];
const EMAIL_KEYS = ["email"];
const OTHER_FORBIDDEN = ["status", "id", "userId", "isActive", "deletedAt"];
const FORBIDDEN = [...ROLE_KEYS, ...EMAIL_KEYS, ...OTHER_FORBIDDEN];

export function forbiddenProfileKey(body: Record<string, unknown>): string | null {
  for (const k of FORBIDDEN) {
    if (Object.prototype.hasOwnProperty.call(body, k)) return k;
  }
  return null;
}

export type TamperAuditAction =
  | "user.role_change_attempt"
  | "user.email_change_attempt"
  | "user.profile_tamper_attempt";

export function auditActionForForbiddenKey(key: string): TamperAuditAction {
  if (ROLE_KEYS.includes(key)) return "user.role_change_attempt";
  if (EMAIL_KEYS.includes(key)) return "user.email_change_attempt";
  return "user.profile_tamper_attempt";
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `corepack pnpm --filter @workspace/api-server exec vitest run src/lib/profile-guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add artifacts/api-server/src/lib/profile-guard.ts artifacts/api-server/src/lib/profile-guard.test.ts
git commit -m "feat(api): pure profile-tamper guard (role/email immutability)"
```

---

### Task 4: Repo + AuthenticatedUser + shared DTO

**Files:**
- Modify: `artifacts/api-server/src/repositories/users.repo.ts`
- Modify: `artifacts/api-server/src/middlewares/auth.ts:10-18`
- Modify: `artifacts/api-server/src/services/auth.service.ts:41-69`
- Create: `artifacts/api-server/src/lib/current-user-dto.ts`

- [ ] **Step 1: Extend the repo — new queries + select fields**

In `artifacts/api-server/src/repositories/users.repo.ts`:

(a) Add to the `UserWithRoles` interface (after `roles: string[];`):
```typescript
  username: string | null;
  avatarStoragePath: string | null;
```

(b) In `findManyWithRolesByIds`, add `username: true,` and `avatarStoragePath: true,` to the `select`, and include them in the returned map object:
```typescript
      username: true,
      avatarStoragePath: true,
```
and in the `.map`:
```typescript
      username: r.username,
      avatarStoragePath: r.avatarStoragePath,
```

(c) Append these new functions at the end of the file:
```typescript
export async function findByUsername(
  username: string,
): Promise<{ id: string } | null> {
  return db.user.findFirst({
    where: { username, deletedAt: null },
    select: { id: true },
  });
}

export async function updateUsername(id: string, username: string): Promise<void> {
  await db.user.update({
    where: { id },
    data: { username, updatedAt: new Date() },
  });
}

export async function updateAvatar(
  id: string,
  storagePath: string | null,
  mimeType: string | null,
): Promise<void> {
  await db.user.update({
    where: { id },
    data: { avatarStoragePath: storagePath, avatarMimeType: mimeType, updatedAt: new Date() },
  });
}

export async function findAvatarById(
  id: string,
): Promise<{ avatarStoragePath: string | null; avatarMimeType: string | null } | null> {
  return db.user.findFirst({
    where: { id, deletedAt: null },
    select: { avatarStoragePath: true, avatarMimeType: true },
  });
}
```

- [ ] **Step 2: Extend `AuthenticatedUser`**

In `artifacts/api-server/src/middlewares/auth.ts`, add to the `AuthenticatedUser` interface (after `roles: string[];`):
```typescript
  username: string | null;
  avatarStoragePath: string | null;
  createdAt: string;
```

- [ ] **Step 3: Map the new fields in `loadAuthenticatedUser`**

In `artifacts/api-server/src/services/auth.service.ts`, in the returned object of `loadAuthenticatedUser` (currently ends with `enrollments,`), add:
```typescript
    username: u.username,
    avatarStoragePath: u.avatarStoragePath,
    createdAt: u.createdAt.toISOString(),
```

- [ ] **Step 4: Create the shared CurrentUser DTO shaper**

Create `artifacts/api-server/src/lib/current-user-dto.ts`:

```typescript
import type { AuthenticatedUser } from "../middlewares/auth";

/** The shape returned by GET /auth/me and the profile mutation endpoints. */
export function currentUserDto(u: AuthenticatedUser) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    username: u.username,
    primaryRole: u.primaryRole,
    roles: u.roles,
    enrollments: u.enrollments,
    avatarUrl: u.avatarStoragePath ? `/api/users/${u.id}/avatar` : null,
    createdAt: u.createdAt,
  };
}
```

- [ ] **Step 5: Use the shaper in `/auth/me`**

In `artifacts/api-server/src/routes/auth.ts`, add the import:
```typescript
import { currentUserDto } from "../lib/current-user-dto";
```
and replace the body of the `GET /me` handler with:
```typescript
router.get("/me", requireAuth, (req, res) => {
  res.json(currentUserDto(req.authUser!));
});
```

- [ ] **Step 6: Typecheck**

Run: `corepack pnpm --filter @workspace/api-server run typecheck`
Expected: PASS. (Confirms the Prisma client from Task 1 exposes `username`/`avatarStoragePath`/`avatarMimeType`, and all maps line up.)

- [ ] **Step 7: Commit**

```
git add artifacts/api-server/src/repositories/users.repo.ts artifacts/api-server/src/middlewares/auth.ts artifacts/api-server/src/services/auth.service.ts artifacts/api-server/src/lib/current-user-dto.ts artifacts/api-server/src/routes/auth.ts
git commit -m "feat(api): surface username/avatar/createdAt on the current-user DTO"
```

---

### Task 5: Profile service (username availability + change)

**Files:**
- Create: `artifacts/api-server/src/services/profile.service.ts`
- Create: `artifacts/api-server/src/services/profile.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/services/profile.service.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { checkUsernameAvailability, updateUsername } from "./profile.service";

const SX = `_prof_${Date.now().toString(36)}`;
let alice: AuthenticatedUser;
let bobId: string;

function authUser(id: string, username: string | null): AuthenticatedUser {
  return {
    id, email: `${username ?? id}@demo`, displayName: "T", isActive: true,
    primaryRole: "student", roles: ["student"], enrollments: [],
    username, avatarStoragePath: null, createdAt: new Date().toISOString(),
  };
}

beforeAll(async () => {
  const a = await db.user.create({ data: { email: `a${SX}@demo`, passwordHash: "x", displayName: "A", username: `alice${SX}`.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 30) } });
  const b = await db.user.create({ data: { email: `b${SX}@demo`, passwordHash: "x", displayName: "B", username: `bob${SX}`.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 30) } });
  alice = authUser(a.id, a.username);
  bobId = b.id;
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [alice.id, bobId] } } });
});

describe("checkUsernameAvailability", () => {
  it("flags invalid and reserved", async () => {
    expect(await checkUsernameAvailability(alice, "ab")).toEqual({ available: false, reason: "invalid" });
    expect(await checkUsernameAvailability(alice, "admin")).toEqual({ available: false, reason: "reserved" });
  });
  it("treats the caller's own username as available (no-op rename)", async () => {
    expect(await checkUsernameAvailability(alice, alice.username!.toUpperCase())).toEqual({ available: true });
  });
  it("flags a name taken by someone else", async () => {
    const bob = await db.user.findUnique({ where: { id: bobId } });
    expect(await checkUsernameAvailability(alice, bob!.username!)).toEqual({ available: false, reason: "taken" });
  });
  it("reports a free name as available", async () => {
    expect(await checkUsernameAvailability(alice, `free${SX}`.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 30))).toEqual({ available: true });
  });
});

describe("updateUsername", () => {
  it("changes the username and writes an audit entry", async () => {
    const next = `renamed${SX}`.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 30);
    const res = await updateUsername(alice, next);
    expect(res).toEqual({ username: next });
    const row = await db.user.findUnique({ where: { id: alice.id } });
    expect(row!.username).toBe(next);
    const audit = await db.auditLog.findFirst({
      where: { actorUserId: alice.id, action: "user.username_changed" },
    });
    expect(audit).not.toBeNull();
  });
  it("rejects a name taken by someone else with a conflict", async () => {
    const bob = await db.user.findUnique({ where: { id: bobId } });
    await expect(updateUsername(alice, bob!.username!)).rejects.toMatchObject({ status: 409 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (`.env` loaded): `corepack pnpm --filter @workspace/api-server exec vitest run src/services/profile.service.test.ts`
Expected: FAIL — `checkUsernameAvailability`/`updateUsername` not exported.

- [ ] **Step 3: Implement the service**

Create `artifacts/api-server/src/services/profile.service.ts`:

```typescript
import * as usersRepo from "../repositories/users.repo";
import * as auditService from "./audit.service";
import { badRequest, conflict } from "../lib/errors";
import { validateUsername } from "../lib/username";
import type { AuthenticatedUser } from "../middlewares/auth";

export type AvailabilityReason = "invalid" | "reserved" | "taken";

export async function checkUsernameAvailability(
  user: AuthenticatedUser,
  raw: string,
): Promise<{ available: boolean; reason?: AvailabilityReason }> {
  const v = validateUsername(raw);
  if (!v.ok) return { available: false, reason: v.reason };
  if (user.username && v.value === user.username) return { available: true };
  const existing = await usersRepo.findByUsername(v.value);
  if (existing && existing.id !== user.id) return { available: false, reason: "taken" };
  return { available: true };
}

export async function updateUsername(
  user: AuthenticatedUser,
  raw: string,
): Promise<{ username: string }> {
  const v = validateUsername(raw);
  if (!v.ok) {
    throw badRequest(
      v.reason === "reserved"
        ? "That username is reserved."
        : "Invalid username. Use 3–30 letters, numbers, or underscores.",
      { errorCode: v.reason === "reserved" ? "username_reserved" : "username_invalid" },
    );
  }
  if (user.username === v.value) return { username: v.value };
  const existing = await usersRepo.findByUsername(v.value);
  if (existing && existing.id !== user.id) {
    throw conflict("That username is already taken.");
  }
  await usersRepo.updateUsername(user.id, v.value);
  await auditService.record(user.id, "user.username_changed", "user", user.id, {
    from: user.username,
    to: v.value,
  });
  return { username: v.value };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `corepack pnpm --filter @workspace/api-server exec vitest run src/services/profile.service.test.ts`
Expected: PASS (6 assertions across the two describes).

- [ ] **Step 5: Commit**

```
git add artifacts/api-server/src/services/profile.service.ts artifacts/api-server/src/services/profile.service.test.ts
git commit -m "feat(api): profile.service username availability + change with audit"
```

---

### Task 6: Avatar service

**Files:**
- Create: `artifacts/api-server/src/services/avatar.service.ts`
- Create: `artifacts/api-server/src/services/avatar.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/services/avatar.service.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { setAvatar, removeAvatar } from "./avatar.service";
import * as usersRepo from "../repositories/users.repo";

const SX = `_av_${Date.now().toString(36)}`;
let user: AuthenticatedUser;

async function pngBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 120, b: 200 } } })
    .png().toBuffer();
}

beforeAll(async () => {
  const u = await db.user.create({ data: { email: `u${SX}@demo`, passwordHash: "x", displayName: "U", username: `av${SX}`.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 30) } });
  user = {
    id: u.id, email: u.email, displayName: "U", isActive: true,
    primaryRole: "student", roles: ["student"], enrollments: [],
    username: u.username, avatarStoragePath: null, createdAt: new Date().toISOString(),
  };
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: user.id } });
});

describe("avatar.service", () => {
  it("rejects a disallowed mime type", async () => {
    await expect(
      setAvatar(user, { buffer: Buffer.from("hi"), mimetype: "text/plain" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("normalizes + stores a valid image and records the columns", async () => {
    await setAvatar(user, { buffer: await pngBuffer(), mimetype: "image/png" });
    const row = await usersRepo.findAvatarById(user.id);
    expect(row?.avatarStoragePath).toBe(`avatars/${user.id}.webp`);
    expect(row?.avatarMimeType).toBe("image/webp");
    const audit = await db.auditLog.findFirst({
      where: { actorUserId: user.id, action: "user.avatar_changed" },
    });
    expect(audit).not.toBeNull();
  });

  it("removes the avatar (clears columns)", async () => {
    const withAvatar = { ...user, avatarStoragePath: `avatars/${user.id}.webp` };
    await removeAvatar(withAvatar);
    const row = await usersRepo.findAvatarById(user.id);
    expect(row?.avatarStoragePath).toBeNull();
    expect(row?.avatarMimeType).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (`.env` loaded): `corepack pnpm --filter @workspace/api-server exec vitest run src/services/avatar.service.test.ts`
Expected: FAIL — `setAvatar`/`removeAvatar` not exported.

- [ ] **Step 3: Implement the service**

Create `artifacts/api-server/src/services/avatar.service.ts`:

```typescript
import sharp from "sharp";
import type { Response } from "express";
import * as usersRepo from "../repositories/users.repo";
import * as auditService from "./audit.service";
import { getStorage } from "../lib/storage";
import { badRequest, notFound } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";

const ALLOWED_AVATAR_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const AVATAR_SIZE = 256;

function avatarKey(userId: string): string {
  return `avatars/${userId}.webp`;
}

export async function setAvatar(
  user: AuthenticatedUser,
  file: { buffer: Buffer; mimetype: string },
): Promise<void> {
  if (!ALLOWED_AVATAR_MIME.has(file.mimetype)) {
    throw badRequest("Avatar must be a JPG, PNG, or WebP image.", { errorCode: "avatar_bad_type" });
  }
  let normalized: Buffer;
  try {
    normalized = await sharp(file.buffer, { failOn: "none" })
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw badRequest("Could not process that image. Try a different file.", { errorCode: "avatar_unprocessable" });
  }
  const key = avatarKey(user.id);
  await getStorage().put({ key, body: normalized, contentType: "image/webp" });
  await usersRepo.updateAvatar(user.id, key, "image/webp");
  await auditService.record(user.id, "user.avatar_changed", "user", user.id, { action: "set" });
}

export async function removeAvatar(user: AuthenticatedUser): Promise<void> {
  if (user.avatarStoragePath) {
    try {
      await getStorage().delete(user.avatarStoragePath);
    } catch {
      // best-effort: the object may already be gone; columns are the source of truth
    }
  }
  await usersRepo.updateAvatar(user.id, null, null);
  await auditService.record(user.id, "user.avatar_changed", "user", user.id, { action: "remove" });
}

export async function streamAvatar(userId: string, res: Response): Promise<void> {
  const row = await usersRepo.findAvatarById(userId);
  if (!row || !row.avatarStoragePath) throw notFound("No avatar");
  const stream = await getStorage().getStream(row.avatarStoragePath);
  res.setHeader("Content-Type", row.avatarMimeType ?? "image/webp");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  stream.pipe(res);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `corepack pnpm --filter @workspace/api-server exec vitest run src/services/avatar.service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```
git add artifacts/api-server/src/services/avatar.service.ts artifacts/api-server/src/services/avatar.service.test.ts
git commit -m "feat(api): avatar.service validate/normalize/store/remove/stream"
```

---

### Task 7: Profile routes + mount + OpenAPI + codegen

**Files:**
- Create: `artifacts/api-server/src/routes/profile.ts`
- Modify: `artifacts/api-server/src/routes/index.ts:16-36`
- Modify: `lib/api-spec/openapi.yaml` (CurrentUser schema + 4 ops)

- [ ] **Step 1: Create the profile router**

Create `artifacts/api-server/src/routes/profile.ts`:

```typescript
import { Router, type IRouter } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { badRequest, forbidden } from "../lib/errors";
import { loadAuthenticatedUser } from "../services/auth.service";
import * as profileService from "../services/profile.service";
import * as avatarService from "../services/avatar.service";
import * as auditService from "../services/audit.service";
import { currentUserDto } from "../lib/current-user-dto";
import { forbiddenProfileKey, auditActionForForbiddenKey } from "../lib/profile-guard";

const router: IRouter = Router();

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const UsernameQuery = z.object({ username: z.string().min(1).max(60) });
const ProfilePatchBody = z.object({ username: z.string().min(1).max(60) }).strict();

router.get("/me/username-available", requireAuth, async (req, res, next) => {
  try {
    const { username } = UsernameQuery.parse(req.query);
    res.json(await profileService.checkUsernameAvailability(req.authUser!, username));
  } catch (err) {
    next(err);
  }
});

router.patch("/me/profile", requireAuth, async (req, res, next) => {
  try {
    const user = req.authUser!;
    const bad = forbiddenProfileKey((req.body ?? {}) as Record<string, unknown>);
    if (bad) {
      await auditService.record(user.id, auditActionForForbiddenKey(bad), "user", user.id, { attempted: bad });
      return next(forbidden("You are not allowed to change that field."));
    }
    const body = ProfilePatchBody.parse(req.body);
    await profileService.updateUsername(user, body.username);
    const fresh = await loadAuthenticatedUser(user.id);
    res.json(currentUserDto(fresh!));
  } catch (err) {
    next(err);
  }
});

router.put("/me/avatar", requireAuth, avatarUpload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return next(badRequest("No file uploaded.", { errorCode: "avatar_missing" }));
    await avatarService.setAvatar(req.authUser!, {
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
    });
    const fresh = await loadAuthenticatedUser(req.authUser!.id);
    res.json(currentUserDto(fresh!));
  } catch (err) {
    next(err);
  }
});

router.delete("/me/avatar", requireAuth, async (req, res, next) => {
  try {
    await avatarService.removeAvatar(req.authUser!);
    const fresh = await loadAuthenticatedUser(req.authUser!.id);
    res.json(currentUserDto(fresh!));
  } catch (err) {
    next(err);
  }
});

router.get("/users/:id/avatar", requireAuth, async (req, res, next) => {
  try {
    await avatarService.streamAvatar(req.params.id, res);
  } catch (err) {
    next(err);
  }
});

export default router;
```

- [ ] **Step 2: Mount the router**

In `artifacts/api-server/src/routes/index.ts`, add the import after the others:
```typescript
import profileRouter from "./profile";
```
and mount it (add after `router.use(moderationRouter);`):
```typescript
router.use(profileRouter);
```

- [ ] **Step 3: Extend the OpenAPI `CurrentUser` schema**

In `lib/api-spec/openapi.yaml`, in `components.schemas.CurrentUser`: change the `required` line to include the new fields and add the property definitions. Replace:
```yaml
      required: [id, email, displayName, roles, primaryRole, enrollments]
```
with:
```yaml
      required: [id, email, displayName, username, avatarUrl, createdAt, roles, primaryRole, enrollments]
```
and add these under `properties:` (e.g. just after `displayName`):
```yaml
        username: { type: string, nullable: true }
        avatarUrl: { type: string, nullable: true }
        createdAt: { type: string, format: date-time }
```

- [ ] **Step 4: Add the four JSON operations**

In `lib/api-spec/openapi.yaml`, under `paths:` (next to `/auth/me`), add:
```yaml
  /me/username-available:
    get:
      operationId: checkUsernameAvailability
      tags: [profile]
      summary: Check whether a username is available for the current user
      parameters:
        - { in: query, name: username, required: true, schema: { type: string } }
      responses:
        "200":
          description: Availability
          content:
            application/json:
              schema:
                type: object
                required: [available]
                properties:
                  available: { type: boolean }
                  reason: { type: string, enum: [invalid, reserved, taken] }
  /me/profile:
    patch:
      operationId: updateMyProfile
      tags: [profile]
      summary: Update the current user's editable profile fields (username)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [username]
              properties:
                username: { type: string }
      responses:
        "200":
          description: Updated current user
          content:
            application/json:
              schema: { $ref: "#/components/schemas/CurrentUser" }
  /me/avatar:
    put:
      operationId: uploadMyAvatar
      tags: [profile]
      summary: Upload or replace the current user's avatar
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required: [file]
              properties:
                file: { type: string, format: binary }
      responses:
        "200":
          description: Updated current user
          content:
            application/json:
              schema: { $ref: "#/components/schemas/CurrentUser" }
    delete:
      operationId: removeMyAvatar
      tags: [profile]
      summary: Remove the current user's avatar
      responses:
        "200":
          description: Updated current user
          content:
            application/json:
              schema: { $ref: "#/components/schemas/CurrentUser" }
```

(The binary stream `GET /users/{id}/avatar` is intentionally NOT in the spec — it is consumed directly as an `<img src>` URL, exactly like `/documents/{id}/preview` is used via `src`/iframe rather than a generated hook.)

- [ ] **Step 5: Regenerate the client + typecheck**

Run:
```
corepack pnpm --filter @workspace/api-spec run codegen
corepack pnpm run typecheck
```
Expected: codegen regenerates `lib/api-zod` + `lib/api-client-react` (new hooks `useCheckUsernameAvailability`, `useUpdateMyProfile`, `useUploadMyAvatar`, `useRemoveMyAvatar`, and `CurrentUser` gains the fields); full typecheck PASS.

- [ ] **Step 6: Restart the API and smoke-test the endpoints**

Restart the API (PowerShell, `.env` loaded, from package dir): stop the process on 8080, then `corepack pnpm --filter @workspace/api-server run start` (background). Then:
```
# login as Noa, check availability of a reserved + a free name, then rename, then a tamper attempt
$base='http://localhost:8080/api'
Invoke-RestMethod "$base/auth/login" -Method Post -ContentType 'application/json' -Body '{"email":"noa.student@knowledgebank.demo","password":"Demo1234!"}' -SessionVariable s | Out-Null
Invoke-RestMethod "$base/me/username-available?username=admin" -WebSession $s    # {available:false,reason:reserved}
Invoke-RestMethod "$base/me/username-available?username=noa_new_handle" -WebSession $s  # {available:true}
Invoke-RestMethod "$base/me/profile" -Method Patch -ContentType 'application/json' -Body '{"username":"noa_new_handle"}' -WebSession $s  # CurrentUser with username
try { Invoke-RestMethod "$base/me/profile" -Method Patch -ContentType 'application/json' -Body '{"role":"admin"}' -WebSession $s } catch { $_.ErrorDetails.Message }  # 403 forbidden
```
Expected: reserved → `{available:false,reason:"reserved"}`; free → `{available:true}`; rename → CurrentUser JSON with `username:"noa_new_handle"`; role tamper → 403 error body. Then verify the audit row:
```
docker exec sceknowledgebank-db-1 psql -U knowledge_bank -d knowledge_bank -c "SELECT action FROM audit_logs WHERE action IN ('user.username_changed','user.role_change_attempt') ORDER BY created_at DESC LIMIT 5;"
```
Expected: both `user.username_changed` and `user.role_change_attempt` present.

- [ ] **Step 7: Commit**

```
git add artifacts/api-server/src/routes/profile.ts artifacts/api-server/src/routes/index.ts lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react
git commit -m "feat(api): profile + avatar endpoints, OpenAPI ops, generated client"
```

---

### Task 8: Frontend — Profile page + nav link

**Files:**
- Create: `artifacts/web/src/pages/profile.tsx`
- Modify: `artifacts/web/src/App.tsx` (add route)
- Modify: `artifacts/web/src/components/layout.tsx` (Profile link)

No web component-test harness exists; verification is typecheck (this task) + the manual check in Task 10.

- [ ] **Step 1: Create the Profile page**

Create `artifacts/web/src/pages/profile.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import {
  useGetCurrentUser,
  getGetCurrentUserQueryKey,
  useUpdateMyProfile,
  useRemoveMyAvatar,
  useCheckUsernameAvailability,
  getCheckUsernameAvailabilityQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { apiUrl } from "@/lib/api-url";
import { UserCircle, Upload, Trash2, Loader2 } from "lucide-react";

export default function Profile() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: me, isLoading } = useGetCurrentUser();

  const [username, setUsername] = useState("");
  const [avatarBust, setAvatarBust] = useState(0); // cache-bust the <img> after change
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (me?.username) setUsername(me.username);
  }, [me?.username]);

  const debounced = useDebounce(username, 300);
  const isAdmin = me?.roles?.includes("admin") ?? false;
  const dirty = !!me && debounced.trim().toLowerCase() !== (me.username ?? "");

  const availParams = { username: debounced.trim() };
  const { data: avail } = useCheckUsernameAvailability(availParams, {
    query: {
      queryKey: getCheckUsernameAvailabilityQueryKey(availParams),
      enabled: dirty && debounced.trim().length > 0,
      staleTime: 5_000,
    },
  });

  const updateMut = useUpdateMyProfile();
  const removeAvatarMut = useRemoveMyAvatar();

  const refreshMe = () => queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });

  const saveUsername = () => {
    updateMut.mutate(
      { data: { username: debounced.trim() } },
      {
        onSuccess: () => { refreshMe(); toast({ title: "Username updated" }); },
        onError: (err: unknown) => {
          const message =
            (err as { data?: { error?: { message?: string } } })?.data?.error?.message ??
            "Could not update username";
          toast({ variant: "destructive", title: "Update failed", description: message });
        },
      },
    );
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast({ variant: "destructive", title: "Unsupported file", description: "Use JPG, PNG, or WebP." });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ variant: "destructive", title: "File too large", description: "Maximum size is 5 MB." });
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(apiUrl("/api/me/avatar"), { method: "PUT", body: form, credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? "Upload failed");
      await refreshMe();
      setAvatarBust(Date.now());
      toast({ title: "Avatar updated" });
    } catch (err) {
      toast({ variant: "destructive", title: "Upload failed", description: (err as Error).message });
    } finally {
      setUploading(false);
    }
  };

  const removeAvatar = () => {
    removeAvatarMut.mutate(undefined, {
      onSuccess: () => { refreshMe(); setAvatarBust(Date.now()); toast({ title: "Avatar removed" }); },
      onError: () => toast({ variant: "destructive", title: "Could not remove avatar" }),
    });
  };

  if (isLoading || !me) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const avatarSrc = me.avatarUrl ? `${apiUrl(me.avatarUrl)}?b=${avatarBust}` : null;
  const initial = me.displayName?.charAt(0)?.toUpperCase() ?? "?";
  const availabilityHint = dirty && avail
    ? avail.available
      ? "Available"
      : avail.reason === "reserved" ? "That name is reserved"
      : avail.reason === "invalid" ? "3–30 letters, numbers, or underscores"
      : "Already taken"
    : "";
  const canSave = dirty && (avail?.available ?? false) && !updateMut.isPending;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-2.5">
        <div className="rounded-lg bg-primary/10 p-1.5"><UserCircle className="h-5 w-5 text-primary" /></div>
        <h1 className="font-serif text-3xl font-bold text-foreground">Profile</h1>
      </div>

      <Card>
        <CardContent className="space-y-6 p-6">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            {avatarSrc ? (
              <img src={avatarSrc} alt="Your avatar" className="h-20 w-20 rounded-full object-cover" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary">
                {initial}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onPickFile} />
              <Button variant="outline" size="sm" className="gap-1.5" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {me.avatarUrl ? "Replace" : "Upload"}
              </Button>
              {me.avatarUrl && (
                <Button variant="ghost" size="sm" className="gap-1.5" disabled={removeAvatarMut.isPending} onClick={removeAvatar}>
                  <Trash2 className="h-4 w-4" /> Remove
                </Button>
              )}
            </div>
          </div>

          {/* Username */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Username</label>
            <div className="flex gap-2">
              <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="your_handle" data-testid="profile-username" />
              <Button onClick={saveUsername} disabled={!canSave}>
                {updateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </div>
            {availabilityHint && (
              <p className={"text-xs " + (avail?.available ? "text-emerald-600" : "text-destructive")}>{availabilityHint}</p>
            )}
          </div>

          {/* Read-only fields */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Email</label>
              <p className="text-sm text-foreground">{me.email}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Role</label>
              <p><Badge variant="outline" className="capitalize">{me.primaryRole}</Badge></p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Joined</label>
              <p className="text-sm text-foreground">{new Date(me.createdAt).toLocaleDateString()}</p>
            </div>
          </div>

          {/* Sub-projects 2 (courses) and 3 (delete account) plug in here for
              students/lecturers. Nothing is rendered until those ship. */}
          {!isAdmin && <div data-testid="profile-extensions" />}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Add the `/profile` route**

In `artifacts/web/src/App.tsx`, add the import near the other page imports:
```tsx
import Profile from "@/pages/profile";
```
and add a route (next to the other `<AuthGuard>` routes, e.g. after the `/notifications` route):
```tsx
      <Route path="/profile">
        <AuthGuard>
          <Layout>
            <Profile />
          </Layout>
        </AuthGuard>
      </Route>
```

- [ ] **Step 3: Add a Profile link to the user menu**

In `artifacts/web/src/components/layout.tsx`:

(a) Add `UserCircle` to the `lucide-react` import list.

(b) Add a Profile item to `moreNav` (visible to all roles) — insert as the first entry of the `moreNav` array (just before `{ href: "/uploads", ... }`):
```tsx
        { href: "/profile", icon: UserCircle, label: "Profile" },
```

(c) Make the desktop user-info block link to the profile. Wrap the existing desktop user-info `<div className="hidden sm:flex items-center gap-3">...</div>` (the name + role + avatar badge) in a wouter `Link`:
```tsx
              <Link href="/profile" className="hidden sm:flex items-center gap-3 hover:opacity-80" aria-label="Open your profile">
                {/* ...existing name/role/avatar markup... */}
              </Link>
```
(Change the wrapper `div` to `Link`; keep the inner markup. `Link` is already imported in this file.)

- [ ] **Step 4: Typecheck the web app**

Run: `corepack pnpm --filter @workspace/web run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add artifacts/web/src/pages/profile.tsx artifacts/web/src/App.tsx artifacts/web/src/components/layout.tsx
git commit -m "feat(web): Profile page (username + avatar) and user-menu link"
```

---

### Task 9: Audit labels + full verification

**Files:**
- Modify: `artifacts/web/src/lib/activity-format.ts:14-39`

- [ ] **Step 1: Add labels for the new audit actions**

In `artifacts/web/src/lib/activity-format.ts`, add to the `ACTION_LABELS` object (after the `user.disable` line):
```typescript
  "user.username_changed": "changed their username",
  "user.avatar_changed": "updated their profile image",
  "user.role_change_attempt": "attempted an unauthorized role change",
  "user.email_change_attempt": "attempted an unauthorized email change",
  "user.profile_tamper_attempt": "attempted an unauthorized profile change",
```

- [ ] **Step 2: Full typecheck**

Run: `corepack pnpm run typecheck`
Expected: PASS across all packages.

- [ ] **Step 3: Run the api-server test suite**

Run (`.env` loaded): `corepack pnpm --filter @workspace/api-server run test`
Expected: all tests pass, including `username.test.ts`, `profile-guard.test.ts`, `profile.service.test.ts`, `avatar.service.test.ts`.

- [ ] **Step 4: Manual UI check**

Ensure both servers are running (API restarted from the package dir; web dev on :5173 with `$env:PORT='5173'; $env:BASE_PATH='/'`). Then:
1. Log in as `noa.student@knowledgebank.demo` / `Demo1234!`.
2. Open the user menu → **Profile** (or click the name/avatar) → `/profile` loads.
3. Username field is prefilled; type `admin` → "That name is reserved"; type a taken handle → "Already taken"; type a free handle → "Available"; **Save** → success toast; the nav still shows the full name (displayName unchanged).
4. Upload a PNG/JPG avatar → it appears as a round image on the profile (and after refresh, in the nav header); **Remove** → falls back to the letter badge.
5. Log in as `admin@knowledgebank.demo` → `/profile` shows avatar/username/email/role only (no courses/delete placeholder).
6. Confirm email + role are read-only (no inputs).

- [ ] **Step 5: Commit**

```
git add artifacts/web/src/lib/activity-format.ts
git commit -m "feat(web): activity-feed labels for profile audit actions"
```

---

## Self-Review

**Spec coverage:**
- Profile page accessible from user menu, role-based layout, no upload/approval surfaces → Task 8. ✓
- Common fields: avatar, username, email (ro), role (ro), created date → Tasks 4 (DTO), 8 (UI). ✓
- Profile image upload/replace/remove, jpg/png/webp ≤5MB, validation/errors → Tasks 6, 7, 8. ✓
- Username: unique (CI), 3–30, `[a-z0-9_]`, reserved, live availability, audit → Tasks 1 (index), 2 (rules), 5 (service+audit), 7 (endpoint), 8 (live check). ✓
- Role/email immutability enforced server-side + audited + proper error → Tasks 3, 7. ✓
- Audit entries (username/avatar/tamper) accessible to admins → Tasks 5, 6, 9 (+ existing /activity view). ✓
- DB migration: additive, soft-delete-aware unique, backfill, compatible → Task 1. ✓
- UI states (loading/empty/error/success) + responsive → Task 8. ✓
- Out of scope (courses, deletion, approvals, comment avatars, cropping) → not included; profile reserves a slot for 2 & 3. ✓

**Placeholder scan:** No TBD/placeholder steps; every code step has complete code; every command has expected output.

**Type consistency:** `validateUsername` → `{ok,value|reason}` used identically in Tasks 2 & 5. `AvailabilityReason` = `invalid|reserved|taken` matches the OpenAPI enum (Task 7) and the UI hint (Task 8). `currentUserDto` fields (`username`, `avatarUrl`, `createdAt`) match the `CurrentUser` schema additions and `AuthenticatedUser` additions. Repo `findByUsername`/`updateUsername`/`updateAvatar`/`findAvatarById` signatures match their callers in Tasks 5–6. Storage `put({key,body,contentType})`, `getStream(key)`, `delete(key)` match the adapter interface. Avatar key `avatars/${userId}.webp` is identical in `setAvatar` and the test assertion.
