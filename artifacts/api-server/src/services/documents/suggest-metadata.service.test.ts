import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {
    tag: { findMany: vi.fn() },
    category: { findFirst: vi.fn() },
  },
}));
vi.mock("./metadata.service", () => ({
  extractMetadata: vi.fn(),
}));
vi.mock("./dedup.service", () => ({
  findVisibleDuplicateByChecksum: vi.fn(),
}));

import { db } from "@workspace/db";
import { extractMetadata } from "./metadata.service";
import { findVisibleDuplicateByChecksum } from "./dedup.service";
import { suggestForUpload } from "./suggest-metadata.service";
import type { AuthenticatedUser } from "../../middlewares/auth";

const tagFindMany = vi.mocked(db.tag.findMany);
const categoryFindFirst = vi.mocked(db.category.findFirst);
const extractMock = vi.mocked(extractMetadata);
const dedupMock = vi.mocked(findVisibleDuplicateByChecksum);

const user = {
  id: "u1",
  email: "u1@x.com",
  displayName: "u1",
  isActive: true,
  primaryRole: "lecturer",
  roles: ["lecturer"],
  enrollments: [],
} as unknown as AuthenticatedUser;

beforeEach(() => {
  tagFindMany.mockReset();
  categoryFindFirst.mockReset();
  extractMock.mockReset();
  dedupMock.mockReset();
  tagFindMany.mockResolvedValue([]);
  categoryFindFirst.mockResolvedValue(null);
  dedupMock.mockResolvedValue(null);
});

describe("suggestForUpload", () => {
  it("returns a clean shape when extraction yields nothing", async () => {
    extractMock.mockResolvedValue({});
    const res = await suggestForUpload(
      { buffer: Buffer.from("x"), mimeType: "application/pdf", filename: "lecture-notes.pdf" },
      user,
    );
    expect(res.keywords).toEqual([]);
    expect(res.tags).toEqual([]);
    expect(res.category).toBeUndefined();
    expect(res.duplicate).toBeUndefined();
    expect(res.title).toBe("Lecture Notes"); // humanised filename stem
  });

  it("derives materialType, semester and year from the filename", async () => {
    extractMock.mockResolvedValue({});
    const res = await suggestForUpload(
      {
        buffer: Buffer.from("x"),
        mimeType: "application/pdf",
        filename: "CS101-final-exam-fall-2024.pdf",
      },
      user,
    );
    expect(res.materialType).toBe("exam");
    expect(res.materialTypeSource).toBe("filename");
    expect(res.semester).toBe("fall");
    expect(res.academicYear).toBe(2024);
  });

  it("populates suggestions with extracted keywords and matched tags", async () => {
    extractMock.mockResolvedValue({
      language: "en",
      keywords: ["algebra", "matrix", "vector"],
      detectedTitle: "Linear Algebra Notes",
    });
    tagFindMany.mockResolvedValue([
      { id: "t1", name: "algebra" },
      { id: "t2", name: "matrix" },
    ] as never);
    categoryFindFirst.mockResolvedValue({
      id: "c1",
      name: "algebra",
    } as never);
    dedupMock.mockResolvedValue({
      documentId: "doc-1",
      title: "Existing notes",
      uploaderDisplayName: "Alice",
      uploadedAt: "2026-05-01T00:00:00.000Z",
    });

    const res = await suggestForUpload(
      {
        buffer: Buffer.from("hello"),
        mimeType: "application/pdf",
        filename: "linear-algebra.pdf",
      },
      user,
    );

    expect(res.title).toBe("Linear Algebra Notes");
    expect(res.language).toBe("en");
    expect(res.keywords).toEqual(["algebra", "matrix", "vector"]);
    expect(res.tags).toEqual([
      { id: "t1", name: "algebra" },
      { id: "t2", name: "matrix" },
    ]);
    expect(res.category).toEqual({ id: "c1", name: "algebra" });
    expect(res.duplicate?.documentId).toBe("doc-1");
  });
});
