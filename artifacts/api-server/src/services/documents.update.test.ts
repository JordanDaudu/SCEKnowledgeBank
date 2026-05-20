import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/documents.repo", () => ({
  findByIdAlive: vi.fn(),
  findManyByIdsAlive: vi.fn().mockResolvedValue([]),
  findFilesByDocumentIds: vi.fn().mockResolvedValue([]),
  findTagLinksForDocuments: vi.fn().mockResolvedValue([]),
  updateDocumentById: vi.fn().mockResolvedValue(undefined),
  replaceDocumentTags: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../repositories/taxonomy.repo", () => ({
  courseExists: vi.fn(),
  findCourseCodesByIds: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("../repositories/comments.repo", () => ({
  countAliveByDocumentIds: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("../repositories/viewHistory.repo", () => ({
  countViewsByDocumentIds: vi.fn().mockResolvedValue(new Map()),
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
  signToken: vi.fn().mockReturnValue({ token: "tok", expiresAt: new Date() }),
  verifyToken: vi.fn(),
}));

import * as docsRepo from "../repositories/documents.repo";
import * as taxonomyRepo from "../repositories/taxonomy.repo";
import { updateDocument } from "./documents.service";
import type { AuthenticatedUser } from "../middlewares/auth";

const findByIdAlive = vi.mocked(docsRepo.findByIdAlive);
const courseExists = vi.mocked(taxonomyRepo.courseExists);

function mkUser(over: Partial<AuthenticatedUser> & { id: string }): AuthenticatedUser {
  return {
    email: `${over.id}@x.com`,
    displayName: over.id,
    isActive: true,
    primaryRole: "lecturer",
    roles: ["lecturer"],
    enrollments: [],
    ...over,
  } as AuthenticatedUser;
}

const lecturerOfA = mkUser({
  id: "lec",
  enrollments: [{ courseId: "course-A", roleInCourse: "lecturer" }],
});
const admin = mkUser({ id: "adm", roles: ["admin"], primaryRole: "admin" });

function makeDoc(over: Partial<{ courseId: string | null; visibility: string }> = {}) {
  return {
    id: "d1",
    title: "t",
    description: null,
    visibility: over.visibility ?? "public",
    courseId: over.courseId === undefined ? "course-A" : over.courseId,
    uploaderId: "lec",
    ownerId: "lec",
    materialType: "notes",
    semester: null,
    academicYear: null,
    categoryId: null,
    storagePath: "x",
    mimeType: "application/pdf",
    fileSize: 1,
    filename: "f.pdf",
    checksum: "c",
    status: "published",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    updatedBy: null,
  } as unknown as docsRepo.DocumentRow;
}

beforeEach(() => {
  vi.clearAllMocks();
  courseExists.mockResolvedValue(true);
});

describe("updateDocument course-aware permissions", () => {
  it("forbids moving a doc into a course the lecturer does not teach", async () => {
    findByIdAlive.mockResolvedValueOnce(makeDoc());
    await expect(
      updateDocument("d1", { courseId: "course-B" }, lecturerOfA),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects a target courseId that does not exist (400)", async () => {
    findByIdAlive.mockResolvedValueOnce(makeDoc());
    courseExists.mockResolvedValueOnce(false);
    // Admin so the membership check passes — we want the existence check.
    await expect(
      updateDocument("d1", { courseId: "missing-course" }, admin),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects flipping visibility to restricted when courseId is null (400)", async () => {
    findByIdAlive.mockResolvedValueOnce(
      makeDoc({ courseId: null, visibility: "public" }),
    );
    await expect(
      updateDocument("d1", { visibility: "restricted" }, admin),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects detaching a restricted doc from its course (400)", async () => {
    findByIdAlive.mockResolvedValueOnce(
      makeDoc({ courseId: "course-A", visibility: "restricted" }),
    );
    await expect(
      updateDocument("d1", { courseId: null }, admin),
    ).rejects.toMatchObject({ status: 400 });
  });
});
