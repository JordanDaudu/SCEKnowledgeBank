import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock every repo / service / storage dep the upload pipeline touches, so
// the test can exercise the quota + dedup logic in isolation. The point
// is to prove the *control flow*: which branch fires for each error
// condition, and that the storage write + DB insert only happen when
// the gate passes.
vi.mock("../repositories/documents.repo", () => ({
  findUploaderDisplayFilenames: vi.fn().mockResolvedValue([]),
  findAliveFileByUploaderAndChecksum: vi.fn(),
  insertDocumentWithFileAndQuota: vi.fn(),
  findManyByIdsAlive: vi.fn().mockResolvedValue([]),
  findFilesByDocumentIds: vi.fn().mockResolvedValue([]),
  findTagLinksForDocuments: vi.fn().mockResolvedValue([]),
}));
vi.mock("../repositories/users.repo", () => ({
  findQuotaById: vi.fn(),
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
// Sprint-2 audit: uploadDocuments now verifies that any supplied
// courseId resolves to a real course before touching storage. Default
// the mock to "exists" so legacy tests pass; the "invalid courseId"
// case overrides it.
vi.mock("../repositories/taxonomy.repo", () => ({
  courseExists: vi.fn().mockResolvedValue(true),
}));
vi.mock("./audit.service", () => ({ record: vi.fn() }));
vi.mock("./permissions.service", () => ({
  canUploadToCourse: vi.fn().mockReturnValue(true),
  // assembleDocuments derives DTO `permissions` flags by calling each
  // of these per-row (Sprint-2 audit); stub them to a permissive
  // baseline so the upload tests stay focused on the quota/dedup gate.
  canView: vi.fn().mockReturnValue(true),
  canEdit: vi.fn().mockReturnValue(true),
  canDelete: vi.fn().mockReturnValue(true),
  canComment: vi.fn().mockReturnValue(true),
  canSubmitForReview: vi.fn().mockReturnValue(false),
  canReview: vi.fn().mockReturnValue(false),
  isAdmin: vi.fn().mockReturnValue(false),
}));
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
import * as usersRepo from "../repositories/users.repo";
import * as taxonomyRepo from "../repositories/taxonomy.repo";
import * as permissionsService from "./permissions.service";
import { uploadDocuments } from "./documents.service";
import type { AuthenticatedUser } from "../middlewares/auth";

const findDup = vi.mocked(docsRepo.findAliveFileByUploaderAndChecksum);
const insertTx = vi.mocked(docsRepo.insertDocumentWithFileAndQuota);
const findQuota = vi.mocked(usersRepo.findQuotaById);
const courseExists = vi.mocked(taxonomyRepo.courseExists);
const canUploadToCourse = vi.mocked(permissionsService.canUploadToCourse);

const uploader: AuthenticatedUser = {
  id: "u1",
  email: "u1@x.com",
  displayName: "U",
  isActive: true,
  primaryRole: "lecturer",
  roles: ["lecturer"],
  enrollments: [{ courseId: "c1", roleInCourse: "lecturer" }],
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

function input(files: Express.Multer.File[]) {
  return {
    files,
    courseId: "c1",
    categoryId: undefined,
    materialType: "lecture_notes",
    semester: undefined,
    academicYear: undefined,
    visibility: "public" as string,
    tagIds: [] as string[],
    description: "",
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

describe("uploadDocuments quota gate", () => {
  it("uploads when running total stays within quota", async () => {
    findQuota.mockResolvedValue({ usedBytes: 0n, quotaBytes: 1000n });
    findDup.mockResolvedValue(null);
    const res = await uploadDocuments(
      input([makeFile("a.pdf", "x".repeat(100))]),
      uploader,
    );
    expect(res).toHaveLength(1);
    expect(res[0].success).toBe(true);
    expect(insertTx).toHaveBeenCalledTimes(1);
    expect(insertTx).toHaveBeenCalledWith(
      expect.objectContaining({ sizeBytes: 100, uploaderId: "u1" }),
    );
    expect(storagePut).toHaveBeenCalledWith(
      expect.objectContaining({ precomputedChecksum: expect.any(String) }),
    );
  });

  it("rejects a file that would push the running total past the quota", async () => {
    // 50 bytes used, 100 byte cap, 60 byte upload → over.
    findQuota.mockResolvedValue({ usedBytes: 50n, quotaBytes: 100n });
    findDup.mockResolvedValue(null);
    const res = await uploadDocuments(
      input([makeFile("big.pdf", "y".repeat(60))]),
      uploader,
    );
    expect(res[0]).toMatchObject({
      success: false,
      errorCode: "storage_quota_exceeded",
    });
    // Critical: no storage write, no DB insert on quota fail.
    expect(storagePut).not.toHaveBeenCalled();
    expect(insertTx).not.toHaveBeenCalled();
  });

  it("falls back to the env default quota when user override is null", async () => {
    findQuota.mockResolvedValue({ usedBytes: 0n, quotaBytes: null });
    findDup.mockResolvedValue(null);
    // Default is 500 MB; 10-byte upload fits trivially.
    const res = await uploadDocuments(
      input([makeFile("a.pdf", "tiny")]),
      uploader,
    );
    expect(res[0].success).toBe(true);
  });
});

describe("uploadDocuments duplicate-file short-circuit", () => {
  it("returns duplicate_file with the existing document id+title without writing storage", async () => {
    findQuota.mockResolvedValue({ usedBytes: 0n, quotaBytes: 1000n });
    findDup.mockResolvedValue({
      documentId: "existing-doc-id",
      documentTitle: "Original Title",
    });
    const res = await uploadDocuments(
      input([makeFile("dupe.pdf", "exact-same-bytes")]),
      uploader,
    );
    expect(res[0]).toMatchObject({
      success: false,
      errorCode: "duplicate_file",
      duplicateOfDocumentId: "existing-doc-id",
      duplicateOfTitle: "Original Title",
    });
    expect(storagePut).not.toHaveBeenCalled();
    expect(insertTx).not.toHaveBeenCalled();
  });

  it("hashes each upload exactly once and reuses the digest for dedup + DocumentFile.checksum", async () => {
    findQuota.mockResolvedValue({ usedBytes: 0n, quotaBytes: 1000n });
    findDup.mockResolvedValue(null);

    // sha256 of "hello" in hex
    const expected =
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

    await uploadDocuments(input([makeFile("h.pdf", "hello")]), uploader);

    // Dedup lookup uses the precomputed checksum.
    expect(findDup).toHaveBeenCalledWith("u1", expected);
    // Storage.put receives the same digest as precomputedChecksum (so the
    // adapter trusts it and doesn't hash a second time).
    expect(storagePut).toHaveBeenCalledWith(
      expect.objectContaining({ precomputedChecksum: expected }),
    );
    // And the DocumentFile insert stores that same checksum.
    expect(insertTx).toHaveBeenCalledWith(
      expect.objectContaining({
        fileValues: expect.objectContaining({ checksum: expected }),
      }),
    );
  });
});

// Sprint-2 audit (T1): restricted-without-course + invalid courseId
// + lecturer scoping. These exercise the service guards directly so
// we know internal callers (not just the HTTP route) can't bypass
// them.
describe("uploadDocuments restricted/course guards", () => {
  beforeEach(() => {
    findQuota.mockResolvedValue({ usedBytes: 0n, quotaBytes: 1_000_000n });
    findDup.mockResolvedValue(null);
  });

  it("rejects a restricted upload with no courseId via clean 400", async () => {
    const badInput = { ...input([makeFile("a.pdf", "x")]) };
    badInput.visibility = "restricted";
    delete (badInput as { courseId?: string }).courseId;

    await expect(uploadDocuments(badInput, uploader)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("Restricted documents must be linked to a course"),
    });
    expect(storagePut).not.toHaveBeenCalled();
    expect(insertTx).not.toHaveBeenCalled();
  });

  it("accepts a restricted upload when the user teaches the course", async () => {
    canUploadToCourse.mockReturnValue(true);
    courseExists.mockResolvedValue(true);
    const okInput = { ...input([makeFile("a.pdf", "x")]) };
    okInput.visibility = "restricted";
    okInput.courseId = "c1";

    const res = await uploadDocuments(okInput, uploader);
    expect(res[0].success).toBe(true);
    expect(insertTx).toHaveBeenCalledWith(
      expect.objectContaining({
        documentValues: expect.objectContaining({
          visibility: "restricted",
          courseId: "c1",
        }),
      }),
    );
  });

  it("SP4: a lecturer may upload to a course they do not teach (uploads are open)", async () => {
    courseExists.mockResolvedValue(true);
    const okInput = { ...input([makeFile("a.pdf", "x")]) };
    okInput.visibility = "restricted";
    okInput.courseId = "c-not-mine";

    const res = await uploadDocuments(okInput, uploader);
    expect(res[0].success).toBe(true);
    expect(insertTx).toHaveBeenCalled();
  });

  it("returns a clean 400 when courseId is well-formed but unknown", async () => {
    canUploadToCourse.mockReturnValue(true);
    courseExists.mockResolvedValue(false);
    const badInput = { ...input([makeFile("a.pdf", "x")]) };
    badInput.courseId = "00000000-0000-0000-0000-000000000000";

    await expect(uploadDocuments(badInput, uploader)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("Target course does not exist"),
    });
    expect(storagePut).not.toHaveBeenCalled();
    expect(insertTx).not.toHaveBeenCalled();
  });
});
