import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/comments.repo", () => ({
  listAliveByDocument: vi.fn(),
  findAliveById: vi.fn(),
  insertComment: vi.fn(),
  softDeleteById: vi.fn(),
  countAliveByDocumentIds: vi.fn(),
}));
vi.mock("../repositories/documents.repo", () => ({
  findByIdAlive: vi.fn(),
}));
vi.mock("./users.service", () => ({
  loadUserSummaries: vi.fn(async (ids: string[]) => {
    const m = new Map();
    for (const id of ids) {
      m.set(id, {
        id,
        email: `${id}@example.com`,
        displayName: id,
        roles: ["student"],
        isActive: true,
        createdAt: "2025-01-01T00:00:00.000Z",
      });
    }
    return m;
  }),
}));
vi.mock("./audit.service", () => ({
  record: vi.fn().mockResolvedValue(undefined),
}));

import * as commentsRepo from "../repositories/comments.repo";
import * as docsRepo from "../repositories/documents.repo";
import type { AuthenticatedUser } from "../middlewares/auth";
import {
  createForDocument,
  deleteComment,
  listForDocument,
} from "./comments.service";

const findAliveById = vi.mocked(commentsRepo.findAliveById);
const listAlive = vi.mocked(commentsRepo.listAliveByDocument);
const insertComment = vi.mocked(commentsRepo.insertComment);
const softDeleteById = vi.mocked(commentsRepo.softDeleteById);
const findDoc = vi.mocked(docsRepo.findByIdAlive);

const user: AuthenticatedUser = {
  id: "u1",
  email: "u1@x.com",
  displayName: "U1",
  isActive: true,
  primaryRole: "student",
  roles: ["student"],
};
const admin: AuthenticatedUser = { ...user, id: "admin", roles: ["admin"] };

function makeDoc(overrides: Partial<{ visibility: string; uploaderId: string; ownerId: string }> = {}) {
  return {
    id: "doc-1",
    visibility: overrides.visibility ?? "public",
    uploaderId: overrides.uploaderId ?? "other",
    ownerId: overrides.ownerId ?? "other",
  } as never as Awaited<ReturnType<typeof docsRepo.findByIdAlive>>;
}

function makeComment(overrides: Partial<{ id: string; parentId: string | null; documentId: string; authorId: string }> = {}) {
  return {
    id: overrides.id ?? "c1",
    documentId: overrides.documentId ?? "doc-1",
    parentId: overrides.parentId ?? null,
    authorId: overrides.authorId ?? "u1",
    body: "hi",
    pageNumber: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    deletedAt: null,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  findDoc.mockResolvedValue(makeDoc());
});

describe("createForDocument nesting rules", () => {
  it("rejects replying to a reply (only one level deep allowed)", async () => {
    findAliveById.mockResolvedValueOnce(
      makeComment({ id: "parent", parentId: "grandparent" }),
    );
    await expect(
      createForDocument("doc-1", { body: "x", parentId: "parent" }, user),
    ).rejects.toMatchObject({ status: 400 });
    expect(insertComment).not.toHaveBeenCalled();
  });

  it("rejects parentId that belongs to a different document", async () => {
    findAliveById.mockResolvedValueOnce(
      makeComment({ id: "parent", documentId: "other-doc" }),
    );
    await expect(
      createForDocument("doc-1", { body: "x", parentId: "parent" }, user),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects parentId that does not resolve to an alive comment", async () => {
    findAliveById.mockResolvedValueOnce(null);
    await expect(
      createForDocument("doc-1", { body: "x", parentId: "ghost" }, user),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("allows a top-level reply to a root comment", async () => {
    findAliveById.mockResolvedValueOnce(
      makeComment({ id: "parent", parentId: null }),
    );
    insertComment.mockResolvedValueOnce(
      makeComment({ id: "c2", parentId: "parent" }),
    );
    const dto = await createForDocument(
      "doc-1",
      { body: "x", parentId: "parent" },
      user,
    );
    expect(dto.parentId).toBe("parent");
    expect(insertComment).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "doc-1", parentId: "parent" }),
    );
  });

  it("forbids commenting on a private doc that the user does not own", async () => {
    findDoc.mockResolvedValueOnce(
      makeDoc({ visibility: "private", uploaderId: "other", ownerId: "other" }),
    );
    await expect(
      createForDocument("doc-1", { body: "x" }, user),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("listForDocument", () => {
  it("nests replies under their parent", async () => {
    listAlive.mockResolvedValueOnce([
      makeComment({ id: "root1" }),
      makeComment({ id: "reply1", parentId: "root1" }),
      makeComment({ id: "root2" }),
      makeComment({ id: "orphan", parentId: "missing-parent" }),
    ]);
    const tree = await listForDocument("doc-1", user);
    expect(tree.map((c) => c.id)).toEqual(["root1", "root2", "orphan"]);
    const root1 = tree.find((c) => c.id === "root1")!;
    expect(root1.replies.map((r) => r.id)).toEqual(["reply1"]);
  });
});

describe("deleteComment authorization", () => {
  it("forbids deleting another user's comment", async () => {
    findAliveById.mockResolvedValueOnce(
      makeComment({ id: "c1", authorId: "other" }),
    );
    await expect(deleteComment("c1", user)).rejects.toMatchObject({
      status: 403,
    });
    expect(softDeleteById).not.toHaveBeenCalled();
  });

  it("allows the author to delete their own comment", async () => {
    findAliveById.mockResolvedValueOnce(
      makeComment({ id: "c1", authorId: user.id }),
    );
    await deleteComment("c1", user);
    expect(softDeleteById).toHaveBeenCalledWith("c1");
  });

  it("allows admins to delete any comment", async () => {
    findAliveById.mockResolvedValueOnce(
      makeComment({ id: "c1", authorId: "someone" }),
    );
    await deleteComment("c1", admin);
    expect(softDeleteById).toHaveBeenCalledWith("c1");
  });

  it("404s when the comment does not exist", async () => {
    findAliveById.mockResolvedValueOnce(null);
    await expect(deleteComment("missing", user)).rejects.toMatchObject({
      status: 404,
    });
  });
});
