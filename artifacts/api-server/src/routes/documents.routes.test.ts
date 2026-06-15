import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

// Mock every service the documents router imports so the test exercises only
// the HTTP wiring (auth guards, Zod validation, error envelopes) and never
// loads the real services or their `@workspace/db` imports.
vi.mock("../services/auth.service", () => ({
  loadAuthenticatedUser: vi.fn(),
}));
vi.mock("../services/documents.service", () => ({
  getById: vi.fn(),
  deleteDocument: vi.fn(),
  rejectDocument: vi.fn(),
  bulkDocumentAction: vi.fn(),
  listDocuments: vi.fn(),
}));
vi.mock("../services/search.service", () => ({
  searchDocuments: vi.fn(),
  searchFacets: vi.fn(),
  autocomplete: vi.fn(),
}));
vi.mock("../services/permissions.service", () => ({
  isAdmin: vi.fn(),
  canUpload: vi.fn(),
}));
vi.mock("../services/documents/dedup.service", () => ({
  findVisibleDuplicateByChecksum: vi.fn(),
}));
vi.mock("../services/documents/suggest-metadata.service", () => ({
  suggestForUpload: vi.fn(),
}));

import * as authService from "../services/auth.service";
import * as documentsService from "../services/documents.service";
import documentsRouter from "./documents";
import { forbidden } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";
import { createTestApp, authedAgent } from "../test/http-harness";

const app = createTestApp("/api", documentsRouter);
const loadAuthenticatedUser = vi.mocked(authService.loadAuthenticatedUser);
const getById = vi.mocked(documentsService.getById);
const deleteDocument = vi.mocked(documentsService.deleteDocument);
const rejectDocument = vi.mocked(documentsService.rejectDocument);
const bulkDocumentAction = vi.mocked(documentsService.bulkDocumentAction);

const UUID = "11111111-1111-4111-8111-111111111111";

const authUser: AuthenticatedUser = {
  id: "user-1",
  email: "a@b.com",
  displayName: "Tester",
  isActive: true,
  primaryRole: "lecturer",
  roles: ["lecturer"],
  enrollments: [],
  username: "tester",
  avatarStoragePath: null,
  createdAt: "2025-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  // Every authenticated request re-resolves the user via attachUser.
  loadAuthenticatedUser.mockResolvedValue(authUser);
});

describe("auth guard", () => {
  it("rejects an unauthenticated GET /api/documents with 401", async () => {
    const res = await request(app).get("/api/documents");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: "unauthorized" });
  });
});

describe("GET /api/documents/:id", () => {
  it("returns 400 with a validation envelope for a non-UUID id", async () => {
    const agent = await authedAgent(app, "user-1");

    const res = await agent.get("/api/documents/not-a-uuid");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
    expect(getById).not.toHaveBeenCalled();
  });

  it("returns the document DTO and passes the auth user to the service", async () => {
    getById.mockResolvedValueOnce({ id: UUID, title: "Doc" } as never);
    const agent = await authedAgent(app, "user-1");

    const res = await agent.get(`/api/documents/${UUID}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: UUID, title: "Doc" });
    expect(getById).toHaveBeenCalledWith(UUID, expect.objectContaining({ id: "user-1" }));
  });

  it("propagates a service forbidden() as a 403 envelope", async () => {
    getById.mockRejectedValueOnce(forbidden("No access to this document"));
    const agent = await authedAgent(app, "user-1");

    const res = await agent.get(`/api/documents/${UUID}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: "forbidden" });
  });
});

describe("DELETE /api/documents/:id", () => {
  it("returns 204 on success", async () => {
    deleteDocument.mockResolvedValueOnce(undefined as never);
    const agent = await authedAgent(app, "user-1");

    const res = await agent.delete(`/api/documents/${UUID}`);

    expect(res.status).toBe(204);
    expect(deleteDocument).toHaveBeenCalledWith(UUID, expect.objectContaining({ id: "user-1" }));
  });
});

describe("POST /api/documents/:id/reject", () => {
  it("returns 400 when the reason is missing", async () => {
    const agent = await authedAgent(app, "user-1");

    const res = await agent.post(`/api/documents/${UUID}/reject`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
    expect(rejectDocument).not.toHaveBeenCalled();
  });

  it("rejects the document and forwards the reason to the service", async () => {
    rejectDocument.mockResolvedValueOnce({ id: UUID, status: "rejected" } as never);
    const agent = await authedAgent(app, "user-1");

    const res = await agent
      .post(`/api/documents/${UUID}/reject`)
      .send({ reason: "Out of scope" });

    expect(res.status).toBe(200);
    expect(rejectDocument).toHaveBeenCalledWith(
      UUID,
      "Out of scope",
      expect.objectContaining({ id: "user-1" }),
    );
  });
});

describe("POST /api/documents/bulk", () => {
  it("returns 400 for an empty id list", async () => {
    const agent = await authedAgent(app, "user-1");

    const res = await agent
      .post("/api/documents/bulk")
      .send({ action: "delete", ids: [] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
    expect(bulkDocumentAction).not.toHaveBeenCalled();
  });

  it("runs the bulk action and returns the per-id results", async () => {
    bulkDocumentAction.mockResolvedValueOnce([{ id: UUID, ok: true }] as never);
    const agent = await authedAgent(app, "user-1");

    const res = await agent
      .post("/api/documents/bulk")
      .send({ action: "delete", ids: [UUID] });

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([{ id: UUID, ok: true }]);
    expect(bulkDocumentAction).toHaveBeenCalledTimes(1);
  });
});
