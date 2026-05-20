import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/requests.repo", () => ({
  listAliveIds: vi.fn(),
  findAliveByIds: vi.fn(),
  findAliveById: vi.fn(),
  insertRequest: vi.fn(),
  updateRequestById: vi.fn(),
  countVotesByRequestIds: vi.fn().mockResolvedValue(new Map()),
  findUserVotedRequestIds: vi.fn().mockResolvedValue(new Set()),
  findVote: vi.fn(),
  insertVoteIfAbsent: vi.fn(),
}));
vi.mock("../repositories/documents.repo", () => ({
  findByIdAlive: vi.fn(),
}));
vi.mock("./taxonomy.service", () => ({
  loadCourses: vi.fn(async () => new Map()),
}));
vi.mock("./users.service", () => ({
  loadUserSummaries: vi.fn(async () => new Map()),
}));
vi.mock("./audit.service", () => ({
  record: vi.fn().mockResolvedValue(undefined),
}));

import * as requestsRepo from "../repositories/requests.repo";
import * as docsRepo from "../repositories/documents.repo";
import type { AuthenticatedUser } from "../middlewares/auth";
import {
  updateRequest,
  voteOnRequest,
} from "./requests.service";

const findAliveById = vi.mocked(requestsRepo.findAliveById);
const findAliveByIds = vi.mocked(requestsRepo.findAliveByIds);
const insertVoteIfAbsent = vi.mocked(requestsRepo.insertVoteIfAbsent);
const updateById = vi.mocked(requestsRepo.updateRequestById);
const findDocAlive = vi.mocked(docsRepo.findByIdAlive);

const owner: AuthenticatedUser = {
  id: "owner",
  email: "o@x.com",
  displayName: "Owner",
  isActive: true,
  primaryRole: "student",
  roles: ["student"],
  enrollments: [],
};
const other: AuthenticatedUser = { ...owner, id: "other" };
const admin: AuthenticatedUser = { ...owner, id: "admin", roles: ["admin"] };
const lecturer: AuthenticatedUser = { ...owner, id: "lecturer", roles: ["lecturer"] };

function makeRequest(overrides: Partial<{ id: string; requestedBy: string; status: string }> = {}) {
  return {
    id: overrides.id ?? "r1",
    title: "Need notes",
    description: "",
    status: overrides.status ?? "open",
    courseId: null,
    requestedBy: overrides.requestedBy ?? owner.id,
    fulfillingDocumentId: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    deletedAt: null,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  findAliveByIds.mockImplementation(async (ids) =>
    ids.map((id) => makeRequest({ id })),
  );
});

describe("voteOnRequest", () => {
  it("records a new vote when the user has not voted (repo returns true)", async () => {
    findAliveById.mockResolvedValueOnce(makeRequest());
    insertVoteIfAbsent.mockResolvedValueOnce(true);
    await voteOnRequest("r1", other);
    expect(insertVoteIfAbsent).toHaveBeenCalledWith("r1", other.id);
  });

  it("rejects a duplicate vote with 409 (repo returns false from ON CONFLICT DO NOTHING)", async () => {
    findAliveById.mockResolvedValueOnce(makeRequest());
    insertVoteIfAbsent.mockResolvedValueOnce(false);
    await expect(voteOnRequest("r1", other)).rejects.toMatchObject({
      status: 409,
      code: "conflict",
    });
  });

  it("is race-safe: a concurrent duplicate still surfaces a 409 rather than a 500", async () => {
    // Both "concurrent" callers see the request as alive...
    findAliveById.mockResolvedValue(makeRequest());
    // ...but the unique index lets only one insert through; the second
    // call gets `false` back from ON CONFLICT DO NOTHING.
    insertVoteIfAbsent
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const [a, b] = await Promise.allSettled([
      voteOnRequest("r1", other),
      voteOnRequest("r1", other),
    ]);
    const statuses = [a, b].map((s) =>
      s.status === "fulfilled" ? 200 : (s.reason as { status?: number }).status,
    );
    expect(statuses.sort()).toEqual([200, 409]);
  });

  it("404s when the request does not exist", async () => {
    findAliveById.mockResolvedValueOnce(null);
    await expect(voteOnRequest("missing", other)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("updateRequest RBAC", () => {
  it("forbids status changes from a student who is not the author", async () => {
    findAliveById.mockResolvedValue(makeRequest());
    await expect(
      updateRequest("r1", { status: "fulfilled" }, other),
    ).rejects.toMatchObject({ status: 403 });
    expect(updateById).not.toHaveBeenCalled();
  });

  it("forbids title edits from a non-owner non-admin user (lecturers included)", async () => {
    findAliveById.mockResolvedValue(makeRequest());
    await expect(
      updateRequest("r1", { title: "rewrite" }, lecturer),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("allows a lecturer to fulfill someone else's request", async () => {
    findAliveById.mockResolvedValue(makeRequest({ requestedBy: "someone" }));
    findDocAlive.mockResolvedValueOnce({ id: "doc1" } as never);
    await updateRequest(
      "r1",
      { status: "fulfilled", fulfillingDocumentId: "doc1" },
      lecturer,
    );
    expect(updateById).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ status: "fulfilled" }),
    );
  });

  it("allows the owner to update status", async () => {
    findAliveById.mockResolvedValue(makeRequest());
    await updateRequest("r1", { status: "fulfilled" }, owner);
    expect(updateById).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ status: "fulfilled" }),
    );
  });

  it("allows an admin to update any request", async () => {
    findAliveById.mockResolvedValue(makeRequest({ requestedBy: "someone" }));
    await updateRequest("r1", { status: "rejected" }, admin);
    expect(updateById).toHaveBeenCalled();
  });

  it("rejects a fulfillingDocumentId that does not resolve to a live doc", async () => {
    findAliveById.mockResolvedValue(makeRequest());
    findDocAlive.mockResolvedValueOnce(null);
    await expect(
      updateRequest("r1", { fulfillingDocumentId: "ghost" }, owner),
    ).rejects.toMatchObject({ status: 400 });
  });
});
