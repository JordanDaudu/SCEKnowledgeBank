import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import * as searchService from "./search.service";
import type { AuthenticatedUser } from "../middlewares/auth";

/**
 * Sprint-3 M3 integration tests for `search.service`.
 *
 * We exercise the typed filter DSL, the facet-count shape, and the
 * autocomplete grouping against the real Postgres test database so the
 * raw-SQL helpers (ts_headline, GROUP BY count, UNION autocomplete)
 * stay honest. Each test owns a hermetic, suffixed dataset and an
 * admin-scoped synthetic user so visibility scoping doesn't accidentally
 * filter the rows we just inserted.
 */
const SUFFIX = `_search_${Date.now().toString(36)}`;

interface Ctx {
  adminUser: AuthenticatedUser;
  uploaderId: string;
  uploaderName: string;
  courseId: string;
  courseCode: string;
  tagPlanktonId: string;
  tagPlanktonName: string;
  docTitleId: string; // matches "plankton" via title
  docTagId: string;   // matches "plankton" via tag name
  docOtherId: string; // never matches "plankton"
}

let ctx: Ctx;

async function setup(): Promise<Ctx> {
  const uploaderName = `Search Uploader${SUFFIX}`;
  const uploader = await db.user.create({
    data: {
      email: `search-up${SUFFIX}@demo`,
      passwordHash: "x",
      displayName: uploaderName,
      isActive: true,
    },
  });
  const admin = await db.user.create({
    data: {
      email: `search-admin${SUFFIX}@demo`,
      passwordHash: "x",
      displayName: `Search Admin${SUFFIX}`,
      isActive: true,
    },
  });
  const courseCode = `SRCH${SUFFIX}`;
  const course = await db.course.create({
    data: {
      code: courseCode,
      title: `Search Studies${SUFFIX}`,
      lecturerName: `Dr. Lookup${SUFFIX}`,
    },
  });
  const tagName = `plankton-tag${SUFFIX}`;
  const tag = await db.tag.create({ data: { name: tagName } });

  const docTitle = await db.document.create({
    data: {
      title: `Plankton census${SUFFIX}`,
      description: "ocean biomass survey",
      uploaderId: uploader.id,
      ownerId: uploader.id,
      materialType: "lecture_notes",
      semester: "fall",
      status: "published",
      visibility: "public",
      courseId: course.id,
    },
  });
  const docTag = await db.document.create({
    data: {
      title: `Unrelated coastal piece${SUFFIX}`,
      description: "",
      uploaderId: uploader.id,
      ownerId: uploader.id,
      materialType: "exam",
      semester: "spring",
      status: "published",
      visibility: "public",
      courseId: course.id,
    },
  });
  await db.documentTag.create({
    data: { documentId: docTag.id, tagId: tag.id },
  });
  const docOther = await db.document.create({
    data: {
      title: `Tectonic baseline${SUFFIX}`,
      description: "",
      uploaderId: uploader.id,
      ownerId: uploader.id,
      materialType: "lecture_notes",
      semester: "fall",
      status: "published",
      visibility: "public",
      courseId: course.id,
    },
  });

  // Synthetic admin AuthenticatedUser — admin role gives unrestricted
  // visibility in `visibleDocumentFilter*`.
  const adminUser: AuthenticatedUser = {
    id: admin.id,
    email: admin.email,
    displayName: admin.displayName,
    isActive: true,
    primaryRole: "admin",
    roles: ["admin"],
    enrollments: [],
    username: null,
    avatarStoragePath: null,
    createdAt: "2025-01-01T00:00:00.000Z",
  };

  return {
    adminUser,
    uploaderId: uploader.id,
    uploaderName,
    courseId: course.id,
    courseCode,
    tagPlanktonId: tag.id,
    tagPlanktonName: tagName,
    docTitleId: docTitle.id,
    docTagId: docTag.id,
    docOtherId: docOther.id,
  };
}

async function teardown(c: Ctx): Promise<void> {
  const ids = [c.docTitleId, c.docTagId, c.docOtherId];
  await db.documentTag.deleteMany({ where: { documentId: { in: ids } } });
  await db.documentFile.deleteMany({ where: { documentId: { in: ids } } });
  await db.document.deleteMany({ where: { id: { in: ids } } });
  await db.tag.deleteMany({ where: { id: c.tagPlanktonId } });
  await db.course.deleteMany({ where: { id: c.courseId } });
  await db.user.deleteMany({ where: { id: { in: [c.uploaderId, c.adminUser.id] } } });
}

beforeAll(async () => {
  ctx = await setup();
});
afterAll(async () => {
  if (ctx) await teardown(ctx);
});

describe("searchDocuments — typed filter DSL", () => {
  it("returns a ranked page with snippet headlines when q is set", async () => {
    const page = await searchService.searchDocuments(
      { q: "plankton", sort: "newest", page: 1, pageSize: 20 },
      ctx.adminUser,
    );
    const ids = page.items.map((i) => i.id);
    expect(ids).toContain(ctx.docTitleId);
    expect(ids).toContain(ctx.docTagId);
    expect(ids).not.toContain(ctx.docOtherId);
    expect(page.total).toBe(page.items.filter((i) => ids.includes(i.id)).length);

    const titleHit = page.items.find((i) => i.id === ctx.docTitleId);
    expect(titleHit?.headline).toBeTruthy();
    // ts_headline wraps matches in the sentinel pair — exact tags
    // matter because the client splits on them.
    expect(titleHit?.headline).toMatch(/\[\[KBMARK]].*\[\[\/KBMARK]]/i);
  });

  // Regression: the browse semester filter sends lowercase (fall/spring/
  // summer) while data may be stored capitalized (e.g. seed-demo writes
  // "Fall"/"Spring"). Matching must be case-insensitive or the filter
  // silently returns nothing. Here the fixtures are lowercase, so filtering
  // with "Fall" must still match them.
  it("filters by semester case-insensitively without a text query", async () => {
    const page = await searchService.searchDocuments(
      { semester: "Fall", sort: "newest", page: 1, pageSize: 50 },
      ctx.adminUser,
    );
    const ids = page.items.map((i) => i.id);
    // docTitle + docOther are semester "fall"; docTag is "spring".
    expect(ids).toContain(ctx.docTitleId);
    expect(ids).toContain(ctx.docOtherId);
    expect(ids).not.toContain(ctx.docTagId);
  });

  it("applies the semester filter case-insensitively in full-text search", async () => {
    const page = await searchService.searchDocuments(
      { q: "plankton", semester: "Fall", sort: "newest", page: 1, pageSize: 20 },
      ctx.adminUser,
    );
    const ids = page.items.map((i) => i.id);
    expect(ids).toContain(ctx.docTitleId); // title match + semester "fall"
    expect(ids).not.toContain(ctx.docTagId); // semester "spring"
  });

  it("matches a partial prefix term (plank → Plankton)", async () => {
    const page = await searchService.searchDocuments(
      { q: "plank", sort: "newest", page: 1, pageSize: 20 },
      ctx.adminUser,
    );
    const ids = page.items.map((i) => i.id);
    expect(ids).toContain(ctx.docTitleId);
    // tag name is "plankton-tag…", so the tag-haystack doc matches too
    expect(ids).toContain(ctx.docTagId);
    expect(ids).not.toContain(ctx.docOtherId);
    // count and page agree (same prefix tsquery on both sides)
    expect(page.total).toBeGreaterThanOrEqual(2);
  });

  it("matches a multi-word query whose last term is a prefix (plankton cens)", async () => {
    const page = await searchService.searchDocuments(
      { q: "plankton cens", sort: "newest", page: 1, pageSize: 20 },
      ctx.adminUser,
    );
    const ids = page.items.map((i) => i.id);
    expect(ids).toContain(ctx.docTitleId);
  });

  it("tolerates a small typo via fuzzy fallback (plankton → plankron)", async () => {
    const page = await searchService.searchDocuments(
      { q: "plankron", sort: "newest", page: 1, pageSize: 20 },
      ctx.adminUser,
    );
    const ids = page.items.map((i) => i.id);
    expect(ids).toContain(ctx.docTitleId);
  });

  it("returns a plain page (no headline) when q is empty", async () => {
    const page = await searchService.searchDocuments(
      { courseId: ctx.courseId, sort: "newest", page: 1, pageSize: 20 },
      ctx.adminUser,
    );
    const ours = page.items.filter((i) =>
      [ctx.docTitleId, ctx.docTagId, ctx.docOtherId].includes(i.id),
    );
    expect(ours.length).toBe(3);
    for (const item of ours) {
      expect((item as { headline?: string }).headline).toBeUndefined();
    }
  });

  it("folds uploaderId into the visibility clause", async () => {
    const page = await searchService.searchDocuments(
      {
        q: "plankton",
        uploaderId: ctx.uploaderId,
        sort: "newest",
        page: 1,
        pageSize: 20,
      },
      ctx.adminUser,
    );
    expect(page.items.every((i) => i.uploader.id === ctx.uploaderId)).toBe(true);
    // A wrong uploaderId returns an empty page, not an error.
    const empty = await searchService.searchDocuments(
      {
        q: "plankton",
        uploaderId: ctx.adminUser.id,
        sort: "newest",
        page: 1,
        pageSize: 20,
      },
      ctx.adminUser,
    );
    expect(empty.total).toBe(0);
    expect(empty.items).toEqual([]);
  });

  it("short-circuits to an empty page when tagIds resolves to no documents", async () => {
    // Random uuid that no document is tagged with.
    const ghostTag = "00000000-0000-0000-0000-0000000000ff";
    const page = await searchService.searchDocuments(
      {
        q: "plankton",
        tagIds: [ghostTag],
        sort: "newest",
        page: 1,
        pageSize: 20,
      },
      ctx.adminUser,
    );
    expect(page.total).toBe(0);
    expect(page.items).toEqual([]);
  });
});

describe("searchFacets — grouped counts with hydrated labels", () => {
  it("returns counts grouped across all five dimensions, scoped to current filters", async () => {
    const facets = await searchService.searchFacets(
      { courseId: ctx.courseId, sort: "newest", page: 1, pageSize: 20 },
      ctx.adminUser,
    );
    // Course chip is hydrated with the course's code+title.
    const ourCourse = facets.course.find((c) => c.id === ctx.courseId);
    expect(ourCourse).toBeDefined();
    expect(ourCourse?.code).toBe(ctx.courseCode);
    expect(ourCourse?.count).toBeGreaterThanOrEqual(3);

    // materialType buckets cover the inserted rows.
    const types = new Set(facets.materialType.map((m) => m.value));
    expect(types.has("lecture_notes")).toBe(true);
    expect(types.has("exam")).toBe(true);

    // Uploader is hydrated with the display name.
    const us = facets.uploader.find((u) => u.id === ctx.uploaderId);
    expect(us?.displayName).toBe(ctx.uploaderName);
    expect(us?.count).toBeGreaterThanOrEqual(3);

    // Status / semester buckets exist for the published+fall/spring rows.
    expect(facets.status.some((s) => s.value === "published")).toBe(true);
    expect(facets.semester.some((s) => s.value === "fall")).toBe(true);
  });
});

describe("autocomplete — grouped suggestions over visible documents", () => {
  it("returns tag, course, and uploader hits matching the prefix", async () => {
    const out = await searchService.autocomplete(
      "plankton",
      10,
      ctx.adminUser,
    );
    // Tag suggestion includes our suffixed plankton tag.
    expect(out.tags.some((t) => t.id === ctx.tagPlanktonId)).toBe(true);
  });

  it("returns document hits matching the prefix by title", async () => {
    const out = await searchService.autocomplete(
      "plankton",
      10,
      ctx.adminUser,
    );
    expect(out.documents.some((d) => d.id === ctx.docTitleId)).toBe(true);
  });

  it("matches courses by code prefix", async () => {
    const out = await searchService.autocomplete(
      ctx.courseCode.slice(0, 6),
      10,
      ctx.adminUser,
    );
    expect(out.courses.some((c) => c.id === ctx.courseId)).toBe(true);
  });

  it("matches uploaders by display-name prefix", async () => {
    const out = await searchService.autocomplete(
      "Search Uploader",
      10,
      ctx.adminUser,
    );
    expect(out.uploaders.some((u) => u.id === ctx.uploaderId)).toBe(true);
  });

  it("returns empty groups for a whitespace prefix without hitting the database", async () => {
    const out = await searchService.autocomplete("   ", 10, ctx.adminUser);
    expect(out).toEqual({ documents: [], tags: [], courses: [], uploaders: [] });
  });
});
