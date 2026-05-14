/**
 * Seed Knowledge Bank with demo data: roles, three users, courses, categories,
 * tags, a handful of documents (with real files in local storage), comments,
 * and material requests.
 *
 * Idempotent: running twice will not duplicate primary entities.
 */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import {
  db,
  roles,
  users,
  userRoles,
  courses,
  categories,
  tags,
  documents,
  documentFiles,
  documentTags,
  comments,
  materialRequests,
  requestVotes,
  materialViewHistory,
} from "@workspace/db";
import { getStorage } from "../lib/storage";
import { logger } from "../lib/logger";

async function upsertRole(name: string, description: string) {
  const existing = await db
    .select()
    .from(roles)
    .where(eq(roles.name, name))
    .limit(1);
  if (existing[0]) return existing[0];
  const inserted = await db
    .insert(roles)
    .values({ name, description })
    .returning();
  return inserted[0];
}

async function upsertUser(
  email: string,
  password: string,
  displayName: string,
  primaryRoleId: string,
  roleIds: string[],
) {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  let user = existing[0];
  if (!user) {
    const hash = await bcrypt.hash(password, 10);
    const inserted = await db
      .insert(users)
      .values({
        email,
        passwordHash: hash,
        displayName,
        primaryRoleId,
      })
      .returning();
    user = inserted[0];
  }
  for (const roleId of roleIds) {
    await db
      .insert(userRoles)
      .values({ userId: user.id, roleId })
      .onConflictDoNothing();
  }
  return user;
}

async function upsertCourse(
  code: string,
  title: string,
  lecturerName: string,
) {
  const existing = await db
    .select()
    .from(courses)
    .where(eq(courses.code, code))
    .limit(1);
  if (existing[0]) return existing[0];
  return (
    await db
      .insert(courses)
      .values({ code, title, lecturerName })
      .returning()
  )[0];
}

async function upsertCategory(name: string, slug: string, description: string) {
  const existing = await db
    .select()
    .from(categories)
    .where(eq(categories.slug, slug))
    .limit(1);
  if (existing[0]) return existing[0];
  return (
    await db
      .insert(categories)
      .values({ name, slug, description })
      .returning()
  )[0];
}

async function upsertTag(name: string) {
  const existing = await db
    .select()
    .from(tags)
    .where(eq(tags.name, name))
    .limit(1);
  if (existing[0]) return existing[0];
  return (await db.insert(tags).values({ name }).returning())[0];
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
) {
  const existing = await db
    .select()
    .from(documents)
    .where(eq(documents.title, title))
    .limit(1);
  if (existing[0]) return existing[0];

  const inserted = await db
    .insert(documents)
    .values({
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
    })
    .returning();
  const doc = inserted[0];

  const ext = opts.filename.includes(".")
    ? opts.filename.slice(opts.filename.lastIndexOf("."))
    : "";
  const key = `documents/${doc.id.slice(0, 2)}/${doc.id}${ext}`;
  const put = await getStorage().put({
    key,
    body,
    contentType: opts.mimeType ?? "application/octet-stream",
  });

  await db.insert(documentFiles).values({
    documentId: doc.id,
    originalFilename: opts.filename,
    displayFilename: opts.filename,
    storedFilename: key.split("/").pop() ?? key,
    mimeType: opts.mimeType ?? "application/octet-stream",
    sizeBytes: body.length,
    storagePath: put.key,
    storageDriver: put.driver,
    checksum: put.checksum,
  });

  if (opts.tagIds && opts.tagIds.length > 0) {
    await db
      .insert(documentTags)
      .values(opts.tagIds.map((tagId) => ({ documentId: doc.id, tagId })))
      .onConflictDoNothing();
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
  const cs350 = await upsertCourse(
    "CS350",
    "Databases",
    "Prof. Aiko Tanaka",
  );
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
    minimalPdf(
      "CS101 Week 1",
      "Introduction to computational thinking and problem decomposition.",
    ),
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
    txt(
      "CS101 — Problem Set 1",
      "1. Write pseudocode for finding the maximum value in a list.",
      "2. Trace the execution of a recursive factorial(5).",
      "3. Explain Big-O notation in your own words.",
    ),
    {
      description: "First problem set covering pseudocode and Big-O.",
      courseId: cs101.id,
      categoryId: catProblemSets.id,
      materialType: "problem-set",
      semester: "fall",
      academicYear: 2025,
      tagIds: [tagFoundational.id, tagHandsOn.id],
      mimeType: "text/plain",
      filename: "cs101-ps1.txt",
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
  const bulkDocs: (typeof documents.$inferSelect)[] = [];
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
        minimalPdf(
          title,
          `Demo material for ${course.code} week ${week}.`,
        ),
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
  const existingComments = await db
    .select()
    .from(comments)
    .where(eq(comments.documentId, doc1.id))
    .limit(1);
  if (!existingComments[0]) {
    const c1 = await db
      .insert(comments)
      .values({
        documentId: doc1.id,
        authorId: student.id,
        body: "Are slides for this lecture posted somewhere? The pseudocode example was great.",
        pageNumber: 1,
      })
      .returning();
    await db.insert(comments).values({
      documentId: doc1.id,
      authorId: lecturer.id,
      parentId: c1[0].id,
      body: "Good catch — I'll upload the slide deck this week. In the meantime, the textbook section 1.3 covers the same material.",
    });
    await db.insert(comments).values({
      documentId: doc2.id,
      authorId: student.id,
      body: "Q3 is open-ended — should I cover both space and time complexity?",
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
      const exists = await db
        .select()
        .from(materialViewHistory)
        .where(eq(materialViewHistory.documentId, allDocsForViews[i].id))
        .limit(50);
      if (exists.some((e) => e.userId === viewerId)) continue;
      await db
        .insert(materialViewHistory)
        .values({ documentId: allDocsForViews[i].id, userId: viewerId });
    }
  }

  // Material requests
  const existingReq = await db.select().from(materialRequests).limit(1);
  if (existingReq.length === 0) {
    const r1 = await db
      .insert(materialRequests)
      .values({
        title: "CS201 Final 2024 solutions",
        description:
          "The 2024 CS201 final exam paper is here but solutions aren't posted. Would help with revision.",
        courseId: cs201.id,
        requestedBy: student.id,
        status: "open",
      })
      .returning();
    const r2 = await db
      .insert(materialRequests)
      .values({
        title: "Annotated slides for MATH210 Lecture 8",
        description:
          "Could a lecturer share the annotated whiteboard photos from the eigenvectors lecture?",
        courseId: math210.id,
        requestedBy: student.id,
        status: "open",
      })
      .returning();
    await db
      .insert(materialRequests)
      .values({
        title: "PHYS150 problem set 4 solutions",
        description:
          "Solutions were promised but never uploaded last semester.",
        courseId: phys150.id,
        requestedBy: student.id,
        status: "fulfilled",
      });
    // Votes
    await db
      .insert(requestVotes)
      .values({ requestId: r1[0].id, userId: lecturer.id })
      .onConflictDoNothing();
    await db
      .insert(requestVotes)
      .values({ requestId: r1[0].id, userId: admin.id })
      .onConflictDoNothing();
    await db
      .insert(requestVotes)
      .values({ requestId: r2[0].id, userId: admin.id })
      .onConflictDoNothing();
  }

  // Additional open requests so the requests board has substance.
  // Idempotent on title.
  {
    const extraOpen: Array<{ title: string; description: string; courseId: string; requestedBy: string }> = [
      {
        title: "CS310 Lab handouts archive",
        description: "Would love an archive of all CS310 lab handouts from last year.",
        courseId: cs310.id,
        requestedBy: student.id,
      },
      {
        title: "STAT230 sample midterms",
        description: "Sample midterms with worked solutions would massively help revision.",
        courseId: stat230.id,
        requestedBy: student.id,
      },
      {
        title: "ECON200 textbook chapter summaries",
        description: "Concise per-chapter summaries of the assigned textbook chapters.",
        courseId: econ200.id,
        requestedBy: student.id,
      },
      {
        title: "CS350 SQL practice problem bank",
        description: "A pool of SQL practice problems with answers for the upcoming final.",
        courseId: cs350.id,
        requestedBy: student.id,
      },
    ];
    for (const r of extraOpen) {
      const existing = await db
        .select()
        .from(materialRequests)
        .where(eq(materialRequests.title, r.title))
        .limit(1);
      const row =
        existing[0] ??
        (
          await db
            .insert(materialRequests)
            .values({ ...r, status: "open" })
            .returning()
        )[0];
      await db
        .insert(requestVotes)
        .values({ requestId: row.id, userId: lecturer.id })
        .onConflictDoNothing();
      if (r.title.includes("STAT230")) {
        await db
          .insert(requestVotes)
          .values({ requestId: row.id, userId: admin.id })
          .onConflictDoNothing();
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
