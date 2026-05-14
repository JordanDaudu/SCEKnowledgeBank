import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/documents.repo", () => ({
  listDocuments: vi.fn(),
  countDocuments: vi.fn(),
  findByIdAlive: vi.fn(),
  findManyByIdsAlive: vi.fn(),
  findFilesByDocumentIds: vi.fn().mockResolvedValue([]),
  findTagLinksForDocuments: vi.fn().mockResolvedValue([]),
  findDocumentIdsByTagIds: vi.fn(),
  findUploaderDisplayFilenames: vi.fn(),
  insertDocument: vi.fn(),
  insertDocumentFile: vi.fn().mockResolvedValue(undefined),
  addDocumentTags: vi.fn().mockResolvedValue(undefined),
  updateDocumentById: vi.fn().mockResolvedValue(undefined),
  replaceDocumentTags: vi.fn().mockResolvedValue(undefined),
  softDeleteDocument: vi.fn().mockResolvedValue(undefined),
  findLatestFileForDocument: vi.fn(),
}));
vi.mock("../repositories/taxonomy.repo", () => ({
  findCourseIdsByCodeOrLecturer: vi.fn(),
  findCourseCodesByIds: vi.fn().mockResolvedValue(new Map()),
  findCoursesByIds: vi.fn().mockResolvedValue([]),
  findCategoriesByIds: vi.fn().mockResolvedValue([]),
}));
vi.mock("../repositories/comments.repo", () => ({
  countAliveByDocumentIds: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("../repositories/viewHistory.repo", () => ({
  recordView: vi.fn().mockResolvedValue(undefined),
  tryRecordView: vi.fn().mockResolvedValue(undefined),
  listRecentDocumentIdsForUser: vi.fn().mockResolvedValue([]),
  countViewsByDocumentIds: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("./users.service", () => ({
  loadUserSummaries: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("./taxonomy.service", () => ({
  loadCourses: vi.fn().mockResolvedValue(new Map()),
  loadCategories: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("./audit.service", () => ({
  record: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/storage", () => ({
  getStorage: () => ({
    put: vi.fn(async ({ key }: { key: string }) => ({
      key,
      driver: "local",
      checksum: "abc",
    })),
    getStream: vi.fn(),
  }),
}));
vi.mock("../lib/env", () => ({
  env: {
    allowedMimeTypes: ["application/pdf", "text/plain"],
  },
}));
vi.mock("../lib/mime-sniff", () => ({
  mimeMatchesContent: vi.fn(() => true),
}));

import * as docsRepo from "../repositories/documents.repo";
import * as taxonomyRepo from "../repositories/taxonomy.repo";
import { mimeMatchesContent } from "../lib/mime-sniff";
import type { AuthenticatedUser } from "../middlewares/auth";
import {
  listDocuments,
  uploadDocuments,
} from "./documents.service";

const listDocsRepo = vi.mocked(docsRepo.listDocuments);
const countDocsRepo = vi.mocked(docsRepo.countDocuments);
const findDocIdsByTagIds = vi.mocked(docsRepo.findDocumentIdsByTagIds);
const findCourseIdsByCodeOrLecturer = vi.mocked(
  taxonomyRepo.findCourseIdsByCodeOrLecturer,
);
const findUploaderDisplayFilenames = vi.mocked(
  docsRepo.findUploaderDisplayFilenames,
);
const insertDocument = vi.mocked(docsRepo.insertDocument);
const insertDocumentFile = vi.mocked(docsRepo.insertDocumentFile);
const mimeMatches = vi.mocked(mimeMatchesContent);

const student: AuthenticatedUser = {
  id: "student-1",
  email: "s@x.com",
  displayName: "Student",
  isActive: true,
  primaryRole: "student",
  roles: ["student"],
};
const admin: AuthenticatedUser = { ...student, id: "admin", roles: ["admin"] };

beforeEach(() => {
  vi.clearAllMocks();
  listDocsRepo.mockResolvedValue([]);
  countDocsRepo.mockResolvedValue(0);
  mimeMatches.mockReturnValue(true);
  findUploaderDisplayFilenames.mockResolvedValue([]);
});

describe("listDocuments visibility scoping", () => {
  it("scopes non-admin users to private-allowed-for", async () => {
    await listDocuments(
      { sort: "newest", page: 1, pageSize: 10 },
      student,
    );
    expect(listDocsRepo).toHaveBeenCalled();
    const filters = listDocsRepo.mock.calls[0]![0];
    expect(filters.visibility).toEqual({
      mode: "private-allowed-for",
      userId: "student-1",
    });
  });

  it("gives admins the `all` visibility scope", async () => {
    await listDocuments({ sort: "newest", page: 1, pageSize: 10 }, admin);
    const filters = listDocsRepo.mock.calls[0]![0];
    expect(filters.visibility).toEqual({ mode: "all" });
  });

  it("forwards date, q, semester, and academicYear filters", async () => {
    const dateFrom = new Date("2025-01-01");
    const dateTo = new Date("2025-02-01");
    await listDocuments(
      {
        sort: "newest",
        page: 1,
        pageSize: 10,
        q: "midterm",
        semester: "fall",
        academicYear: 2025,
        dateFrom,
        dateTo,
      },
      student,
    );
    const filters = listDocsRepo.mock.calls[0]![0];
    expect(filters).toMatchObject({
      q: "midterm",
      semester: "fall",
      academicYear: 2025,
      dateFrom,
      dateTo,
    });
  });
});

describe("listDocuments tag and course-code shortcuts", () => {
  it("returns empty result when courseCode/lecturerName resolve to zero courses", async () => {
    findCourseIdsByCodeOrLecturer.mockResolvedValueOnce([]);
    const result = await listDocuments(
      { sort: "newest", page: 1, pageSize: 10, courseCode: "CS101" },
      student,
    );
    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 10 });
    expect(listDocsRepo).not.toHaveBeenCalled();
  });

  it("returns empty result when tagIds resolve to zero documents", async () => {
    findDocIdsByTagIds.mockResolvedValueOnce([]);
    const result = await listDocuments(
      { sort: "newest", page: 1, pageSize: 10, tagIds: ["t1"] },
      student,
    );
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(listDocsRepo).not.toHaveBeenCalled();
  });
});

describe("uploadDocuments", () => {
  const pdfBuffer = Buffer.from("%PDF-1.4\n%fake");

  function makeFile(
    overrides: Partial<Express.Multer.File> = {},
  ): Express.Multer.File {
    return {
      fieldname: "files",
      originalname: "notes.pdf",
      encoding: "7bit",
      mimetype: "application/pdf",
      size: pdfBuffer.length,
      buffer: pdfBuffer,
      destination: "",
      filename: "",
      path: "",
      stream: undefined as never,
      ...overrides,
    } as Express.Multer.File;
  }

  it("rejects when no files are provided", async () => {
    await expect(
      uploadDocuments(
        {
          files: [],
          materialType: "notes",
          visibility: "public",
          description: "",
          tagIds: [],
        },
        student,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("flags disallowed mime types without persisting", async () => {
    const result = await uploadDocuments(
      {
        files: [makeFile({ mimetype: "application/x-evil" })],
        materialType: "notes",
        visibility: "public",
        description: "",
        tagIds: [],
      },
      student,
    );
    expect(result[0]).toMatchObject({
      success: false,
      errorCode: "disallowed_mime",
    });
    expect(insertDocument).not.toHaveBeenCalled();
  });

  it("flags content/declared-mime mismatches", async () => {
    mimeMatches.mockReturnValueOnce(false);
    const result = await uploadDocuments(
      {
        files: [makeFile()],
        materialType: "notes",
        visibility: "public",
        description: "",
        tagIds: [],
      },
      student,
    );
    expect(result[0]).toMatchObject({
      success: false,
      errorCode: "mime_mismatch",
    });
    expect(insertDocument).not.toHaveBeenCalled();
  });

  it("preserves originalFilename and suffixes displayFilename when the uploader already has the same name", async () => {
    findUploaderDisplayFilenames.mockResolvedValueOnce(["notes.pdf"]);
    insertDocument.mockImplementation(async (v) => ({
      ...v,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    }) as never);

    const result = await uploadDocuments(
      {
        files: [makeFile()],
        materialType: "notes",
        visibility: "public",
        description: "",
        tagIds: [],
      },
      student,
    );
    expect(result[0].success).toBe(true);
    expect(insertDocumentFile).toHaveBeenCalledWith(
      expect.objectContaining({
        originalFilename: "notes.pdf",
        displayFilename: "notes (2).pdf",
      }),
    );
  });

  it("uses titleOverride only when uploading exactly one file", async () => {
    insertDocument.mockImplementation(async (v) => ({
      ...v,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    }) as never);
    await uploadDocuments(
      {
        files: [makeFile()],
        materialType: "notes",
        visibility: "public",
        description: "",
        tagIds: [],
        titleOverride: "Final Exam Notes",
      },
      student,
    );
    expect(insertDocument).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Final Exam Notes" }),
    );

    insertDocument.mockClear();
    await uploadDocuments(
      {
        files: [
          makeFile({ originalname: "a.pdf" }),
          makeFile({ originalname: "b.pdf" }),
        ],
        materialType: "notes",
        visibility: "public",
        description: "",
        tagIds: [],
        titleOverride: "Should Not Apply",
      },
      student,
    );
    const titles = insertDocument.mock.calls.map(
      (c) => (c[0] as { title: string }).title,
    );
    expect(titles).toEqual(["a", "b"]);
  });
});
