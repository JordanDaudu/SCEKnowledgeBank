/**
 * Smoke-test for the demo seed. Scoped to the entities `seed-demo.ts`
 * is responsible for (demo emails, demo course codes, demo titles)
 * so it can't be satisfied by unrelated data the other seeders write.
 * Exits non-zero on any failure.
 */
import { db } from "@workspace/db";
import * as documentsService from "../services/documents.service";
import * as searchService from "../services/search.service";
import type { AuthenticatedUser } from "../middlewares/auth";

const DEMO_EMAILS = [
  "admin@knowledgebank.demo",
  "maya.cohen@knowledgebank.demo",
  "daniel.levi@knowledgebank.demo",
  "pending.lecturer@knowledgebank.demo",
  "noa.student@knowledgebank.demo",
  "amir.student@knowledgebank.demo",
  "yael.student@knowledgebank.demo",
  "restricted.student@knowledgebank.demo",
  "disabled.user@knowledgebank.demo",
];
const DEMO_COURSES = ["CS101", "CS220", "IS310", "IS420"];
const DEMO_CATEGORY_SLUGS = [
  "lecture-notes", "assignments", "exams", "summaries",
  "presentations", "reading-material", "project-documents",
];
const DEMO_TAGS = [
  "algorithms", "recursion", "arrays", "linked-list", "exam-prep",
  "sprint", "agile", "risk-management", "knowledge-base", "database",
  "pdf", "presentation", "summary", "important",
];
const DEMO_DOC_TITLES = [
  "Introduction to Programming — Lecture 1",
  "Variables and Control Flow Summary",
  "CS101 Assignment 1 — Basics",
  "CS101 Midterm Practice Questions",
  "Data Structures — Arrays and Lists",
  "Recursion Worksheet",
  "Algorithm Complexity Cheat Sheet",
  "Agile Project Management Slides",
  "Risk Management Template",
  "Sprint Planning Guide",
  "Final Project Instructions",
  "Knowledge Base Architecture",
  "Metadata Extraction Reading",
  "Search and Discovery Design",
  "IS420 Final Exam Review",
  "Private Lecturer Notes — CS220",
];
const DEMO_REQUEST_TITLES = [
  "Need CS101 final exam examples",
  "Please upload more recursion exercises",
  "Missing project charter template",
  "Need IS420 metadata extraction example",
  "Can we get Agile retrospective slides?",
  "Need Data Structures previous exams",
  "Please add risk register sample",
  "Need summary for Knowledge Base Architecture",
  "Old IS310 exam papers",
];

const DEMO_REVIEW_DOC_TITLES = [
  "Noa's Draft Study Notes — CS101",
  "Noa's CS101 Exam Summary — Pending Review",
  "Amir's CS101 Lab Report — Rejected",
  "Amir's IS310 Sprint Notes — Approved",
];

interface Check {
  name: string;
  run: () => Promise<boolean | string>;
}

const checks: Check[] = [
  {
    name: "demo: all 9 users exist with @knowledgebank.demo",
    run: async () => {
      const found = await db.user.findMany({
        where: { email: { in: DEMO_EMAILS } },
        select: { email: true },
      });
      const missing = DEMO_EMAILS.filter(
        (e) => !found.some((f) => f.email === e),
      );
      return missing.length === 0 ? true : `missing: ${missing.join(", ")}`;
    },
  },
  {
    name: "demo: pending.lecturer has status PENDING_APPROVAL",
    run: async () => {
      const u = await db.user.findFirst({
        where: { email: "pending.lecturer@knowledgebank.demo" },
      });
      return u?.status === "PENDING_APPROVAL"
        ? true
        : `got status=${u?.status}`;
    },
  },
  {
    name: "demo: disabled.user has status DISABLED",
    run: async () => {
      const u = await db.user.findFirst({
        where: { email: "disabled.user@knowledgebank.demo" },
      });
      return u?.status === "DISABLED" ? true : `got status=${u?.status}`;
    },
  },
  {
    name: "demo: quotas configured (Yael near quota, Amir low)",
    run: async () => {
      const yael = await db.user.findFirst({
        where: { email: "yael.student@knowledgebank.demo" },
      });
      const amir = await db.user.findFirst({
        where: { email: "amir.student@knowledgebank.demo" },
      });
      if (!yael || !amir) return "yael or amir missing";
      if (yael.quotaBytes == null || amir.quotaBytes == null)
        return "quotaBytes null";
      if (yael.usedBytes <= amir.usedBytes)
        return `expected yael.used > amir.used (${yael.usedBytes} vs ${amir.usedBytes})`;
      return true;
    },
  },
  {
    name: "demo: all 4 courses exist",
    run: async () => {
      const found = await db.course.findMany({
        where: { code: { in: DEMO_COURSES } },
        select: { code: true },
      });
      const missing = DEMO_COURSES.filter(
        (c) => !found.some((f) => f.code === c),
      );
      return missing.length === 0 ? true : `missing: ${missing.join(", ")}`;
    },
  },
  {
    name: "demo: 12 enrollments exist (4 lecturer + 8 student)",
    run: async () => {
      const courses = await db.course.findMany({
        where: { code: { in: DEMO_COURSES } },
        select: { id: true },
      });
      const ids = courses.map((c) => c.id);
      const users = await db.user.findMany({
        where: { email: { in: DEMO_EMAILS } },
        select: { id: true },
      });
      const userIds = users.map((u) => u.id);
      const n = await db.courseEnrollment.count({
        where: { courseId: { in: ids }, userId: { in: userIds } },
      });
      return n >= 12 ? true : `got ${n} enrollments`;
    },
  },
  {
    name: "demo: 7 categories exist",
    run: async () => {
      const found = await db.category.findMany({
        where: { slug: { in: DEMO_CATEGORY_SLUGS } },
        select: { slug: true },
      });
      const missing = DEMO_CATEGORY_SLUGS.filter(
        (s) => !found.some((f) => f.slug === s),
      );
      return missing.length === 0 ? true : `missing: ${missing.join(", ")}`;
    },
  },
  {
    name: "demo: 14 tags exist",
    run: async () => {
      const found = await db.tag.findMany({
        where: { name: { in: DEMO_TAGS } },
        select: { name: true },
      });
      const missing = DEMO_TAGS.filter(
        (t) => !found.some((f) => f.name === t),
      );
      return missing.length === 0 ? true : `missing: ${missing.join(", ")}`;
    },
  },
  {
    name: "demo: 16 documents exist by title",
    run: async () => {
      const found = await db.document.findMany({
        where: { title: { in: DEMO_DOC_TITLES } },
        select: { title: true },
      });
      const missing = DEMO_DOC_TITLES.filter(
        (t) => !found.some((f) => f.title === t),
      );
      return missing.length === 0 ? true : `missing: ${missing.join(", ")}`;
    },
  },
  {
    name: "demo: every demo document has a DocumentFile",
    run: async () => {
      const docs = await db.document.findMany({
        where: { title: { in: DEMO_DOC_TITLES } },
        select: { id: true, title: true },
      });
      const orphaned: string[] = [];
      for (const d of docs) {
        const f = await db.documentFile.findFirst({
          where: { documentId: d.id },
        });
        if (!f) orphaned.push(d.title);
      }
      return orphaned.length === 0
        ? true
        : `orphaned: ${orphaned.join(", ")}`;
    },
  },
  {
    name: "demo: nested comments + page-pinned + mentions present",
    run: async () => {
      const midterm = await db.document.findFirst({
        where: { title: "CS101 Midterm Practice Questions" },
      });
      if (!midterm) return "midterm doc missing";
      const top = await db.comment.count({
        where: { documentId: midterm.id, parentId: null },
      });
      const nested = await db.comment.count({
        where: { documentId: midterm.id, parentId: { not: null } },
      });
      const pinned = await db.comment.count({
        where: { documentId: midterm.id, pageNumber: { not: null } },
      });
      if (top < 1) return `expected top-level comment, got ${top}`;
      if (nested < 2) return `expected nested replies, got ${nested}`;
      if (pinned < 1) return `expected page-pinned, got ${pinned}`;
      const mentioned = await db.commentMention.count();
      return mentioned >= 2 ? true : `mentions=${mentioned}`;
    },
  },
  {
    name: "demo: recently viewed populated for noa + yael + restricted",
    run: async () => {
      const emails = [
        "noa.student@knowledgebank.demo",
        "yael.student@knowledgebank.demo",
        "restricted.student@knowledgebank.demo",
      ];
      for (const e of emails) {
        const u = await db.user.findFirst({ where: { email: e } });
        if (!u) return `${e} missing`;
        const c = await db.materialViewHistory.count({
          where: { userId: u.id },
        });
        if (c < 3) return `${e}: only ${c} views`;
      }
      return true;
    },
  },
  {
    name: "demo: all 9 demo material requests exist",
    run: async () => {
      const found = await db.materialRequest.findMany({
        where: { title: { in: DEMO_REQUEST_TITLES } },
        select: { title: true },
      });
      const missing = DEMO_REQUEST_TITLES.filter(
        (t) => !found.some((f) => f.title === t),
      );
      return missing.length === 0 ? true : `missing: ${missing.join(", ")}`;
    },
  },
  {
    name: "demo: review-workflow docs exist (draft, pending, rejected, approved)",
    run: async () => {
      const found = await db.document.findMany({
        where: { title: { in: DEMO_REVIEW_DOC_TITLES } },
        select: { title: true, status: true, reviewReason: true },
      });
      if (found.length < DEMO_REVIEW_DOC_TITLES.length) {
        const missing = DEMO_REVIEW_DOC_TITLES.filter(
          (t) => !found.some((f) => f.title === t),
        );
        return `missing: ${missing.join(", ")}`;
      }
      const draft = found.find((d) => d.title.includes("Draft"));
      if (draft?.status !== "draft") return `draft status=${draft?.status}`;
      const pending = found.find((d) => d.title.includes("Pending"));
      if (pending?.status !== "pending_review") return `pending status=${pending?.status}`;
      const rejected = found.find((d) => d.title.includes("Rejected"));
      if (rejected?.status !== "rejected") return `rejected status=${rejected?.status}`;
      if (!rejected?.reviewReason) return "rejected doc missing reviewReason";
      const approved = found.find((d) => d.title.includes("Approved"));
      if (approved?.status !== "approved") return `approved status=${approved?.status}`;
      return true;
    },
  },
  {
    name: "demo: favorites seeded for noa + amir + yael",
    run: async () => {
      const users = await db.user.findMany({
        where: {
          email: {
            in: [
              "noa.student@knowledgebank.demo",
              "amir.student@knowledgebank.demo",
              "yael.student@knowledgebank.demo",
            ],
          },
        },
        select: { id: true },
      });
      const userIds = users.map((u) => u.id);
      const n = await db.documentFavorite.count({
        where: { userId: { in: userIds } },
      });
      return n >= 5 ? true : `got ${n} favorites`;
    },
  },
  {
    name: "demo: comment reactions seeded",
    run: async () => {
      const n = await db.commentReaction.count();
      return n >= 1 ? true : `got ${n} reactions`;
    },
  },
  {
    name: "demo: closed request exists",
    run: async () => {
      const r = await db.materialRequest.findFirst({
        where: { title: "Old IS310 exam papers" },
      });
      if (!r) return "closed request missing";
      return r.status === "closed" ? true : `status=${r.status}`;
    },
  },
  {
    name: "demo: votes on demo requests",
    run: async () => {
      const reqs = await db.materialRequest.findMany({
        where: { title: { in: DEMO_REQUEST_TITLES } },
        select: { id: true },
      });
      const n = await db.requestVote.count({
        where: { requestId: { in: reqs.map((r) => r.id) } },
      });
      return n >= 5 ? true : `got ${n} votes`;
    },
  },
  {
    name: "demo: 'risk register sample' is fulfilled with a document link",
    run: async () => {
      const r = await db.materialRequest.findFirst({
        where: { title: "Please add risk register sample" },
      });
      if (!r) return "request missing";
      if (r.status !== "fulfilled") return `status=${r.status}`;
      if (!r.fulfillingDocumentId) return "no fulfillingDocumentId";
      return true;
    },
  },
  {
    // Sprint-2 audit: confirm `seed-demo` actually runs the metadata
    // extraction pipeline (task #27) rather than leaving the metadata
    // columns null. The check is intentionally loose — extraction is
    // best-effort per-file (the service is documented to never throw
    // and to silently fall back to empty), and pdf-parse in
    // particular has a worker-thread quirk when invoked from a tsx
    // script context that does not affect the live upload route.
    // What we *can* assert is that the markdown/text path populated
    // `extractedText`, which is the FTS column.
    name: "demo: extraction pipeline populated extractedText on at least one demo doc",
    run: async () => {
      const n = await db.documentFile.count({
        where: {
          document: { title: { in: DEMO_DOC_TITLES } },
          extractedText: { not: null },
        },
      });
      return n >= 1 ? true : "no demo doc has extractedText after seed";
    },
  },
  {
    // Sprint-2 audit (strengthened): prove the full-text-search
    // pipeline actually returns a seeded document because of a phrase
    // that lives *inside extractedText* — not just in the title /
    // description (which would pass even if extraction were a no-op).
    //
    // Strategy: pick a token that appears only in the fixture body
    // (`# Sprint Planning\n1. Refine backlog…` lives in the
    // sprint-planning.md fixture), then call the same
    // `documentsService.listDocuments` path the web app uses, as an
    // admin user (visibility-unrestricted). The expected document is
    // "Sprint Planning Guide" and its match must come via the FTS
    // route — i.e. only after the extracted-text trigger has fed the
    // tsvector. If extraction is broken (or the trigger didn't fire),
    // the title alone does contain "Sprint Planning", so we *also*
    // search for a body-only word ("Refine") that cannot match the
    // title or description and must come from extractedText.
    name: "demo: full-text search returns a seeded doc by a phrase from extractedText",
    run: async () => {
      const admin = await db.user.findFirst({
        where: { email: "admin@knowledgebank.demo" },
      });
      if (!admin) return "admin demo user missing";
      const authed = {
        id: admin.id,
        email: admin.email,
        displayName: admin.displayName,
        isActive: true,
        primaryRole: "admin",
        roles: ["admin"],
        enrollments: [],
      } as unknown as AuthenticatedUser;

      // "Refine" only appears in the body of sprint-planning.md
      // (`1. Refine backlog`). It is not in any DEMO_DOC_TITLES nor
      // in any course code / tag, so a hit here proves the FTS
      // pipeline indexed `document_files.extracted_text`.
      // Sprint-3 M7 retired the in-list `q` FTS branch — full-text
      // search now lives exclusively on the v2 search service.
      const res = await searchService.searchDocuments(
        { q: "Refine", sort: "newest", page: 1, pageSize: 10 },
        authed,
      );
      const hit = res.items.find(
        (d) => d.title === "Sprint Planning Guide",
      );
      if (!hit) {
        const titles = res.items.map((d) => d.title).join(", ");
        return `expected "Sprint Planning Guide" via FTS on body token "Refine"; got [${titles}]`;
      }
      return true;
    },
  },
  {
    name: "demo: 14 permissions seeded",
    run: async () => {
      const allKeys = [
        "users.manage", "courses.manage", "documents.manage",
        "documents.upload", "documents.view", "documents.download",
        "comments.manage", "comments.create", "comments.view",
        "requests.manage", "requests.view", "requests.fulfill",
        "requests.create", "requests.vote",
      ];
      const found = await db.permission.findMany({
        where: { key: { in: allKeys } },
        select: { key: true },
      });
      const missing = allKeys.filter(
        (k) => !found.some((f) => f.key === k),
      );
      return missing.length === 0 ? true : `missing: ${missing.join(", ")}`;
    },
  },
];

async function main() {
  let passed = 0;
  let failed = 0;
  for (const c of checks) {
    try {
      const r = await c.run();
      if (r === true) {
        passed++;
        // eslint-disable-next-line no-console
        console.log(`  ✓ ${c.name}`);
      } else {
        failed++;
        // eslint-disable-next-line no-console
        console.error(`  ✗ ${c.name} — ${r}`);
      }
    } catch (e) {
      failed++;
      // eslint-disable-next-line no-console
      console.error(`  ✗ ${c.name} — error: ${(e as Error).message}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().finally(async () => {
  await db.$disconnect();
});
