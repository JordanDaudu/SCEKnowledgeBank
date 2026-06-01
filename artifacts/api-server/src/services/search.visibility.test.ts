import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import * as searchService from "./search.service";
import type { AuthenticatedUser } from "../middlewares/auth";

/**
 * Sprint-3 completion: raw-SQL visibility parity.
 *
 * `permissions.visibleDocumentFilterSql` (used by v2 search, facets,
 * autocomplete) must hide the same set of statuses as the Prisma twin
 * `visibleDocumentFilter` — including `draft`. A regression here means
 * a student can upload a `public` doc, skip auto-submit, and the
 * draft starts showing up in search results for anyone.
 */
const SUFFIX = `_sv_${Date.now().toString(36)}`;

interface Ctx {
  uploader: AuthenticatedUser;       // student A — owns the draft
  stranger: AuthenticatedUser;       // student B — unrelated
  lecturerSame: AuthenticatedUser;   // lecturer for course A
  lecturerOther: AuthenticatedUser;  // lecturer for an unrelated course
  courseId: string;
  draftId: string;
  publishedId: string;
  pendingId: string;
  rejectedId: string;
  uploaderName: string;
  tagId: string;
  otherCourseId: string;
}

let ctx: Ctx;

function mkAuthed(id: string, opts: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id,
    email: `${id}@demo`,
    displayName: id,
    isActive: true,
    primaryRole: "student",
    roles: ["student"],
    enrollments: [],
    username: null,
    avatarStoragePath: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    ...opts,
  };
}

async function setup(): Promise<Ctx> {
  const uploaderName = `Plkn Uploader${SUFFIX}`;
  const uploaderRow = await db.user.create({
    data: { email: `pu${SUFFIX}@d`, passwordHash: "x", displayName: uploaderName, isActive: true },
  });
  const strangerRow = await db.user.create({
    data: { email: `ps${SUFFIX}@d`, passwordHash: "x", displayName: `Stranger${SUFFIX}`, isActive: true },
  });
  const lecASameRow = await db.user.create({
    data: { email: `pls${SUFFIX}@d`, passwordHash: "x", displayName: `Lec A${SUFFIX}`, isActive: true },
  });
  const lecOtherRow = await db.user.create({
    data: { email: `plo${SUFFIX}@d`, passwordHash: "x", displayName: `Lec Other${SUFFIX}`, isActive: true },
  });
  const course = await db.course.create({
    data: { code: `VIS${SUFFIX}`, title: `Vis Studies${SUFFIX}`, lecturerName: `Dr. Vis${SUFFIX}` },
  });
  const otherCourse = await db.course.create({
    data: { code: `OTH${SUFFIX}`, title: `Other Studies${SUFFIX}`, lecturerName: `Dr. Other${SUFFIX}` },
  });
  const tag = await db.tag.create({ data: { name: `vis-tag${SUFFIX}` } });

  // 4 docs: draft, published, pending_review, rejected — all by
  // uploader on `course`, all public visibility, all sharing the
  // unique title token `plkn${SUFFIX}` so a single q matches them.
  const make = async (status: string, suffix: string) =>
    db.document.create({
      data: {
        title: `plkn${SUFFIX} ${suffix}`,
        description: "vis",
        uploaderId: uploaderRow.id,
        ownerId: uploaderRow.id,
        materialType: "lecture_notes",
        semester: "fall",
        status,
        visibility: "public",
        courseId: course.id,
      },
    });
  const draft = await make("draft", "draft");
  const published = await make("published", "pub");
  const pending = await make("pending_review", "pend");
  const rejected = await make("rejected", "rej");

  // Tag the draft so autocomplete by tag prefix could surface it if
  // visibility leaked.
  await db.documentTag.create({ data: { documentId: draft.id, tagId: tag.id } });

  return {
    uploader: mkAuthed(uploaderRow.id, { email: uploaderRow.email, displayName: uploaderName }),
    stranger: mkAuthed(strangerRow.id, { email: strangerRow.email, displayName: strangerRow.displayName }),
    lecturerSame: mkAuthed(lecASameRow.id, {
      primaryRole: "lecturer",
      roles: ["lecturer"],
      enrollments: [{ courseId: course.id, roleInCourse: "lecturer" }],
    }),
    lecturerOther: mkAuthed(lecOtherRow.id, {
      primaryRole: "lecturer",
      roles: ["lecturer"],
      enrollments: [{ courseId: otherCourse.id, roleInCourse: "lecturer" }],
    }),
    courseId: course.id,
    otherCourseId: otherCourse.id,
    draftId: draft.id,
    publishedId: published.id,
    pendingId: pending.id,
    rejectedId: rejected.id,
    uploaderName,
    tagId: tag.id,
  };
}

async function teardown(c: Ctx): Promise<void> {
  const ids = [c.draftId, c.publishedId, c.pendingId, c.rejectedId];
  await db.documentTag.deleteMany({ where: { documentId: { in: ids } } });
  await db.documentFile.deleteMany({ where: { documentId: { in: ids } } });
  await db.document.deleteMany({ where: { id: { in: ids } } });
  await db.tag.deleteMany({ where: { id: c.tagId } });
  await db.course.deleteMany({ where: { id: { in: [c.courseId, c.otherCourseId] } } });
  await db.user.deleteMany({
    where: {
      id: { in: [c.uploader.id, c.stranger.id, c.lecturerSame.id, c.lecturerOther.id] },
    },
  });
}

beforeAll(async () => { ctx = await setup(); });
afterAll(async () => { if (ctx) await teardown(ctx); });

const Q = () => `plkn${SUFFIX}`;

async function searchIds(user: AuthenticatedUser): Promise<string[]> {
  const page = await searchService.searchDocuments(
    { q: Q(), sort: "newest", page: 1, pageSize: 50 },
    user,
  );
  return page.items.map((i) => i.id);
}

describe("v2 search visibility — review-hidden statuses", () => {
  it("stranger sees only the published doc (no draft / pending / rejected)", async () => {
    const ids = await searchIds(ctx.stranger);
    expect(ids).toContain(ctx.publishedId);
    expect(ids).not.toContain(ctx.draftId);
    expect(ids).not.toContain(ctx.pendingId);
    expect(ids).not.toContain(ctx.rejectedId);
  });

  it("uploader sees their own draft + pending + rejected + published", async () => {
    const ids = await searchIds(ctx.uploader);
    for (const id of [ctx.draftId, ctx.publishedId, ctx.pendingId, ctx.rejectedId]) {
      expect(ids).toContain(id);
    }
  });

  it("lecturer of the doc's course sees the full review pipeline", async () => {
    const ids = await searchIds(ctx.lecturerSame);
    for (const id of [ctx.draftId, ctx.publishedId, ctx.pendingId, ctx.rejectedId]) {
      expect(ids).toContain(id);
    }
  });

  it("lecturer of an unrelated course is treated as a stranger", async () => {
    const ids = await searchIds(ctx.lecturerOther);
    expect(ids).toContain(ctx.publishedId);
    expect(ids).not.toContain(ctx.draftId);
    expect(ids).not.toContain(ctx.pendingId);
    expect(ids).not.toContain(ctx.rejectedId);
  });

  it("facets do not count review-hidden docs for a stranger", async () => {
    const facets = await searchService.searchFacets(
      { courseId: ctx.courseId, sort: "newest", page: 1, pageSize: 50 },
      ctx.stranger,
    );
    // Only the `published` row in our suffix is visible. Statuses for
    // hidden rows must not appear in the buckets.
    const statuses = new Set(facets.status.map((s) => s.value));
    expect(statuses.has("published")).toBe(true);
    expect(statuses.has("draft")).toBe(false);
    expect(statuses.has("pending_review")).toBe(false);
    expect(statuses.has("rejected")).toBe(false);
  });

  it("autocomplete tag prefix does not surface a tag that only attaches to a draft", async () => {
    const out = await searchService.autocomplete(
      `vis-tag${SUFFIX}`.slice(0, 8),
      10,
      ctx.stranger,
    );
    expect(out.tags.some((t) => t.id === ctx.tagId)).toBe(false);
    // Uploader CAN see their own draft's tag.
    const own = await searchService.autocomplete(
      `vis-tag${SUFFIX}`.slice(0, 8),
      10,
      ctx.uploader,
    );
    expect(own.tags.some((t) => t.id === ctx.tagId)).toBe(true);
  });

  it("autocomplete uploader-name prefix does not surface an uploader whose only matching doc is a draft", async () => {
    // Hermetic scenario: a brand-new user owns a single `draft` doc
    // on the same course, with a unique display-name token. Stranger
    // must NOT see the uploader in autocomplete; uploader themselves
    // and the course lecturer MUST.
    const draftOnlyName = `Onlydraft Author${SUFFIX}`;
    const draftOnlyTagName = `onlydraft-tag${SUFFIX}`;
    const draftOnlyUserRow = await db.user.create({
      data: {
        email: `pdo${SUFFIX}@d`,
        passwordHash: "x",
        displayName: draftOnlyName,
        isActive: true,
      },
    });
    const draftOnlyTag = await db.tag.create({ data: { name: draftOnlyTagName } });
    const draftOnlyDoc = await db.document.create({
      data: {
        title: `onlydraft${SUFFIX} doc`,
        description: "vis",
        uploaderId: draftOnlyUserRow.id,
        ownerId: draftOnlyUserRow.id,
        materialType: "lecture_notes",
        semester: "fall",
        status: "draft",
        visibility: "public",
        courseId: ctx.courseId,
      },
    });
    await db.documentTag.create({
      data: { documentId: draftOnlyDoc.id, tagId: draftOnlyTag.id },
    });
    const draftOnlyUser = mkAuthed(draftOnlyUserRow.id, {
      email: draftOnlyUserRow.email,
      displayName: draftOnlyName,
    });
    try {
      const namePrefix = draftOnlyName.split(" ")[0]!;
      // Stranger: no draft-only uploader, no draft-only tag.
      const strangerOut = await searchService.autocomplete(namePrefix, 10, ctx.stranger);
      expect(strangerOut.uploaders.some((u) => u.id === draftOnlyUser.id)).toBe(false);
      const strangerTagOut = await searchService.autocomplete(
        draftOnlyTagName.slice(0, 8),
        10,
        ctx.stranger,
      );
      expect(strangerTagOut.tags.some((t) => t.id === draftOnlyTag.id)).toBe(false);

      // Uploader sees themselves (their own draft is visible to them).
      const ownOut = await searchService.autocomplete(namePrefix, 10, draftOnlyUser);
      expect(ownOut.uploaders.some((u) => u.id === draftOnlyUser.id)).toBe(true);

      // Course lecturer sees the draft-only uploader and tag.
      const lecOut = await searchService.autocomplete(namePrefix, 10, ctx.lecturerSame);
      expect(lecOut.uploaders.some((u) => u.id === draftOnlyUser.id)).toBe(true);
      const lecTagOut = await searchService.autocomplete(
        draftOnlyTagName.slice(0, 8),
        10,
        ctx.lecturerSame,
      );
      expect(lecTagOut.tags.some((t) => t.id === draftOnlyTag.id)).toBe(true);

      // Lecturer of another course is treated as a stranger for both
      // the uploader-name prefix and the tag-name prefix.
      const otherOut = await searchService.autocomplete(namePrefix, 10, ctx.lecturerOther);
      expect(otherOut.uploaders.some((u) => u.id === draftOnlyUser.id)).toBe(false);
      const otherTagOut = await searchService.autocomplete(
        draftOnlyTagName.slice(0, 8),
        10,
        ctx.lecturerOther,
      );
      expect(otherTagOut.tags.some((t) => t.id === draftOnlyTag.id)).toBe(false);
    } finally {
      await db.documentTag.deleteMany({ where: { documentId: draftOnlyDoc.id } });
      await db.document.deleteMany({ where: { id: draftOnlyDoc.id } });
      await db.tag.deleteMany({ where: { id: draftOnlyTag.id } });
      await db.user.deleteMany({ where: { id: draftOnlyUserRow.id } });
    }
  });
});
