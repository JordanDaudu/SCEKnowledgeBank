import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

// Mock the services the moderation router (and its `requireAdmin` gate) use, so
// the test covers only HTTP wiring: requireAuth → requireAdmin → Zod params →
// service → response/error envelope. No real services or DB load.
vi.mock("../services/auth.service", () => ({
  loadAuthenticatedUser: vi.fn(),
}));
vi.mock("../services/permissions.service", () => ({
  isAdmin: vi.fn(),
}));
vi.mock("../services/moderation.service", () => ({
  listModeration: vi.fn(),
  hideCollection: vi.fn(),
  unhideCollection: vi.fn(),
  removeComment: vi.fn(),
}));

import * as authService from "../services/auth.service";
import * as permissions from "../services/permissions.service";
import * as moderation from "../services/moderation.service";
import moderationRouter from "./moderation";
import type { AuthenticatedUser } from "../middlewares/auth";
import { createTestApp, authedAgent } from "../test/http-harness";

const app = createTestApp("/api", moderationRouter);
const loadAuthenticatedUser = vi.mocked(authService.loadAuthenticatedUser);
const isAdmin = vi.mocked(permissions.isAdmin);
const listModeration = vi.mocked(moderation.listModeration);
const hideCollection = vi.mocked(moderation.hideCollection);
const unhideCollection = vi.mocked(moderation.unhideCollection);
const removeComment = vi.mocked(moderation.removeComment);

const UUID = "22222222-2222-4222-8222-222222222222";

const adminUser: AuthenticatedUser = {
  id: "admin-1",
  email: "admin@b.com",
  displayName: "Admin",
  isActive: true,
  primaryRole: "admin",
  roles: ["admin"],
  enrollments: [],
  username: "admin",
  avatarStoragePath: null,
  createdAt: "2025-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  loadAuthenticatedUser.mockResolvedValue(adminUser);
  isAdmin.mockReturnValue(true);
});

describe("admin gating", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/admin/collections/moderation");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: "unauthorized" });
    expect(listModeration).not.toHaveBeenCalled();
  });

  it("returns 403 for an authenticated non-admin", async () => {
    isAdmin.mockReturnValue(false);
    const agent = await authedAgent(app, "user-1");

    const res = await agent.get("/api/admin/collections/moderation");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: "forbidden" });
    expect(listModeration).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/collections/moderation", () => {
  it("returns the moderation list for an admin", async () => {
    listModeration.mockResolvedValueOnce({ items: [] } as never);
    const agent = await authedAgent(app, "admin-1");

    const res = await agent.get("/api/admin/collections/moderation");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
    expect(listModeration).toHaveBeenCalledWith(
      expect.objectContaining({ id: "admin-1" }),
      { limit: undefined },
    );
  });
});

describe("POST /api/admin/collections/:id/hide", () => {
  it("returns 400 for a non-UUID collection id", async () => {
    const agent = await authedAgent(app, "admin-1");

    const res = await agent.post("/api/admin/collections/not-a-uuid/hide").send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
    expect(hideCollection).not.toHaveBeenCalled();
  });

  it("hides the collection and forwards the reason", async () => {
    hideCollection.mockResolvedValueOnce({ id: UUID, hidden: true } as never);
    const agent = await authedAgent(app, "admin-1");

    const res = await agent
      .post(`/api/admin/collections/${UUID}/hide`)
      .send({ reason: "Spam" });

    expect(res.status).toBe(200);
    expect(hideCollection).toHaveBeenCalledWith(
      expect.objectContaining({ id: "admin-1" }),
      UUID,
      "Spam",
    );
  });
});

describe("POST /api/admin/collections/:id/unhide", () => {
  it("unhides the collection", async () => {
    unhideCollection.mockResolvedValueOnce({ id: UUID, hidden: false } as never);
    const agent = await authedAgent(app, "admin-1");

    const res = await agent.post(`/api/admin/collections/${UUID}/unhide`);

    expect(res.status).toBe(200);
    expect(unhideCollection).toHaveBeenCalledWith(
      expect.objectContaining({ id: "admin-1" }),
      UUID,
    );
  });
});

describe("DELETE /api/admin/collections/comments/:commentId", () => {
  it("returns 400 for a non-UUID comment id", async () => {
    const agent = await authedAgent(app, "admin-1");

    const res = await agent.delete("/api/admin/collections/comments/not-a-uuid");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
    expect(removeComment).not.toHaveBeenCalled();
  });

  it("removes the comment and returns 204", async () => {
    removeComment.mockResolvedValueOnce(undefined as never);
    const agent = await authedAgent(app, "admin-1");

    const res = await agent.delete(`/api/admin/collections/comments/${UUID}`);

    expect(res.status).toBe(204);
    expect(removeComment).toHaveBeenCalledWith(
      expect.objectContaining({ id: "admin-1" }),
      UUID,
    );
  });
});
