/**
 * Seed Knowledge Bank with demo data: roles, three users, courses, categories,
 * tags, a handful of documents (with real files in local storage), comments,
 * and material requests.
 *
 * Idempotent: running twice will not duplicate primary entities.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import type {
  Role,
  User,
  Course,
  Category,
  Tag,
  Document as DocumentRow,
} from "@workspace/db";
import { getStorage } from "../lib/storage";
import { logger } from "../lib/logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// lib/db/src/seed/fixtures is the canonical fixtures directory — versioned
// alongside the schema. We resolve it from the api-server runtime so the
// seed always reads the committed binaries (small real PDFs/PNG/TXT) instead
// of relying on the synthetic in-memory PDF builder for every document.
const FIXTURES_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "lib",
  "db",
  "src",
  "seed",
  "fixtures",
);

function fixture(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURES_DIR, name));
}

async function upsertRole(name: string, description: string): Promise<Role> {
  const existing = await db.role.findFirst({ where: { name } });
  if (existing) return existing;
  return db.role.create({ data: { name, description } });
}

async function upsertUser(
  email: string,
  password: string,
  displayName: string,
  primaryRoleId: string,
  roleIds: string[],
): Promise<User> {
  let user = await db.user.findFirst({ where: { email } });
  if (!user) {
    const hash = await bcrypt.hash(password, 10);
    user = await db.user.create({
      data: { email, passwordHash: hash, displayName, primaryRoleId },
    });
  }
  if (roleIds.length > 0) {
    await db.userRole.createMany({
      data: roleIds.map((roleId) => ({ userId: user!.id, roleId })),
      skipDuplicates: true,
    });
  }
  return user;
}

async function upsertCourse(
  code: string,
  title: string,
  lecturerName: string,
): Promise<Course> {
  const existing = await db.course.findFirst({ where: { code } });
  if (existing) return existing;
  return db.course.create({ data: { code, title, lecturerName } });
}

async function upsertCategory(
  name: string,
  slug: string,
  description: string,
): Promise<Category> {
  const existing = await db.category.findFirst({ where: { slug } });
  if (existing) return existing;
  return db.category.create({ data: { name, slug, description } });
}

async function upsertTag(name: string): Promise<Tag> {
  const existing = await db.tag.findFirst({ where: { name } });
  if (existing) return existing;
  return db.tag.create({ data: { name } });
}

async function ensureDocument(
  title: string,
  uploaderId: string,
  body: Buffer,
  opts: {
    description: string;
    courseId?: string;
    categoryId?: string;
    materialType: string;
    semester?: string;
    academicYear?: number;
    visibility?: string;
    tagIds?: string[];
    mimeType?: string;
    filename: string;
  },
): Promise<DocumentRow> {
  const existing = await db.document.findFirst({ where: { title } });
  if (existing) return existing;

  const doc = await db.document.create({
    data: {
      title,
      description: opts.description,
      materialType: opts.materialType,
      visibility: opts.visibility ?? "public",
      uploaderId,
      ownerId: uploaderId,
      createdBy: uploaderId,
      updatedBy: uploaderId,
      ...(opts.courseId ? { courseId: opts.courseId } : {}),
      ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
      ...(opts.semester ? { semester: opts.semester } : {}),
      ...(opts.academicYear != null ? { academicYear: opts.academicYear } : {}),
    },
  });

  const ext = opts.filename.includes(".")
    ? opts.filename.slice(opts.filename.lastIndexOf("."))
    : "";
  const key = `documents/${doc.id.slice(0, 2)}/${doc.id}${ext}`;
  const put = await getStorage().put({
    key,
    body,
    contentType: opts.mimeType ?? "application/octet-stream",
  });

  await db.documentFile.create({
    data: {
      documentId: doc.id,
      originalFilename: opts.filename,
      displayFilename: opts.filename,
      storedFilename: key.split("/").pop() ?? key,
      mimeType: opts.mimeType ?? "application/octet-stream",
      sizeBytes: BigInt(body.length),
      storagePath: put.key,
      storageDriver: put.driver,
      checksum: put.checksum,
    },
  });

  if (opts.tagIds && opts.tagIds.length > 0) {
    await db.documentTag.createMany({
      data: opts.tagIds.map((tagId) => ({ documentId: doc.id, tagId })),
      skipDuplicates: true,
    });
  }

  return doc;
}

function txt(...lines: string[]): Buffer {
  return Buffer.from(lines.join("\n") + "\n", "utf8");
}

// Minimal valid PDF (Hello World) — single page, no external resources.
function minimalPdf(title: string, body: string): Buffer {
  const content = `BT /F1 18 Tf 50 760 Td (${title.replace(/[()\\]/g, "")}) Tj 0 -28 Td /F1 12 Tf (${body.replace(/[()\\]/g, "")}) Tj ET`;
  const stream = `q\n${content}\nQ`;
  const streamLen = Buffer.byteLength(stream, "binary");
  const parts: string[] = [];
  const offsets: number[] = [];
  function add(s: string) {
    offsets.push(Buffer.byteLength(parts.join(""), "binary"));
    parts.push(s);
  }
  parts.push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  add(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  add(`2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n`);
  add(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`,
  );
  add(
    `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${stream}\nendstream\nendobj\n`,
  );
  add(`5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);
  const xrefStart = Buffer.byteLength(parts.join(""), "binary");
  let xref = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${off.toString().padStart(10, "0")} 00000 n \n`;
  }
  parts.push(xref);
  parts.push(
    `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`,
  );
  return Buffer.from(parts.join(""), "binary");
}

async function main() {
  logger.info("Seeding Knowledge Bank…");

  const studentRole = await upsertRole("student", "Student");
  const lecturerRole = await upsertRole("lecturer", "Lecturer");
  const adminRole = await upsertRole("admin", "Administrator");

  const student = await upsertUser(
    "student@demo",
    "demo1234",
    "Riley Chen",
    studentRole.id,
    [studentRole.id],
  );
  const lecturer = await upsertUser(
    "lecturer@demo",
    "demo1234",
    "Dr. Morgan Reyes",
    lecturerRole.id,
    [lecturerRole.id, studentRole.id],
  );
  const admin = await upsertUser(
    "admin@demo",
    "demo1234",
    "Sasha Park",
    adminRole.id,
    [adminRole.id, lecturerRole.id, studentRole.id],
  );

  const cs101 = await upsertCourse(
    "CS101",
    "Introduction to Computer Science",
    "Dr. Morgan Reyes",
  );
  const cs201 = await upsertCourse(
    "CS201",
    "Data Structures and Algorithms",
    "Dr. Morgan Reyes",
  );
  const math210 = await upsertCourse(
    "MATH210",
    "Linear Algebra",
    "Prof. Elena Vasquez",
  );
  const phys150 = await upsertCourse(
    "PHYS150",
    "Classical Mechanics",
    "Prof. Henry Okafor",
  );
  const cs310 = await upsertCourse(
    "CS310",
    "Operating Systems",
    "Dr. Morgan Reyes",
  );
  const cs350 = await upsertCourse("CS350", "Databases", "Prof. Aiko Tanaka");
  const econ200 = await upsertCourse(
    "ECON200",
    "Microeconomics",
    "Prof. Lars Bergstrom",
  );
  const stat230 = await upsertCourse(
    "STAT230",
    "Probability and Statistics",
    "Prof. Elena Vasquez",
  );
  const courseList = [
    cs101,
    cs201,
    math210,
    phys150,
    cs310,
    cs350,
    econ200,
    stat230,
  ];

  // ─── Course enrollments ────────────────────────────────────────
  // The demo lecturer (Dr. Morgan Reyes) teaches the CS courses.
  // The demo student is enrolled in a subset of the catalogue so the
  // restricted-visibility rule has both positive and negative cases.
  // The admin is enrolled in nothing — admins bypass enrollment checks.
  const lecturerCourseIds = [cs101.id, cs201.id, cs310.id];
  const studentCourseIds = [cs101.id, cs201.id, math210.id];
  await db.courseEnrollment.createMany({
    data: [
      ...lecturerCourseIds.map((courseId) => ({
        userId: lecturer.id,
        courseId,
        roleInCourse: "lecturer",
      })),
      ...studentCourseIds.map((courseId) => ({
        userId: student.id,
        courseId,
        roleInCourse: "student",
      })),
    ],
    skipDuplicates: true,
  });

  const catLectureNotes = await upsertCategory(
    "Lecture Notes",
    "lecture-notes",
    "Notes from lectures and recitations",
  );
  const catProblemSets = await upsertCategory(
    "Problem Sets",
    "problem-sets",
    "Weekly problem sets and solutions",
  );
  const catPastExams = await upsertCategory(
    "Past Exams",
    "past-exams",
    "Past midterm and final exam papers",
  );
  const catSlides = await upsertCategory(
    "Slides",
    "slides",
    "Lecture slide decks",
  );
  const catProjects = await upsertCategory(
    "Project Reports",
    "project-reports",
    "Student project writeups and reports",
  );

  const tagFoundational = await upsertTag("foundational");
  const tagExamPrep = await upsertTag("exam-prep");
  const tagHandsOn = await upsertTag("hands-on");
  const tagTheory = await upsertTag("theory");
  const tagMidterm = await upsertTag("midterm");
  const tagFinal = await upsertTag("final");
  const tagWorkedExamples = await upsertTag("worked-examples");
  const tagAdvanced = await upsertTag("advanced");
  const tagSummary = await upsertTag("summary");
  const tagCheatSheet = await upsertTag("cheat-sheet");
  const tagLab = await upsertTag("lab");
  const tagSolutions = await upsertTag("solutions");
  const tagList = [
    tagFoundational,
    tagExamPrep,
    tagHandsOn,
    tagTheory,
    tagMidterm,
    tagFinal,
    tagWorkedExamples,
    tagAdvanced,
    tagSummary,
    tagCheatSheet,
    tagLab,
    tagSolutions,
  ];

  const doc1 = await ensureDocument(
    "CS101 Week 1 — Introduction & Computational Thinking",
    lecturer.id,
    fixture("sample-lecture-notes.pdf"),
    {
      description:
        "Opening lecture: what is computer science, problem decomposition, pseudocode, and the shape of the course.",
      courseId: cs101.id,
      categoryId: catLectureNotes.id,
      materialType: "lecture-notes",
      semester: "fall",
      academicYear: 2025,
      tagIds: [tagFoundational.id],
      mimeType: "application/pdf",
      filename: "cs101-week-01.pdf",
    },
  );

  const doc2 = await ensureDocument(
    "CS101 Problem Set 1",
    lecturer.id,
    fixture("sample-problem-set.pdf"),
    {
      description: "First problem set covering pseudocode and Big-O.",
      courseId: cs101.id,
      categoryId: catProblemSets.id,
      materialType: "problem-set",
      semester: "fall",
      academicYear: 2025,
      tagIds: [tagFoundational.id, tagHandsOn.id],
      mimeType: "application/pdf",
      filename: "cs101-ps1.pdf",
    },
  );

  // One real text fixture and one real image fixture so the preview pane has
  // non-PDF demo content out of the box.
  // Restricted document in CS350 — the demo student is NOT enrolled in
  // CS350, so this should be invisible to them and serves as the canary
  // for the enrollment-based visibility rule.
  await ensureDocument(
    "CS350 — Restricted Exam Solutions (Spring 2025)",
    lecturer.id,
    minimalPdf(
      "CS350 Restricted Exam Solutions",
      "Solutions to the CS350 final — restricted to enrolled students.",
    ),
    {
      description:
        "Worked solutions to the CS350 final exam. Restricted: only students enrolled in CS350 can see this.",
      courseId: cs350.id,
      categoryId: catPastExams.id,
      materialType: "exam",
      semester: "spring",
      academicYear: 2025,
      visibility: "restricted",
      tagIds: [tagExamPrep.id, tagSolutions.id],
      mimeType: "application/pdf",
      filename: "cs350-final-solutions-spring-2025.pdf",
    },
  );

  await ensureDocument(
    "CS350 — SQL Joins Cheat Sheet",
    lecturer.id,
    fixture("sample-cheat-sheet.txt"),
    {
      description:
        "One-page cheat sheet covering INNER, LEFT, RIGHT, and FULL OUTER joins with examples.",
      courseId: cs350.id,
      categoryId: catLectureNotes.id,
      materialType: "cheat-sheet",
      semester: "fall",
      academicYear: 2025,
      tagIds: [tagCheatSheet.id, tagExamPrep.id],
      mimeType: "text/plain",
      filename: "cs350-sql-joins-cheatsheet.txt",
    },
  );

  await ensureDocument(
    "CS101 — Computational Thinking Diagram",
    lecturer.id,
    fixture("sample-diagram.png"),
    {
      description:
        "Small diagram illustrating problem decomposition steps used in the week 1 lecture.",
      courseId: cs101.id,
      categoryId: catLectureNotes.id,
      materialType: "slides",
      semester: "fall",
      academicYear: 2025,
      tagIds: [tagFoundational.id],
      mimeType: "image/png",
      filename: "cs101-decomposition-diagram.png",
    },
  );

  await ensureDocument(
    "CS101 — Course Syllabus",
    lecturer.id,
    fixture("sample-syllabus.md"),
    {
      description: "Course syllabus, schedule, and grading policy for CS101.",
      courseId: cs101.id,
      categoryId: catLectureNotes.id,
      materialType: "syllabus",
      semester: "fall",
      academicYear: 2025,
      tagIds: [tagFoundational.id, tagSummary.id],
      mimeType: "text/markdown",
      filename: "cs101-syllabus.md",
    },
  );

  await ensureDocument(
    "CS201 Midterm — Spring 2025",
    lecturer.id,
    minimalPdf(
      "CS201 Midterm Spring 2025",
      "Trees, graphs, hashing, and asymptotic analysis.",
    ),
    {
      description:
        "Past midterm: trees, graphs, hashing, and asymptotic analysis. Solutions available on request.",
      courseId: cs201.id,
      categoryId: catPastExams.id,
      materialType: "exam",
      semester: "spring",
      academicYear: 2025,
      tagIds: [tagExamPrep.id, tagMidterm.id],
      mimeType: "application/pdf",
      filename: "cs201-midterm-spring-2025.pdf",
    },
  );

  await ensureDocument(
    "Linear Algebra — Eigenvectors Cheat Sheet",
    lecturer.id,
    txt(
      "Eigenvalues and Eigenvectors — quick reference",
      "Definition: Av = lambda v for non-zero v.",
      "Characteristic polynomial: det(A - lambda I) = 0",
      "Symmetric matrices have real eigenvalues and orthogonal eigenvectors.",
    ),
    {
      description: "One-page cheat sheet for eigenvalues and eigenvectors.",
      courseId: math210.id,
      categoryId: catLectureNotes.id,
      materialType: "cheat-sheet",
      semester: "fall",
      academicYear: 2025,
      tagIds: [tagTheory.id, tagExamPrep.id],
      mimeType: "text/plain",
      filename: "math210-eigenvectors.txt",
    },
  );

  await ensureDocument(
    "Classical Mechanics — Final Review Notes",
    admin.id,
    minimalPdf(
      "PHYS150 Final Review",
      "Newtonian mechanics, conservation laws, oscillations and waves.",
    ),
    {
      description:
        "Comprehensive review for the PHYS150 final exam: kinematics, dynamics, energy, momentum, rotational motion, oscillations.",
      courseId: phys150.id,
      categoryId: catPastExams.id,
      materialType: "review-notes",
      semester: "fall",
      academicYear: 2024,
      tagIds: [tagExamPrep.id, tagFinal.id, tagTheory.id],
      mimeType: "application/pdf",
      filename: "phys150-final-review.pdf",
    },
  );

  await ensureDocument(
    "CS201 — Project Report: Distributed Cache",
    student.id,
    txt(
      "Project Report — Distributed Cache",
      "Author: Riley Chen",
      "We implemented a consistent-hashing distributed cache with LRU eviction.",
      "Results show 3.2× throughput vs single-node cache under skewed load.",
    ),
    {
      description:
        "Final project report for CS201: design and evaluation of a small distributed cache.",
      courseId: cs201.id,
      categoryId: catProjects.id,
      materialType: "project-report",
      semester: "spring",
      academicYear: 2025,
      tagIds: [tagHandsOn.id],
      mimeType: "text/plain",
      filename: "cs201-distributed-cache.txt",
    },
  );

  // Bulk-generate additional documents to reach the demo threshold (>=30 total).
  const categoryList = [
    catLectureNotes,
    catProblemSets,
    catPastExams,
    catSlides,
    catProjects,
  ];
  const materialTypes = [
    "lecture-notes",
    "problem-set",
    "exam",
    "slides",
    "review-notes",
    "cheat-sheet",
    "project-report",
  ];
  const semesters = ["fall", "spring", "summer"] as const;
  const uploaders = [lecturer, admin];
  const bulkDocs: DocumentRow[] = [];
  let bulkIdx = 0;
  for (const course of courseList) {
    for (let week = 1; week <= 4; week++) {
      const uploader = uploaders[bulkIdx % uploaders.length];
      const cat = categoryList[bulkIdx % categoryList.length];
      const mtype = materialTypes[bulkIdx % materialTypes.length];
      const sem = semesters[bulkIdx % semesters.length];
      const year = 2024 + (bulkIdx % 2);
      const tagPick = [
        tagList[bulkIdx % tagList.length].id,
        tagList[(bulkIdx + 3) % tagList.length].id,
      ];
      const title = `${course.code} Week ${week} — ${cat.name}`;
      const filename = `${course.code.toLowerCase()}-w${week}-${cat.slug}.pdf`;
      const d = await ensureDocument(
        title,
        uploader.id,
        minimalPdf(title, `Demo material for ${course.code} week ${week}.`),
        {
          description: `Auto-generated demo ${cat.name.toLowerCase()} for ${course.code}, week ${week}.`,
          courseId: course.id,
          categoryId: cat.id,
          materialType: mtype,
          semester: sem,
          academicYear: year,
          tagIds: tagPick,
          mimeType: "application/pdf",
          filename,
        },
      );
      bulkDocs.push(d);
      bulkIdx++;
    }
  }

  // Comments on doc1
  const existingComment = await db.comment.findFirst({
    where: { documentId: doc1.id },
  });
  if (!existingComment) {
    const c1 = await db.comment.create({
      data: {
        documentId: doc1.id,
        authorId: student.id,
        body: "Are slides for this lecture posted somewhere? The pseudocode example was great.",
        pageNumber: 1,
      },
    });
    await db.comment.create({
      data: {
        documentId: doc1.id,
        authorId: lecturer.id,
        parentId: c1.id,
        body: "Good catch — I'll upload the slide deck this week. In the meantime, the textbook section 1.3 covers the same material.",
      },
    });
    await db.comment.create({
      data: {
        documentId: doc2.id,
        authorId: student.id,
        body: "Q3 is open-ended — should I cover both space and time complexity?",
      },
    });
  }

  // Recent-view history so the "Continue Reading" section is populated.
  // Idempotent per (user, document): only insert if that user has not viewed
  // that document yet.
  const allDocsForViews = [doc1, doc2, ...bulkDocs.slice(0, 12)];
  for (let i = 0; i < allDocsForViews.length; i++) {
    const viewers = [student.id];
    if (i % 2 === 0) viewers.push(lecturer.id);
    if (i % 3 === 0) viewers.push(admin.id);
    for (const viewerId of viewers) {
      const exists = await db.materialViewHistory.findFirst({
        where: { documentId: allDocsForViews[i].id, userId: viewerId },
      });
      if (exists) continue;
      await db.materialViewHistory.create({
        data: { documentId: allDocsForViews[i].id, userId: viewerId },
      });
    }
  }

  // Material requests
  const existingReq = await db.materialRequest.findFirst();
  if (!existingReq) {
    const r1 = await db.materialRequest.create({
      data: {
        title: "CS201 Final 2024 solutions",
        description:
          "The 2024 CS201 final exam paper is here but solutions aren't posted. Would help with revision.",
        courseId: cs201.id,
        requestedBy: student.id,
        status: "open",
      },
    });
    const r2 = await db.materialRequest.create({
      data: {
        title: "Annotated slides for MATH210 Lecture 8",
        description:
          "Could a lecturer share the annotated whiteboard photos from the eigenvectors lecture?",
        courseId: math210.id,
        requestedBy: student.id,
        status: "open",
      },
    });
    await db.materialRequest.create({
      data: {
        title: "PHYS150 problem set 4 solutions",
        description: "Solutions were promised but never uploaded last semester.",
        courseId: phys150.id,
        requestedBy: student.id,
        status: "fulfilled",
      },
    });
    // Votes
    await db.requestVote.createMany({
      data: [
        { requestId: r1.id, userId: lecturer.id },
        { requestId: r1.id, userId: admin.id },
        { requestId: r2.id, userId: admin.id },
      ],
      skipDuplicates: true,
    });
  }

  // Additional open requests so the requests board has substance.
  // Idempotent on title.
  {
    const extraOpen: Array<{
      title: string;
      description: string;
      courseId: string;
      requestedBy: string;
    }> = [
      {
        title: "CS310 Lab handouts archive",
        description:
          "Would love an archive of all CS310 lab handouts from last year.",
        courseId: cs310.id,
        requestedBy: student.id,
      },
      {
        title: "STAT230 sample midterms",
        description:
          "Sample midterms with worked solutions would massively help revision.",
        courseId: stat230.id,
        requestedBy: student.id,
      },
      {
        title: "ECON200 textbook chapter summaries",
        description:
          "Concise per-chapter summaries of the assigned textbook chapters.",
        courseId: econ200.id,
        requestedBy: student.id,
      },
      {
        title: "CS350 SQL practice problem bank",
        description:
          "A pool of SQL practice problems with answers for the upcoming final.",
        courseId: cs350.id,
        requestedBy: student.id,
      },
    ];
    for (const r of extraOpen) {
      const existing = await db.materialRequest.findFirst({
        where: { title: r.title },
      });
      const row =
        existing ??
        (await db.materialRequest.create({
          data: { ...r, status: "open" },
        }));
      await db.requestVote.createMany({
        data: [{ requestId: row.id, userId: lecturer.id }],
        skipDuplicates: true,
      });
      if (r.title.includes("STAT230")) {
        await db.requestVote.createMany({
          data: [{ requestId: row.id, userId: admin.id }],
          skipDuplicates: true,
        });
      }
    }
  }

  logger.info("Seed complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "Seed failed");
    process.exit(1);
  });
