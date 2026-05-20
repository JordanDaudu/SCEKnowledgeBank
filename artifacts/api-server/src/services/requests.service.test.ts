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
  loadCourses: vi.fn(async (ids: (string | null | undefined)[]) => {
    // Default: any non-null courseId resolves to a stub course so
    // existence checks pass. Tests can override via mockResolvedValueOnce.
    const map = new Map<string, { id: string; code: string; title: string; lecturerName: string }>();
    for (const id of ids) {
      if (id) map.set(id, { id, code: "C101", title: "Course", lecturerName: "L" });
    }
    return map;
  }),
}));
vi.mock("./users.service", () => ({
  loadUserSummaries: vi.fn(async () => new Map()),
}));
vi.mock("./audit.service", () => ({
  record: vi.fn().mockResolvedValue(undefined),
}));

import * as requestsRepo from "../repositories/requests.repo";
import * as docsRepo from "../repositories/documents.repo";
import * as taxonomyService from "./taxonomy.service";
import type { AuthenticatedUser } from "../middlewares/auth";
import {
  createRequest,
  updateRequest,
  voteOnRequest,
} from "./requests.service";

const findAliveById = vi.mocked(requestsRepo.findAliveById);
const findAliveByIds = vi.mocked(requestsRepo.findAliveByIds);
const insertVoteIfAbsent = vi.mocked(requestsRepo.insertVoteIfAbsent);
const updateById = vi.mocked(requestsRepo.updateRequestById);
const findDocAlive = vi.mocked(docsRepo.findByIdAlive);
const insertRequest = vi.mocked(requestsRepo.insertRequest);
const loadCourses = vi.mocked(taxonomyService.loadCourses);

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

describe("request visibility (Sprint-2 audit)", () => {
  const courseScoped = (overrides: Partial<{ id: string; courseId: string }> = {}) => {
    const base = makeRequest({ id: overrides.id ?? "rcs" }) as unknown as Record<string, unknown>;
    return { ...base, courseId: overrides.courseId ?? "course-X" } as never;
  };

  it("404s voteOnRequest for a student outside the course (no leak via 409)", async () => {
    findAliveById.mockResolvedValueOnce(courseScoped());
    await expect(voteOnRequest("rcs", other)).rejects.toMatchObject({
      status: 404,
    });
    expect(insertVoteIfAbsent).not.toHaveBeenCalled();
  });

  it("404s updateRequest for a non-enrolled user on a course-scoped request", async () => {
    findAliveById.mockResolvedValueOnce(courseScoped());
    await expect(
      updateRequest("rcs", { status: "fulfilled" }, other),
    ).rejects.toMatchObject({ status: 404 });
    expect(updateById).not.toHaveBeenCalled();
  });

  it("admins see course-scoped requests regardless of enrollment", async () => {
    findAliveById.mockResolvedValue(courseScoped());
    insertVoteIfAbsent.mockResolvedValueOnce(true);
    await voteOnRequest("rcs", admin);
    expect(insertVoteIfAbsent).toHaveBeenCalled();
  });

  it("enrolled students can see and vote on course-scoped requests", async () => {
    const enrolled: AuthenticatedUser = {
      ...other,
      enrollments: [{ courseId: "course-X", roleInCourse: "student" }],
    };
    findAliveById.mockResolvedValue(courseScoped());
    insertVoteIfAbsent.mockResolvedValueOnce(true);
    await voteOnRequest("rcs", enrolled);
    expect(insertVoteIfAbsent).toHaveBeenCalled();
  });
});

describe("createRequest course access (Sprint-2 audit)", () => {
  const enrolledStudent: AuthenticatedUser = {
    ...owner,
    id: "student-enrolled",
    roles: ["student"],
    enrollments: [{ courseId: "course-A", roleInCourse: "student" }],
  };
  const teachingLecturer: AuthenticatedUser = {
    ...owner,
    id: "lecturer-teaching",
    roles: ["lecturer"],
    enrollments: [{ courseId: "course-A", roleInCourse: "lecturer" }],
  };
  const unrelatedLecturer: AuthenticatedUser = {
    ...owner,
    id: "lecturer-other",
    roles: ["lecturer"],
    enrollments: [{ courseId: "course-B", roleInCourse: "lecturer" }],
  };

  beforeEach(() => {
    insertRequest.mockImplementation(
      async (values) =>
        ({
          id: "new-req",
          title: values.title,
          description: values.description ?? "",
          courseId: (values.courseId as string | undefined) ?? null,
          requestedBy: values.requestedBy ?? owner.id,
          status: "open",
          fulfillingDocumentId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        }) as never,
    );
  });

  it("allows a student to create a request for a course they are enrolled in", async () => {
    await createRequest(
      { title: "Need lecture notes", courseId: "course-A" },
      enrolledStudent,
    );
    expect(insertRequest).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: "course-A" }),
    );
  });

  it("forbids a student from creating a request for a course they are not enrolled in (404 to prevent enumeration)", async () => {
    await expect(
      createRequest({ title: "x", courseId: "course-Z" }, enrolledStudent),
    ).rejects.toMatchObject({ status: 404 });
    expect(insertRequest).not.toHaveBeenCalled();
  });

  it("allows a lecturer to create a request for a course they teach", async () => {
    await createRequest(
      { title: "x", courseId: "course-A" },
      teachingLecturer,
    );
    expect(insertRequest).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: "course-A" }),
    );
  });

  it("forbids a lecturer from creating a request for an unrelated course (404 to prevent enumeration)", async () => {
    await expect(
      createRequest({ title: "x", courseId: "course-A" }, unrelatedLecturer),
    ).rejects.toMatchObject({ status: 404 });
    expect(insertRequest).not.toHaveBeenCalled();
  });

  it("allows an admin to create a request for any course", async () => {
    await createRequest({ title: "x", courseId: "course-Z" }, admin);
    expect(insertRequest).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: "course-Z" }),
    );
  });

  it("allows any authenticated user to create a global request (no courseId)", async () => {
    await createRequest({ title: "general help" }, other);
    expect(insertRequest).toHaveBeenCalled();
    // Global requests must not carry a courseId.
    const call = insertRequest.mock.calls.at(-1)?.[0] as { courseId?: string };
    expect(call.courseId).toBeUndefined();
    // The taxonomy access check (loadCourses with the request's
    // courseId) is skipped for global requests. buildDTOs still calls
    // loadCourses to hydrate the DTO, so we just assert no call carried
    // a real course id — only the null hydration call from buildDTOs.
    const accessCheckCall = loadCourses.mock.calls.find((c) =>
      (c[0] as (string | null | undefined)[]).some((x) => typeof x === "string"),
    );
    expect(accessCheckCall).toBeUndefined();
  });

  it("404s when the courseId does not exist", async () => {
    loadCourses.mockResolvedValueOnce(new Map());
    await expect(
      createRequest({ title: "x", courseId: "ghost" }, admin),
    ).rejects.toMatchObject({ status: 404 });
    expect(insertRequest).not.toHaveBeenCalled();
  });

  it("returns 404 (not 403) to non-admins denied by course access — prevents enumeration", async () => {
    // Course exists, but the student is not enrolled. The endpoint
    // collapses this into the same 404 as "course doesn't exist" so
    // course ids can't be probed via the create endpoint.
    await expect(
      createRequest({ title: "x", courseId: "course-Z" }, enrolledStudent),
    ).rejects.toMatchObject({ status: 404 });
    expect(insertRequest).not.toHaveBeenCalled();
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
