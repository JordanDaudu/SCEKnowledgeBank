import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/documents.repo", () => ({
  findByIdAlive: vi.fn(),
  findManyByIdsAlive: vi.fn(),
  findFilesByDocumentIds: vi.fn().mockResolvedValue([]),
  findTagLinksForDocuments: vi.fn().mockResolvedValue([]),
}));
vi.mock("../repositories/viewHistory.repo", () => ({
  recordView: vi.fn().mockResolvedValue(undefined),
  listRecentDocumentIdsForUser: vi.fn(),
  countViewsByDocumentIds: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("../repositories/comments.repo", () => ({
  countAliveByDocumentIds: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("./users.service", () => ({
  loadUserSummaries: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("./taxonomy.service", () => ({
  loadCourses: vi.fn().mockResolvedValue(new Map()),
  loadCategories: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("./audit.service", () => ({ record: vi.fn() }));
vi.mock("../lib/sign-url", () => ({
  signToken: vi
    .fn()
    .mockReturnValue({ token: "tok", expiresAt: new Date("2030-01-01") }),
  verifyToken: vi.fn(),
}));

import * as docsRepo from "../repositories/documents.repo";
import * as viewRepo from "../repositories/viewHistory.repo";
import { issueAccessToken, listRecentForUser } from "./documents.service";
import type { AuthenticatedUser } from "../middlewares/auth";

const findByIdAlive = vi.mocked(docsRepo.findByIdAlive);
const findManyByIdsAlive = vi.mocked(docsRepo.findManyByIdsAlive);
const listRecentIds = vi.mocked(viewRepo.listRecentDocumentIdsForUser);

function mkUser(over: Partial<AuthenticatedUser> & { id: string }): AuthenticatedUser {
  return {
    email: `${over.id}@x.com`,
    displayName: over.id,
    isActive: true,
    primaryRole: "student",
    roles: ["student"],
    enrollments: [],
    ...over,
  } as AuthenticatedUser;
}

const student = mkUser({ id: "stu", enrollments: [{ courseId: "c-A", roleInCourse: "student" }] });
const admin = mkUser({ id: "adm", roles: ["admin"], primaryRole: "admin" });

function doc(over: Partial<{ visibility: string; courseId: string | null; uploaderId: string; ownerId: string }> = {}) {
  return {
    id: "d1",
    title: "t",
    description: null,
    visibility: "restricted",
    courseId: "c-B",
    uploaderId: "someone",
    ownerId: "someone",
    materialType: "notes",
    semester: null,
    academicYear: null,
    categoryId: null,
    storagePath: "x",
    mimeType: "application/pdf",
    fileSize: 1,
    filename: "f.pdf",
    checksum: "c",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    updatedBy: null,
    ...over,
  } as unknown as docsRepo.DocumentRow;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("documents.service.issueAccessToken uses the same canView gate", () => {
  it("denies preview/download to a non-enrolled student on a restricted doc", async () => {
    findByIdAlive.mockResolvedValueOnce(doc({ visibility: "restricted", courseId: "c-B" }));
    await expect(issueAccessToken("d1", "preview", student)).rejects.toMatchObject({
      status: 403,
    });
    findByIdAlive.mockResolvedValueOnce(doc({ visibility: "restricted", courseId: "c-B" }));
    await expect(issueAccessToken("d1", "download", student)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("allows an enrolled student on a restricted doc in their course", async () => {
    findByIdAlive.mockResolvedValueOnce(doc({ visibility: "restricted", courseId: "c-A" }));
    const result = await issueAccessToken("d1", "preview", student);
    expect(result.token).toBe("tok");
  });

  it("allows admin on a private doc owned by someone else", async () => {
    findByIdAlive.mockResolvedValueOnce(doc({ visibility: "private", courseId: null }));
    const result = await issueAccessToken("d1", "download", admin);
    expect(result.token).toBe("tok");
  });

  it("404s when the document does not exist", async () => {
    findByIdAlive.mockResolvedValueOnce(null);
    await expect(issueAccessToken("missing", "preview", student)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("documents.service.listRecentForUser filters by canView", () => {
  it("drops restricted docs the user can no longer view", async () => {
    listRecentIds.mockResolvedValueOnce(["d1", "d2", "d3"]);
    findManyByIdsAlive.mockResolvedValueOnce([
      { ...doc({ visibility: "public", courseId: null }), id: "d1" } as never,
      { ...doc({ visibility: "restricted", courseId: "c-B" }), id: "d2" } as never,
      { ...doc({ visibility: "restricted", courseId: "c-A" }), id: "d3" } as never,
    ]);
    const items = await listRecentForUser(student, 10);
    expect(items.map((i) => i.id).sort()).toEqual(["d1", "d3"]);
  });

  it("admin sees everything in recents", async () => {
    listRecentIds.mockResolvedValueOnce(["d1", "d2"]);
    findManyByIdsAlive.mockResolvedValueOnce([
      { ...doc({ visibility: "private", courseId: null, uploaderId: "x", ownerId: "y" }), id: "d1" } as never,
      { ...doc({ visibility: "restricted", courseId: "c-X" }), id: "d2" } as never,
    ]);
    const items = await listRecentForUser(admin, 10);
    expect(items).toHaveLength(2);
  });
});
