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
}));
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

describe("uploadDocuments — student-upload gating", () => {
  it("enrolled student uploading to their course succeeds and lands as draft", async () => {
    const res = await uploadDocuments(baseInput(), enrolledStudent);
    expect(res).toHaveLength(1);
    expect(res[0].success).toBe(true);
    // The forced status is the headline guarantee: students never
    // direct-publish, even when the route would accept "published".
    expect(insertTx).toHaveBeenCalledWith(
      expect.objectContaining({
        documentValues: expect.objectContaining({
          status: "draft",
          uploaderId: "stu1",
          courseId: "c-enrolled",
        }),
      }),
    );
  });

  it("client-supplied status=published is ignored for students (forced to draft)", async () => {
    const res = await uploadDocuments(
      baseInput({ status: "published" } as never),
      enrolledStudent,
    );
    expect(res[0].success).toBe(true);
    expect(insertTx).toHaveBeenCalledWith(
      expect.objectContaining({
        documentValues: expect.objectContaining({ status: "draft" }),
      }),
    );
  });

  it("student uploading to a course they are NOT enrolled in is rejected with 403", async () => {
    await expect(
      uploadDocuments(baseInput({ courseId: "c-other" }), enrolledStudent),
    ).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("enrolled"),
    });
    expect(storagePut).not.toHaveBeenCalled();
    expect(insertTx).not.toHaveBeenCalled();
  });

  it("student upload without courseId is rejected with 400 (explicit error)", async () => {
    await expect(
      uploadDocuments(
        baseInput({ courseId: undefined } as never),
        enrolledStudent,
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("course"),
    });
    expect(storagePut).not.toHaveBeenCalled();
    expect(insertTx).not.toHaveBeenCalled();
  });

  it("student with zero enrollments cannot upload anywhere", async () => {
    // Even with a real courseId in hand — the per-course check fails
    // because the user is enrolled in NO courses at all.
    await expect(
      uploadDocuments(
        baseInput({ courseId: "c-enrolled" }),
        unenrolledStudent,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(insertTx).not.toHaveBeenCalled();
  });

  it("student uploads do not write to storage when the course gate fails", async () => {
    await expect(
      uploadDocuments(baseInput({ courseId: "c-other" }), enrolledStudent),
    ).rejects.toMatchObject({ status: 403 });
    expect(storagePut).not.toHaveBeenCalled();
  });

  it("student-supplied visibility=restricted is honoured (gate is enrollment, not role)", async () => {
    const res = await uploadDocuments(
      baseInput({ visibility: "restricted" }),
      enrolledStudent,
    );
    expect(res[0].success).toBe(true);
    expect(insertTx).toHaveBeenCalledWith(
      expect.objectContaining({
        documentValues: expect.objectContaining({
          visibility: "restricted",
          status: "draft",
        }),
      }),
    );
  });

  it("lecturer upload is NOT forced to draft (legacy publish path preserved)", async () => {
    // Default `status` is undefined; the service should leave it
    // alone for non-students. The repo insert receives whatever the
    // service decided (undefined → repo default).
    const res = await uploadDocuments(
      baseInput({ courseId: "c-mine" }),
      lecturer,
    );
    expect(res[0].success).toBe(true);
    const call = insertTx.mock.calls[0][0];
    // Critical assertion: NOT force-set to "draft".
    expect(call.documentValues.status).not.toBe("draft");
  });

  it("lecturer uploading to a course they don't teach is rejected with 403", async () => {
    await expect(
      uploadDocuments(baseInput({ courseId: "c-not-mine" }), lecturer),
    ).rejects.toMatchObject({ status: 403 });
    expect(insertTx).not.toHaveBeenCalled();
  });

  it("autoSubmitForReview flag is accepted on UploadInput without changing the upload-level status", async () => {
    // The actual submit-for-review side effect lives in the HTTP
    // route (it iterates UploadResultEntry and calls submitForReview
    // per drafted doc). At the service layer the flag must NOT alter
    // the persisted status — that stays "draft" so the route's later
    // submitForReview call sees the correct precondition.
    const res = await uploadDocuments(
      baseInput({ autoSubmitForReview: true } as never),
      enrolledStudent,
    );
    expect(res[0].success).toBe(true);
    expect(insertTx).toHaveBeenCalledWith(
      expect.objectContaining({
        documentValues: expect.objectContaining({ status: "draft" }),
      }),
    );
  });
});
