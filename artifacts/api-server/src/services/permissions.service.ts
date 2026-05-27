/**
 * Central permissions service. Every visibility / role decision in the API
 * goes through this module — no other service or route may branch on role
 * names or recompute these rules locally.
 *
 * Rules (Sprint 2):
 * - admin sees and manages everything.
 * - lecturer manages materials only for courses they actually teach
 *   (enrolled with role "lecturer" in that course). For viewing,
 *   lecturers obey the same enrollment-based rules as students.
 * - students see public always, restricted only when enrolled in the
 *   course, and private only when they are the uploader, owner, or admin.
 */
import type { Prisma } from "@workspace/db";
import { Prisma as PrismaNs } from "@workspace/db";
import type {
  AuthenticatedUser,
  UserCourseEnrollment,
} from "../middlewares/auth";

export interface DocumentForPermission {
  uploaderId: string;
  ownerId: string;
  visibility: string;
  courseId: string | null;
  /**
   * Sprint-3 M2: optional so existing callers that build the shape
   * without a status (tests, ad-hoc inputs) keep compiling. When
   * absent, status-aware checks (visibility of `pending_review` /
   * `rejected` docs) treat the doc as visible-by-status — i.e. they
   * preserve pre-M2 behaviour.
   */
  status?: string;
}

/**
 * Statuses produced by the review workflow that are NOT publicly
 * visible. Uploaders and reviewers (admin / course lecturer) can
 * still see them; everyone else gets a 404-equivalent.
 */
const REVIEW_HIDDEN_STATUSES = ["pending_review", "rejected"] as const;
function isReviewHidden(status: string | undefined): boolean {
  return !!status && (REVIEW_HIDDEN_STATUSES as readonly string[]).includes(status);
}

export function isAdmin(u: AuthenticatedUser | undefined | null): boolean {
  return !!u?.roles.includes("admin");
}

function hasRole(u: AuthenticatedUser, role: string): boolean {
  return u.roles.includes(role);
}

function enrolledCourseIds(u: AuthenticatedUser): string[] {
  return u.enrollments.map((e) => e.courseId);
}

function lecturerCourseIds(u: AuthenticatedUser): string[] {
  return u.enrollments
    .filter((e) => e.roleInCourse === "lecturer")
    .map((e) => e.courseId);
}

export function isLecturerForCourse(
  u: AuthenticatedUser,
  courseId: string | null | undefined,
): boolean {
  if (!courseId) return false;
  return lecturerCourseIds(u).includes(courseId);
}

/**
 * Can the user read the document?
 *
 * Strict Sprint-2 reading:
 * - admin sees everything.
 * - public is visible to everyone.
 * - restricted is gated **only** by course enrollment (no uploader/owner
 *   bypass — an uploader who is no longer enrolled in the course loses
 *   read access, by design).
 * - private is visible only to the uploader, the owner, or an admin.
 */
export function canView(
  doc: DocumentForPermission,
  user: AuthenticatedUser,
): boolean {
  if (isAdmin(user)) return true;
  // Sprint-3 M2: documents in the review workflow that haven't been
  // approved are visible only to the uploader/owner and reviewers
  // (lecturer-for-course). Everyone else gets blocked here before the
  // visibility predicate runs.
  if (isReviewHidden(doc.status)) {
    if (doc.uploaderId === user.id || doc.ownerId === user.id) {
      // fall through to the visibility check below
    } else if (canReview(doc, user)) {
      return true;
    } else {
      return false;
    }
  }
  if (doc.visibility === "public") return true;
  if (doc.visibility === "restricted") {
    if (!doc.courseId) return false;
    return enrolledCourseIds(user).includes(doc.courseId);
  }
  if (doc.visibility === "private") {
    return doc.uploaderId === user.id || doc.ownerId === user.id;
  }
  return false;
}

/**
 * Sprint-3 M2: who can approve/reject a doc in `pending_review`?
 *
 * - admin: yes.
 * - course-scoped doc: lecturer teaching that course.
 * - course-less doc: only an admin (no obvious lecturer scope).
 */
export function canReview(
  doc: DocumentForPermission,
  user: AuthenticatedUser,
): boolean {
  if (isAdmin(user)) return true;
  if (!hasRole(user, "lecturer")) return false;
  if (!doc.courseId) return false;
  return isLecturerForCourse(user, doc.courseId);
}

/**
 * Sprint-3 M2: who can submit-for-review on this doc?
 * Uploaders/owners (their own work) and anyone who can edit the
 * metadata (admin / course lecturer).
 */
export function canSubmitForReview(
  doc: DocumentForPermission,
  user: AuthenticatedUser,
): boolean {
  if (doc.uploaderId === user.id) return true;
  if (doc.ownerId === user.id) return true;
  return canEdit(doc, user);
}

/**
 * Can the user edit/update the document's metadata?
 *
 * - admin: yes.
 * - course-scoped doc: only a lecturer who teaches that course.
 * - course-less doc (private/orphan): only the uploader or owner.
 *
 * A lecturer who uploaded a doc into a course they no longer teach
 * loses edit rights — this is the deliberate Sprint-2 rule.
 */
export function canEdit(
  doc: DocumentForPermission,
  user: AuthenticatedUser,
): boolean {
  if (isAdmin(user)) return true;
  if (doc.courseId) {
    return hasRole(user, "lecturer") && isLecturerForCourse(user, doc.courseId);
  }
  return doc.uploaderId === user.id || doc.ownerId === user.id;
}

/** Can the user soft-delete the document? Same rules as edit. */
export function canDelete(
  doc: DocumentForPermission,
  user: AuthenticatedUser,
): boolean {
  return canEdit(doc, user);
}

/** Can the user post or read comments on this document? */
export function canComment(
  doc: DocumentForPermission,
  user: AuthenticatedUser,
): boolean {
  return canView(doc, user);
}

/** Can the user moderate (edit/delete) someone else's comment? */
export function canModerateCommentOnDocument(
  doc: DocumentForPermission,
  user: AuthenticatedUser,
): boolean {
  if (isAdmin(user)) return true;
  if (hasRole(user, "lecturer") && isLecturerForCourse(user, doc.courseId)) {
    return true;
  }
  return false;
}

/**
 * Can the user edit this comment? Authors may always edit their own
 * comments. Moderation does *not* extend to edits (it would let
 * lecturers/admins put words in other users' mouths) — only deletes.
 */
export function canEditComment(
  comment: { authorId: string },
  user: AuthenticatedUser,
): boolean {
  return comment.authorId === user.id;
}

/**
 * Can the user delete this comment? Authors may delete their own;
 * lecturers/admins may moderate-delete others' comments on documents
 * they manage.
 */
export function canDeleteComment(
  comment: { authorId: string },
  doc: DocumentForPermission,
  user: AuthenticatedUser,
): boolean {
  if (comment.authorId === user.id) return true;
  return canModerateCommentOnDocument(doc, user);
}

/**
 * Can the user upload a new version of this document, or restore an
 * older one as the latest? Same rule as editing the document metadata
 * (US-5). Centralised here so routes and service layer share one truth.
 */
export function canManageVersions(
  doc: DocumentForPermission,
  user: AuthenticatedUser,
): boolean {
  return canEdit(doc, user);
}

/** Can the user upload new documents at all? */
export function canUpload(user: AuthenticatedUser): boolean {
  return isAdmin(user) || hasRole(user, "lecturer");
}

/**
 * Can the user upload a document targeted at this specific course?
 *
 * - Admins can upload anywhere.
 * - Lecturers can upload only to courses they teach (enrolled with role
 *   "lecturer" in that course).
 * - Course-less uploads (e.g. cross-course resources) require admin OR a
 *   user who already has any lecturer enrollment — a plain "lecturer"
 *   role alone is not enough.
 * - Students cannot upload.
 */
export function canUploadToCourse(
  user: AuthenticatedUser,
  courseId: string | null | undefined,
): boolean {
  if (isAdmin(user)) return true;
  if (!hasRole(user, "lecturer")) return false;
  if (courseId) return isLecturerForCourse(user, courseId);
  // No course → must teach at least one course to upload cross-course material.
  return lecturerCourseIds(user).length > 0;
}

/**
 * Can the user *create* a material request for this course?
 *
 * - Global requests (`courseId === null`) are open to any authenticated
 *   user — anyone can ask for help that isn't tied to a specific course.
 * - Admins may create requests under any course.
 * - For course-scoped requests every other user must have an enrollment
 *   in that course (lecturers teaching it, students enrolled in it).
 *   This mirrors the visibility/voting scoping in
 *   `requests.service` — you cannot raise a request in a course you
 *   would not even be able to see.
 */
export function canCreateRequestForCourse(
  user: AuthenticatedUser,
  courseId: string | null | undefined,
): boolean {
  if (!courseId) return true;
  if (isAdmin(user)) return true;
  return enrolledCourseIds(user).includes(courseId);
}

/**
 * Can the user fulfil (or close) a material request? If the request is
 * scoped to a course, lecturers must teach that course.
 */
export function canFulfilRequest(
  user: AuthenticatedUser,
  request: { requestedBy: string; courseId: string | null },
): boolean {
  if (isAdmin(user)) return true;
  if (request.requestedBy === user.id) return true;
  if (!hasRole(user, "lecturer")) return false;
  if (!request.courseId) return true;
  return isLecturerForCourse(user, request.courseId);
}

/**
 * Prisma `where` fragment scoping a document query to the rows this user
 * is allowed to see. AND this into other filters; do not OR it.
 *
 * Returns `undefined` for admins (no scoping needed).
 */
export function visibleDocumentFilter(
  user: AuthenticatedUser,
): Prisma.DocumentWhereInput | undefined {
  if (isAdmin(user)) return undefined;
  const enrolled = enrolledCourseIds(user);
  const restrictedClause: Prisma.DocumentWhereInput =
    enrolled.length > 0
      ? { visibility: "restricted", courseId: { in: enrolled } }
      : // No enrollments → no restricted docs are visible.
        { id: { in: [] } };
  const visibility: Prisma.DocumentWhereInput = {
    OR: [
      { visibility: "public" },
      restrictedClause,
      {
        visibility: "private",
        OR: [{ uploaderId: user.id }, { ownerId: user.id }],
      },
    ],
  };
  // Sprint-3 M2: hide `pending_review` / `rejected` from non-reviewers
  // who aren't the uploader/owner. Lecturers who teach the doc's
  // course (i.e. potential reviewers) continue to see them so they
  // can find work in the queue and on the doc's own page.
  const lecturerCourses = lecturerCourseIds(user);
  const statusOK: Prisma.DocumentWhereInput = {
    OR: [
      { status: { notIn: [...REVIEW_HIDDEN_STATUSES] } },
      { uploaderId: user.id },
      { ownerId: user.id },
      ...(lecturerCourses.length > 0
        ? [{ courseId: { in: lecturerCourses } } as Prisma.DocumentWhereInput]
        : []),
    ],
  };
  return { AND: [visibility, statusOK] };
}

/**
 * Raw-SQL twin of `visibleDocumentFilter` for the FTS path. Returns a
 * `Prisma.Sql` fragment safe to AND into a `WHERE` clause; the alias
 * `d` must refer to the `documents` table.
 *
 * Returns `Prisma.sql\`TRUE\`` for admins so callers can unconditionally
 * AND the fragment in.
 */
export function visibleDocumentFilterSql(user: AuthenticatedUser): Prisma.Sql {
  if (isAdmin(user)) return PrismaNs.sql`TRUE`;
  const enrolled = enrolledCourseIds(user);
  const restrictedClause = enrolled.length
    ? PrismaNs.sql`d.course_id IN (${PrismaNs.join(
        enrolled.map((id) => PrismaNs.sql`${id}::uuid`),
      )})`
    : PrismaNs.sql`FALSE`;
  const lecturerCourses = lecturerCourseIds(user);
  const lecturerCourseClause = lecturerCourses.length
    ? PrismaNs.sql`d.course_id IN (${PrismaNs.join(
        lecturerCourses.map((id) => PrismaNs.sql`${id}::uuid`),
      )})`
    : PrismaNs.sql`FALSE`;
  return PrismaNs.sql`(
    (
      d.visibility = 'public'
      OR (d.visibility = 'restricted' AND d.course_id IS NOT NULL AND ${restrictedClause})
      OR (d.visibility = 'private' AND (d.uploader_id = ${user.id}::uuid OR d.owner_id = ${user.id}::uuid))
    )
    AND (
      d.status NOT IN ('pending_review', 'rejected')
      OR d.uploader_id = ${user.id}::uuid
      OR d.owner_id = ${user.id}::uuid
      OR ${lecturerCourseClause}
    )
  )`;
}

/** Convenience accessor for tests and the suggestions raw query. */
export function userEnrollmentSummary(user: AuthenticatedUser): {
  isAdmin: boolean;
  userId: string;
  enrolledCourseIds: string[];
  lecturerCourseIds: string[];
} {
  return {
    isAdmin: isAdmin(user),
    userId: user.id,
    enrolledCourseIds: enrolledCourseIds(user),
    lecturerCourseIds: lecturerCourseIds(user),
  };
}

export type { UserCourseEnrollment };
