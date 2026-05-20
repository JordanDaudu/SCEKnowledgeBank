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
import type {
  AuthenticatedUser,
  UserCourseEnrollment,
} from "../middlewares/auth";

export interface DocumentForPermission {
  uploaderId: string;
  ownerId: string;
  visibility: string;
  courseId: string | null;
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
  return {
    OR: [
      { visibility: "public" },
      restrictedClause,
      {
        visibility: "private",
        OR: [{ uploaderId: user.id }, { ownerId: user.id }],
      },
    ],
  };
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
