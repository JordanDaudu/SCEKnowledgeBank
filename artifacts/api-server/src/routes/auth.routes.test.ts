import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

// Mock the service layer so these tests exercise only the HTTP wiring:
// routing, Zod validation, auth guards, session, and error envelopes. The same
// mocked module backs both the auth routes and `attachUser`'s user lookup.
vi.mock("../services/auth.service", () => ({
  register: vi.fn(),
  login: vi.fn(),
  recordLogout: vi.fn(),
  loadAuthenticatedUser: vi.fn(),
}));

import * as authService from "../services/auth.service";
import authRouter from "./auth";
import { unauthorized } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";
import { createTestApp } from "../test/http-harness";

const app = createTestApp("/api/auth", authRouter);
const register = vi.mocked(authService.register);
const login = vi.mocked(authService.login);
const loadAuthenticatedUser = vi.mocked(authService.loadAuthenticatedUser);

const authUser: AuthenticatedUser = {
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

const validStudent = {
  fullName: "Riley Carter",
  email: "riley@uni.edu",
  password: "secret123",
  confirmPassword: "secret123",
  role: "student" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/auth/register", () => {
  it("rejects an invalid body with a 400 validation envelope and never calls the service", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: "x" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
    expect(register).not.toHaveBeenCalled();
  });

  it("rejects role=admin at the schema boundary (admin can never self-register)", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...validStudent, role: "admin" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
    expect(register).not.toHaveBeenCalled();
  });

  it("creates a student and returns 201 with the user payload", async () => {
    register.mockResolvedValueOnce({
      status: "ACTIVE",
      message: "ok",
      userId: "new-1",
      user: {
        id: "new-1",
        email: "riley@uni.edu",
        displayName: "Riley Carter",
        primaryRole: "student",
        roles: ["student"],
        enrollments: [],
      },
    } as never);

    const res = await request(app).post("/api/auth/register").send(validStudent);

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ id: "new-1", primaryRole: "student" });
    expect(register).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/auth/login", () => {
  it("returns 200 with the user and sets a session cookie on success", async () => {
    login.mockResolvedValueOnce({ userId: "user-1", user: authUser } as never);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "a@b.com", password: "pw" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: "user-1",
      email: "a@b.com",
      roles: ["student"],
    });
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("propagates a service auth failure as a 401 error envelope", async () => {
    login.mockRejectedValueOnce(unauthorized("Invalid email or password"));

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "a@b.com", password: "bad" });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: "unauthorized" });
  });

  it("rejects a body missing the password with a 400 validation envelope", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "a@b.com" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
    expect(login).not.toHaveBeenCalled();
  });
});

describe("GET /api/auth/me", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/auth/me");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: "unauthorized" });
  });

  it("returns the current-user DTO once a session is established", async () => {
    login.mockResolvedValueOnce({ userId: "user-1", user: authUser } as never);
    loadAuthenticatedUser.mockResolvedValue(authUser);

    const agent = request.agent(app);
    await agent
      .post("/api/auth/login")
      .send({ email: "a@b.com", password: "pw" })
      .expect(200);

    const res = await agent.get("/api/auth/me");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: "user-1",
      username: "tester",
      avatarUrl: null,
      roles: ["student"],
    });
  });
});

describe("POST /api/auth/logout", () => {
  it("returns 204 even when no session exists", async () => {
    const res = await request(app).post("/api/auth/logout");

    expect(res.status).toBe(204);
  });
});
