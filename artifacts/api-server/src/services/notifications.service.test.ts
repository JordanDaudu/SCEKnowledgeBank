import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/notifications.repo", () => ({
  insertIfNew: vi.fn(),
  listForRecipient: vi.fn(),
  countUnread: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
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
        status: "ACTIVE",
        createdAt: "2025-01-01T00:00:00.000Z",
      });
    }
    return m;
  }),
}));

// Sprint-3 M7: the `FEATURE_NOTIFICATIONS` flag was graduated. The
// helper is retained as a thin wrapper so the existing call sites
// don't have to change.
async function importNotificationsService() {
  vi.resetModules();
  return await import("./notifications.service");
}

import * as repo from "../repositories/notifications.repo";
const insertIfNew = vi.mocked(repo.insertIfNew);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("notifications.service notify()", () => {
  it("inserts when recipient differs from actor", async () => {
    const svc = await importNotificationsService();
    insertIfNew.mockResolvedValueOnce({
      id: "n1",
      recipientId: "u-target",
      actorId: "u-actor",
      type: "comment.mention",
      subjectType: "comment",
      subjectId: "c1",
      body: "",
      url: null,
      readAt: null,
      createdAt: new Date(),
    });
    await svc.notify({
      recipientId: "u-target",
      actorId: "u-actor",
      type: "comment.mention",
      subjectType: "comment",
      subjectId: "c1",
    });
    expect(insertIfNew).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: "u-target",
        actorId: "u-actor",
        type: "comment.mention",
        subjectId: "c1",
      }),
    );
  });

  it("no-ops when recipient === actor (no self-notify)", async () => {
    const svc = await importNotificationsService();
    await svc.notify({
      recipientId: "same",
      actorId: "same",
      type: "comment.mention",
      subjectType: "comment",
      subjectId: "c1",
    });
    expect(insertIfNew).not.toHaveBeenCalled();
  });

  it("swallows repository errors (never throws to caller)", async () => {
    const svc = await importNotificationsService();
    insertIfNew.mockRejectedValueOnce(new Error("db down"));
    await expect(
      svc.notify({
        recipientId: "u-target",
        actorId: "u-actor",
        type: "comment.mention",
        subjectType: "comment",
        subjectId: "c1",
      }),
    ).resolves.toBeUndefined();
  });

  it("relies on repo for dedup (caller may invoke twice safely)", async () => {
    const svc = await importNotificationsService();
    insertIfNew.mockResolvedValueOnce(null); // duplicate suppressed by unique index
    await expect(
      svc.notify({
        recipientId: "u-target",
        actorId: "u-actor",
        type: "comment.mention",
        subjectType: "comment",
        subjectId: "c1",
      }),
    ).resolves.toBeUndefined();
    expect(insertIfNew).toHaveBeenCalledTimes(1);
  });
});
