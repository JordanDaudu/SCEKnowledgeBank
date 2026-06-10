import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../middlewares/auth";

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));

vi.mock("@google/genai", () => ({
  // Must be `function` (not an arrow) so the service's `new GoogleGenAI(...)`
  // works — arrow functions are not constructable.
  GoogleGenAI: vi.fn().mockImplementation(function () {
    return { models: { generateContent } };
  }),
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
  // Course-less: real permissions.canEdit only grants the uploader/owner
  // edit rights on a course-LESS doc; course-scoped docs are editable only
  // by admins / course lecturers. The owner fixture below is a plain
  // student, so a null courseId is what makes them a legitimate owner-editor.
  courseId: null,
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
