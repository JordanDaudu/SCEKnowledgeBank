/**
 * Comprehensive Knowledge Bank demo seed.
 *
 * Runs idempotently — uses stable emails, course codes, category slugs,
 * tag names, document titles, request titles, and comment bodies as
 * natural keys, so re-running this script never accumulates duplicates.
 *
 * Coexists with `seed.ts` (the lightweight CI / dev seed): both scripts
 * insert into the same tables but with disjoint natural keys (this one
 * uses `@knowledgebank.demo` emails, the lightweight one uses `@demo`).
 *
 * After running you can sign in with any of the demo credentials
 * printed at the end of the run, plus the original `student@demo` /
 * `lecturer@demo` / `admin@demo` accounts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { getStorage } from "../lib/storage";
import { logger } from "../lib/logger";
import { extractMetadata } from "../services/documents/metadata.service";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(
  __dirname, "..", "..", "..", "..", "lib", "db", "src", "seed", "fixtures",
);
const DEMO_PASSWORD = "Demo1234!";

type Status = "ACTIVE" | "PENDING_APPROVAL" | "DISABLED";

// ─── Helpers ─────────────────────────────────────────────────────────

function fixture(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURES_DIR, name));
}

function txt(...lines: string[]): Buffer {
  return Buffer.from(lines.join("\n") + "\n", "utf8");
}

// Single-page PDF used when no realistic fixture exists. Keeps tests
// for PDF previews and page-pinned comments meaningful.
function minimalPdf(title: string, body: string): Buffer {
  const content = `BT /F1 18 Tf 50 760 Td (${title.replace(/[()\\]/g, "")}) Tj 0 -28 Td /F1 12 Tf (${body.replace(/[()\\]/g, "")}) Tj ET`;
  const stream = `q\n${content}\nQ`;
  const streamLen = Buffer.byteLength(stream, "binary");
  const parts: string[] = [];
  const offsets: number[] = [];
  const add = (s: string) => {
    offsets.push(Buffer.byteLength(parts.join(""), "binary"));
    parts.push(s);
  };
  parts.push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  add(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  add(`2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n`);
  add(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`);
  add(`4 0 obj\n<< /Length ${streamLen} >>\nstream\n${stream}\nendstream\nendobj\n`);
  add(`5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);
  const xrefStart = Buffer.byteLength(parts.join(""), "binary");
  let xref = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${off.toString().padStart(10, "0")} 00000 n \n`;
  parts.push(xref);
  parts.push(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);
  return Buffer.from(parts.join(""), "binary");
}

async function ensureRole(name: string, description: string) {
  return (
    (await db.role.findFirst({ where: { name } })) ??
    (await db.role.create({ data: { name, description } }))
  );
}

async function ensurePermission(key: string, description: string) {
  return (
    (await db.permission.findFirst({ where: { key } })) ??
    (await db.permission.create({ data: { key, description } }))
  );
}

async function ensureCategory(name: string, slug: string, description: string) {
  return (
    (await db.category.findFirst({ where: { slug } })) ??
    (await db.category.create({ data: { name, slug, description } }))
  );
}

async function ensureTag(name: string) {
  return (
    (await db.tag.findFirst({ where: { name } })) ??
    (await db.tag.create({ data: { name } }))
  );
}

interface UserSpec {
  email: string;
  displayName: string;
  roleName: "admin" | "lecturer" | "student";
  status: Status;
  studentId?: string;
  lecturerId?: string;
  department?: string;
  quotaBytes?: bigint;
  usedBytes?: bigint;
}

async function ensureUser(spec: UserSpec, roleMap: Record<string, string>) {
  const roleId = roleMap[spec.roleName];
  let user = await db.user.findFirst({ where: { email: spec.email } });
  if (!user) {
    const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
    user = await db.user.create({
      data: {
        email: spec.email,
        displayName: spec.displayName,
        passwordHash: hash,
        primaryRoleId: roleId,
        status: spec.status,
        studentId: spec.studentId ?? null,
        lecturerId: spec.lecturerId ?? null,
        department: spec.department ?? null,
        usedBytes: spec.usedBytes ?? 0n,
        quotaBytes: spec.quotaBytes ?? null,
      },
    });
  } else {
    // Keep status / quota fields in sync if an admin or a previous
    // seed mutated them — that way `pnpm seed:demo` always restores
    // the documented demo state.
    await db.user.update({
      where: { id: user.id },
      data: {
        displayName: spec.displayName,
        status: spec.status,
        studentId: spec.studentId ?? null,
        lecturerId: spec.lecturerId ?? null,
        department: spec.department ?? null,
        usedBytes: spec.usedBytes ?? user.usedBytes,
        quotaBytes: spec.quotaBytes ?? user.quotaBytes,
        primaryRoleId: roleId,
      },
    });
  }
  await db.userRole.createMany({
    data: [{ userId: user.id, roleId }],
    skipDuplicates: true,
  });
  return user;
}

async function ensureCourse(opts: {
  code: string;
  title: string;
  lecturer: { id: string; displayName: string };
  semester: string;
  academicYear: number;
}) {
  const existing = await db.course.findFirst({ where: { code: opts.code } });
  if (existing) {
    return db.course.update({
      where: { id: existing.id },
      data: {
        title: opts.title,
        lecturerName: opts.lecturer.displayName,
        lecturerUserId: opts.lecturer.id,
      },
    });
  }
  return db.course.create({
    data: {
      code: opts.code,
      title: opts.title,
      lecturerName: opts.lecturer.displayName,
      lecturerUserId: opts.lecturer.id,
    },
  });
}

interface DocSpec {
  title: string;
  description: string;
  uploaderId: string;
  courseId?: string;
  categoryId?: string;
  materialType: string;
  visibility: "public" | "restricted" | "private";
  semester?: string;
  academicYear?: number;
  tagIds?: string[];
  mimeType: string;
  filename: string;
  body: Buffer;
  createdAt?: Date;
  status?: string;
  reviewReason?: string;
}

async function ensureDocument(spec: DocSpec) {
  // Convergent: if the document row already exists we still verify
  // that its DocumentFile and tag rows are present, and repair them
  // if a previous run crashed between writes.
  let doc = await db.document.findFirst({ where: { title: spec.title } });
  if (!doc) {
    doc = await db.document.create({
      data: {
        title: spec.title,
        description: spec.description,
        materialType: spec.materialType,
        visibility: spec.visibility,
        uploaderId: spec.uploaderId,
        ownerId: spec.uploaderId,
        createdBy: spec.uploaderId,
        updatedBy: spec.uploaderId,
        ...(spec.courseId ? { courseId: spec.courseId } : {}),
        ...(spec.categoryId ? { categoryId: spec.categoryId } : {}),
        ...(spec.semester ? { semester: spec.semester } : {}),
        ...(spec.academicYear != null ? { academicYear: spec.academicYear } : {}),
        ...(spec.createdAt ? { createdAt: spec.createdAt, updatedAt: spec.createdAt } : {}),
        ...(spec.status ? { status: spec.status } : {}),
        ...(spec.reviewReason != null ? { reviewReason: spec.reviewReason } : {}),
      },
    });
  } else {
    // Converge status and reviewReason on re-runs so the documented
    // demo state is always restored even if an admin mutated the doc.
    if (spec.status || spec.reviewReason != null) {
      await db.document.update({
        where: { id: doc.id },
        data: {
          ...(spec.status ? { status: spec.status } : {}),
          ...(spec.reviewReason != null ? { reviewReason: spec.reviewReason } : {}),
        },
      });
    }
  }

  let docFile = await db.documentFile.findFirst({
    where: { documentId: doc.id },
  });
  if (!docFile) {
    const ext = spec.filename.includes(".")
      ? spec.filename.slice(spec.filename.lastIndexOf("."))
      : "";
    const key = `documents/${doc.id.slice(0, 2)}/${doc.id}${ext}`;
    const put = await getStorage().put({
      key, body: spec.body, contentType: spec.mimeType,
    });
    docFile = await db.documentFile.create({
      data: {
        documentId: doc.id,
        originalFilename: spec.filename,
        displayFilename: spec.filename,
        storedFilename: key.split("/").pop() ?? key,
        mimeType: spec.mimeType,
        sizeBytes: BigInt(spec.body.length),
        storagePath: put.key,
        storageDriver: put.driver,
        checksum: put.checksum,
      },
    });
  }

  // ── Metadata backfill (Sprint-2 audit) ────────────────────────────
  //
  // Run real extraction against the fixture buffer so the seeded
  // documents look like the upload-path output: page counts on PDFs,
  // FTS text on PDFs/text files, image dimensions on images, and a
  // server-generated thumbnail on images. Backfills nulls only — once
  // the fields are non-null we skip the (relatively expensive) re-run
  // to keep `seed:demo` idempotent and fast.
  // Type-aware backfill predicate. Each MIME class has different
  // metadata columns the upload pipeline will actually populate, so
  // checking unsupported columns (e.g. `imageWidth` on a PDF, or
  // `pageCount` on a markdown file) would force an endless re-extract
  // on every `seed:demo` run. We mirror the dispatch in
  // `metadata.service.ts` and only require the columns each branch
  // produces.
  const mt = spec.mimeType;
  let needsMetadata = false;
  if (mt === "application/pdf") {
    needsMetadata =
      docFile.extractedText == null || docFile.pageCount == null;
  } else if (
    mt === "text/plain" ||
    mt === "text/markdown" ||
    mt === "text/csv"
  ) {
    needsMetadata = docFile.extractedText == null;
  } else if (mt.startsWith("image/")) {
    needsMetadata =
      docFile.imageWidth == null ||
      docFile.imageHeight == null ||
      docFile.thumbnailPath == null;
  } else {
    // Office / unknown: deep text extraction is best-effort. The
    // upload pipeline sets `fallbackIconType` at DTO-assembly time
    // (not on the file row), so there is no per-file column to
    // re-check — leave alone once seeded.
    needsMetadata = false;
  }
  if (needsMetadata) {
    const meta = await extractMetadata({
      buffer: spec.body,
      mimeType: spec.mimeType,
      filename: spec.filename,
    });
    const patch: Record<string, unknown> = {};
    if (meta.pageCount != null) patch.pageCount = meta.pageCount;
    if (meta.extractedText) patch.extractedText = meta.extractedText;
    if (meta.detectedTitle) patch.detectedTitle = meta.detectedTitle;
    if (meta.author) patch.author = meta.author;
    if (meta.imageWidth != null) patch.imageWidth = meta.imageWidth;
    if (meta.imageHeight != null) patch.imageHeight = meta.imageHeight;
    if (meta.thumbnail) {
      const thumbKey = `documents/${doc.id.slice(0, 2)}/${doc.id}.thumb.jpg`;
      const tput = await getStorage().put({
        key: thumbKey,
        body: meta.thumbnail.body,
        contentType: meta.thumbnail.mimeType,
      });
      patch.thumbnailPath = tput.key;
      patch.thumbnailMimeType = meta.thumbnail.mimeType;
    }
    if (Object.keys(patch).length > 0) {
      await db.documentFile.update({ where: { id: docFile.id }, data: patch });
    }
  }

  if (spec.tagIds?.length) {
    await db.documentTag.createMany({
      data: spec.tagIds.map((tagId) => ({ documentId: doc.id, tagId })),
      skipDuplicates: true,
    });
  }
  return doc;
}

// ─── Permissions matrix ──────────────────────────────────────────────

const PERMISSIONS_BY_ROLE = {
  admin: [
    "users.manage", "courses.manage", "documents.manage",
    "documents.upload", "documents.view", "documents.download",
    "comments.manage", "requests.manage",
  ],
  lecturer: [
    "documents.upload", "documents.view", "documents.download",
    "comments.create", "comments.view",
    "requests.view", "requests.fulfill",
  ],
  student: [
    "documents.view", "documents.download",
    "comments.create", "comments.view",
    "requests.create", "requests.vote",
  ],
} as const;

const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  "users.manage": "Manage user accounts (approve / disable / re-enable).",
  "courses.manage": "Create and update courses.",
  "documents.manage": "Manage any document, including delete and ownership change.",
  "documents.upload": "Upload new documents.",
  "documents.view": "View documents allowed by visibility/enrollment.",
  "documents.download": "Download document files via signed URLs.",
  "comments.manage": "Moderate or delete any comment.",
  "comments.create": "Create comments and replies on documents.",
  "comments.view": "Read comment threads.",
  "requests.manage": "Manage the material request board.",
  "requests.view": "View material requests.",
  "requests.fulfill": "Mark requests as fulfilled by linking a document.",
  "requests.create": "Open a new material request.",
  "requests.vote": "Vote on existing material requests.",
};

async function seedPermissions(roleMap: Record<string, string>) {
  const permIds: Record<string, string> = {};
  const allKeys = Array.from(
    new Set(Object.values(PERMISSIONS_BY_ROLE).flat()),
  );
  for (const key of allKeys) {
    const p = await ensurePermission(key, PERMISSION_DESCRIPTIONS[key] ?? key);
    permIds[key] = p.id;
  }
  for (const [roleName, keys] of Object.entries(PERMISSIONS_BY_ROLE)) {
    const roleId = roleMap[roleName];
    if (!roleId) continue;
    await db.rolePermission.createMany({
      data: keys.map((k) => ({ roleId, permissionId: permIds[k] })),
      skipDuplicates: true,
    });
  }
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  logger.info("▸ Seeding Knowledge Bank demo data…");

  const studentRole = await ensureRole("student", "Student");
  const lecturerRole = await ensureRole("lecturer", "Lecturer");
  const adminRole = await ensureRole("admin", "Administrator");
  const roleMap = {
    student: studentRole.id,
    lecturer: lecturerRole.id,
    admin: adminRole.id,
  };
  await seedPermissions(roleMap);

  // ─── Users ────────────────────────────────────────────────────────
  const KB = 1024n;
  const MB = KB * KB;
  const GB = MB * KB;

  const admin = await ensureUser({
    email: "admin@knowledgebank.demo",
    displayName: "Admin User",
    roleName: "admin",
    status: "ACTIVE",
  }, roleMap);

  const maya = await ensureUser({
    email: "maya.cohen@knowledgebank.demo",
    displayName: "Dr. Maya Cohen",
    roleName: "lecturer",
    status: "ACTIVE",
    lecturerId: "L-1001",
    department: "Computer Science",
  }, roleMap);

  const daniel = await ensureUser({
    email: "daniel.levi@knowledgebank.demo",
    displayName: "Prof. Daniel Levi",
    roleName: "lecturer",
    status: "ACTIVE",
    lecturerId: "L-1002",
    department: "Information Systems",
  }, roleMap);

  const pendingLecturer = await ensureUser({
    email: "pending.lecturer@knowledgebank.demo",
    displayName: "Pending Lecturer",
    roleName: "lecturer",
    status: "PENDING_APPROVAL",
    lecturerId: "L-1099",
    department: "Computer Science",
  }, roleMap);

  const noa = await ensureUser({
    email: "noa.student@knowledgebank.demo",
    displayName: "Noa Student",
    roleName: "student",
    status: "ACTIVE",
    studentId: "S-2001",
    quotaBytes: 500n * MB,
    usedBytes: 180n * MB, // medium usage
  }, roleMap);

  const amir = await ensureUser({
    email: "amir.student@knowledgebank.demo",
    displayName: "Amir Student",
    roleName: "student",
    status: "ACTIVE",
    studentId: "S-2002",
    quotaBytes: 500n * MB,
    usedBytes: 32n * MB, // low usage
  }, roleMap);

  const yael = await ensureUser({
    email: "yael.student@knowledgebank.demo",
    displayName: "Yael Student",
    roleName: "student",
    status: "ACTIVE",
    studentId: "S-2003",
    quotaBytes: 500n * MB,
    usedBytes: 470n * MB, // near quota
  }, roleMap);

  const restricted = await ensureUser({
    email: "restricted.student@knowledgebank.demo",
    displayName: "Restricted Student",
    roleName: "student",
    status: "ACTIVE",
    studentId: "S-2004",
    quotaBytes: 500n * MB,
    usedBytes: 12n * MB,
  }, roleMap);

  const disabled = await ensureUser({
    email: "disabled.user@knowledgebank.demo",
    displayName: "Disabled User",
    roleName: "student",
    status: "DISABLED",
    studentId: "S-9999",
  }, roleMap);

  // ─── Courses ──────────────────────────────────────────────────────
  const cs101 = await ensureCourse({
    code: "CS101", title: "Introduction to Computer Science",
    lecturer: maya, semester: "Spring", academicYear: 2026,
  });
  const cs220 = await ensureCourse({
    code: "CS220", title: "Data Structures",
    lecturer: maya, semester: "Spring", academicYear: 2026,
  });
  const is310 = await ensureCourse({
    code: "IS310", title: "Project Management",
    lecturer: daniel, semester: "Spring", academicYear: 2026,
  });
  const is420 = await ensureCourse({
    code: "IS420", title: "Knowledge Management Systems",
    lecturer: daniel, semester: "Spring", academicYear: 2026,
  });

  // Lecturer ownership + student enrollments — idempotent via
  // `(userId, courseId)` unique constraint.
  await db.courseEnrollment.createMany({
    data: [
      { userId: maya.id, courseId: cs101.id, roleInCourse: "lecturer" },
      { userId: maya.id, courseId: cs220.id, roleInCourse: "lecturer" },
      { userId: daniel.id, courseId: is310.id, roleInCourse: "lecturer" },
      { userId: daniel.id, courseId: is420.id, roleInCourse: "lecturer" },
      // Noa: CS101, CS220, IS310
      { userId: noa.id, courseId: cs101.id, roleInCourse: "student" },
      { userId: noa.id, courseId: cs220.id, roleInCourse: "student" },
      { userId: noa.id, courseId: is310.id, roleInCourse: "student" },
      // Amir: CS101, IS310
      { userId: amir.id, courseId: cs101.id, roleInCourse: "student" },
      { userId: amir.id, courseId: is310.id, roleInCourse: "student" },
      // Yael: IS310, IS420
      { userId: yael.id, courseId: is310.id, roleInCourse: "student" },
      { userId: yael.id, courseId: is420.id, roleInCourse: "student" },
      // Restricted: only CS101 — used to demonstrate course-aware permissions
      { userId: restricted.id, courseId: cs101.id, roleInCourse: "student" },
    ],
    skipDuplicates: true,
  });

  // ─── Categories ───────────────────────────────────────────────────
  const catLectureNotes = await ensureCategory("Lecture Notes", "lecture-notes", "Notes from lectures and recitations");
  const catAssignments  = await ensureCategory("Assignments", "assignments", "Homework and assignments");
  const catExams        = await ensureCategory("Exams", "exams", "Midterm and final exam materials");
  const catSummaries    = await ensureCategory("Summaries", "summaries", "Topic summaries and study guides");
  const catPresentations= await ensureCategory("Presentations", "presentations", "Slide decks and presentations");
  const catReading      = await ensureCategory("Reading Material", "reading-material", "Articles and supplemental reading");
  const catProjects     = await ensureCategory("Project Documents", "project-documents", "Project templates and instructions");

  // ─── Tags ─────────────────────────────────────────────────────────
  const tagNames = [
    "algorithms", "recursion", "arrays", "linked-list", "exam-prep",
    "sprint", "agile", "risk-management", "knowledge-base", "database",
    "pdf", "presentation", "summary", "important",
  ];
  const tagsByName: Record<string, string> = {};
  for (const t of tagNames) tagsByName[t] = (await ensureTag(t)).id;

  // ─── Documents ────────────────────────────────────────────────────
  // Spread createdAt over the last 60 days so popularity / recents
  // sorting has variance.
  const now = Date.now();
  const daysAgo = (n: number) => new Date(now - n * 86_400_000);

  const docDefs: Array<{
    key: string;
    spec: Omit<DocSpec, "body"> & { body?: Buffer; bodyFactory?: () => Buffer };
  }> = [
    // ── CS101 ────────────────────────────────────────────────────
    { key: "cs101-l1", spec: {
        title: "Introduction to Programming — Lecture 1",
        description: "First lecture: what programming is, mental models, and the shape of CS101.",
        uploaderId: maya.id, courseId: cs101.id, categoryId: catLectureNotes.id,
        materialType: "lecture-notes", visibility: "public",
        semester: "Spring", academicYear: 2026,
        tagIds: [tagsByName["pdf"], tagsByName["important"]],
        mimeType: "application/pdf", filename: "cs101-lecture-01.pdf",
        bodyFactory: () => fixture("sample-lecture-notes.pdf"),
        createdAt: daysAgo(55),
    }},
    { key: "cs101-summary", spec: {
        title: "Variables and Control Flow Summary",
        description: "One-page summary of variables, branching, and loops.",
        uploaderId: maya.id, courseId: cs101.id, categoryId: catSummaries.id,
        materialType: "summary", visibility: "public",
        semester: "Spring", academicYear: 2026,
        tagIds: [tagsByName["summary"]],
        mimeType: "text/markdown", filename: "cs101-control-flow-summary.md",
        bodyFactory: () => txt(
          "# Variables and Control Flow",
          "- Variables, types, and assignment",
          "- Branching: if / else / switch",
          "- Loops: for, while, do-while",
        ),
        createdAt: daysAgo(48),
    }},
    { key: "cs101-a1", spec: {
        title: "CS101 Assignment 1 — Basics",
        description: "Restricted assignment for enrolled CS101 students.",
        uploaderId: maya.id, courseId: cs101.id, categoryId: catAssignments.id,
        materialType: "assignment", visibility: "restricted",
        semester: "Spring", academicYear: 2026,
        tagIds: [tagsByName["important"]],
        mimeType: "application/pdf", filename: "cs101-assignment-1.pdf",
        bodyFactory: () => minimalPdf("CS101 Assignment 1", "Basics: variables, expressions, control flow."),
        createdAt: daysAgo(42),
    }},
    { key: "cs101-midterm-q", spec: {
        title: "CS101 Midterm Practice Questions",
        description: "Practice midterm. Multiple pages — perfect for page-pinned comments.",
        uploaderId: maya.id, courseId: cs101.id, categoryId: catExams.id,
        materialType: "exam", visibility: "restricted",
        semester: "Spring", academicYear: 2026,
        tagIds: [tagsByName["exam-prep"]],
        mimeType: "application/pdf", filename: "cs101-midterm-practice.pdf",
        bodyFactory: () => fixture("sample-problem-set.pdf"),
        createdAt: daysAgo(35),
    }},

    // ── CS220 ────────────────────────────────────────────────────
    { key: "cs220-arrays", spec: {
        title: "Data Structures — Arrays and Lists",
        description: "Foundational notes on arrays, linked lists, and trade-offs.",
        uploaderId: maya.id, courseId: cs220.id, categoryId: catLectureNotes.id,
        materialType: "lecture-notes", visibility: "public",
        semester: "Spring", academicYear: 2026,
        tagIds: [tagsByName["arrays"], tagsByName["linked-list"]],
        mimeType: "application/pdf", filename: "cs220-arrays-lists.pdf",
        bodyFactory: () => minimalPdf("Arrays and Lists", "Array vs linked list — access, insert, delete costs."),
        createdAt: daysAgo(50),
    }},
    { key: "cs220-recursion", spec: {
        title: "Recursion Worksheet",
        description: "Hands-on recursion problems for CS220 enrolled students.",
        uploaderId: maya.id, courseId: cs220.id, categoryId: catAssignments.id,
        materialType: "assignment", visibility: "restricted",
        semester: "Spring", academicYear: 2026,
        tagIds: [tagsByName["recursion"]],
        mimeType: "application/pdf", filename: "cs220-recursion-worksheet.pdf",
        bodyFactory: () => minimalPdf("Recursion Worksheet", "Define, trace, and reason about recursive functions."),
        createdAt: daysAgo(28),
    }},
    { key: "cs220-bigo", spec: {
        title: "Algorithm Complexity Cheat Sheet",
        description: "Big-O reference for common sorts and search algorithms.",
        uploaderId: maya.id, courseId: cs220.id, categoryId: catSummaries.id,
        materialType: "summary", visibility: "public",
        semester: "Spring", academicYear: 2026,
        tagIds: [tagsByName["algorithms"], tagsByName["summary"]],
        mimeType: "text/markdown", filename: "cs220-bigo-cheatsheet.md",
        bodyFactory: () => txt(
          "# Big-O Cheat Sheet",
          "Bubble sort: O(n^2)",
          "Quicksort: O(n log n) average",
          "Hash table lookup: O(1) average",
        ),
        createdAt: daysAgo(22),
    }},

    // ── IS310 ────────────────────────────────────────────────────
    { key: "is310-agile-slides", spec: {
        title: "Agile Project Management Slides",
        description: "Lecture deck covering Scrum, Kanban, and sprint cadence.",
        uploaderId: daniel.id, courseId: is310.id, categoryId: catPresentations.id,
        materialType: "slides", visibility: "public",
        semester: "Spring", academicYear: 2026,
        tagIds: [tagsByName["agile"], tagsByName["sprint"], tagsByName["presentation"]],
        mimeType: "application/pdf", filename: "is310-agile-slides.pdf",
        bodyFactory: () => minimalPdf("Agile PM", "Scrum, Kanban, sprint cadence, retrospectives."),
        createdAt: daysAgo(40),
    }},
    { key: "is310-risk", spec: {
        title: "Risk Management Template",
        description: "Restricted template for the IS310 risk register assignment.",
        uploaderId: daniel.id, courseId: is310.id, categoryId: catProjects.id,
        materialType: "template", visibility: "restricted",
        semester: "Spring", academicYear: 2026,
        tagIds: [tagsByName["risk-management"]],
        mimeType: "application/pdf", filename: "is310-risk-template.pdf",
        bodyFactory: () => minimalPdf("Risk Register Template", "Probability x impact, mitigation, owner."),
        createdAt: daysAgo(30),
    }},
    { key: "is310-sprint", spec: {
        title: "Sprint Planning Guide",
        description: "Reading material walking through a sprint planning meeting.",
        uploaderId: daniel.id, courseId: is310.id, categoryId: catReading.id,
        materialType: "reading", visibility: "public",
        semester: "Spring", academicYear: 2026,
        tagIds: [tagsByName["sprint"], tagsByName["agile"]],
        mimeType: "text/markdown", filename: "is310-sprint-planning.md",
        bodyFactory: () => txt(
          "# Sprint Planning",
          "1. Refine backlog",
          "2. Capacity check",
          "3. Commit to sprint goal",
        ),
        createdAt: daysAgo(20),
    }},
    { key: "is310-final", spec: {
        title: "Final Project Instructions",
        description: "Restricted final-project brief for IS310 enrolled students.",
        uploaderId: daniel.id, courseId: is310.id, categoryId: catAssignments.id,
        materialType: "assignment", visibility: "restricted",
        semester: "Spring", academicYear: 2026,
        tagIds: [tagsByName["important"]],
        mimeType: "application/pdf", filename: "is310-final-instructions.pdf",
        bodyFactory: () => minimalPdf("IS310 Final Project", "Deliverables, milestones, grading rubric."),
        createdAt: daysAgo(10),
    }},

    // ── IS420 ────────────────────────────────────────────────────
    { key: "is420-arch", spec: {
        title: "Knowledge Base Architecture",
        description: "Architectural overview of a modern knowledge base system.",
        uploaderId: daniel.id, courseId: is420.id, categoryId: catLectureNotes.id,
        materialType: "lecture-notes", visibility: "public",
        semester: "Spring", academicYear: 2026,
        tagIds: [tagsByName["knowledge-base"], tagsByName["database"]],
        mimeType: "application/pdf", filename: "is420-architecture.pdf",
        bodyFactory: () => minimalPdf("Knowledge Base Architecture", "Ingest, store, index, retrieve."),
        createdAt: daysAgo(45),
    }},
    { key: "is420-metadata", spec: {
        title: "Metadata Extraction Reading",
        description: "Background reading on metadata extraction pipelines.",
        uploaderId: daniel.id, courseId: is420.id, categoryId: catReading.id,
        materialType: "reading", visibility: "public",
        semester: "Spring", academicYear: 2026,
        tagIds: [tagsByName["knowledge-base"]],
        mimeType: "text/markdown", filename: "is420-metadata-reading.md",
        bodyFactory: () => txt(
          "# Metadata Extraction",
          "Title detection, author, abstract, keywords.",
          "Common libraries: tika, pdf.js, exiftool.",
        ),
        createdAt: daysAgo(33),
    }},
    { key: "is420-search", spec: {
        title: "Search and Discovery Design",
        description: "Design patterns for relevance ranking and faceted search.",
        uploaderId: daniel.id, courseId: is420.id, categoryId: catPresentations.id,
        materialType: "slides", visibility: "public",
        semester: "Spring", academicYear: 2026,
        tagIds: [tagsByName["database"], tagsByName["presentation"]],
        mimeType: "application/pdf", filename: "is420-search-design.pdf",
        bodyFactory: () => minimalPdf("Search & Discovery", "BM25, vectors, hybrid ranking."),
        createdAt: daysAgo(18),
    }},
    { key: "is420-final-review", spec: {
        title: "IS420 Final Exam Review",
        description: "Restricted final-exam review for IS420 enrolled students.",
        uploaderId: daniel.id, courseId: is420.id, categoryId: catExams.id,
        materialType: "exam", visibility: "restricted",
        semester: "Spring", academicYear: 2026,
        tagIds: [tagsByName["exam-prep"], tagsByName["important"]],
        mimeType: "application/pdf", filename: "is420-final-review.pdf",
        bodyFactory: () => minimalPdf("IS420 Final Review", "Topics, sample questions, study plan."),
        createdAt: daysAgo(7),
    }},

    // ── Private lecturer notes ────────────────────────────────────
    { key: "maya-private", spec: {
        title: "Private Lecturer Notes — CS220",
        description: "Maya's private prep notes. Visible only to owner and admin.",
        uploaderId: maya.id, courseId: cs220.id, categoryId: catLectureNotes.id,
        materialType: "lecture-notes", visibility: "private",
        semester: "Spring", academicYear: 2026,
        tagIds: [],
        mimeType: "text/markdown", filename: "maya-private-notes.md",
        bodyFactory: () => txt(
          "# Private notes",
          "Internal grading notes — do not share.",
        ),
        createdAt: daysAgo(3),
    }},

    // ── Student review-workflow documents (Sprint-3 demo) ─────────
    // These illustrate every status reachable via the student-upload
    // flow: draft (not yet submitted), pending_review (waiting for
    // lecturer decision), rejected (with reason), and approved.
    { key: "noa-draft", spec: {
        title: "Noa's Draft Study Notes — CS101",
        description: "Noa's unfinished notes — still being edited before submission.",
        uploaderId: noa.id, courseId: cs101.id, categoryId: catLectureNotes.id,
        materialType: "lecture-notes", visibility: "public",
        semester: "Spring", academicYear: 2026,
        tagIds: [tagsByName["summary"]],
        mimeType: "text/markdown", filename: "noa-draft-notes.md",
        bodyFactory: () => txt(
          "# CS101 Study Notes (DRAFT)",
          "Week 1: variables, loops, functions.",
          "Week 2: TODO — add examples",
        ),
        createdAt: daysAgo(2),
        status: "draft",
    }},
    { key: "noa-pending", spec: {
        title: "Noa's CS101 Exam Summary — Pending Review",
        description: "Noa's one-page exam summary submitted for lecturer approval.",
        uploaderId: noa.id, courseId: cs101.id, categoryId: catSummaries.id,
        materialType: "summary", visibility: "public",
        semester: "Spring", academicYear: 2026,
        tagIds: [tagsByName["exam-prep"], tagsByName["summary"]],
        mimeType: "text/markdown", filename: "noa-exam-summary.md",
        bodyFactory: () => txt(
          "# CS101 Exam Summary",
          "Key concepts: recursion, sorting, complexity.",
          "Practice: BFS, DFS, dynamic programming.",
        ),
        createdAt: daysAgo(1),
        status: "pending_review",
    }},
    { key: "amir-rejected", spec: {
        title: "Amir's CS101 Lab Report — Rejected",
        description: "Amir's first lab report submission — rejected due to missing references.",
        uploaderId: amir.id, courseId: cs101.id, categoryId: catAssignments.id,
        materialType: "assignment", visibility: "public",
        semester: "Spring", academicYear: 2026,
        tagIds: [],
        mimeType: "text/markdown", filename: "amir-lab-report.md",
        bodyFactory: () => txt(
          "# Lab Report 1",
          "We implemented a linked list.",
          "Results: it works.",
        ),
        createdAt: daysAgo(4),
        status: "rejected",
        reviewReason: "Incomplete references — please add full citations and expand the results section with measurements.",
    }},
    { key: "amir-approved", spec: {
        title: "Amir's IS310 Sprint Notes — Approved",
        description: "Amir's sprint-process notes, approved by lecturer for public sharing.",
        uploaderId: amir.id, courseId: is310.id, categoryId: catLectureNotes.id,
        materialType: "lecture-notes", visibility: "public",
        semester: "Spring", academicYear: 2026,
        tagIds: [tagsByName["sprint"], tagsByName["agile"]],
        mimeType: "text/markdown", filename: "amir-sprint-notes.md",
        bodyFactory: () => txt(
          "# Sprint Notes — IS310",
          "Sprint 1: planning, backlog refinement.",
          "Sprint 2: velocity tracking, retrospective.",
        ),
        createdAt: daysAgo(6),
        status: "approved",
    }},
  ];

  const docs: Record<string, { id: string }> = {};
  for (const { key, spec } of docDefs) {
    const body = spec.body ?? spec.bodyFactory!();
    const d = await ensureDocument({ ...spec, body });
    docs[key] = d;
  }

  // ─── Recently viewed ──────────────────────────────────────────────
  // Course-aware: each viewer only "views" documents they can access.
  // Idempotent: skip insert when (user, document) already recorded.
  const viewPlan: Array<[string, string[]]> = [
    [noa.id, ["cs101-l1", "cs101-summary", "cs101-midterm-q", "cs220-arrays", "cs220-bigo", "is310-agile-slides", "is310-sprint"]],
    [amir.id, ["cs101-l1", "cs101-summary", "is310-agile-slides", "is310-sprint"]],
    [yael.id, ["is310-agile-slides", "is310-final", "is420-arch", "is420-search", "is420-final-review"]],
    [restricted.id, ["cs101-l1", "cs101-summary", "cs101-a1", "cs101-midterm-q"]],
  ];
  for (const [userId, keys] of viewPlan) {
    for (const k of keys) {
      const docId = docs[k]?.id;
      if (!docId) continue;
      const exists = await db.materialViewHistory.findFirst({
        where: { documentId: docId, userId },
      });
      if (!exists) {
        await db.materialViewHistory.create({
          data: { documentId: docId, userId },
        });
      }
    }
  }

  // ─── Comments (with nested replies, page-pinned, @mentions) ──────
  // Idempotent on (documentId, body). Mentions resolved against actual
  // users so the mention table has real foreign keys.
  async function ensureComment(opts: {
    documentId: string;
    authorId: string;
    body: string;
    parentId?: string;
    pageNumber?: number;
    mentions?: string[];
  }): Promise<{ id: string }> {
    // Convergent: re-running reconciles parentId / pageNumber and tops
    // up mentions if they were partially written on a prior crash.
    let c = await db.comment.findFirst({
      where: { documentId: opts.documentId, body: opts.body },
    });
    if (!c) {
      c = await db.comment.create({
        data: {
          documentId: opts.documentId,
          authorId: opts.authorId,
          body: opts.body,
          parentId: opts.parentId ?? null,
          pageNumber: opts.pageNumber ?? null,
        },
      });
    } else if (
      (opts.parentId ?? null) !== c.parentId ||
      (opts.pageNumber ?? null) !== c.pageNumber
    ) {
      c = await db.comment.update({
        where: { id: c.id },
        data: {
          parentId: opts.parentId ?? null,
          pageNumber: opts.pageNumber ?? null,
        },
      });
    }
    if (opts.mentions?.length) {
      await db.commentMention.createMany({
        data: opts.mentions.map((mentionedUserId) => ({
          commentId: c!.id, mentionedUserId,
        })),
        skipDuplicates: true,
      });
    }
    return c;
  }

  // 1) Page-pinned PDF thread on the midterm practice doc
  const midtermQ = await ensureComment({
    documentId: docs["cs101-midterm-q"].id,
    authorId: noa.id,
    body: "Q4 on page 2 — is the answer key released anywhere?",
    pageNumber: 2,
    mentions: [maya.id],
  });
  const mayaReply = await ensureComment({
    documentId: docs["cs101-midterm-q"].id,
    authorId: maya.id,
    body: "Good question — I'll post the worked solutions after the practice deadline.",
    parentId: midtermQ.id,
    pageNumber: 2,
  });
  await ensureComment({
    documentId: docs["cs101-midterm-q"].id,
    authorId: amir.id,
    body: "Thanks Dr. Cohen — that'll really help.",
    parentId: mayaReply.id,
    pageNumber: 2,
  });

  // 2) Mention thread on the risk template
  const yaelQ = await ensureComment({
    documentId: docs["is310-risk"].id,
    authorId: yael.id,
    body: "Could you clarify the scoring rubric? @Prof. Daniel Levi",
    mentions: [daniel.id],
  });
  await ensureComment({
    documentId: docs["is310-risk"].id,
    authorId: daniel.id,
    body: "Use the 1–5 probability × impact matrix on the second sheet.",
    parentId: yaelQ.id,
  });

  // 3) Shorter threads on three more docs to satisfy "at least 5"
  await ensureComment({
    documentId: docs["cs220-recursion"].id,
    authorId: noa.id,
    body: "Problem 3 is tricky — any hint on the base case?",
    mentions: [maya.id],
  });
  await ensureComment({
    documentId: docs["is420-arch"].id,
    authorId: yael.id,
    body: "Loved the diagram on page 1 — clarified the ingest path.",
    pageNumber: 1,
  });
  await ensureComment({
    documentId: docs["is310-agile-slides"].id,
    authorId: amir.id,
    body: "Are the retro templates posted somewhere too?",
  });

  // ─── Favorites (document following) ─────────────────────────────
  // Idempotent via (userId, documentId) unique constraint.
  const favoritePlan: Array<[string, string[]]> = [
    [noa.id,  ["cs101-l1", "cs101-midterm-q", "cs220-arrays", "is310-agile-slides"]],
    [amir.id, ["cs101-l1", "is310-sprint"]],
    [yael.id, ["is420-arch", "is420-search", "is310-risk"]],
  ];
  for (const [userId, keys] of favoritePlan) {
    for (const k of keys) {
      const docId = docs[k]?.id;
      if (!docId) continue;
      await db.documentFavorite.createMany({
        data: [{ userId, documentId: docId }],
        skipDuplicates: true,
      });
    }
  }

  // ─── Comment reactions ────────────────────────────────────────────
  // Seed a handful of emoji reactions to show the reaction strip on
  // comment threads. Idempotent via (commentId, userId, emoji).
  async function ensureReaction(commentId: string, userId: string, kind: string) {
    await db.commentReaction.createMany({
      data: [{ commentId, userId, kind }],
      skipDuplicates: true,
    });
  }

  // Reactions on the midterm thread comments
  const midtermDoc = await db.document.findFirst({
    where: { title: "CS101 Midterm Practice Questions" },
  });
  if (midtermDoc) {
    const midtermComments = await db.comment.findMany({
      where: { documentId: midtermDoc.id },
      take: 3,
    });
    for (const [i, c] of midtermComments.entries()) {
      // Cycle through reaction kinds and reactors so each comment gets ≥1 reaction
      const pairs: Array<[string, string]> = [
        ["like", noa.id], ["like", amir.id], ["like", yael.id],
      ];
      const [kind, userId] = pairs[i % pairs.length]!;
      await ensureReaction(c.id, userId, kind);
    }
  }

  // ─── Material requests ────────────────────────────────────────────
  async function ensureRequest(opts: {
    title: string;
    description: string;
    courseId?: string;
    requestedBy: string;
    status: "open" | "in_progress" | "fulfilled" | "closed";
    voters?: string[];
    fulfillingDocumentId?: string;
  }) {
    let req = await db.materialRequest.findFirst({ where: { title: opts.title } });
    if (!req) {
      req = await db.materialRequest.create({
        data: {
          title: opts.title,
          description: opts.description,
          courseId: opts.courseId ?? null,
          requestedBy: opts.requestedBy,
          status: opts.status,
          fulfillingDocumentId: opts.fulfillingDocumentId ?? null,
        },
      });
    } else {
      // Converge: restore status / description / fulfillment link
      // in case an admin mutated them between seed runs.
      req = await db.materialRequest.update({
        where: { id: req.id },
        data: {
          description: opts.description,
          status: opts.status,
          fulfillingDocumentId: opts.fulfillingDocumentId ?? null,
        },
      });
    }
    if (opts.voters?.length) {
      await db.requestVote.createMany({
        data: opts.voters.map((userId) => ({ requestId: req!.id, userId })),
        skipDuplicates: true,
      });
    }
    return req;
  }

  await ensureRequest({
    title: "Need CS101 final exam examples",
    description: "Past CS101 finals would help us prepare.",
    courseId: cs101.id, requestedBy: noa.id, status: "open",
    voters: [amir.id, restricted.id, yael.id],
  });
  await ensureRequest({
    title: "Please upload more recursion exercises",
    description: "The worksheet only has 5 problems — could we get more?",
    courseId: cs220.id, requestedBy: noa.id, status: "open",
    voters: [amir.id],
  });
  await ensureRequest({
    title: "Missing project charter template",
    description: "We need a charter template for the IS310 final project.",
    courseId: is310.id, requestedBy: amir.id, status: "open",
    voters: [noa.id, yael.id],
  });
  await ensureRequest({
    title: "Need IS420 metadata extraction example",
    description: "Could we get a worked example of the metadata pipeline?",
    courseId: is420.id, requestedBy: yael.id, status: "open",
    voters: [],
  });
  await ensureRequest({
    title: "Can we get Agile retrospective slides?",
    description: "The lecture covered retros but slides weren't posted.",
    courseId: is310.id, requestedBy: amir.id, status: "open",
    voters: [noa.id, yael.id],
  });
  await ensureRequest({
    title: "Need Data Structures previous exams",
    description: "Old CS220 papers would help with revision.",
    courseId: cs220.id, requestedBy: noa.id, status: "open",
    voters: [amir.id, yael.id],
  });
  await ensureRequest({
    title: "Please add risk register sample",
    description: "A completed risk register example would be very useful.",
    courseId: is310.id, requestedBy: yael.id, status: "fulfilled",
    voters: [noa.id, amir.id],
    fulfillingDocumentId: docs["is310-risk"].id,
  });
  await ensureRequest({
    title: "Need summary for Knowledge Base Architecture",
    description: "A one-page summary of the architecture lecture would be great.",
    courseId: is420.id, requestedBy: yael.id, status: "open",
    voters: [noa.id],
  });
  await ensureRequest({
    title: "Old IS310 exam papers",
    description: "Past IS310 papers from 2023-2024 would help with revision.",
    courseId: is310.id, requestedBy: amir.id, status: "closed",
    voters: [noa.id],
  });

  // ─── Demo hygiene: prune non-demo requests ────────────────────────
  // Playwright smoke tests create material requests (title prefix
  // "smoke request …"). Delete any request whose title is not in the
  // known demo set so the request board starts clean for every demo run.
  const demoRequestTitles = [
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
  const pruned = await db.materialRequest.deleteMany({
    where: { title: { notIn: demoRequestTitles } },
  });
  if (pruned.count > 0) {
    logger.info(`✓ Pruned ${pruned.count} non-demo request(s)`);
  }

  // ─── Prep Hub: a study collection + progress for Noa ──────────────
  // Gives the Prep Hub, Continue-studying, and recommendation surfaces real
  // demo data. Idempotent: find-or-create the collection, then reset its
  // items and re-add in order.
  let prep = await db.studyCollection.findFirst({
    where: { ownerId: noa.id, title: "CS101 Final Prep" },
  });
  if (!prep) {
    prep = await db.studyCollection.create({
      data: {
        ownerId: noa.id,
        title: "CS101 Final Prep",
        description: "Everything I need to review for the CS101 final.",
        kind: "exam_prep",
      },
    });
  }
  await db.studyCollectionItem.deleteMany({ where: { collectionId: prep.id } });
  const prepKeys = ["cs101-l1", "cs101-midterm-q", "cs220-arrays"];
  let prepPos = 0;
  for (const k of prepKeys) {
    const docId = docs[k]?.id;
    if (!docId) continue;
    await db.studyCollectionItem.create({
      data: { collectionId: prep.id, documentId: docId, position: prepPos++ },
    });
  }
  async function setProgress(key: string, status: "reviewing" | "completed") {
    const docId = docs[key]?.id;
    if (!docId) return;
    await db.studyProgress.upsert({
      where: { userId_documentId: { userId: noa.id, documentId: docId } },
      create: { userId: noa.id, documentId: docId, status },
      update: { status },
    });
  }
  await setProgress("cs101-l1", "completed");
  await setProgress("cs101-midterm-q", "reviewing");
  await setProgress("cs220-arrays", "reviewing");
  logger.info("✓ Seeded Prep Hub collection + study progress for Noa");

  // ─── Prep Hub: a catalogue of PUBLIC study collections ────────────
  // Gives every Prep Hub discovery lane (Trending / Popular / Highest
  // Rated / Most Viewed / New / Upcoming Exams / For You) real demo data.
  // Each collection is find-or-created by (ownerId, title); items are
  // reset and re-added in order so the script stays idempotent. Engagement
  // (views / likes / follows / ratings / comments) is seeded into the
  // event tables and the denormalised counters are recomputed afterwards
  // (see the engagement-counter sync block below), mirroring how the
  // documents counters are rebuilt from their event tables.
  const daysFromNow = (n: number) => new Date(now + n * 86_400_000);

  interface CollectionSpec {
    owner: { id: string };
    title: string;
    description: string;
    kind: "collection" | "exam_prep" | "revision" | "semester" | "learning_path";
    isOfficial?: boolean;
    course?: { id: string };
    category?: { id: string };
    examName?: string;
    examDate?: Date;
    createdAt?: Date;
    itemKeys: string[];
    tagNames?: string[];
    // Engagement — user ids drive the denormalised counters.
    views?: string[];
    likes?: string[];
    followers?: string[];
    ratings?: Array<[string, number]>; // [userId, 1..5]
    comments?: Array<[string, string]>; // [authorId, body]
  }

  const collectionSpecs: CollectionSpec[] = [
    {
      owner: maya, title: "CS101 Crash Course",
      description: "A guided path through the CS101 fundamentals — start here if you're new to programming.",
      kind: "learning_path", isOfficial: true, course: cs101, category: catLectureNotes,
      createdAt: daysAgo(40),
      itemKeys: ["cs101-l1", "cs101-summary", "cs101-a1", "cs101-midterm-q"],
      tagNames: ["important", "summary"],
      views: [noa.id, amir.id, yael.id, restricted.id, daniel.id, admin.id],
      likes: [noa.id, amir.id, restricted.id],
      followers: [noa.id, amir.id, yael.id, restricted.id],
      ratings: [[noa.id, 5], [amir.id, 4], [yael.id, 5]],
      comments: [[noa.id, "This made CS101 finally click for me!"], [amir.id, "Perfect for a last-minute review."]],
    },
    {
      owner: maya, title: "Data Structures Mastery",
      description: "Everything you need to ace CS220 — arrays, lists, recursion, and complexity.",
      kind: "learning_path", isOfficial: true, course: cs220, category: catLectureNotes,
      createdAt: daysAgo(35),
      itemKeys: ["cs220-arrays", "cs220-recursion", "cs220-bigo"],
      tagNames: ["algorithms", "arrays", "recursion"],
      views: [noa.id, amir.id, yael.id],
      likes: [noa.id, yael.id],
      followers: [noa.id, amir.id],
      ratings: [[noa.id, 5], [amir.id, 5], [yael.id, 5], [restricted.id, 5]],
      comments: [[noa.id, "The recursion section is gold."]],
    },
    {
      owner: maya, title: "Big-O & Complexity Essentials",
      description: "A compact revision pack on algorithmic complexity and common Big-O classes.",
      kind: "revision", course: cs220, category: catSummaries,
      createdAt: daysAgo(25),
      itemKeys: ["cs220-bigo", "cs220-arrays"],
      tagNames: ["algorithms", "summary"],
      views: [amir.id, yael.id],
      likes: [amir.id],
      followers: [yael.id],
      ratings: [[amir.id, 4], [yael.id, 4]],
    },
    {
      owner: daniel, title: "Agile & Scrum Foundations",
      description: "Lecture-curated intro to Agile, Scrum, and sprint cadence for IS310.",
      kind: "learning_path", isOfficial: true, course: is310, category: catPresentations,
      createdAt: daysAgo(38),
      itemKeys: ["is310-agile-slides", "is310-sprint"],
      tagNames: ["agile", "sprint", "presentation"],
      views: [noa.id, amir.id, yael.id, restricted.id, maya.id],
      likes: [amir.id, yael.id],
      followers: [amir.id, yael.id, noa.id],
      ratings: [[amir.id, 4], [yael.id, 5]],
      comments: [[amir.id, "Clearest explanation of Scrum I've seen."]],
    },
    {
      owner: daniel, title: "IS310 Final Project Toolkit",
      description: "Templates and guides for the IS310 final project — risk register, planning, and brief.",
      kind: "collection", course: is310, category: catProjects,
      createdAt: daysAgo(15),
      examName: "IS310 Final Project Defense", examDate: daysFromNow(21),
      itemKeys: ["is310-risk", "is310-final", "is310-sprint"],
      tagNames: ["risk-management", "sprint", "important"],
      views: [yael.id, amir.id],
      followers: [yael.id, amir.id],
      ratings: [[yael.id, 4]],
    },
    {
      owner: daniel, title: "Knowledge Management Deep Dive",
      description: "A curated path through knowledge-base architecture, metadata, and search design.",
      kind: "learning_path", isOfficial: true, course: is420, category: catLectureNotes,
      createdAt: daysAgo(30),
      itemKeys: ["is420-arch", "is420-metadata", "is420-search"],
      tagNames: ["knowledge-base", "database"],
      views: [yael.id, noa.id],
      likes: [yael.id],
      followers: [yael.id],
      ratings: [[yael.id, 5], [amir.id, 5]],
    },
    {
      owner: daniel, title: "IS420 Final Exam Prep",
      description: "Focused review pack for the IS420 final — key topics and sample questions.",
      kind: "exam_prep", course: is420, category: catExams,
      createdAt: daysAgo(12),
      examName: "IS420 Final Exam", examDate: daysFromNow(14),
      itemKeys: ["is420-final-review", "is420-arch", "is420-search"],
      tagNames: ["exam-prep", "knowledge-base", "important"],
      views: [yael.id],
      followers: [yael.id],
    },
    {
      owner: noa, title: "My CS101 Exam Survival Kit",
      description: "The lectures, summaries, and practice questions I'm using to cram for the CS101 final.",
      kind: "exam_prep", course: cs101, category: catExams,
      createdAt: daysAgo(2),
      examName: "CS101 Final", examDate: daysFromNow(10),
      itemKeys: ["cs101-l1", "cs101-midterm-q", "cs101-summary"],
      tagNames: ["exam-prep", "summary"],
      views: [amir.id, restricted.id],
      likes: [amir.id],
      followers: [amir.id],
      comments: [[amir.id, "Borrowing this for the final!"]],
    },
    {
      owner: amir, title: "Recursion Practice Pack",
      description: "Hand-picked recursion drills and a Big-O cheat sheet to go with them.",
      kind: "revision", course: cs220, category: catAssignments,
      createdAt: daysAgo(3),
      itemKeys: ["cs220-recursion", "cs220-bigo"],
      tagNames: ["recursion", "algorithms"],
      views: [noa.id],
      likes: [noa.id],
      followers: [noa.id],
    },
    {
      owner: yael, title: "Search & Discovery Patterns",
      description: "Reading and slides on relevance ranking, faceted search, and metadata pipelines.",
      kind: "collection", course: is420, category: catReading,
      createdAt: daysAgo(8),
      itemKeys: ["is420-search", "is420-metadata"],
      tagNames: ["knowledge-base", "database"],
      views: [noa.id, amir.id],
      ratings: [[noa.id, 4]],
    },
    {
      owner: yael, title: "Sprint Planning Quickref",
      description: "A two-item quick reference for sprint planning meetings.",
      kind: "revision", course: is310, category: catReading,
      createdAt: daysAgo(1),
      itemKeys: ["is310-sprint", "is310-agile-slides"],
      tagNames: ["sprint", "agile"],
      views: [amir.id],
      likes: [amir.id],
    },
    {
      owner: amir, title: "Arrays vs Linked Lists",
      description: "A focused look at the access/insert/delete trade-offs between arrays and linked lists.",
      kind: "collection", course: cs220, category: catSummaries,
      createdAt: daysAgo(4),
      itemKeys: ["cs220-arrays"],
      tagNames: ["arrays", "linked-list"],
      views: [noa.id, yael.id],
      followers: [noa.id],
    },
  ];

  async function ensureCollection(spec: CollectionSpec) {
    let c = await db.studyCollection.findFirst({
      where: { ownerId: spec.owner.id, title: spec.title },
    });
    const data = {
      description: spec.description,
      kind: spec.kind,
      visibility: "public",
      isOfficial: spec.isOfficial ?? false,
      courseId: spec.course?.id ?? null,
      categoryId: spec.category?.id ?? null,
      examName: spec.examName ?? null,
      examDate: spec.examDate ?? null,
      semester: "Spring",
      academicYear: 2026,
    };
    if (!c) {
      c = await db.studyCollection.create({
        data: {
          ownerId: spec.owner.id,
          title: spec.title,
          ...data,
          ...(spec.createdAt ? { createdAt: spec.createdAt, updatedAt: spec.createdAt } : {}),
        },
      });
    } else {
      c = await db.studyCollection.update({
        where: { id: c.id },
        data: { ...data, ...(spec.createdAt ? { createdAt: spec.createdAt } : {}) },
      });
    }

    // Items — reset and re-add in order.
    await db.studyCollectionItem.deleteMany({ where: { collectionId: c.id } });
    let pos = 0;
    for (const k of spec.itemKeys) {
      const docId = docs[k]?.id;
      if (!docId) continue;
      await db.studyCollectionItem.create({
        data: { collectionId: c.id, documentId: docId, position: pos++ },
      });
    }

    // Tags.
    if (spec.tagNames?.length) {
      await db.studyCollectionTag.createMany({
        data: spec.tagNames
          .map((t) => tagsByName[t])
          .filter((id): id is string => !!id)
          .map((tagId) => ({ collectionId: c!.id, tagId })),
        skipDuplicates: true,
      });
    }

    // Engagement — likes / followers / ratings have a (collection,user)
    // unique key (skipDuplicates is idempotent). Views and comments have
    // no unique key, so guard with find-first.
    if (spec.likes?.length) {
      await db.studyCollectionLike.createMany({
        data: spec.likes.map((userId) => ({ collectionId: c!.id, userId })),
        skipDuplicates: true,
      });
    }
    if (spec.followers?.length) {
      await db.studyCollectionFollower.createMany({
        data: spec.followers.map((userId) => ({ collectionId: c!.id, userId })),
        skipDuplicates: true,
      });
    }
    if (spec.ratings?.length) {
      await db.studyCollectionRating.createMany({
        data: spec.ratings.map(([userId, value]) => ({ collectionId: c!.id, userId, value })),
        skipDuplicates: true,
      });
    }
    for (const userId of spec.views ?? []) {
      const exists = await db.studyCollectionView.findFirst({
        where: { collectionId: c.id, userId },
      });
      if (!exists) {
        await db.studyCollectionView.create({ data: { collectionId: c.id, userId } });
      }
    }
    for (const [authorId, body] of spec.comments ?? []) {
      const exists = await db.studyCollectionComment.findFirst({
        where: { collectionId: c.id, body },
      });
      if (!exists) {
        await db.studyCollectionComment.create({
          data: { collectionId: c.id, authorId, body },
        });
      }
    }
    return c;
  }

  for (const spec of collectionSpecs) {
    await ensureCollection(spec);
  }
  logger.info(`✓ Seeded ${collectionSpecs.length} public study collections for Prep Hub`);

  // ─── Sync engagement counters from the seeded event tables ────────
  // The seed inserts view-history / favorites / download audits directly via
  // Prisma, which bypasses the incremental maintenance of the denormalised
  // counters the ranking engine reads. Reset and backfill them so search
  // ranking, the trending widget, and the dashboards reflect the demo data.
  await db.$executeRaw`UPDATE documents SET view_count = 0, download_count = 0, favorite_count = 0`;
  await db.$executeRaw`
    UPDATE documents d SET view_count = sub.c
    FROM (SELECT document_id, count(*)::int AS c FROM material_view_history GROUP BY document_id) sub
    WHERE sub.document_id = d.id`;
  await db.$executeRaw`
    UPDATE documents d SET favorite_count = sub.c
    FROM (SELECT document_id, count(*)::int AS c FROM document_favorites GROUP BY document_id) sub
    WHERE sub.document_id = d.id`;
  await db.$executeRaw`
    UPDATE documents d SET download_count = sub.c
    FROM (SELECT entity_id, count(*)::int AS c FROM audit_logs
          WHERE action = 'document.download' AND entity_type = 'document' GROUP BY entity_id) sub
    WHERE sub.entity_id = d.id::text`;
  logger.info("✓ Synced engagement counters from seeded events");

  // ─── Sync collection engagement counters + popularity ─────────────
  // Same pattern as documents: the seed writes collection engagement
  // directly via Prisma, bypassing the transactional counter maintenance
  // the ranking SQL reads. Reset and rebuild the denormalised columns so
  // every Prep Hub discovery lane reflects the seeded data. popularity_score
  // mirrors computePopularity(): followers * 3 + items.
  await db.$executeRaw`UPDATE study_collections SET like_count = 0, rating_count = 0, rating_sum = 0, view_count = 0, comment_count = 0, follower_count = 0`;
  await db.$executeRaw`
    UPDATE study_collections sc SET like_count = sub.c
    FROM (SELECT collection_id, count(*)::int AS c FROM study_collection_likes GROUP BY collection_id) sub
    WHERE sub.collection_id = sc.id`;
  await db.$executeRaw`
    UPDATE study_collections sc SET rating_count = sub.c, rating_sum = sub.s
    FROM (SELECT collection_id, count(*)::int AS c, sum(value)::int AS s FROM study_collection_ratings GROUP BY collection_id) sub
    WHERE sub.collection_id = sc.id`;
  await db.$executeRaw`
    UPDATE study_collections sc SET view_count = sub.c
    FROM (SELECT collection_id, count(*)::int AS c FROM study_collection_views GROUP BY collection_id) sub
    WHERE sub.collection_id = sc.id`;
  await db.$executeRaw`
    UPDATE study_collections sc SET comment_count = sub.c
    FROM (SELECT collection_id, count(*)::int AS c FROM study_collection_comments WHERE deleted_at IS NULL GROUP BY collection_id) sub
    WHERE sub.collection_id = sc.id`;
  await db.$executeRaw`
    UPDATE study_collections sc SET follower_count = sub.c
    FROM (SELECT collection_id, count(*)::int AS c FROM study_collection_followers GROUP BY collection_id) sub
    WHERE sub.collection_id = sc.id`;
  await db.$executeRaw`
    UPDATE study_collections sc SET popularity_score =
      sc.follower_count * 3
      + COALESCE((SELECT count(*) FROM study_collection_items i WHERE i.collection_id = sc.id), 0)::int`;
  logger.info("✓ Synced collection engagement counters + popularity");

  // ─── Output ───────────────────────────────────────────────────────
  /* eslint-disable no-console */
  console.log("\nDemo data created successfully.\n");
  console.log("Demo login credentials:");
  console.log("Admin:");
  console.log("admin@knowledgebank.demo / Demo1234!\n");
  console.log("Lecturer:");
  console.log("maya.cohen@knowledgebank.demo / Demo1234!");
  console.log("daniel.levi@knowledgebank.demo / Demo1234!\n");
  console.log("Pending Lecturer:");
  console.log("pending.lecturer@knowledgebank.demo / Demo1234!\n");
  console.log("Students:");
  console.log("noa.student@knowledgebank.demo / Demo1234!");
  console.log("amir.student@knowledgebank.demo / Demo1234!");
  console.log("yael.student@knowledgebank.demo / Demo1234!");
  console.log("restricted.student@knowledgebank.demo / Demo1234!\n");
  console.log("Disabled:");
  console.log("disabled.user@knowledgebank.demo / Demo1234!\n");
  console.log("Recommended demo flows:");
  console.log(" 1. Login as Admin and approve the Pending Lecturer at /admin/users");
  console.log(" 2. Login as Noa and browse/search/filter documents");
  console.log(" 3. Login as Restricted Student and verify CS101-only access");
  console.log(" 4. Login as Dr. Maya Cohen and upload / manage course materials");
  console.log(" 5. Test comments, nested replies, PDF page-pinned comments, and mentions");
  console.log(" 6. Test request board voting");
  console.log(" 7. Test signed preview/download links");
  console.log(" 8. Test storage quota display (Yael is near quota)");
  console.log(" 9. Test duplicate upload detection by re-uploading the same file");
  console.log("    (e.g. lib/db/src/seed/fixtures/sample-lecture-notes.pdf — same sha256)");
  console.log(" 10. Login as Noa and open Prep Hub — browse the discovery lanes");
  console.log("     (Trending, Popular, Highest Rated, Most Viewed, New, Upcoming");
  console.log("     Exams, For You) populated by the seeded public collections");
  console.log(" 11. Login as Admin → Analytics → Activity logs tab; check the dashboard");
  /* eslint-enable no-console */

  logger.info("✓ Demo seed complete.");
}

main()
  .catch((err) => {
    logger.error({ err }, "demo seed failed");
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
