import { beforeEach, describe, expect, it, vi } from "vitest";

// Sprint-3 completion: service-level gates for STUDENT uploaders.
// Mirrors `documents.upload.test.ts` mock topology so the gate logic
// runs end-to-end against the real `uploadDocuments` flow (real
// permissions.service, real upload service) but with storage + repos
// stubbed out.

vi.mock("../repositories/documents.repo", () => ({
  findUploaderDisplayFilenames: vi.fn().mockResolvedValue([]),
  findAliveFileByUploaderAndChecksum: vi.fn().mockResolvedValue(null),
  insertDocumentWithFileAndQuota: vi.fn(),
  findManyByIdsAlive: vi.fn().mockResolvedValue([]),
  findFilesByDocumentIds: vi.fn().mockResolvedValue([]),
  findTagLinksForDocuments: vi.fn().mockResolvedValue([]),
}));
vi.mock("../repositories/users.repo", () => ({
  findQuotaById: vi.fn().mockResolvedValue({ usedBytes: 0n, quotaBytes: 1_000_000n }),
  findAdminUserIds: vi.fn().mockResolvedValue([]),
}));
vi.mock("../repositories/enrollments.repo", () => ({
  findCourseLecturerIds: vi.fn().mockResolvedValue([]),
}));
vi.mock("./notifications.service", () => ({ notify: vi.fn() }));
vi.mock("./users.service", async () => {
  const actual = await vi.importActual<typeof import("./users.service")>(
    "./users.service",
  );
  return {
    ...actual,
    loadUserSummaries: vi.fn().mockResolvedValue(new Map()),
  };
});
vi.mock("./taxonomy.service", () => ({
  loadCourses: vi.fn().mockResolvedValue(new Map()),
  loadCategories: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("../repositories/taxonomy.repo", () => ({
  courseExists: vi.fn().mockResolvedValue(true),
}));
vi.mock("./audit.service", () => ({ record: vi.fn() }));
vi.mock("../repositories/viewHistory.repo", () => ({
  countViewsByDocumentIds: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("../repositories/comments.repo", () => ({
  countAliveByDocumentIds: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("../lib/mime-sniff", () => ({
  mimeMatchesContent: vi.fn().mockReturnValue(true),
}));

const storagePut = vi.fn();
vi.mock("../lib/storage", () => ({
  getStorage: () => ({
    put: storagePut,
    get: vi.fn(),
    getStream: vi.fn(),
    head: vi.fn(),
    delete: vi.fn(),
    driver: "local",
  }),
}));

import * as docsRepo from "../repositories/documents.repo";
import { uploadDocuments } from "./documents.service";
import type { AuthenticatedUser } from "../middlewares/auth";

const insertTx = vi.mocked(docsRepo.insertDocumentWithFileAndQuota);

const enrolledStudent: AuthenticatedUser = {
  id: "stu1",
  email: "stu1@x.com",
  displayName: "Stu",
  isActive: true,
  primaryRole: "student",
  roles: ["student"],
  enrollments: [{ courseId: "c-enrolled", roleInCourse: "student" }],
  username: null,
  avatarStoragePath: null,
  createdAt: "2025-01-01T00:00:00.000Z",
} as AuthenticatedUser;

const unenrolledStudent: AuthenticatedUser = {
  id: "stu2",
  email: "stu2@x.com",
  displayName: "Stu2",
  isActive: true,
  primaryRole: "student",
  roles: ["student"],
  enrollments: [],
  username: null,
  avatarStoragePath: null,
  createdAt: "2025-01-01T00:00:00.000Z",
} as AuthenticatedUser;

const lecturer: AuthenticatedUser = {
  id: "lec1",
  email: "lec1@x.com",
  displayName: "Lec",
  isActive: true,
  primaryRole: "lecturer",
  roles: ["lecturer"],
  enrollments: [{ courseId: "c-mine", roleInCourse: "lecturer" }],
  username: null,
  avatarStoragePath: null,
  createdAt: "2025-01-01T00:00:00.000Z",
} as AuthenticatedUser;

function makeFile(name: string, body: string, mimetype = "application/pdf") {
  const buffer = Buffer.from(body);
  return {
    fieldname: "files",
    originalname: name,
    encoding: "7bit",
    mimetype,
    size: buffer.length,
    buffer,
    stream: undefined as never,
    destination: "",
    filename: name,
    path: "",
  } as Express.Multer.File;
}

function baseInput(overrides: Partial<Parameters<typeof uploadDocuments>[0]> = {}) {
  return {
    files: [makeFile("a.pdf", "hello")],
    courseId: "c-enrolled",
    categoryId: undefined,
    materialType: "lecture_notes",
    semester: undefined,
    academicYear: undefined,
    visibility: "public" as string,
    tagIds: [] as string[],
    description: "",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storagePut.mockImplementation(async (args: { key: string; precomputedChecksum?: string }) => ({
    key: args.key,
    size: 0,
    checksum: args.precomputedChecksum ?? "deadbeef",
    driver: "local",
  }));
  insertTx.mockImplementation(async ({ documentValues }) => ({
    ...documentValues,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  }) as never);
});

describe("uploadDocuments — SP4 open uploads + approval routing", () => {
  it("student upload lands in pending_review (auto-submitted to lecturer review)", async () => {
    const res = await uploadDocuments(baseInput(), enrolledStudent);
    expect(res).toHaveLength(1);
    expect(res[0].success).toBe(true);
    expect(insertTx).toHaveBeenCalledWith(
      expect.objectContaining({
        documentValues: expect.objectContaining({
          status: "pending_review",
          uploaderId: "stu1",
          courseId: "c-enrolled",
        }),
      }),
    );
  });

  it("student can upload to a course they are NOT enrolled in (uploads are open)", async () => {
    const res = await uploadDocuments(
      baseInput({ courseId: "c-other" }),
      unenrolledStudent,
    );
    expect(res[0].success).toBe(true);
    expect(insertTx).toHaveBeenCalledWith(
      expect.objectContaining({
        documentValues: expect.objectContaining({ status: "pending_review" }),
      }),
    );
  });

  it("student upload without courseId is rejected with 400 (need a course to route to)", async () => {
    await expect(
      uploadDocuments(baseInput({ courseId: undefined } as never), enrolledStudent),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("course") });
    expect(storagePut).not.toHaveBeenCalled();
    expect(insertTx).not.toHaveBeenCalled();
  });

  it("lecturer normal upload publishes directly", async () => {
    const res = await uploadDocuments(baseInput({ courseId: "c-mine" }), lecturer);
    expect(res[0].success).toBe(true);
    expect(insertTx.mock.calls[0][0].documentValues.status).toBe("published");
  });

  it("lecturer restricted-type upload goes to pending_admin_approval", async () => {
    const res = await uploadDocuments(
      baseInput({ files: [makeFile("bundle.zip", "data", "application/zip")] }),
      lecturer,
    );
    expect(res[0].success).toBe(true);
    expect(insertTx.mock.calls[0][0].documentValues.status).toBe("pending_admin_approval");
  });

  it("lecturer can upload to a course they don't teach (uploads are open)", async () => {
    const res = await uploadDocuments(baseInput({ courseId: "c-not-mine" }), lecturer);
    expect(res[0].success).toBe(true);
    expect(insertTx.mock.calls[0][0].documentValues.status).toBe("published");
  });

  it("student visibility=restricted is honoured (status still pending_review)", async () => {
    const res = await uploadDocuments(
      baseInput({ visibility: "restricted" }),
      enrolledStudent,
    );
    expect(res[0].success).toBe(true);
    expect(insertTx).toHaveBeenCalledWith(
      expect.objectContaining({
        documentValues: expect.objectContaining({
          visibility: "restricted",
          status: "pending_review",
        }),
      }),
    );
  });
});
