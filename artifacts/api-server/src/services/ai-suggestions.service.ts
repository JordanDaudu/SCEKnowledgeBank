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
  /** Proposed brand-new tag names not yet in the catalog. */
  suggestedNewTags: string[];
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
    "Then pick up to 5 tags from the catalog that genuinely fit the document (field `tagIds`). Only use tag ids that appear in the catalog; return an empty list if none fit.",
    "If the document covers an important topic that NO catalog tag captures, you may propose up to 3 short, new tag names in `newTags` (1-3 words each, in the document's language, lowercase unless a proper noun). Do not propose a new tag that merely restates one already in the catalog. Return an empty list when the catalog is sufficient.",
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
    newTags: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["summary", "tagIds", "newTags"],
} as const;

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: env.geminiApiKey });
  return client;
}

async function callGemini(prompt: string): Promise<{
  summary: string;
  tagIds: string[];
  newTags: string[];
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
  const p = parsed as { summary: string; tagIds: unknown[]; newTags?: unknown };
  return {
    summary: p.summary.trim(),
    tagIds: p.tagIds.filter((t): t is string => typeof t === "string"),
    // newTags is optional defensively: a model that omits it shouldn't fail.
    newTags: Array.isArray(p.newTags)
      ? p.newTags.filter((t): t is string => typeof t === "string")
      : [],
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
    // New-tag proposals: trim, drop empties, dedupe case-insensitively,
    // and drop any that already exist in the catalog (the model should
    // have used the existing tag — never propose a duplicate label).
    const existingNames = new Set(tags.map((t) => t.name.toLowerCase()));
    const seen = new Set<string>();
    const newTags: string[] = [];
    for (const raw of out.newTags) {
      const name = raw.trim();
      const key = name.toLowerCase();
      if (!name || existingNames.has(key) || seen.has(key)) continue;
      seen.add(key);
      newTags.push(name);
      if (newTags.length >= 3) break;
    }
    const row = await repo.upsertForDocument({
      documentId,
      summary: out.summary,
      suggestedTagIds: tagIds,
      suggestedNewTags: newTags,
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
      suggestedNewTags: [],
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
    suggestedNewTags: r.suggestedNewTags,
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
  /** New tag names the uploader chose to create (subset of suggestions). */
  newTags?: string[];
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
  // Likewise, only new-tag names that were actually proposed may be created
  // (case-insensitive match against the stored proposals).
  const suggestedNew = new Map(
    row.suggestedNewTags.map((n) => [n.toLowerCase(), n]),
  );
  const newTagNames = Array.from(
    new Set(
      (input.newTags ?? [])
        .map((n) => suggestedNew.get(n.trim().toLowerCase()))
        .filter((n): n is string => !!n),
    ),
  );
  const updated = await repo.applyAcceptance({
    documentId,
    summary: input.acceptSummary ? row.summary : null,
    tagIds,
    newTagNames,
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
