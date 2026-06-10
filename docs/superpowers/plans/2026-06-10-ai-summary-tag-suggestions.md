# AI Summary + Tag Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After upload, a background job sends the document's extracted text to Google Gemini, stores a pending summary + tag suggestion, notifies the uploader, who reviews/accepts it on the document page.

**Architecture:** Fire-and-forget post-upload hook (same pattern as the existing badge/requests hooks in `documents.service.ts`) → `ai-suggestions.service.ts` calls Gemini (`@google/genai`, structured JSON output) → row in new `document_ai_suggestions` table → notification `document.ai_suggestions_ready` → owner-gated REST endpoints → React review card on the document detail page. Accepted summary lands in new `documents.ai_summary` column; accepted tags become `document_tags` rows.

**Tech Stack:** Express 5 + Prisma (api-server), `@google/genai` SDK (`gemini-2.5-flash`), Zod, vitest (mock-based unit tests, house style), OpenAPI spec + orval codegen for React Query hooks, React + i18next (en/he).

**Spec:** `docs/superpowers/specs/2026-06-10-ai-summary-tag-suggestions-design.md`

**Conventions discovered (verified against the codebase):**
- Tests: vitest, `vi.mock` module paths, e.g. `pnpm --filter @workspace/api-server exec vitest run src/services/ai-suggestions.service.test.ts`
- Typecheck: `pnpm run typecheck` (root)
- Client hooks are **generated**: edit `lib/api-spec/openapi.yaml`, then `pnpm --filter @workspace/api-spec run codegen`
- Prisma: schema `lib/db/prisma/schema.prisma`, hand-written SQL migrations in `lib/db/prisma/migrations/YYYYMMDDHHMMSS_slug/migration.sql`, `pnpm --filter @workspace/db run generate` / `run migrate`
- `notify()` (`services/notifications.service.ts`) is non-throwing, dedupes on `(recipientId, type, subjectType, subjectId)`, and **no-ops when actorId === recipientId** — so the AI notification must pass `actorId: null`
- Permission check for owner/admin: `permissions.canEdit({uploaderId, ownerId, visibility, courseId, status}, user)`

---

### Task 0: Feature branch

**Files:** none

- [ ] **Step 1: Create branch**

```bash
git checkout -b feature/ai-suggestions
```

- [ ] **Step 2: Verify clean state**

Run: `git status`
Expected: `On branch feature/ai-suggestions, nothing to commit, working tree clean`

---

### Task 1: Prisma schema + migration

**Files:**
- Modify: `lib/db/prisma/schema.prisma` (Document model ~line 225–302; add new model after `DocumentTag` ~line 377)
- Create: `lib/db/prisma/migrations/20260610090000_add_document_ai_suggestions/migration.sql`

- [ ] **Step 1: Add `aiSummary` to the `Document` model**

In `lib/db/prisma/schema.prisma`, inside `model Document`, after the `favoriteCount` line add:

```prisma
  // ─── AI suggestions (design 2026-06-10) ───────────────────────
  // Uploader-accepted AI-generated summary. Empty string = none.
  // Never auto-populated; only written when the owner accepts a
  // pending DocumentAiSuggestion. Distinct from `description`,
  // which is always human-authored.
  aiSummary String @default("") @map("ai_summary")
```

And add to the Document relations block (after `studyProgress StudyProgress[]`):

```prisma
  aiSuggestion      DocumentAiSuggestion?
```

- [ ] **Step 2: Add the `DocumentAiSuggestion` model**

After `model DocumentTag` (~line 377), add:

```prisma
// AI-generated summary + tag suggestions awaiting uploader review
// (design 2026-06-10). One live row per document (`documentId` unique);
// regeneration overwrites in place. `suggestedTagIds` reference Tag rows
// validated at generation time. Status: pending | accepted | dismissed
// | failed.
model DocumentAiSuggestion {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  documentId      String    @unique(map: "document_ai_suggestions_document_unique") @map("document_id") @db.Uuid
  summary         String    @default("")
  suggestedTagIds String[]  @default([]) @map("suggested_tag_ids") @db.Uuid
  status          String    @default("pending")
  error           String?
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  resolvedAt      DateTime? @map("resolved_at") @db.Timestamptz()

  document Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@map("document_ai_suggestions")
}
```

- [ ] **Step 3: Write the migration SQL**

Create `lib/db/prisma/migrations/20260610090000_add_document_ai_suggestions/migration.sql`:

```sql
-- AI summary + tag suggestions (design 2026-06-10).
-- documents.ai_summary holds the uploader-ACCEPTED summary only;
-- pending/failed suggestions live in document_ai_suggestions.
ALTER TABLE "documents" ADD COLUMN "ai_summary" TEXT NOT NULL DEFAULT '';

CREATE TABLE "document_ai_suggestions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "document_id" UUID NOT NULL,
  "summary" TEXT NOT NULL DEFAULT '',
  "suggested_tag_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  "status" TEXT NOT NULL DEFAULT 'pending',
  "error" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "resolved_at" TIMESTAMPTZ,
  CONSTRAINT "document_ai_suggestions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_ai_suggestions_document_unique"
  ON "document_ai_suggestions" ("document_id");

ALTER TABLE "document_ai_suggestions"
  ADD CONSTRAINT "document_ai_suggestions_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Regenerate the Prisma client and apply**

Run: `pnpm --filter @workspace/db run generate`
Expected: `Generated Prisma Client` with no schema errors.

Then, if a local database is reachable (dev.ps1 environment): `pnpm --filter @workspace/db run migrate`
Expected: `1 migration applied`. If no local DB is running, skip — unit tests are mock-based and don't need it; note this in the commit message.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm run typecheck:libs`
Expected: PASS

```bash
git add lib/db/prisma/schema.prisma lib/db/prisma/migrations/20260610090000_add_document_ai_suggestions/migration.sql
git commit -m "feat(db): document_ai_suggestions table + documents.ai_summary"
```

---

### Task 2: Environment config

**Files:**
- Modify: `artifacts/api-server/src/lib/env.ts` (schema ~line 51–77, export ~line 88–144)

- [ ] **Step 1: Add the vars to the Zod schema**

In `envSchema` (after `STORAGE_LOCAL_ROOT`):

```ts
  // ─── AI suggestions (design 2026-06-10) ──────────────────────────
  // Feature master switch: empty/absent disables the feature entirely
  // (uploads behave exactly as before; UI hides all AI elements).
  GEMINI_API_KEY: z.string().optional().default(""),
  AI_SUGGESTIONS_MODEL: z.string().default("gemini-2.5-flash"),
```

- [ ] **Step 2: Add to the exported `env` object**

At the end of the `export const env = { ... }` literal:

```ts
  geminiApiKey: e.GEMINI_API_KEY.trim(),
  aiSuggestionsModel: e.AI_SUGGESTIONS_MODEL,
```

- [ ] **Step 3: Typecheck and commit**

Run: `pnpm --filter @workspace/api-server run typecheck`
Expected: PASS

```bash
git add artifacts/api-server/src/lib/env.ts
git commit -m "feat(api): GEMINI_API_KEY + AI_SUGGESTIONS_MODEL env config"
```

---

### Task 3: Repository layer

**Files:**
- Create: `artifacts/api-server/src/repositories/ai-suggestions.repo.ts`

Thin Prisma calls only — no business logic, so no dedicated repo tests (service tests mock this module, house style).

- [ ] **Step 1: Write the repository**

```ts
import { db } from "@workspace/db";

export interface AiSuggestionRow {
  id: string;
  documentId: string;
  summary: string;
  suggestedTagIds: string[];
  status: string; // pending | accepted | dismissed | failed
  error: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

/** Minimal document context for permission checks + generation. */
export interface DocContextRow {
  id: string;
  title: string;
  description: string;
  uploaderId: string;
  ownerId: string;
  visibility: string;
  courseId: string | null;
  status: string;
  courseTitle: string | null;
  /** From the latest DocumentFile version. */
  extractedText: string | null;
  language: string | null;
}

export async function findDocContext(
  documentId: string,
): Promise<DocContextRow | null> {
  const doc = await db.document.findFirst({
    where: { id: documentId, deletedAt: null },
    select: {
      id: true,
      title: true,
      description: true,
      uploaderId: true,
      ownerId: true,
      visibility: true,
      courseId: true,
      status: true,
      course: { select: { title: true } },
      files: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { extractedText: true, language: true },
      },
    },
  });
  if (!doc) return null;
  const file = doc.files[0];
  return {
    id: doc.id,
    title: doc.title,
    description: doc.description,
    uploaderId: doc.uploaderId,
    ownerId: doc.ownerId,
    visibility: doc.visibility,
    courseId: doc.courseId,
    status: doc.status,
    courseTitle: doc.course?.title ?? null,
    extractedText: file?.extractedText ?? null,
    language: file?.language ?? null,
  };
}

export async function listTagCatalog(): Promise<
  Array<{ id: string; name: string }>
> {
  return db.tag.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function findByDocument(
  documentId: string,
): Promise<AiSuggestionRow | null> {
  return db.documentAiSuggestion.findUnique({ where: { documentId } });
}

/** Regeneration overwrites the single per-document row in place. */
export async function upsertForDocument(values: {
  documentId: string;
  summary: string;
  suggestedTagIds: string[];
  status: "pending" | "failed";
  error?: string | null;
}): Promise<AiSuggestionRow> {
  const data = {
    summary: values.summary,
    suggestedTagIds: values.suggestedTagIds,
    status: values.status,
    error: values.error ?? null,
    createdAt: new Date(),
    resolvedAt: null,
  };
  return db.documentAiSuggestion.upsert({
    where: { documentId: values.documentId },
    create: { documentId: values.documentId, ...data },
    update: data,
  });
}

/**
 * Apply an acceptance atomically: optionally copy the summary onto the
 * document, attach the chosen tags (duplicates ignored), and resolve
 * the suggestion row.
 */
export async function applyAcceptance(args: {
  documentId: string;
  summary: string | null; // null = summary not accepted
  tagIds: string[];
}): Promise<AiSuggestionRow> {
  return db.$transaction(async (tx) => {
    if (args.summary !== null) {
      await tx.document.update({
        where: { id: args.documentId },
        data: { aiSummary: args.summary },
      });
    }
    if (args.tagIds.length > 0) {
      await tx.documentTag.createMany({
        data: args.tagIds.map((tagId) => ({
          documentId: args.documentId,
          tagId,
        })),
        skipDuplicates: true,
      });
    }
    return tx.documentAiSuggestion.update({
      where: { documentId: args.documentId },
      data: { status: "accepted", resolvedAt: new Date() },
    });
  });
}

export async function markDismissed(
  documentId: string,
): Promise<AiSuggestionRow> {
  return db.documentAiSuggestion.update({
    where: { documentId },
    data: { status: "dismissed", resolvedAt: new Date() },
  });
}
```

- [ ] **Step 2: Typecheck and commit**

Run: `pnpm --filter @workspace/api-server run typecheck`
Expected: PASS

```bash
git add artifacts/api-server/src/repositories/ai-suggestions.repo.ts
git commit -m "feat(api): ai-suggestions repository"
```

---

### Task 4: Generation service (TDD)

**Files:**
- Create: `artifacts/api-server/src/services/ai-suggestions.service.ts`
- Test: `artifacts/api-server/src/services/ai-suggestions.service.test.ts`

- [ ] **Step 1: Install the Gemini SDK**

Run: `pnpm --filter @workspace/api-server add @google/genai`
Expected: dependency added to `artifacts/api-server/package.json`.

- [ ] **Step 2: Write the failing tests**

`artifacts/api-server/src/services/ai-suggestions.service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../middlewares/auth";

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent },
  })),
  Type: { OBJECT: "object", STRING: "string", ARRAY: "array" },
}));

vi.mock("../lib/env", () => ({
  env: {
    geminiApiKey: "test-key",
    aiSuggestionsModel: "gemini-2.5-flash",
  },
}));

vi.mock("../repositories/ai-suggestions.repo", () => ({
  findDocContext: vi.fn(),
  listTagCatalog: vi.fn(),
  findByDocument: vi.fn(),
  upsertForDocument: vi.fn(),
  applyAcceptance: vi.fn(),
  markDismissed: vi.fn(),
}));

vi.mock("./notifications.service", () => ({ notify: vi.fn() }));

import * as repo from "../repositories/ai-suggestions.repo";
import * as notifications from "./notifications.service";
import * as svc from "./ai-suggestions.service";

const findDocContext = vi.mocked(repo.findDocContext);
const listTagCatalog = vi.mocked(repo.listTagCatalog);
const findByDocument = vi.mocked(repo.findByDocument);
const upsertForDocument = vi.mocked(repo.upsertForDocument);
const applyAcceptance = vi.mocked(repo.applyAcceptance);
const markDismissed = vi.mocked(repo.markDismissed);
const notify = vi.mocked(notifications.notify);

const DOC: repo.DocContextRow = {
  id: "d1",
  title: "Calculus Lecture 3",
  description: "",
  uploaderId: "u-owner",
  ownerId: "u-owner",
  visibility: "public",
  courseId: "c1",
  status: "published",
  courseTitle: "Calculus 1",
  extractedText: "limits and derivatives ...",
  language: "en",
};

const TAGS = [
  { id: "t1", name: "calculus" },
  { id: "t2", name: "exam prep" },
];

const owner = {
  id: "u-owner",
  roles: ["student"],
  enrollments: [],
} as unknown as AuthenticatedUser;
const stranger = {
  id: "u-other",
  roles: ["student"],
  enrollments: [],
} as unknown as AuthenticatedUser;

function row(over: Partial<repo.AiSuggestionRow> = {}): repo.AiSuggestionRow {
  return {
    id: "s1",
    documentId: "d1",
    summary: "A summary.",
    suggestedTagIds: ["t1"],
    status: "pending",
    error: null,
    createdAt: new Date(),
    resolvedAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findDocContext.mockResolvedValue(DOC);
  listTagCatalog.mockResolvedValue(TAGS);
});

describe("buildPrompt", () => {
  it("includes title, course, language, tag catalog, and text", () => {
    const p = svc.buildPrompt(DOC, TAGS);
    expect(p).toContain("Calculus Lecture 3");
    expect(p).toContain("Calculus 1");
    expect(p).toContain('"t1"');
    expect(p).toContain("calculus");
    expect(p).toContain("limits and derivatives");
    expect(p.toLowerCase()).toContain("same language");
  });
});

describe("generateForDocument", () => {
  it("stores a pending suggestion and notifies the owner (actorId null)", async () => {
    generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ summary: "A summary.", tagIds: ["t1"] }),
    });
    upsertForDocument.mockResolvedValueOnce(row());
    const result = await svc.generateForDocument("d1");
    expect(result.status).toBe("pending");
    expect(upsertForDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "d1",
        summary: "A summary.",
        suggestedTagIds: ["t1"],
        status: "pending",
      }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: "u-owner",
        actorId: null,
        type: "document.ai_suggestions_ready",
        subjectType: "document",
        subjectId: "d1",
      }),
    );
  });

  it("drops hallucinated tag ids", async () => {
    generateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "S",
        tagIds: ["t1", "bogus", "t2", "t2"],
      }),
    });
    upsertForDocument.mockResolvedValueOnce(row());
    await svc.generateForDocument("d1");
    expect(upsertForDocument).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedTagIds: ["t1", "t2"] }),
    );
  });

  it("records a failed row on Gemini error and does not notify", async () => {
    generateContent.mockRejectedValueOnce(new Error("quota exceeded"));
    upsertForDocument.mockResolvedValueOnce(row({ status: "failed" }));
    const result = await svc.generateForDocument("d1");
    expect(result.status).toBe("failed");
    expect(upsertForDocument).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error: "quota exceeded" }),
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it("records a failed row on malformed JSON", async () => {
    generateContent.mockResolvedValueOnce({ text: "not json at all" });
    upsertForDocument.mockResolvedValueOnce(row({ status: "failed" }));
    const result = await svc.generateForDocument("d1");
    expect(result.status).toBe("failed");
    expect(notify).not.toHaveBeenCalled();
  });

  it("throws no_extracted_text when the document has no text", async () => {
    findDocContext.mockResolvedValueOnce({ ...DOC, extractedText: null });
    await expect(svc.generateForDocument("d1")).rejects.toMatchObject({
      code: "no_extracted_text",
    });
    expect(generateContent).not.toHaveBeenCalled();
  });
});

describe("generateForDocumentSafe (upload hook)", () => {
  it("never throws", async () => {
    generateContent.mockRejectedValueOnce(new Error("boom"));
    upsertForDocument.mockRejectedValueOnce(new Error("db down"));
    await expect(svc.generateForDocumentSafe("d1")).resolves.toBeUndefined();
  });

  it("is a no-op when the doc has no extracted text", async () => {
    findDocContext.mockResolvedValueOnce({ ...DOC, extractedText: null });
    await svc.generateForDocumentSafe("d1");
    expect(generateContent).not.toHaveBeenCalled();
    expect(upsertForDocument).not.toHaveBeenCalled();
  });
});

describe("getForDocument", () => {
  it("returns the envelope with resolved tag names for the owner", async () => {
    findByDocument.mockResolvedValueOnce(row());
    const out = await svc.getForDocument("d1", owner);
    expect(out.enabled).toBe(true);
    expect(out.hasExtractedText).toBe(true);
    expect(out.suggestion).toMatchObject({
      status: "pending",
      summary: "A summary.",
      suggestedTags: [{ id: "t1", name: "calculus" }],
    });
  });

  it("rejects a non-owner with forbidden", async () => {
    await expect(svc.getForDocument("d1", stranger)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("returns suggestion null when none exists", async () => {
    findByDocument.mockResolvedValueOnce(null);
    const out = await svc.getForDocument("d1", owner);
    expect(out.suggestion).toBeNull();
  });
});

describe("accept", () => {
  it("applies summary + selected tags and resolves", async () => {
    findByDocument.mockResolvedValueOnce(row());
    applyAcceptance.mockResolvedValueOnce(row({ status: "accepted" }));
    const out = await svc.accept("d1", owner, {
      acceptSummary: true,
      tagIds: ["t1"],
    });
    expect(applyAcceptance).toHaveBeenCalledWith({
      documentId: "d1",
      summary: "A summary.",
      tagIds: ["t1"],
    });
    expect(out.suggestion?.status).toBe("accepted");
  });

  it("ignores tag ids that were not suggested", async () => {
    findByDocument.mockResolvedValueOnce(row());
    applyAcceptance.mockResolvedValueOnce(row({ status: "accepted" }));
    await svc.accept("d1", owner, { acceptSummary: false, tagIds: ["t2"] });
    expect(applyAcceptance).toHaveBeenCalledWith({
      documentId: "d1",
      summary: null,
      tagIds: [],
    });
  });

  it("409s when the suggestion is not pending", async () => {
    findByDocument.mockResolvedValueOnce(row({ status: "dismissed" }));
    await expect(
      svc.accept("d1", owner, { acceptSummary: true, tagIds: [] }),
    ).rejects.toMatchObject({ code: "not_pending" });
  });
});

describe("dismiss", () => {
  it("marks dismissed without applying anything", async () => {
    findByDocument.mockResolvedValueOnce(row());
    markDismissed.mockResolvedValueOnce(row({ status: "dismissed" }));
    const out = await svc.dismiss("d1", owner);
    expect(markDismissed).toHaveBeenCalledWith("d1");
    expect(applyAcceptance).not.toHaveBeenCalled();
    expect(out.suggestion?.status).toBe("dismissed");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @workspace/api-server exec vitest run src/services/ai-suggestions.service.test.ts`
Expected: FAIL — `Cannot find module './ai-suggestions.service'` (or equivalent).

- [ ] **Step 4: Write the service**

`artifacts/api-server/src/services/ai-suggestions.service.ts`:

```ts
/**
 * AI summary + tag suggestions (design 2026-06-10).
 *
 * Generation runs as a best-effort background step after upload
 * (`generateForDocumentSafe`) or synchronously via POST
 * /documents/:id/ai-suggestions/generate. Results are stored as a
 * PENDING DocumentAiSuggestion; nothing is publicly visible until the
 * owner accepts. Feature is disabled entirely when GEMINI_API_KEY is
 * unset.
 */
import { GoogleGenAI, Type } from "@google/genai";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import type { AuthenticatedUser } from "../middlewares/auth";
import * as repo from "../repositories/ai-suggestions.repo";
import * as permissions from "./permissions.service";
import * as notificationsService from "./notifications.service";

// ─── Errors ──────────────────────────────────────────────────────────
export class AiSuggestionError extends Error {
  constructor(
    public code:
      | "forbidden"
      | "not_found"
      | "no_suggestion"
      | "not_pending"
      | "no_extracted_text"
      | "ai_disabled",
    message: string,
  ) {
    super(message);
    this.name = "AiSuggestionError";
  }
}

// ─── DTOs ────────────────────────────────────────────────────────────
export interface AiSuggestionDTO {
  id: string;
  status: string;
  summary: string;
  suggestedTags: Array<{ id: string; name: string }>;
  error: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** GET envelope — lets the UI decide what to render without 404 dances. */
export interface AiSuggestionEnvelope {
  enabled: boolean;
  hasExtractedText: boolean;
  suggestion: AiSuggestionDTO | null;
}

export function isEnabled(): boolean {
  return env.geminiApiKey.length > 0;
}

// ─── Prompt ──────────────────────────────────────────────────────────
export function buildPrompt(
  doc: repo.DocContextRow,
  tags: Array<{ id: string; name: string }>,
): string {
  const catalog = tags.map((t) => `- id: "${t.id}" name: "${t.name}"`).join("\n");
  return [
    "You are helping organize a university course-material library.",
    "Write a concise 2-4 sentence summary of the document below, in the SAME LANGUAGE as the document text (e.g. Hebrew text gets a Hebrew summary).",
    "Then pick up to 5 tags from the catalog that genuinely fit the document. Only use tag ids that appear in the catalog; return an empty list if none fit.",
    "",
    `Document title: ${doc.title}`,
    doc.description ? `Uploader description: ${doc.description}` : "",
    doc.courseTitle ? `Course: ${doc.courseTitle}` : "",
    doc.language ? `Detected language code: ${doc.language}` : "",
    "",
    "Tag catalog:",
    catalog || "(empty)",
    "",
    "Document text:",
    doc.extractedText ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    tagIds: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["summary", "tagIds"],
} as const;

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: env.geminiApiKey });
  return client;
}

async function callGemini(prompt: string): Promise<{
  summary: string;
  tagIds: string[];
}> {
  const res = await getClient().models.generateContent({
    model: env.aiSuggestionsModel,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });
  const parsed: unknown = JSON.parse(res.text ?? "");
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { summary?: unknown }).summary !== "string" ||
    !Array.isArray((parsed as { tagIds?: unknown }).tagIds)
  ) {
    throw new Error("Malformed model response");
  }
  const p = parsed as { summary: string; tagIds: unknown[] };
  return {
    summary: p.summary.trim(),
    tagIds: p.tagIds.filter((t): t is string => typeof t === "string"),
  };
}

// ─── Generation ──────────────────────────────────────────────────────
/**
 * Generate (or regenerate) suggestions for a document. Throws
 * AiSuggestionError for caller-fixable conditions; model/API failures
 * are captured as a `failed` row and returned, not thrown.
 */
export async function generateForDocument(
  documentId: string,
): Promise<repo.AiSuggestionRow> {
  if (!isEnabled()) {
    throw new AiSuggestionError("ai_disabled", "AI suggestions are disabled");
  }
  const doc = await repo.findDocContext(documentId);
  if (!doc) throw new AiSuggestionError("not_found", "Document not found");
  if (!doc.extractedText || doc.extractedText.trim().length === 0) {
    throw new AiSuggestionError(
      "no_extracted_text",
      "Document has no extracted text",
    );
  }
  const tags = await repo.listTagCatalog();
  try {
    const out = await callGemini(buildPrompt(doc, tags));
    const validIds = new Set(tags.map((t) => t.id));
    const tagIds = Array.from(
      new Set(out.tagIds.filter((id) => validIds.has(id))),
    ).slice(0, 5);
    const row = await repo.upsertForDocument({
      documentId,
      summary: out.summary,
      suggestedTagIds: tagIds,
      status: "pending",
    });
    // actorId MUST be null: notify() suppresses self-notifications, and
    // the recipient here is the uploader themself. The "actor" is the AI.
    await notificationsService.notify({
      recipientId: doc.ownerId,
      actorId: null,
      type: "document.ai_suggestions_ready",
      subjectType: "document",
      subjectId: documentId,
      body: `AI suggestions are ready for "${doc.title}".`,
      url: `/documents/${documentId}`,
    });
    return row;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed";
    logger.warn({ err, documentId }, "ai suggestion generation failed");
    return repo.upsertForDocument({
      documentId,
      summary: "",
      suggestedTagIds: [],
      status: "failed",
      error: message,
    });
  }
}

/**
 * Fire-and-forget wrapper for the upload hook. Never throws; silently
 * no-ops when disabled or when the doc has no extracted text.
 */
export async function generateForDocumentSafe(
  documentId: string,
): Promise<void> {
  try {
    if (!isEnabled()) return;
    const doc = await repo.findDocContext(documentId);
    if (!doc?.extractedText?.trim()) return;
    await generateForDocument(documentId);
  } catch (err) {
    logger.warn({ err, documentId }, "ai suggestion hook failed (swallowed)");
  }
}

// ─── Review API ──────────────────────────────────────────────────────
function toDTO(r: repo.AiSuggestionRow, tagNames: Map<string, string>): AiSuggestionDTO {
  return {
    id: r.id,
    status: r.status,
    summary: r.summary,
    suggestedTags: r.suggestedTagIds.map((id) => ({
      id,
      name: tagNames.get(id) ?? "",
    })),
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
  };
}

async function requireEditableDoc(
  documentId: string,
  user: AuthenticatedUser,
): Promise<repo.DocContextRow> {
  const doc = await repo.findDocContext(documentId);
  if (!doc) throw new AiSuggestionError("not_found", "Document not found");
  const permObj = {
    uploaderId: doc.uploaderId,
    ownerId: doc.ownerId,
    visibility: doc.visibility,
    courseId: doc.courseId,
    status: doc.status,
  };
  if (!permissions.canEdit(permObj, user)) {
    throw new AiSuggestionError("forbidden", "Not allowed");
  }
  return doc;
}

async function envelope(
  doc: repo.DocContextRow,
  rowOrNull: repo.AiSuggestionRow | null,
): Promise<AiSuggestionEnvelope> {
  let suggestion: AiSuggestionDTO | null = null;
  if (rowOrNull) {
    const tags = await repo.listTagCatalog();
    suggestion = toDTO(rowOrNull, new Map(tags.map((t) => [t.id, t.name])));
  }
  return {
    enabled: isEnabled(),
    hasExtractedText: !!doc.extractedText?.trim(),
    suggestion,
  };
}

export async function getForDocument(
  documentId: string,
  user: AuthenticatedUser,
): Promise<AiSuggestionEnvelope> {
  const doc = await requireEditableDoc(documentId, user);
  const row = await repo.findByDocument(documentId);
  return envelope(doc, row);
}

export interface AcceptInput {
  acceptSummary: boolean;
  tagIds: string[];
}

export async function accept(
  documentId: string,
  user: AuthenticatedUser,
  input: AcceptInput,
): Promise<AiSuggestionEnvelope> {
  const doc = await requireEditableDoc(documentId, user);
  const row = await repo.findByDocument(documentId);
  if (!row) throw new AiSuggestionError("no_suggestion", "No suggestion");
  if (row.status !== "pending") {
    throw new AiSuggestionError("not_pending", "Suggestion already resolved");
  }
  // Only tags that were actually suggested may be accepted.
  const suggested = new Set(row.suggestedTagIds);
  const tagIds = Array.from(new Set(input.tagIds.filter((id) => suggested.has(id))));
  const updated = await repo.applyAcceptance({
    documentId,
    summary: input.acceptSummary ? row.summary : null,
    tagIds,
  });
  return envelope(doc, updated);
}

export async function dismiss(
  documentId: string,
  user: AuthenticatedUser,
): Promise<AiSuggestionEnvelope> {
  const doc = await requireEditableDoc(documentId, user);
  const row = await repo.findByDocument(documentId);
  if (!row) throw new AiSuggestionError("no_suggestion", "No suggestion");
  if (row.status !== "pending") {
    throw new AiSuggestionError("not_pending", "Suggestion already resolved");
  }
  const updated = await repo.markDismissed(documentId);
  return envelope(doc, updated);
}

export async function generateViaApi(
  documentId: string,
  user: AuthenticatedUser,
): Promise<AiSuggestionEnvelope> {
  const doc = await requireEditableDoc(documentId, user);
  if (!isEnabled()) {
    throw new AiSuggestionError("ai_disabled", "AI suggestions are disabled");
  }
  const row = await generateForDocument(documentId);
  return envelope(doc, row);
}
```

Note: check how `logger` is imported in `notifications.service.ts` (`import { logger } from "../lib/logger"`) — same path here. If `permissions.canEdit`'s parameter type differs from the inline `permObj`, match the existing call shape used in `documents.service.ts` (~line 206).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @workspace/api-server exec vitest run src/services/ai-suggestions.service.test.ts`
Expected: all tests PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @workspace/api-server run typecheck`
Expected: PASS

```bash
git add artifacts/api-server/src/services/ai-suggestions.service.ts artifacts/api-server/src/services/ai-suggestions.service.test.ts artifacts/api-server/package.json pnpm-lock.yaml
git commit -m "feat(api): Gemini-backed ai-suggestions service"
```

---

### Task 5: Upload trigger

**Files:**
- Modify: `artifacts/api-server/src/services/documents.service.ts` (~line 1247, right after the `requests.service` fire-and-forget block)
- Test: extend `artifacts/api-server/src/services/ai-suggestions.service.test.ts` (already covers `generateForDocumentSafe`); upload-side wiring verified by existing upload tests still passing

- [ ] **Step 1: Add the hook**

In `uploadDocuments()`, immediately after the existing `void import("./requests.service")...catch(() => {})` block (~line 1247), add:

```ts
      // AI suggestions (design 2026-06-10): best-effort background
      // summary + tag generation. Dynamic import keeps the Gemini SDK
      // off the upload path; generateForDocumentSafe never throws and
      // no-ops when GEMINI_API_KEY is unset or no text was extracted.
      void import("./ai-suggestions.service")
        .then((m) => m.generateForDocumentSafe(insertedDoc.id))
        .catch(() => {});
```

- [ ] **Step 2: Run the existing upload tests to verify nothing broke**

Run: `pnpm --filter @workspace/api-server exec vitest run src/services/documents.upload.test.ts src/services/documents.studentUpload.test.ts`
Expected: PASS (the hook is a dynamic import that resolves lazily; if a test fails because the new module loads `@google/genai`, mock `./ai-suggestions.service` in that test file with `vi.mock("./ai-suggestions.service", () => ({ generateForDocumentSafe: vi.fn(async () => {}) }))`).

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/services/documents.service.ts
git commit -m "feat(api): trigger AI suggestions after upload (fire-and-forget)"
```

---

### Task 6: Routes

**Files:**
- Create: `artifacts/api-server/src/routes/ai-suggestions.ts`
- Modify: `artifacts/api-server/src/routes/index.ts` (register router — follow how `reputationRouter` is imported/used)

- [ ] **Step 1: Write the router**

`artifacts/api-server/src/routes/ai-suggestions.ts`:

```ts
import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import * as aiSuggestionsService from "../services/ai-suggestions.service";
import { AiSuggestionError } from "../services/ai-suggestions.service";

const router: IRouter = Router();

const IdParams = z.object({ id: z.string().uuid() });

const AcceptBody = z.object({
  acceptSummary: z.boolean(),
  tagIds: z.array(z.string().uuid()).max(5).default([]),
});

/** Map service error codes to HTTP statuses. */
function statusFor(err: AiSuggestionError): number {
  switch (err.code) {
    case "forbidden":
      return 403;
    case "not_found":
    case "no_suggestion":
      return 404;
    case "not_pending":
      return 409;
    case "no_extracted_text":
    case "ai_disabled":
      return 422;
  }
}

function handle(
  fn: (req: Parameters<Parameters<IRouter["get"]>[2]>[0]) => Promise<unknown>,
): Parameters<IRouter["get"]>[2] {
  return async (req, res, next) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      if (err instanceof AiSuggestionError) {
        res.status(statusFor(err)).json({ error: err.code, message: err.message });
        return;
      }
      next(err);
    }
  };
}

router.get(
  "/documents/:id/ai-suggestions",
  requireAuth,
  handle(async (req) => {
    const { id } = IdParams.parse(req.params);
    return aiSuggestionsService.getForDocument(id, req.authUser!);
  }),
);

router.post(
  "/documents/:id/ai-suggestions/accept",
  requireAuth,
  handle(async (req) => {
    const { id } = IdParams.parse(req.params);
    const body = AcceptBody.parse(req.body);
    return aiSuggestionsService.accept(id, req.authUser!, body);
  }),
);

router.post(
  "/documents/:id/ai-suggestions/dismiss",
  requireAuth,
  handle(async (req) => {
    const { id } = IdParams.parse(req.params);
    return aiSuggestionsService.dismiss(id, req.authUser!);
  }),
);

router.post(
  "/documents/:id/ai-suggestions/generate",
  requireAuth,
  handle(async (req) => {
    const { id } = IdParams.parse(req.params);
    return aiSuggestionsService.generateViaApi(id, req.authUser!);
  }),
);

export default router;
```

If the `handle` helper's typing fights Express 5's types, fall back to the house pattern used in `routes/notifications.ts` — explicit `async (req, res, next) => { try { ... } catch (err) { ... } }` per route with the same `AiSuggestionError` → status mapping inline.

- [ ] **Step 2: Register the router**

In `artifacts/api-server/src/routes/index.ts`, add alongside the existing imports/uses (mirroring `reputationRouter`):

```ts
import aiSuggestionsRouter from "./ai-suggestions";
// ... where the other routers are mounted:
router.use(aiSuggestionsRouter);
```

(Match the exact mounting style used for the other routers in that file — some codebases `router.use("/", x)`.)

- [ ] **Step 3: Typecheck, run the service tests, commit**

Run: `pnpm --filter @workspace/api-server run typecheck && pnpm --filter @workspace/api-server exec vitest run src/services/ai-suggestions.service.test.ts`
Expected: PASS

```bash
git add artifacts/api-server/src/routes/ai-suggestions.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat(api): AI suggestion review endpoints"
```

---

### Task 7: Expose `aiSummary` on the document DTO

**Files:**
- Modify: `artifacts/api-server/src/services/documents.service.ts` (DTO interface ~line 37–119; `assembleDocuments` mapping ~line 187–231)
- Modify: `artifacts/api-server/src/repositories/documents.repo.ts` (the `DocumentRow` type + any explicit `select` that feeds `assembleDocuments` — grep for `DocumentRow`)

- [ ] **Step 1: Add the field to `DocumentDTO`**

In the interface (after `description: string;`):

```ts
  /**
   * Uploader-accepted AI-generated summary (design 2026-06-10).
   * Empty/absent until the owner accepts a suggestion. Rendered with
   * an explicit "AI-generated" label — distinct from `description`.
   */
  aiSummary?: string;
```

- [ ] **Step 2: Map it in `assembleDocuments`**

In the `docs.map((d) => { ... })` body, after the `if (d.reviewReason)` line:

```ts
    if (d.aiSummary) dto.aiSummary = d.aiSummary;
```

- [ ] **Step 3: Extend the repo row type**

In `documents.repo.ts`, find the `DocumentRow` interface/type and add `aiSummary: string;` (and add `aiSummary: true` to any explicit Prisma `select` used by the queries that return `DocumentRow`; if the repo selects whole rows without `select`, no query change is needed).

- [ ] **Step 4: Typecheck, run document service tests, commit**

Run: `pnpm --filter @workspace/api-server run typecheck && pnpm --filter @workspace/api-server exec vitest run src/services/documents.service.test.ts src/services/documents.access.test.ts`
Expected: PASS

```bash
git add artifacts/api-server/src/services/documents.service.ts artifacts/api-server/src/repositories/documents.repo.ts
git commit -m "feat(api): surface accepted aiSummary on document DTOs"
```

---

### Task 8: OpenAPI spec + client codegen

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (paths near the other `/documents/{id}/...` entries ~line 535+; schemas in `components.schemas`)
- Generated: `lib/api-client-react/src/generated/*` (via codegen, do not hand-edit)

- [ ] **Step 1: Add schemas**

In `components.schemas` (match the file's existing indentation/style; check a sibling schema like the reputation ones at ~line 1772 for reference):

```yaml
    AiSuggestionTag:
      type: object
      required: [id, name]
      properties:
        id: { type: string, format: uuid }
        name: { type: string }
    AiSuggestion:
      type: object
      required: [id, status, summary, suggestedTags, createdAt]
      properties:
        id: { type: string, format: uuid }
        status:
          type: string
          enum: [pending, accepted, dismissed, failed]
        summary: { type: string }
        suggestedTags:
          type: array
          items: { $ref: "#/components/schemas/AiSuggestionTag" }
        error: { type: string, nullable: true }
        createdAt: { type: string, format: date-time }
        resolvedAt: { type: string, format: date-time, nullable: true }
    AiSuggestionEnvelope:
      type: object
      required: [enabled, hasExtractedText, suggestion]
      properties:
        enabled: { type: boolean }
        hasExtractedText: { type: boolean }
        suggestion:
          oneOf:
            - $ref: "#/components/schemas/AiSuggestion"
            - type: "null"
    AcceptAiSuggestionRequest:
      type: object
      required: [acceptSummary]
      properties:
        acceptSummary: { type: boolean }
        tagIds:
          type: array
          maxItems: 5
          items: { type: string, format: uuid }
```

Also add to the existing `Document` / `DocumentDetail` schema's properties (wherever `description` is defined):

```yaml
        aiSummary:
          type: string
          description: Uploader-accepted AI-generated summary (may be absent/empty).
```

- [ ] **Step 2: Add paths**

Near the other `/documents/{id}/...` paths (~line 535+), following the file's parameter/response conventions:

```yaml
  /documents/{id}/ai-suggestions:
    get:
      tags: [documents]
      summary: Get AI suggestion state for a document (owner only)
      operationId: getDocumentAiSuggestions
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200":
          description: Suggestion envelope
          content:
            application/json:
              schema: { $ref: "#/components/schemas/AiSuggestionEnvelope" }
  /documents/{id}/ai-suggestions/accept:
    post:
      tags: [documents]
      summary: Accept the pending AI suggestion (summary and/or tags)
      operationId: acceptDocumentAiSuggestions
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string, format: uuid }
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/AcceptAiSuggestionRequest" }
      responses:
        "200":
          description: Updated envelope
          content:
            application/json:
              schema: { $ref: "#/components/schemas/AiSuggestionEnvelope" }
  /documents/{id}/ai-suggestions/dismiss:
    post:
      tags: [documents]
      summary: Dismiss the pending AI suggestion
      operationId: dismissDocumentAiSuggestions
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200":
          description: Updated envelope
          content:
            application/json:
              schema: { $ref: "#/components/schemas/AiSuggestionEnvelope" }
  /documents/{id}/ai-suggestions/generate:
    post:
      tags: [documents]
      summary: Generate (or regenerate) AI suggestions for a document
      operationId: generateDocumentAiSuggestions
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200":
          description: Envelope with the fresh suggestion (pending or failed)
          content:
            application/json:
              schema: { $ref: "#/components/schemas/AiSuggestionEnvelope" }
```

- [ ] **Step 3: Run codegen**

Run: `pnpm --filter @workspace/api-spec run codegen`
Expected: regenerates `lib/api-client-react/src/generated/*` and the workspace typecheck inside the script passes. New hooks exist: `useGetDocumentAiSuggestions`, `useAcceptDocumentAiSuggestions`, `useDismissDocumentAiSuggestions`, `useGenerateDocumentAiSuggestions`.

- [ ] **Step 4: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react/src/generated
git commit -m "feat(api-spec): AI suggestion endpoints + generated client hooks"
```

---

### Task 9: Web UI

**Files:**
- Create: `artifacts/web/src/components/document-detail/AiSuggestionsCard.tsx`
- Modify: `artifacts/web/src/pages/document-detail.tsx` (render the card; page fetches `doc` at ~line 83)
- Modify: `artifacts/web/src/components/document-detail/MetadataPanel.tsx` (render accepted `aiSummary`)
- Modify: `artifacts/web/src/pages/notifications.tsx` (`typeLabel()` ~line 16–25)
- Modify: `artifacts/web/src/i18n/locales/en.json`, `artifacts/web/src/i18n/locales/he.json`

- [ ] **Step 1: Add i18n strings**

In `en.json` (top-level namespace, matching existing structure):

```json
"aiSuggestions": {
  "title": "AI suggestions",
  "summaryLabel": "Suggested summary",
  "useSummary": "Use this summary",
  "tagsLabel": "Suggested tags",
  "accept": "Accept selected",
  "dismiss": "Dismiss",
  "generate": "Generate AI suggestions",
  "generating": "Generating…",
  "failed": "AI suggestion generation failed. You can try again.",
  "aiSummaryBadge": "AI-generated summary",
  "notificationReady": "AI suggestions are ready"
}
```

In `he.json`:

```json
"aiSuggestions": {
  "title": "הצעות בינה מלאכותית",
  "summaryLabel": "תקציר מוצע",
  "useSummary": "השתמש בתקציר זה",
  "tagsLabel": "תגיות מוצעות",
  "accept": "אשר את הנבחרים",
  "dismiss": "דחה",
  "generate": "צור הצעות AI",
  "generating": "יוצר…",
  "failed": "יצירת הצעות ה-AI נכשלה. אפשר לנסות שוב.",
  "aiSummaryBadge": "תקציר שנוצר על ידי AI",
  "notificationReady": "הצעות AI מוכנות"
}
```

- [ ] **Step 2: Write `AiSuggestionsCard.tsx`**

```tsx
import { useState } from "react";
import {
  useGetDocumentAiSuggestions,
  useAcceptDocumentAiSuggestions,
  useDismissDocumentAiSuggestions,
  useGenerateDocumentAiSuggestions,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Props {
  documentId: string;
  /** Server-computed permission flag — card is owner/admin only. */
  canEdit: boolean;
}

/**
 * Owner-only review card for pending AI suggestions (design 2026-06-10).
 * Renders nothing when the feature is disabled server-side, the doc has
 * no extracted text, or the suggestion is already resolved (accepted/
 * dismissed). A failed or absent suggestion shows a Generate button.
 */
export default function AiSuggestionsCard({ documentId, canEdit }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useGetDocumentAiSuggestions(documentId, {
    query: { enabled: canEdit },
  });
  const [useSummary, setUseSummary] = useState(true);
  const [selectedTagIds, setSelectedTagIds] = useState<string[] | null>(null);

  const invalidate = () => {
    void refetch();
    // Accepted tags/summary change the document DTO — refetch it.
    void queryClient.invalidateQueries();
  };
  const acceptMutation = useAcceptDocumentAiSuggestions({
    mutation: { onSuccess: invalidate },
  });
  const dismissMutation = useDismissDocumentAiSuggestions({
    mutation: { onSuccess: invalidate },
  });
  const generateMutation = useGenerateDocumentAiSuggestions({
    mutation: { onSuccess: invalidate },
  });

  if (!canEdit || isLoading || !data || !data.enabled) return null;

  const suggestion = data.suggestion;
  const resolved =
    suggestion?.status === "accepted" || suggestion?.status === "dismissed";

  // No pending suggestion: offer manual generation when possible.
  if (!suggestion || suggestion.status === "failed") {
    if (!data.hasExtractedText || resolved) return null;
    return (
      <div className="rounded-lg border p-4 mb-4" data-testid="ai-suggestions-card">
        {suggestion?.status === "failed" && (
          <p className="text-sm text-muted-foreground mb-2">
            {t("aiSuggestions.failed")}
          </p>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={generateMutation.isPending}
          onClick={() => generateMutation.mutate({ id: documentId })}
          data-testid="ai-suggestions-generate"
        >
          <Sparkles className="h-4 w-4 me-1" />
          {generateMutation.isPending
            ? t("aiSuggestions.generating")
            : t("aiSuggestions.generate")}
        </Button>
      </div>
    );
  }

  if (suggestion.status !== "pending") return null;

  const tagIds =
    selectedTagIds ?? suggestion.suggestedTags.map((tag) => tag.id);
  const toggleTag = (id: string) =>
    setSelectedTagIds(
      tagIds.includes(id) ? tagIds.filter((x) => x !== id) : [...tagIds, id],
    );

  return (
    <div className="rounded-lg border p-4 mb-4" data-testid="ai-suggestions-card">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="h-4 w-4" />
        <h3 className="font-semibold">{t("aiSuggestions.title")}</h3>
      </div>
      {suggestion.summary && (
        <div className="mb-3">
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={useSummary}
              onCheckedChange={(v) => setUseSummary(v === true)}
              data-testid="ai-suggestions-use-summary"
            />
            <span>
              <span className="font-medium block mb-1">
                {t("aiSuggestions.summaryLabel")}
              </span>
              <span className="text-muted-foreground">{suggestion.summary}</span>
            </span>
          </label>
        </div>
      )}
      {suggestion.suggestedTags.length > 0 && (
        <div className="mb-3">
          <p className="text-sm font-medium mb-1">{t("aiSuggestions.tagsLabel")}</p>
          <div className="flex flex-wrap gap-1">
            {suggestion.suggestedTags.map((tag) => (
              <Badge
                key={tag.id}
                variant={tagIds.includes(tag.id) ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => toggleTag(tag.id)}
                data-testid={`ai-suggestions-tag-${tag.id}`}
              >
                {tag.name}
              </Badge>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={acceptMutation.isPending || (!useSummary && tagIds.length === 0)}
          onClick={() =>
            acceptMutation.mutate({
              id: documentId,
              data: { acceptSummary: useSummary, tagIds },
            })
          }
          data-testid="ai-suggestions-accept"
        >
          {t("aiSuggestions.accept")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={dismissMutation.isPending}
          onClick={() => dismissMutation.mutate({ id: documentId })}
          data-testid="ai-suggestions-dismiss"
        >
          {t("aiSuggestions.dismiss")}
        </Button>
      </div>
    </div>
  );
}
```

**Adapt to reality:** the generated mutation call shapes (`{ id, data }` vs positional) come from orval — check a neighbouring generated mutation usage (e.g. in `EditMetadataModal.tsx`) and match it. If there is no `Checkbox` ui component, use the same pattern the codebase uses elsewhere (grep `components/ui/checkbox`); a plain `<input type="checkbox">` styled like nearby forms is an acceptable fallback.

- [ ] **Step 3: Render the card on the document detail page**

In `artifacts/web/src/pages/document-detail.tsx`, import and place the card above/near `MetadataPanel` (inside the main column), passing the server-computed flag:

```tsx
import AiSuggestionsCard from "@/components/document-detail/AiSuggestionsCard";
// ... inside the render, right before <MetadataPanel ... />:
<AiSuggestionsCard documentId={doc.id} canEdit={doc.permissions.canEdit} />
```

- [ ] **Step 4: Render the accepted summary in `MetadataPanel.tsx`**

Where the description is rendered (locate `doc.description` in the component), add after it:

```tsx
{doc.aiSummary ? (
  <div className="mt-3" data-testid="ai-summary">
    <Badge variant="secondary" className="mb-1">
      <Sparkles className="h-3 w-3 me-1" />
      {t("aiSuggestions.aiSummaryBadge")}
    </Badge>
    <p className="text-sm text-muted-foreground">{doc.aiSummary}</p>
  </div>
) : null}
```

(Add `Sparkles` to the existing `lucide-react` import.)

- [ ] **Step 5: Notification label**

In `artifacts/web/src/pages/notifications.tsx` `typeLabel()` add a case mapping `"document.ai_suggestions_ready"` → `t("aiSuggestions.notificationReady")` (match the function's existing return style).

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @workspace/web run typecheck` (if the web package has no typecheck script, run root `pnpm run typecheck`)
Expected: PASS

```bash
git add artifacts/web/src
git commit -m "feat(web): AI suggestions review card, aiSummary display, i18n"
```

---

### Task 10: Final verification

**Files:** none

- [ ] **Step 1: Full typecheck + test suite**

Run: `pnpm run typecheck && pnpm --filter @workspace/api-server run test`
Expected: PASS, zero failures.

- [ ] **Step 2: Spec-coverage sanity check**

Confirm against the spec (`docs/superpowers/specs/2026-06-10-ai-summary-tag-suggestions-design.md`): fire-and-forget trigger ✓, Gemini structured output ✓, pending/accept/dismiss/failed lifecycle ✓, notification with `actorId: null` ✓, owner-gated endpoints ✓, `aiSummary` on DTO + MetadataPanel ✓, Generate fallback button ✓, i18n en+he ✓, disabled-without-key behavior ✓.

- [ ] **Step 3: Commit any stragglers**

```bash
git status
git add -A
git commit -m "chore: ai-suggestions loose ends" # only if anything is left
```
