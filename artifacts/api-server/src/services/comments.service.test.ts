import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/comments.repo", () => ({
  listAliveByDocument: vi.fn(),
  findAliveById: vi.fn(),
  insertComment: vi.fn(),
  softDeleteById: vi.fn(),
  countAliveByDocumentIds: vi.fn(),
  insertMentions: vi.fn().mockResolvedValue(undefined),
  listMentionsByCommentIds: vi.fn().mockResolvedValue(new Map()),
  deleteMentionsByCommentId: vi.fn().mockResolvedValue(undefined),
  updateById: vi.fn(),
}));
vi.mock("../repositories/documents.repo", () => ({
  findByIdAlive: vi.fn(),
}));
vi.mock("../repositories/users.repo", () => ({
  findActiveByDisplayNames: vi.fn().mockResolvedValue([]),
  findActiveByIds: vi.fn().mockResolvedValue([]),
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
vi.mock("./notifications.service", () => ({
  notify: vi.fn().mockResolvedValue(undefined),
}));

import * as commentsRepo from "../repositories/comments.repo";
import * as docsRepo from "../repositories/documents.repo";
import * as usersRepo from "../repositories/users.repo";
import * as notificationsService from "./notifications.service";
import type { AuthenticatedUser } from "../middlewares/auth";
import {
  createForDocument,
  deleteComment,
  listForDocument,
  parseMentionTokens,
  updateComment,
} from "./comments.service";

const deleteMentions = vi.mocked(commentsRepo.deleteMentionsByCommentId);
const updateCommentById = vi.mocked(commentsRepo.updateById);

const findAliveById = vi.mocked(commentsRepo.findAliveById);
const listAlive = vi.mocked(commentsRepo.listAliveByDocument);
const insertComment = vi.mocked(commentsRepo.insertComment);
const softDeleteById = vi.mocked(commentsRepo.softDeleteById);
const insertMentions = vi.mocked(commentsRepo.insertMentions);
const listMentions = vi.mocked(commentsRepo.listMentionsByCommentIds);
const findDoc = vi.mocked(docsRepo.findByIdAlive);
const findByNames = vi.mocked(usersRepo.findActiveByDisplayNames);
const findByIds = vi.mocked(usersRepo.findActiveByIds);

const user: AuthenticatedUser = {
  id: "u1",
  email: "u1@x.com",
  displayName: "U1",
  isActive: true,
  primaryRole: "student",
  roles: ["student"],
  enrollments: [],
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
  it("allows replying to a reply (arbitrary depth)", async () => {
    // Task #29 dropped the one-level depth cap. The service must
    // accept a parent that itself has a parent, with no special-case.
    findAliveById.mockResolvedValueOnce(
      makeComment({ id: "parent", parentId: "grandparent" }),
    );
    insertComment.mockResolvedValueOnce(
      makeComment({ id: "deep", parentId: "parent" }),
    );
    const dto = await createForDocument(
      "doc-1",
      { body: "deeper still", parentId: "parent" },
      user,
    );
    expect(dto.parentId).toBe("parent");
    expect(insertComment).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "doc-1", parentId: "parent" }),
    );
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
  it("nests replies under their parent at arbitrary depth", async () => {
    listAlive.mockResolvedValueOnce([
      makeComment({ id: "root1" }),
      makeComment({ id: "reply1", parentId: "root1" }),
      makeComment({ id: "reply1a", parentId: "reply1" }),
      makeComment({ id: "reply1a1", parentId: "reply1a" }),
      makeComment({ id: "root2" }),
      makeComment({ id: "orphan", parentId: "missing-parent" }),
    ]);
    const tree = await listForDocument("doc-1", user);
    expect(tree.map((c) => c.id)).toEqual(["root1", "root2", "orphan"]);
    const root1 = tree.find((c) => c.id === "root1")!;
    expect(root1.replies.map((r) => r.id)).toEqual(["reply1"]);
    expect(root1.replies[0]!.replies.map((r) => r.id)).toEqual(["reply1a"]);
    expect(root1.replies[0]!.replies[0]!.replies.map((r) => r.id)).toEqual([
      "reply1a1",
    ]);
  });

  it("surfaces persisted mentions on each comment DTO", async () => {
    listAlive.mockResolvedValueOnce([
      makeComment({ id: "c1" }),
      makeComment({ id: "c2" }),
    ]);
    listMentions.mockResolvedValueOnce(
      new Map([
        ["c1", ["mentioned-1", "mentioned-2"]],
        ["c2", []],
      ]),
    );
    const tree = await listForDocument("doc-1", user);
    const c1 = tree.find((c) => c.id === "c1")!;
    expect(c1.mentions.map((m) => m.id).sort()).toEqual([
      "mentioned-1",
      "mentioned-2",
    ]);
    const c2 = tree.find((c) => c.id === "c2")!;
    expect(c2.mentions).toEqual([]);
  });
});

describe("parseMentionTokens", () => {
  it("extracts simple @displayName tokens", () => {
    const { displayNames, userIds } = parseMentionTokens(
      "Hi @Alice and @bob_2, please look.",
    );
    expect(displayNames.sort()).toEqual(["Alice", "bob_2"]);
    expect(userIds).toEqual([]);
  });

  it("does not match @ embedded inside another word (email-like)", () => {
    const { displayNames } = parseMentionTokens("contact me at user@example.com");
    expect(displayNames).toEqual([]);
  });

  it("extracts explicit @[uuid] tokens and lowercases them", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    const { userIds } = parseMentionTokens(`see @[${id.toUpperCase()}]`);
    expect(userIds).toEqual([id]);
  });
});

describe("createForDocument mention persistence", () => {
  it("resolves @displayName to user ids and persists them", async () => {
    insertComment.mockResolvedValueOnce(makeComment({ id: "new-c" }));
    findByNames.mockResolvedValueOnce([
      { id: "user-alice", displayName: "Alice" },
    ]);
    const dto = await createForDocument(
      "doc-1",
      { body: "Hi @Alice and @Ghost!" },
      user,
    );
    expect(findByNames).toHaveBeenCalledWith(
      expect.arrayContaining(["Alice", "Ghost"]),
    );
    expect(insertMentions).toHaveBeenCalledWith("new-c", ["user-alice"]);
    expect(dto.mentions.map((m) => m.id)).toEqual(["user-alice"]);
  });

  it("silently drops unresolved tokens without failing the write", async () => {
    insertComment.mockResolvedValueOnce(makeComment({ id: "new-c" }));
    findByNames.mockResolvedValueOnce([]);
    const dto = await createForDocument(
      "doc-1",
      { body: "Hi @nobody-here" },
      user,
    );
    expect(insertMentions).toHaveBeenCalledWith("new-c", []);
    expect(dto.mentions).toEqual([]);
    expect(dto.body).toBe("hi"); // body itself is not rewritten
  });

  it("resolves @displayName case-insensitively", async () => {
    insertComment.mockResolvedValueOnce(makeComment({ id: "new-c" }));
    // The repo is what performs the case-insensitive match in
    // production; here we just assert the service forwards the raw
    // token and trusts the repo's result.
    findByNames.mockResolvedValueOnce([
      { id: "user-alice", displayName: "Alice" },
    ]);
    const dto = await createForDocument(
      "doc-1",
      { body: "ping @alice" },
      user,
    );
    expect(findByNames).toHaveBeenCalledWith(["alice"]);
    expect(insertMentions).toHaveBeenCalledWith("new-c", ["user-alice"]);
    expect(dto.mentions.map((m) => m.id)).toEqual(["user-alice"]);
  });

  it("dedupes when the same user is mentioned via name and explicit id", async () => {
    insertComment.mockResolvedValueOnce(makeComment({ id: "new-c" }));
    findByNames.mockResolvedValueOnce([
      { id: "user-alice", displayName: "Alice" },
    ]);
    findByIds.mockResolvedValueOnce([{ id: "user-alice" }]);
    await createForDocument(
      "doc-1",
      { body: "Hi @Alice @[user-alice]" },
      user,
    );
    const call = insertMentions.mock.calls[0]!;
    expect(call[0]).toBe("new-c");
    expect(call[1]).toEqual(["user-alice"]);
  });
});

describe("updateComment re-parses mentions when body changes", () => {
  it("wipes old mentions and inserts fresh ones for the new body", async () => {
    findAliveById.mockResolvedValueOnce(
      makeComment({ id: "c1", authorId: user.id }),
    );
    updateCommentById.mockResolvedValueOnce(
      makeComment({ id: "c1", authorId: user.id }),
    );
    findByNames.mockResolvedValueOnce([
      { id: "user-bob", displayName: "Bob" },
    ]);
    await updateComment("c1", { body: "now mentioning @Bob" }, user);
    expect(deleteMentions).toHaveBeenCalledWith("c1");
    expect(insertMentions).toHaveBeenCalledWith("c1", ["user-bob"]);
  });

  it("leaves mentions alone when only pageNumber changes (no body edit)", async () => {
    findAliveById.mockResolvedValueOnce(
      makeComment({ id: "c1", authorId: user.id }),
    );
    updateCommentById.mockResolvedValueOnce(
      makeComment({ id: "c1", authorId: user.id }),
    );
    await updateComment("c1", { pageNumber: 7 }, user);
    expect(deleteMentions).not.toHaveBeenCalled();
    expect(insertMentions).not.toHaveBeenCalled();
  });
});

describe("createForDocument notification producer hooks", () => {
  // Sprint-3 M1: comment posts must fan out notifications for
  // @mentioned users and (for replies) the parent author. Fire-and-
  // forget — the comment write must not depend on notify resolving.
  const notify = vi.mocked(notificationsService.notify);

  it("notifies each mentioned user with type comment.mention", async () => {
    insertComment.mockResolvedValueOnce(makeComment({ id: "new-c" }));
    findByNames.mockResolvedValueOnce([
      { id: "user-alice", displayName: "Alice" },
      { id: "user-bob", displayName: "Bob" },
    ]);
    await createForDocument(
      "doc-1",
      { body: "Hi @Alice and @Bob" },
      user,
    );
    // Allow the fire-and-forget microtasks to drain.
    await new Promise((r) => setImmediate(r));
    const mentionCalls = notify.mock.calls.filter(
      (c) => c[0].type === "comment.mention",
    );
    expect(mentionCalls.map((c) => c[0].recipientId).sort()).toEqual([
      "user-alice",
      "user-bob",
    ]);
    for (const call of mentionCalls) {
      expect(call[0]).toMatchObject({
        actorId: user.id,
        subjectType: "comment",
        subjectId: "new-c",
        url: "/documents/doc-1#comment-new-c",
      });
    }
  });

  it("notifies the parent author with comment.reply", async () => {
    findAliveById.mockResolvedValueOnce(
      makeComment({ id: "parent", authorId: "u-parent" }),
    );
    insertComment.mockResolvedValueOnce(
      makeComment({ id: "child", parentId: "parent" }),
    );
    await createForDocument(
      "doc-1",
      { body: "nice point", parentId: "parent" },
      user,
    );
    await new Promise((r) => setImmediate(r));
    const replyCalls = notify.mock.calls.filter(
      (c) => c[0].type === "comment.reply",
    );
    expect(replyCalls).toHaveLength(1);
    expect(replyCalls[0]![0]).toMatchObject({
      recipientId: "u-parent",
      actorId: user.id,
      subjectType: "comment",
      subjectId: "child",
    });
  });

  it("does not fire comment.reply when replying to one's own comment", async () => {
    findAliveById.mockResolvedValueOnce(
      makeComment({ id: "parent", authorId: user.id }),
    );
    insertComment.mockResolvedValueOnce(
      makeComment({ id: "child", parentId: "parent" }),
    );
    await createForDocument(
      "doc-1",
      { body: "follow up", parentId: "parent" },
      user,
    );
    await new Promise((r) => setImmediate(r));
    const replyCalls = notify.mock.calls.filter(
      (c) => c[0].type === "comment.reply",
    );
    expect(replyCalls).toHaveLength(0);
  });

  it("does not fail the comment write if notify throws synchronously", async () => {
    insertComment.mockResolvedValueOnce(makeComment({ id: "new-c" }));
    findByNames.mockResolvedValueOnce([
      { id: "user-alice", displayName: "Alice" },
    ]);
    notify.mockImplementationOnce(() => {
      throw new Error("synchronous boom");
    });
    const dto = await createForDocument(
      "doc-1",
      { body: "Hi @Alice" },
      user,
    );
    expect(dto.id).toBe("new-c");
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
