import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repositories/documents.repo", () => ({
  findAliveDocumentsByChecksum: vi.fn(),
}));

import * as docsRepo from "../../repositories/documents.repo";
import { findVisibleDuplicateByChecksum } from "./dedup.service";
import type { AuthenticatedUser } from "../../middlewares/auth";

const findAliveDocumentsByChecksum = vi.mocked(
  docsRepo.findAliveDocumentsByChecksum,
);

function mkUser(id: string, role: "student" | "lecturer" | "admin" = "student"): AuthenticatedUser {
  return {
    id,
    email: `${id}@x.com`,
    displayName: id,
    isActive: true,
    primaryRole: role,
    roles: [role],
    enrollments: [],
  } as unknown as AuthenticatedUser;
}

beforeEach(() => {
  findAliveDocumentsByChecksum.mockReset();
});

describe("findVisibleDuplicateByChecksum", () => {
  it("returns null on empty checksum without hitting the repo", async () => {
    const res = await findVisibleDuplicateByChecksum("", mkUser("u1"));
    expect(res).toBeNull();
    expect(findAliveDocumentsByChecksum).not.toHaveBeenCalled();
  });

  it("returns null when no documents match", async () => {
    findAliveDocumentsByChecksum.mockResolvedValue([]);
    const res = await findVisibleDuplicateByChecksum("a".repeat(64), mkUser("u1"));
    expect(res).toBeNull();
  });

  it("returns the first candidate when caller can view it", async () => {
    const uploadedAt = new Date("2026-05-26T12:00:00Z");
    findAliveDocumentsByChecksum.mockResolvedValue([
      {
        documentId: "doc-1",
        documentTitle: "Lecture 3",
        uploaderId: "u-other",
        ownerId: "u-other",
        uploaderDisplayName: "Other User",
        uploadedAt,
        visibility: "public",
        status: "published",
        courseId: null,
      },
    ]);
    const res = await findVisibleDuplicateByChecksum(
      "a".repeat(64),
      mkUser("u1"),
    );
    expect(res).toEqual({
      documentId: "doc-1",
      title: "Lecture 3",
      uploaderDisplayName: "Other User",
      uploadedAt: uploadedAt.toISOString(),
    });
  });

  it("hides a private duplicate uploaded by another user", async () => {
    findAliveDocumentsByChecksum.mockResolvedValue([
      {
        documentId: "doc-secret",
        documentTitle: "Secret Notes",
        uploaderId: "u-other",
        ownerId: "u-other",
        uploaderDisplayName: "Other User",
        uploadedAt: new Date("2026-05-26T12:00:00Z"),
        visibility: "private",
        status: "published",
        courseId: null,
      },
    ]);
    const res = await findVisibleDuplicateByChecksum(
      "a".repeat(64),
      mkUser("u1"),
    );
    expect(res).toBeNull();
  });

  it("hides an in-review duplicate uploaded by another user", async () => {
    findAliveDocumentsByChecksum.mockResolvedValue([
      {
        documentId: "doc-pending",
        documentTitle: "Pending Notes",
        uploaderId: "u-other",
        ownerId: "u-other",
        uploaderDisplayName: "Other User",
        uploadedAt: new Date("2026-05-26T12:00:00Z"),
        visibility: "public",
        status: "pending_review",
        courseId: null,
      },
    ]);
    const res = await findVisibleDuplicateByChecksum(
      "a".repeat(64),
      mkUser("u1"),
    );
    expect(res).toBeNull();
  });
});
