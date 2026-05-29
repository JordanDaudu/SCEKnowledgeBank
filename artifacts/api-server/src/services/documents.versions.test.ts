import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the whole dependency surface of the versioning service paths
// so we can drive them in isolation. The point is to verify the
// permission gates, quota gate, and the "restore reuses storage_path
// without double-counting quota" invariant.

vi.mock("../repositories/documents.repo", () => ({
  findByIdAlive: vi.fn(),
  findVersionsByDocument: vi.fn(),
  findVersionByIdAndDocument: vi.fn(),
  insertNewVersionFile: vi.fn(),
  updateDocumentByIdIfStatus: vi.fn(),
}));
vi.mock("./quota.service", () => ({
  effectiveQuotaForUser: vi.fn(),
  effectiveQuotaById: vi.fn(),
  canFit: (q: { usedBytes: bigint; quotaBytes: bigint }, s: bigint) =>
    q.usedBytes + s <= q.quotaBytes,
  remainingBytes: (q: { usedBytes: bigint; quotaBytes: bigint }) =>
    q.quotaBytes - q.usedBytes > 0n ? q.quotaBytes - q.usedBytes : 0n,
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
vi.mock("./audit.service", () => ({ record: vi.fn() }));
vi.mock("./permissions.service", async () => {
  const actual = await vi.importActual<
    typeof import("./permissions.service")
  >("./permissions.service");
  return {
    ...actual,
    canView: vi.fn().mockReturnValue(true),
    canManageVersions: vi.fn().mockReturnValue(true),
  };
});
vi.mock("../lib/mime-sniff", () => ({
  mimeMatchesContent: vi.fn().mockReturnValue(true),
}));
vi.mock("./documents/metadata.service", () => ({
  extractMetadata: vi.fn().mockResolvedValue({}),
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
import * as quotaService from "./quota.service";
import * as permissions from "./permissions.service";
import {
  uploadNewVersion,
  restoreVersion,
  listVersions,
} from "./documents.service";
import type { AuthenticatedUser } from "../middlewares/auth";

const findDoc = vi.mocked(docsRepo.findByIdAlive);
const findVersions = vi.mocked(docsRepo.findVersionsByDocument);
const findVersionById = vi.mocked(docsRepo.findVersionByIdAndDocument);
const insertVersion = vi.mocked(docsRepo.insertNewVersionFile);
const updateIfStatus = vi.mocked(docsRepo.updateDocumentByIdIfStatus);
const effQuotaForUser = vi.mocked(quotaService.effectiveQuotaForUser);
const canManageVersions = vi.mocked(permissions.canManageVersions);
const canView = vi.mocked(permissions.canView);

const lecturer: AuthenticatedUser = {
  id: "lect-1",
  email: "lect@x.com",
  displayName: "Lect",
  isActive: true,
  primaryRole: "lecturer",
  roles: ["lecturer"],
  enrollments: [{ courseId: "c1", roleInCourse: "lecturer" }],
} as AuthenticatedUser;

const student: AuthenticatedUser = {
  id: "stu-1",
  email: "stu@x.com",
  displayName: "Stu",
  isActive: true,
  primaryRole: "student",
  roles: ["student"],
  enrollments: [],
} as AuthenticatedUser;

function fakeFile(name = "v2.pdf", body = "hello v2") {
  const buffer = Buffer.from(body);
  return {
    fieldname: "file",
    originalname: name,
    encoding: "7bit",
    mimetype: "application/pdf",
    size: buffer.length,
    buffer,
  } as Express.Multer.File;
}

function fakeDoc(over: Partial<docsRepo.DocumentRow> = {}) {
  return {
    id: "doc-1",
    uploaderId: lecturer.id,
    ownerId: lecturer.id,
    courseId: "c1",
    visibility: "public",
    currentVersion: 1,
    ...over,
  } as docsRepo.DocumentRow;
}

function fakeVersionRow(
  over: Partial<docsRepo.DocumentVersionRow> = {},
): docsRepo.DocumentVersionRow {
  return {
    id: "ver-id",
    documentId: "doc-1",
    versionNumber: 1,
    originalFilename: "v1.pdf",
    displayFilename: "v1.pdf",
    mimeType: "application/pdf",
    sizeBytes: 100,
    storagePath: "documents/do/doc-1.v1",
    storageDriver: "local",
    checksum: "abc",
    changeNote: null,
    uploadedById: lecturer.id,
    uploadedAt: new Date(),
    isCurrent: true,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  canManageVersions.mockReturnValue(true);
  canView.mockReturnValue(true);
  storagePut.mockImplementation(async (a: { key: string; precomputedChecksum?: string }) => ({
    key: a.key,
    size: 0,
    checksum: a.precomputedChecksum ?? "deadbeef",
    driver: "local",
  }));
});

describe("uploadNewVersion — uploader bypass + re-review", () => {
  beforeEach(() => {
    effQuotaForUser.mockResolvedValue({
      usedBytes: 0n,
      quotaBytes: 1_000_000n,
    } as never);
    insertVersion.mockResolvedValue(
      fakeVersionRow({ versionNumber: 2, isCurrent: true }),
    );
    updateIfStatus.mockResolvedValue(1);
  });

  it("lets the original uploader add a version to their own doc without manage rights", async () => {
    canManageVersions.mockReturnValue(false);
    findDoc.mockResolvedValue(
      fakeDoc({ uploaderId: student.id, ownerId: student.id, status: "approved" }),
    );
    await expect(
      uploadNewVersion("doc-1", { file: fakeFile() }, student),
    ).resolves.toBeTruthy();
    expect(insertVersion).toHaveBeenCalled();
  });

  it("re-enters review when a non-manager uploader versions an already-approved doc", async () => {
    canManageVersions.mockReturnValue(false);
    findDoc.mockResolvedValue(
      fakeDoc({ uploaderId: student.id, ownerId: student.id, status: "approved" }),
    );
    await uploadNewVersion("doc-1", { file: fakeFile() }, student);
    expect(updateIfStatus).toHaveBeenCalledWith(
      "doc-1",
      "approved",
      expect.objectContaining({ status: "pending_review" }),
    );
  });

  it("does NOT change status when the uploader's doc is still a draft", async () => {
    canManageVersions.mockReturnValue(false);
    findDoc.mockResolvedValue(
      fakeDoc({ uploaderId: student.id, ownerId: student.id, status: "draft" }),
    );
    await uploadNewVersion("doc-1", { file: fakeFile() }, student);
    expect(updateIfStatus).not.toHaveBeenCalled();
  });

  it("does NOT re-review when a manager versions an approved doc", async () => {
    canManageVersions.mockReturnValue(true);
    findDoc.mockResolvedValue(fakeDoc({ status: "approved" }));
    await uploadNewVersion("doc-1", { file: fakeFile() }, lecturer);
    expect(updateIfStatus).not.toHaveBeenCalled();
  });

  it("still rejects a non-uploader who cannot manage versions", async () => {
    canManageVersions.mockReturnValue(false);
    findDoc.mockResolvedValue(
      fakeDoc({ uploaderId: "someone-else", ownerId: "someone-else", status: "approved" }),
    );
    await expect(
      uploadNewVersion("doc-1", { file: fakeFile() }, student),
    ).rejects.toMatchObject({ status: 403 });
    expect(insertVersion).not.toHaveBeenCalled();
  });
});

describe("listVersions", () => {
  it("404s when the document is missing", async () => {
    findDoc.mockResolvedValue(null);
    await expect(listVersions("doc-x", lecturer)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("403s when the user cannot view the document", async () => {
    findDoc.mockResolvedValue(fakeDoc({ visibility: "private", uploaderId: "x" }));
    canView.mockReturnValue(false);
    await expect(listVersions("doc-1", student)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("returns rows from the repo", async () => {
    findDoc.mockResolvedValue(fakeDoc());
    findVersions.mockResolvedValue([
      fakeVersionRow({ versionNumber: 2, isCurrent: true, id: "v2" }),
      fakeVersionRow({ versionNumber: 1, isCurrent: false, id: "v1" }),
    ]);
    const dtos = await listVersions("doc-1", lecturer);
    expect(dtos.map((d) => d.versionNumber)).toEqual([2, 1]);
    expect(dtos[0].isCurrent).toBe(true);
  });
});

describe("uploadNewVersion", () => {
  it("403s when the user cannot manage versions", async () => {
    findDoc.mockResolvedValue(fakeDoc());
    canManageVersions.mockReturnValue(false);
    await expect(
      uploadNewVersion("doc-1", { file: fakeFile() }, student),
    ).rejects.toMatchObject({ status: 403 });
    expect(insertVersion).not.toHaveBeenCalled();
  });

  it("rejects when the uploader's quota would be exceeded", async () => {
    findDoc.mockResolvedValue(fakeDoc());
    effQuotaForUser.mockResolvedValue({ usedBytes: 95n, quotaBytes: 100n });
    await expect(
      uploadNewVersion("doc-1", { file: fakeFile("v.pdf", "x".repeat(20)) }, lecturer),
    ).rejects.toMatchObject({ status: 400 });
    expect(insertVersion).not.toHaveBeenCalled();
  });

  it("persists a new version and bumps quota when the gate passes", async () => {
    findDoc.mockResolvedValue(fakeDoc());
    effQuotaForUser.mockResolvedValue({ usedBytes: 0n, quotaBytes: 1_000_000n });
    insertVersion.mockResolvedValue(
      fakeVersionRow({ versionNumber: 2, isCurrent: true, changeNote: "fix typos" }),
    );
    const dto = await uploadNewVersion(
      "doc-1",
      { file: fakeFile("v2.pdf", "hello v2"), changeNote: "fix typos" },
      lecturer,
    );
    expect(dto.versionNumber).toBe(2);
    expect(insertVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "doc-1",
        uploadedById: lecturer.id,
        countTowardQuota: true,
        uploaderIdForQuota: lecturer.id,
        fileValues: expect.objectContaining({ changeNote: "fix typos" }),
      }),
    );
    expect(storagePut).toHaveBeenCalled();
  });
});

describe("restoreVersion", () => {
  it("404s when the version does not belong to the document", async () => {
    findDoc.mockResolvedValue(fakeDoc());
    findVersionById.mockResolvedValue(null);
    await expect(
      restoreVersion("doc-1", "v-foreign", lecturer),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("400s when trying to restore the version that is already current", async () => {
    findDoc.mockResolvedValue(fakeDoc());
    findVersionById.mockResolvedValue(
      fakeVersionRow({ versionNumber: 3, isCurrent: true }),
    );
    await expect(
      restoreVersion("doc-1", "v3", lecturer),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("403s when the user cannot manage versions", async () => {
    findDoc.mockResolvedValue(fakeDoc());
    canManageVersions.mockReturnValue(false);
    await expect(
      restoreVersion("doc-1", "v1", student),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("inserts a new version that reuses storage_path and does NOT count toward quota", async () => {
    findDoc.mockResolvedValue(fakeDoc({ currentVersion: 3 }));
    findVersionById.mockResolvedValue(
      fakeVersionRow({
        id: "v1",
        versionNumber: 1,
        isCurrent: false,
        sizeBytes: 500,
        storagePath: "documents/do/doc-1.v1.original",
        checksum: "checksum-v1",
      }),
    );
    insertVersion.mockResolvedValue(
      fakeVersionRow({ versionNumber: 4, isCurrent: true }),
    );

    await restoreVersion("doc-1", "v1", lecturer);

    expect(insertVersion).toHaveBeenCalledTimes(1);
    const args = insertVersion.mock.calls[0][0];
    // Critical invariant: blob is shared, not re-uploaded.
    expect(args.fileValues.storagePath).toBe(
      "documents/do/doc-1.v1.original",
    );
    expect(args.fileValues.checksum).toBe("checksum-v1");
    // Quota must NOT be bumped — we're pointing at existing bytes.
    expect(args.countTowardQuota).toBe(false);
    // Change note is auto-generated to record provenance.
    expect(args.fileValues.changeNote).toMatch(/Restored from version 1/);
    // No new storage write either.
    expect(storagePut).not.toHaveBeenCalled();
  });
});
