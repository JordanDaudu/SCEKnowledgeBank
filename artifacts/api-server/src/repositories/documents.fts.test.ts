import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, Prisma } from "@workspace/db";
import {
  countSearchDocuments,
  searchDocumentsRanked,
} from "./documents.repo";

/**
 * Integration tests for Postgres FTS (task #28). Exercises the
 * trigger-maintained `documents.search_vector` and the
 * `searchDocumentsRanked` / `countSearchDocuments` raw-SQL helpers
 * against the real test database.
 *
 * Strategy: insert a small, hermetic dataset under unique-suffixed
 * names so we can clean up cleanly without disturbing seed data, run
 * a handful of searches, and assert that titles / tags / extracted
 * text all surface results, and that non-FTS filters still compose.
 */
const SUFFIX = `_fts_${Date.now().toString(36)}`;
const ADMIN_VISIBILITY = Prisma.sql`TRUE`; // admin-like scope

interface Ctx {
  courseId: string;
  userId: string;
  tagOcean: string;
  tagDesert: string;
  docTitleId: string;   // matches via title
  docTagId: string;     // matches via tag name
  docTextId: string;    // matches via extracted_text
  docOtherId: string;   // matches no q
}

let ctx: Ctx;

async function setup(): Promise<Ctx> {
  const user = await db.user.create({
    data: {
      email: `fts-user${SUFFIX}@demo`,
      passwordHash: "x",
      displayName: `FTS Tester${SUFFIX}`,
      isActive: true,
    },
  });
  const course = await db.course.create({
    data: {
      code: `FTS${SUFFIX}`,
      title: `Marine Geology${SUFFIX}`,
      lecturerName: `Dr. Surge${SUFFIX}`,
    },
  });
  const tagOcean = await db.tag.create({
    data: { name: `ocean-currents${SUFFIX}` },
  });
  const tagDesert = await db.tag.create({
    data: { name: `desert-winds${SUFFIX}` },
  });

  // Doc A: title hit on the keyword we'll search ("plankton").
  const docTitle = await db.document.create({
    data: {
      title: `Plankton populations${SUFFIX}`,
      description: "",
      uploaderId: user.id,
      ownerId: user.id,
      materialType: "lecture_notes",
      visibility: "public",
      courseId: course.id,
    },
  });
  // Doc B: tag hit only (no "plankton" in title/description).
  const docTag = await db.document.create({
    data: {
      title: `Unrelated coastal study${SUFFIX}`,
      description: "",
      uploaderId: user.id,
      ownerId: user.id,
      materialType: "lecture_notes",
      visibility: "public",
      courseId: course.id,
    },
  });
  await db.documentTag.create({
    data: { documentId: docTag.id, tagId: tagOcean.id },
  });
  // Doc C: extracted-text hit only.
  const docText = await db.document.create({
    data: {
      title: `Submarine ridges${SUFFIX}`,
      description: "",
      uploaderId: user.id,
      ownerId: user.id,
      materialType: "lecture_notes",
      visibility: "public",
      courseId: course.id,
    },
  });
  await db.documentFile.create({
    data: {
      documentId: docText.id,
      originalFilename: "ridges.pdf",
      displayFilename: "ridges.pdf",
      storedFilename: "ridges.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1n,
      storagePath: "x",
      checksum: `sha${SUFFIX}-c`,
      extractedText:
        "Detailed analysis of plankton blooms near the ridge.",
    },
  });
  // Doc D: a control row that should never match.
  const docOther = await db.document.create({
    data: {
      title: `Tectonic baseline${SUFFIX}`,
      description: "",
      uploaderId: user.id,
      ownerId: user.id,
      materialType: "lecture_notes",
      visibility: "public",
      courseId: course.id,
    },
  });

  return {
    courseId: course.id,
    userId: user.id,
    tagOcean: tagOcean.id,
    tagDesert: tagDesert.id,
    docTitleId: docTitle.id,
    docTagId: docTag.id,
    docTextId: docText.id,
    docOtherId: docOther.id,
  };
}

async function teardown(c: Ctx): Promise<void> {
  // Order: tags links → files (cascade) → docs → tags → course → user.
  const ids = [c.docTitleId, c.docTagId, c.docTextId, c.docOtherId];
  await db.documentTag.deleteMany({ where: { documentId: { in: ids } } });
  await db.documentFile.deleteMany({ where: { documentId: { in: ids } } });
  await db.document.deleteMany({ where: { id: { in: ids } } });
  await db.tag.deleteMany({ where: { id: { in: [c.tagOcean, c.tagDesert] } } });
  await db.course.deleteMany({ where: { id: c.courseId } });
  await db.user.deleteMany({ where: { id: c.userId } });
}

beforeAll(async () => {
  ctx = await setup();
});

afterAll(async () => {
  if (ctx) await teardown(ctx);
});

const SCOPE = {
  visibility: undefined,
  restrictDocumentIds: undefined,
} as const;

function filtersWithDocIds(ids: string[]) {
  return {
    visibility: undefined,
    restrictDocumentIds: ids,
  };
}

describe("documents FTS — ranked search via Postgres tsvector", () => {
  it("finds documents matching by title", async () => {
    const rows = await searchDocumentsRanked(
      "plankton",
      filtersWithDocIds([
        ctx.docTitleId,
        ctx.docTagId,
        ctx.docTextId,
        ctx.docOtherId,
      ]),
      ADMIN_VISIBILITY,
      { sort: "newest", page: 1, pageSize: 20 },
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(ctx.docTitleId);
    expect(ids).toContain(ctx.docTextId);
    expect(ids).not.toContain(ctx.docOtherId);
  });

  it("finds documents matching by tag name", async () => {
    const rows = await searchDocumentsRanked(
      `ocean-currents${SUFFIX}`,
      filtersWithDocIds([
        ctx.docTitleId,
        ctx.docTagId,
        ctx.docTextId,
        ctx.docOtherId,
      ]),
      ADMIN_VISIBILITY,
      { sort: "newest", page: 1, pageSize: 20 },
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(ctx.docTagId);
    expect(ids).not.toContain(ctx.docOtherId);
  });

  it("finds documents matching by extracted text", async () => {
    const rows = await searchDocumentsRanked(
      "blooms",
      filtersWithDocIds([
        ctx.docTitleId,
        ctx.docTagId,
        ctx.docTextId,
        ctx.docOtherId,
      ]),
      ADMIN_VISIBILITY,
      { sort: "newest", page: 1, pageSize: 20 },
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(ctx.docTextId);
    expect(ids).not.toContain(ctx.docOtherId);
  });

  it("composes additional filters with q (course filter narrows results)", async () => {
    // courseId narrows the universe; doc still matches by extracted text.
    const rows = await searchDocumentsRanked(
      "blooms",
      {
        ...filtersWithDocIds([
          ctx.docTitleId,
          ctx.docTagId,
          ctx.docTextId,
          ctx.docOtherId,
        ]),
        courseId: ctx.courseId,
      },
      ADMIN_VISIBILITY,
      { sort: "newest", page: 1, pageSize: 20 },
    );
    expect(rows.map((r) => r.id)).toContain(ctx.docTextId);
  });

  it("countSearchDocuments matches the row count under the same filters", async () => {
    const filters = filtersWithDocIds([
      ctx.docTitleId,
      ctx.docTagId,
      ctx.docTextId,
      ctx.docOtherId,
    ]);
    const total = await countSearchDocuments(
      "plankton",
      filters,
      ADMIN_VISIBILITY,
    );
    const rows = await searchDocumentsRanked(
      "plankton",
      filters,
      ADMIN_VISIBILITY,
      { sort: "newest", page: 1, pageSize: 50 },
    );
    expect(total).toBe(rows.length);
  });

  it("returns an empty page (not an error) when q has no matches", async () => {
    const filters = filtersWithDocIds([
      ctx.docTitleId,
      ctx.docTagId,
      ctx.docTextId,
      ctx.docOtherId,
    ]);
    const rows = await searchDocumentsRanked(
      `totally-unmatched-token${SUFFIX}`,
      filters,
      ADMIN_VISIBILITY,
      { sort: "newest", page: 1, pageSize: 20 },
    );
    expect(rows).toHaveLength(0);
    const total = await countSearchDocuments(
      `totally-unmatched-token${SUFFIX}`,
      filters,
      ADMIN_VISIBILITY,
    );
    expect(total).toBe(0);
  });

  it("refreshes both old and new doc when a document_tags link is re-pointed", async () => {
    // Move the ocean tag link from docTag → docOther. After the
    // AFTER UPDATE trigger fires, ocean-currents should now match
    // docOther (not docTag).
    await db.documentTag.updateMany({
      where: { documentId: ctx.docTagId, tagId: ctx.tagOcean },
      data: { documentId: ctx.docOtherId },
    });
    try {
      const rows = await searchDocumentsRanked(
        `ocean-currents${SUFFIX}`,
        filtersWithDocIds([
          ctx.docTitleId,
          ctx.docTagId,
          ctx.docTextId,
          ctx.docOtherId,
        ]),
        ADMIN_VISIBILITY,
        { sort: "newest", page: 1, pageSize: 20 },
      );
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(ctx.docOtherId);
      expect(ids).not.toContain(ctx.docTagId);
    } finally {
      await db.documentTag.updateMany({
        where: { documentId: ctx.docOtherId, tagId: ctx.tagOcean },
        data: { documentId: ctx.docTagId },
      });
    }
  });

  it("propagates tag-name updates into the search vector via trigger", async () => {
    // Rename the ocean tag and confirm the renamed token now hits.
    const newName = `renamed-tide-${Date.now().toString(36)}`;
    await db.tag.update({
      where: { id: ctx.tagOcean },
      data: { name: newName },
    });
    try {
      const rows = await searchDocumentsRanked(
        newName,
        filtersWithDocIds([
          ctx.docTitleId,
          ctx.docTagId,
          ctx.docTextId,
          ctx.docOtherId,
        ]),
        ADMIN_VISIBILITY,
        { sort: "newest", page: 1, pageSize: 20 },
      );
      expect(rows.map((r) => r.id)).toContain(ctx.docTagId);
    } finally {
      await db.tag.update({
        where: { id: ctx.tagOcean },
        data: { name: `ocean-currents${SUFFIX}` },
      });
    }
  });
});

// Silence the unused-binding lint about SCOPE for callers that adapt
// the test later; the constant is kept for future extension.
void SCOPE;
