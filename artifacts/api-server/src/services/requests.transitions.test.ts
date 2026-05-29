import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/requests.repo", () => ({
  findAliveById: vi.fn(),
  findAliveByIds: vi.fn().mockResolvedValue([]),
  listAliveIds: vi.fn(),
  insertRequest: vi.fn(),
  updateRequestById: vi.fn().mockResolvedValue(undefined),
  insertVoteIfAbsent: vi.fn(),
  countVotesByRequestIds: vi.fn().mockResolvedValue(new Map()),
  findUserVotedRequestIds: vi.fn().mockResolvedValue(new Set()),
}));
vi.mock("../repositories/documents.repo", () => ({
  findByIdAlive: vi.fn(),
}));
vi.mock("./taxonomy.service", () => ({
  loadCourses: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("./users.service", () => ({
  loadUserSummaries: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("./audit.service", () => ({ record: vi.fn() }));
vi.mock("./notifications.service", () => ({ notify: vi.fn() }));
vi.mock("./permissions.service", () => ({
  isAdmin: vi.fn().mockReturnValue(true),
  canFulfilRequest: vi.fn().mockReturnValue(true),
  canCreateRequestForCourse: vi.fn().mockReturnValue(true),
}));

import * as requestsRepo from "../repositories/requests.repo";
import * as notificationsService from "./notifications.service";
import { updateRequest, REQUEST_STATUSES } from "./requests.service";
import { HttpError } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";

const findAliveById = vi.mocked(requestsRepo.findAliveById);
const updateRequestById = vi.mocked(requestsRepo.updateRequestById);
const notify = vi.mocked(notificationsService.notify);

const user: AuthenticatedUser = {
  id: "actor",
  email: "a@e",
  displayName: "Actor",
  roles: ["admin"],
  enrollments: [],
} as unknown as AuthenticatedUser;

beforeEach(() => {
  vi.clearAllMocks();
  findAliveById.mockResolvedValue({
    id: "r1",
    title: "T",
    description: "",
    status: "open",
    courseId: null,
    requestedBy: "author",
    fulfillingDocumentId: null,
    createdAt: new Date(),
  } as never);
});

describe("requests.service status transitions", () => {
  it("exposes the full allow-list including in_progress", () => {
    expect(REQUEST_STATUSES).toContain("open");
    expect(REQUEST_STATUSES).toContain("in_progress");
    expect(REQUEST_STATUSES).toContain("fulfilled");
    expect(REQUEST_STATUSES).toContain("closed");
  });

  it("rejects an unknown status with 400", async () => {
    await expect(
      updateRequest("r1", { status: "banana" }, user),
    ).rejects.toBeInstanceOf(HttpError);
    expect(updateRequestById).not.toHaveBeenCalled();
  });

  it("accepts in_progress and persists it", async () => {
    await updateRequest("r1", { status: "in_progress" }, user);
    expect(updateRequestById).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ status: "in_progress" }),
    );
  });

  it("notifies the author on a status change by another user", async () => {
    await updateRequest("r1", { status: "in_progress" }, user);
    await Promise.resolve();
    await Promise.resolve();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "request.status",
        recipientId: "author",
        actorId: "actor",
      }),
    );
  });

  it("does not notify the author when they move their own request", async () => {
    findAliveById.mockResolvedValue({
      id: "r1",
      title: "T",
      description: "",
      status: "open",
      courseId: null,
      requestedBy: "actor",
      fulfillingDocumentId: null,
      createdAt: new Date(),
    } as never);
    await updateRequest("r1", { status: "in_progress" }, user);
    await Promise.resolve();
    expect(notify).not.toHaveBeenCalled();
  });

  it("encodes the new status into subjectId so successive transitions are not deduped", async () => {
    await updateRequest("r1", { status: "in_progress" }, user);
    await updateRequest("r1", { status: "fulfilled" }, user);
    await Promise.resolve();
    await Promise.resolve();
    expect(notify).toHaveBeenCalledTimes(2);
    const subjects = notify.mock.calls.map(
      ([args]) => (args as { subjectId: string }).subjectId,
    );
    expect(new Set(subjects).size).toBe(2);
  });

  it("does not notify when status is unchanged", async () => {
    await updateRequest("r1", { status: "open" }, user);
    await Promise.resolve();
    expect(notify).not.toHaveBeenCalled();
  });
});
