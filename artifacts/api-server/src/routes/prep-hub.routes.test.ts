import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

// Mock every service the prep-hub router (and its guards) import so the test
// exercises only HTTP wiring and stays hermetic (no real services / DB).
vi.mock("../services/auth.service", () => ({
  loadAuthenticatedUser: vi.fn(),
}));
vi.mock("../services/permissions.service", () => ({
  canUseCollections: vi.fn(),
}));
vi.mock("../services/prep-hub.service", () => ({
  listDiscoverable: vi.fn(),
  listTrending: vi.fn(),
  getRecommendedCollections: vi.fn(),
  listFollowed: vi.fn(),
  getPublicCollection: vi.fn(),
  followCollection: vi.fn(),
  unfollowCollection: vi.fn(),
}));
vi.mock("../services/collection-engagement.service", () => ({
  likeCollection: vi.fn(),
  unlikeCollection: vi.fn(),
  rateCollection: vi.fn(),
  clearRating: vi.fn(),
}));
vi.mock("../services/collection-comments.service", () => ({
  listComments: vi.fn(),
  createComment: vi.fn(),
  editComment: vi.fn(),
  deleteComment: vi.fn(),
}));

import * as authService from "../services/auth.service";
import * as permissions from "../services/permissions.service";
import * as prepHubService from "../services/prep-hub.service";
import * as engagementService from "../services/collection-engagement.service";
import * as commentsService from "../services/collection-comments.service";
import prepHubRouter from "./prep-hub";
import type { AuthenticatedUser } from "../middlewares/auth";
import { createTestApp, authedAgent } from "../test/http-harness";

const app = createTestApp("/api", prepHubRouter);
const loadAuthenticatedUser = vi.mocked(authService.loadAuthenticatedUser);
const canUseCollections = vi.mocked(permissions.canUseCollections);
const listDiscoverable = vi.mocked(prepHubService.listDiscoverable);
const followCollection = vi.mocked(prepHubService.followCollection);
const rateCollection = vi.mocked(engagementService.rateCollection);
const createComment = vi.mocked(commentsService.createComment);
const deleteComment = vi.mocked(commentsService.deleteComment);

const UUID = "44444444-4444-4444-8444-444444444444";

const user: AuthenticatedUser = {
  id: "user-1",
  email: "a@b.com",
  displayName: "Tester",
  isActive: true,
  primaryRole: "student",
  roles: ["student"],
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

describe("GET /api/prep-hub/collections (discover, requireAuth only)", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/prep-hub/collections");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: "unauthorized" });
  });

  it("returns the discover list for any authenticated user", async () => {
    listDiscoverable.mockResolvedValueOnce([{ id: UUID }] as never);
    const agent = await authedAgent(app, "user-1");

    const res = await agent.get("/api/prep-hub/collections");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: UUID }]);
  });

  it("returns 400 for an invalid sort value", async () => {
    const agent = await authedAgent(app, "user-1");

    const res = await agent.get("/api/prep-hub/collections?sort=bogus");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
    expect(listDiscoverable).not.toHaveBeenCalled();
  });
});

describe("POST /api/prep-hub/collections/:id/follow (collections-access gate)", () => {
  it("returns 403 when the account cannot use collections", async () => {
    canUseCollections.mockReturnValue(false);
    const agent = await authedAgent(app, "user-1");

    const res = await agent.post(`/api/prep-hub/collections/${UUID}/follow`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: "forbidden" });
    expect(followCollection).not.toHaveBeenCalled();
  });

  it("follows the collection when permitted", async () => {
    followCollection.mockResolvedValueOnce({ following: true } as never);
    const agent = await authedAgent(app, "user-1");

    const res = await agent.post(`/api/prep-hub/collections/${UUID}/follow`);

    expect(res.status).toBe(200);
    expect(followCollection).toHaveBeenCalledWith(
      UUID,
      expect.objectContaining({ id: "user-1" }),
    );
  });
});

describe("PUT /api/prep-hub/collections/:id/rating", () => {
  it("returns 400 for an out-of-range rating", async () => {
    const agent = await authedAgent(app, "user-1");

    const res = await agent
      .put(`/api/prep-hub/collections/${UUID}/rating`)
      .send({ value: 6 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
    expect(rateCollection).not.toHaveBeenCalled();
  });

  it("records a valid rating", async () => {
    rateCollection.mockResolvedValueOnce({ value: 4 } as never);
    const agent = await authedAgent(app, "user-1");

    const res = await agent
      .put(`/api/prep-hub/collections/${UUID}/rating`)
      .send({ value: 4 });

    expect(res.status).toBe(200);
    expect(rateCollection).toHaveBeenCalledWith(
      UUID,
      expect.objectContaining({ id: "user-1" }),
      4,
    );
  });
});

describe("comments", () => {
  it("returns 400 when posting an empty comment body", async () => {
    const agent = await authedAgent(app, "user-1");

    const res = await agent
      .post(`/api/prep-hub/collections/${UUID}/comments`)
      .send({ body: "" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
    expect(createComment).not.toHaveBeenCalled();
  });

  it("creates a comment and returns 201", async () => {
    createComment.mockResolvedValueOnce({ id: UUID, body: "Nice" } as never);
    const agent = await authedAgent(app, "user-1");

    const res = await agent
      .post(`/api/prep-hub/collections/${UUID}/comments`)
      .send({ body: "Nice" });

    expect(res.status).toBe(201);
    expect(createComment).toHaveBeenCalledWith(
      UUID,
      expect.objectContaining({ id: "user-1" }),
      "Nice",
    );
  });

  it("deletes a comment and returns 204", async () => {
    deleteComment.mockResolvedValueOnce(undefined as never);
    const agent = await authedAgent(app, "user-1");

    const res = await agent.delete(`/api/prep-hub/collections/comments/${UUID}`);

    expect(res.status).toBe(204);
    expect(deleteComment).toHaveBeenCalledWith(
      UUID,
      expect.objectContaining({ id: "user-1" }),
    );
  });
});
