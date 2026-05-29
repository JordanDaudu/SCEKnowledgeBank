import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/reactions.repo", () => ({
  insertIfAbsent: vi.fn(),
  deleteOne: vi.fn(),
  summariseByCommentIds: vi.fn(),
}));
vi.mock("../repositories/comments.repo", () => ({
  findAliveById: vi.fn(),
}));
vi.mock("../repositories/documents.repo", () => ({
  findByIdAlive: vi.fn(),
}));
vi.mock("./notifications.service", () => ({ notify: vi.fn() }));
vi.mock("./permissions.service", () => ({ canComment: vi.fn() }));
vi.mock("./audit.service", () => ({ record: vi.fn() }));

import * as reactionsRepo from "../repositories/reactions.repo";
import * as auditService from "./audit.service";
import * as commentsRepo from "../repositories/comments.repo";
import * as docsRepo from "../repositories/documents.repo";
import * as notificationsService from "./notifications.service";
import * as permissions from "./permissions.service";
import { addReaction, removeReaction } from "./reactions.service";
import { HttpError } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";

const insertIfAbsent = vi.mocked(reactionsRepo.insertIfAbsent);
const deleteOne = vi.mocked(reactionsRepo.deleteOne);
const summarise = vi.mocked(reactionsRepo.summariseByCommentIds);
const findComment = vi.mocked(commentsRepo.findAliveById);
const findDoc = vi.mocked(docsRepo.findByIdAlive);
const notify = vi.mocked(notificationsService.notify);
const canComment = vi.mocked(permissions.canComment);
const auditRecord = vi.mocked(auditService.record);

const user: AuthenticatedUser = {
  id: "u1",
  email: "u@e",
  displayName: "U",
  roles: ["student"],
  enrollments: [],
} as unknown as AuthenticatedUser;

beforeEach(() => {
  vi.clearAllMocks();
  findComment.mockResolvedValue({
    id: "c1",
    documentId: "d1",
    authorId: "u2",
  } as never);
  findDoc.mockResolvedValue({ id: "d1" } as never);
  canComment.mockReturnValue(true);
  summarise.mockResolvedValue(
    new Map([
      [
        "c1",
        [{ kind: "like", count: 1, viewerReacted: true }],
      ],
    ]),
  );
});

describe("reactions.service", () => {
  it("rejects unknown reaction kinds", async () => {
    await expect(addReaction("c1", "thumbs-up", user)).rejects.toBeInstanceOf(
      HttpError,
    );
    expect(insertIfAbsent).not.toHaveBeenCalled();
  });

  it("records a comment.reaction audit event only on first react", async () => {
    insertIfAbsent.mockResolvedValue(true);
    await addReaction("c1", "like", user);
    expect(auditRecord).toHaveBeenCalledWith(
      "u1",
      "comment.reaction",
      "comment",
      "c1",
      { kind: "like" },
    );
    // A duplicate react (no insert) must not emit a second event.
    auditRecord.mockClear();
    insertIfAbsent.mockResolvedValue(false);
    await addReaction("c1", "like", user);
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it("inserts and notifies the comment author on first react", async () => {
    insertIfAbsent.mockResolvedValue(true);
    const out = await addReaction("c1", "like", user);
    expect(insertIfAbsent).toHaveBeenCalledWith("c1", "u1", "like");
    expect(out).toEqual([{ kind: "like", count: 1, viewerReacted: true }]);
    // Notify is fire-and-forget; allow microtasks to flush.
    await Promise.resolve();
    await Promise.resolve();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "comment.reaction",
        recipientId: "u2",
        actorId: "u1",
        body: "like",
      }),
    );
  });

  it("does not notify the author when they react to their own comment", async () => {
    findComment.mockResolvedValue({
      id: "c1",
      documentId: "d1",
      authorId: "u1",
    } as never);
    insertIfAbsent.mockResolvedValue(true);
    await addReaction("c1", "like", user);
    await Promise.resolve();
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not notify when the reaction was already present (idempotent add)", async () => {
    insertIfAbsent.mockResolvedValue(false);
    await addReaction("c1", "like", user);
    await Promise.resolve();
    expect(notify).not.toHaveBeenCalled();
  });

  it("removeReaction returns the refreshed summary", async () => {
    deleteOne.mockResolvedValue(true);
    summarise.mockResolvedValue(new Map([["c1", []]]));
    const out = await removeReaction("c1", "like", user);
    expect(deleteOne).toHaveBeenCalledWith("c1", "u1", "like");
    expect(out).toEqual([]);
  });

  it("forbids reacting when the underlying document is not commentable", async () => {
    canComment.mockReturnValue(false);
    await expect(addReaction("c1", "like", user)).rejects.toBeInstanceOf(
      HttpError,
    );
  });
});
