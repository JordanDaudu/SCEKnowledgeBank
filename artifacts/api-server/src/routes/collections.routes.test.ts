import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

// Mock every service the collections router (and its guards) import so the test
// exercises only HTTP wiring and stays hermetic (no real services / DB).
vi.mock("../services/auth.service", () => ({
  loadAuthenticatedUser: vi.fn(),
}));
vi.mock("../services/permissions.service", () => ({
  canUseCollections: vi.fn(),
}));
vi.mock("../services/collections.service", () => ({
  listMyCollections: vi.fn(),
  createCollection: vi.fn(),
  getCollection: vi.fn(),
  updateCollection: vi.fn(),
  deleteCollection: vi.fn(),
  duplicateCollection: vi.fn(),
  addDocument: vi.fn(),
  removeDocument: vi.fn(),
  setItemNote: vi.fn(),
  reorder: vi.fn(),
}));
vi.mock("../services/studyProgress.service", () => ({
  setProgress: vi.fn(),
  listInProgress: vi.fn(),
}));
vi.mock("../services/recommendations.service", () => ({
  getRecommendations: vi.fn(),
}));

import * as authService from "../services/auth.service";
import * as permissions from "../services/permissions.service";
import * as collectionsService from "../services/collections.service";
import * as studyProgressService from "../services/studyProgress.service";
import collectionsRouter from "./collections";
import type { AuthenticatedUser } from "../middlewares/auth";
import { createTestApp, authedAgent } from "../test/http-harness";

const app = createTestApp("/api", collectionsRouter);
const loadAuthenticatedUser = vi.mocked(authService.loadAuthenticatedUser);
const canUseCollections = vi.mocked(permissions.canUseCollections);
const listMyCollections = vi.mocked(collectionsService.listMyCollections);
const createCollection = vi.mocked(collectionsService.createCollection);
const deleteCollection = vi.mocked(collectionsService.deleteCollection);
const setProgress = vi.mocked(studyProgressService.setProgress);

const UUID = "33333333-3333-4333-8333-333333333333";

const user: AuthenticatedUser = {
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
  loadAuthenticatedUser.mockResolvedValue(user);
  canUseCollections.mockReturnValue(true);
});

describe("collections access gate", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/collections");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: "unauthorized" });
  });

  it("returns 403 when the account cannot use collections", async () => {
    canUseCollections.mockReturnValue(false);
    const agent = await authedAgent(app, "user-1");

    const res = await agent.get("/api/collections");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: "forbidden" });
    expect(listMyCollections).not.toHaveBeenCalled();
  });
});

describe("GET /api/collections", () => {
  it("lists the caller's collections", async () => {
    listMyCollections.mockResolvedValueOnce([{ id: UUID }] as never);
    const agent = await authedAgent(app, "user-1");

    const res = await agent.get("/api/collections");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: UUID }]);
    expect(listMyCollections).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-1" }),
    );
  });
});

describe("POST /api/collections", () => {
  it("returns 400 when the title is missing", async () => {
    const agent = await authedAgent(app, "user-1");

    const res = await agent.post("/api/collections").send({ description: "x" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
    expect(createCollection).not.toHaveBeenCalled();
  });

  it("creates a collection and returns 201", async () => {
    createCollection.mockResolvedValueOnce({ id: UUID, title: "Finals" } as never);
    const agent = await authedAgent(app, "user-1");

    const res = await agent.post("/api/collections").send({ title: "Finals" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: UUID, title: "Finals" });
    expect(createCollection).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-1" }),
      expect.objectContaining({ title: "Finals" }),
    );
  });
});

describe("GET /api/collections/:id", () => {
  it("returns 400 for a non-UUID id", async () => {
    const agent = await authedAgent(app, "user-1");

    const res = await agent.get("/api/collections/not-a-uuid");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });
});

describe("DELETE /api/collections/:id", () => {
  it("returns 204 on success", async () => {
    deleteCollection.mockResolvedValueOnce(undefined as never);
    const agent = await authedAgent(app, "user-1");

    const res = await agent.delete(`/api/collections/${UUID}`);

    expect(res.status).toBe(204);
    expect(deleteCollection).toHaveBeenCalledWith(
      UUID,
      expect.objectContaining({ id: "user-1" }),
    );
  });
});

describe("PUT /api/documents/:id/progress", () => {
  // This route is gated by requireAuth only (no collections-access gate).
  it("records progress and forwards the status to the service", async () => {
    setProgress.mockResolvedValueOnce({ status: "completed" } as never);
    const agent = await authedAgent(app, "user-1");

    const res = await agent
      .put(`/api/documents/${UUID}/progress`)
      .send({ status: "completed" });

    expect(res.status).toBe(200);
    expect(setProgress).toHaveBeenCalledWith(
      UUID,
      "completed",
      expect.objectContaining({ id: "user-1" }),
    );
  });
});
