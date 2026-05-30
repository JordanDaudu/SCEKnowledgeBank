import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { createCollection } from "./collections.service";
import {
  listComments,
  createComment,
  editComment,
  deleteComment,
} from "./collection-comments.service";

const SX = `_cmtsvc_${Date.now().toString(36)}`;
let owner: AuthenticatedUser;
let commenter: AuthenticatedUser;
let pubId: string;
let privId: string;

afterAll(async () => {
  await db.notification.deleteMany({ where: { recipientId: owner.id } });
  await db.studyCollectionComment.deleteMany({ where: { collectionId: { in: [pubId, privId] } } });
  await db.studyCollection.deleteMany({ where: { id: { in: [pubId, privId] } } });
  await db.user.deleteMany({ where: { id: { in: [owner.id, commenter.id] } } });
});

beforeAll(async () => {
  const o = await db.user.create({ data: { email: `o${SX}@demo`, passwordHash: "x", displayName: `O${SX}`, isActive: true } });
  const c = await db.user.create({ data: { email: `c${SX}@demo`, passwordHash: "x", displayName: `C${SX}`, isActive: true } });
  owner = { id: o.id, roles: ["student"], enrollments: [] } as unknown as AuthenticatedUser;
  commenter = { id: c.id, roles: ["student"], enrollments: [] } as unknown as AuthenticatedUser;
  pubId = (await createCollection(owner, { title: `Pub${SX}`, visibility: "public" })).id;
  privId = (await createCollection(owner, { title: `Priv${SX}`, visibility: "private" })).id;
});

describe("collection-comments.service", () => {
  it("a non-owner comment notifies the owner", async () => {
    const dto = await createComment(pubId, commenter, "Great set!");
    expect(dto.body).toBe("Great set!");
    expect(dto.editable).toBe(true);
    const notif = await db.notification.findFirst({
      where: { recipientId: owner.id, type: "collection.comment", subjectId: pubId },
    });
    expect(notif).not.toBeNull();
    expect(notif?.url).toBe(`/prep-hub/${pubId}`);
  });

  it("a self-comment (owner) does NOT notify", async () => {
    await db.notification.deleteMany({ where: { recipientId: owner.id } });
    await createComment(pubId, owner, "owner note");
    const notif = await db.notification.findFirst({
      where: { recipientId: owner.id, type: "collection.comment" },
    });
    expect(notif).toBeNull();
  });

  it("editable flag is false for other viewers; list is oldest-first", async () => {
    const list = await listComments(pubId, owner);
    expect(list.length).toBe(2);
    expect(list[0].editable).toBe(false); // commenter's comment, viewed by owner
    expect(list[1].editable).toBe(true); // owner's own comment
  });

  it("only the author can edit/delete", async () => {
    const created = await createComment(pubId, commenter, "mine");
    await expect(editComment(created.id, owner, "hijack")).rejects.toThrow();
    await expect(deleteComment(created.id, owner)).rejects.toThrow();
    const edited = await editComment(created.id, commenter, "mine-edited");
    expect(edited.body).toBe("mine-edited");
    await deleteComment(created.id, commenter);
    expect((await listComments(pubId, owner)).some((x) => x.id === created.id)).toBe(false);
  });

  it("comments on a private collection 404", async () => {
    await expect(createComment(privId, commenter, "x")).rejects.toThrow();
    await expect(listComments(privId, commenter)).rejects.toThrow();
  });

  it("empty body is rejected", async () => {
    await expect(createComment(pubId, commenter, "   ")).rejects.toThrow();
  });
});
