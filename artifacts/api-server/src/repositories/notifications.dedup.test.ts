import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import * as repo from "./notifications.repo";

/**
 * Sprint-3 completion: prove the restored per-(recipient, type,
 * subject) dedup contract at the database boundary.
 *
 *   - Same (recipient, type, subject) → second insert returns null
 *     (unique-index suppressed).
 *   - Same (recipient, subject) but different type → both rows
 *     persist. This is the property that lets `document.rejected`
 *     and a later `document.approved` for the same document both
 *     reach the uploader across a reject→resubmit→approve cycle.
 */
const SUFFIX = `_nd_${Date.now().toString(36)}`;
let recipientId: string;

beforeAll(async () => {
  const u = await db.user.create({
    data: {
      email: `ndr${SUFFIX}@d`,
      passwordHash: "x",
      displayName: `Notif Recipient${SUFFIX}`,
      isActive: true,
    },
  });
  recipientId = u.id;
});

afterAll(async () => {
  await db.notification.deleteMany({ where: { recipientId } });
  await db.user.deleteMany({ where: { id: recipientId } });
});

describe("notifications.repo.insertIfNew — dedup key includes type", () => {
  it("dedupes identical (recipient, type, subjectType, subjectId)", async () => {
    const subjectId = `doc-${SUFFIX}-a`;
    const first = await repo.insertIfNew({
      recipientId,
      type: "document.approved",
      subjectType: "document",
      subjectId,
    });
    expect(first).not.toBeNull();
    const second = await repo.insertIfNew({
      recipientId,
      type: "document.approved",
      subjectType: "document",
      subjectId,
    });
    expect(second).toBeNull();
  });

  it("allows two different types on the same (recipient, subject) — reject then approve", async () => {
    const subjectId = `doc-${SUFFIX}-b`;
    const rejected = await repo.insertIfNew({
      recipientId,
      type: "document.rejected",
      subjectType: "document",
      subjectId,
      body: "needs sources",
    });
    const approved = await repo.insertIfNew({
      recipientId,
      type: "document.approved",
      subjectType: "document",
      subjectId,
      body: "looks good",
    });
    expect(rejected).not.toBeNull();
    expect(approved).not.toBeNull();
    const rows = await db.notification.findMany({
      where: { recipientId, subjectId },
      orderBy: { createdAt: "asc" },
    });
    const types = rows.map((r) => r.type).sort();
    expect(types).toEqual(["document.approved", "document.rejected"]);
  });

  it("isolates dedup per recipient (same type+subject, different recipient → both insert)", async () => {
    const other = await db.user.create({
      data: {
        email: `ndo${SUFFIX}@d`,
        passwordHash: "x",
        displayName: `Other${SUFFIX}`,
        isActive: true,
      },
    });
    try {
      const subjectId = `doc-${SUFFIX}-c`;
      const a = await repo.insertIfNew({
        recipientId,
        type: "document.approved",
        subjectType: "document",
        subjectId,
      });
      const b = await repo.insertIfNew({
        recipientId: other.id,
        type: "document.approved",
        subjectType: "document",
        subjectId,
      });
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
    } finally {
      await db.notification.deleteMany({ where: { recipientId: other.id } });
      await db.user.deleteMany({ where: { id: other.id } });
    }
  });
});
