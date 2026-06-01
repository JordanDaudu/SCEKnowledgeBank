import { describe, expect, it } from "vitest";
import * as permissions from "./permissions.service";
import type {
  AuthenticatedUser,
  UserCourseEnrollment,
} from "../middlewares/auth";

function makeUser(
  overrides: Partial<AuthenticatedUser> & { id: string },
): AuthenticatedUser {
  return {
    email: `${overrides.id}@x.com`,
    displayName: overrides.id,
    isActive: true,
    primaryRole: "student",
    roles: ["student"],
    enrollments: [],
    ...overrides,
  } as AuthenticatedUser;
}

function enr(
  courseId: string,
  roleInCourse: "student" | "lecturer" = "student",
): UserCourseEnrollment {
  return { courseId, roleInCourse };
}

const admin = makeUser({ id: "admin", roles: ["admin"], primaryRole: "admin" });
const lecturerA = makeUser({
  id: "lect-a",
  roles: ["lecturer"],
  primaryRole: "lecturer",
  enrollments: [enr("c-A", "lecturer"), enr("c-AA", "lecturer")],
});
const lecturerB = makeUser({
  id: "lect-b",
  roles: ["lecturer"],
  primaryRole: "lecturer",
  enrollments: [enr("c-B", "lecturer")],
});
const studentEnrolledA = makeUser({
  id: "stu-A",
  enrollments: [enr("c-A")],
});
const studentEnrolledNone = makeUser({ id: "stu-none" });

describe("permissions.canEditComment", () => {
  it("only the author may edit (no moderation passthrough)", () => {
    expect(
      permissions.canEditComment({ authorId: "stu-A" }, studentEnrolledA),
    ).toBe(true);
    // Admin can MODERATE-delete, but cannot EDIT someone else's comment.
    expect(
      permissions.canEditComment({ authorId: "stu-A" }, admin),
    ).toBe(false);
    // Course lecturer also cannot edit a student's words.
    expect(
      permissions.canEditComment({ authorId: "stu-A" }, lecturerA),
    ).toBe(false);
  });
});

describe("permissions.canDeleteComment", () => {
  const d = doc({ courseId: "c-A" });

  it("author can always delete their own comment", () => {
    expect(
      permissions.canDeleteComment(
        { authorId: "stu-A" },
        d,
        studentEnrolledA,
      ),
    ).toBe(true);
  });

  it("admins moderate-delete on any document", () => {
    expect(
      permissions.canDeleteComment({ authorId: "stu-A" }, d, admin),
    ).toBe(true);
  });

  it("the document's course lecturer moderate-deletes", () => {
    expect(
      permissions.canDeleteComment({ authorId: "stu-A" }, d, lecturerA),
    ).toBe(true);
  });

  it("a lecturer for a *different* course cannot delete someone else's comment", () => {
    expect(
      permissions.canDeleteComment({ authorId: "stu-A" }, d, lecturerB),
    ).toBe(false);
  });

  it("an unrelated student cannot delete someone else's comment", () => {
    expect(
      permissions.canDeleteComment(
        { authorId: "stu-A" },
        d,
        studentEnrolledNone,
      ),
    ).toBe(false);
  });
});

describe("permissions.canManageVersions", () => {
  it("admins can manage versions of any doc", () => {
    expect(
      permissions.canManageVersions(doc({ visibility: "private" }), admin),
    ).toBe(true);
  });

  it("uploader can manage versions of their own doc", () => {
    expect(permissions.canManageVersions(doc(), lecturerA)).toBe(true);
  });

  it("an unrelated student cannot manage versions", () => {
    expect(permissions.canManageVersions(doc(), studentEnrolledNone)).toBe(
      false,
    );
  });
});

function doc(
  overrides: Partial<permissions.DocumentForPermission> = {},
): permissions.DocumentForPermission {
  return {
    uploaderId: "lect-a",
    ownerId: "lect-a",
    visibility: "public",
    courseId: "c-A",
    ...overrides,
  };
}

describe("permissions.canView", () => {
  it("admin sees everything (public/restricted/private, any course)", () => {
    expect(permissions.canView(doc({ visibility: "public" }), admin)).toBe(true);
    expect(
      permissions.canView(doc({ visibility: "restricted" }), admin),
    ).toBe(true);
    expect(
      permissions.canView(
        doc({ visibility: "private", uploaderId: "x", ownerId: "y" }),
        admin,
      ),
    ).toBe(true);
  });

  it("public docs are visible to everyone, regardless of enrollment", () => {
    expect(
      permissions.canView(doc({ visibility: "public" }), studentEnrolledNone),
    ).toBe(true);
    expect(
      permissions.canView(doc({ visibility: "public" }), lecturerB),
    ).toBe(true);
  });

  it("restricted docs require enrollment in the doc's course", () => {
    const restricted = doc({
      visibility: "restricted",
      uploaderId: "someone",
      ownerId: "someone",
      courseId: "c-A",
    });
    expect(permissions.canView(restricted, studentEnrolledA)).toBe(true);
    expect(permissions.canView(restricted, studentEnrolledNone)).toBe(false);
    // Lecturer B does not teach c-A and is not enrolled — cannot view.
    expect(permissions.canView(restricted, lecturerB)).toBe(false);
  });

  it("restricted: uploader/owner does NOT bypass enrollment (strict rule)", () => {
    // A user who uploaded a restricted doc but is not enrolled in its
    // course loses read access. This is the deliberate Sprint-2 rule.
    const restricted = doc({
      visibility: "restricted",
      uploaderId: studentEnrolledNone.id,
      ownerId: studentEnrolledNone.id,
      courseId: "c-A",
    });
    expect(permissions.canView(restricted, studentEnrolledNone)).toBe(false);
    // Admin still sees it.
    expect(permissions.canView(restricted, admin)).toBe(true);
  });

  it("restricted docs with no courseId are hidden from non-admins", () => {
    const restricted = doc({
      visibility: "restricted",
      courseId: null,
      uploaderId: "x",
      ownerId: "y",
    });
    expect(permissions.canView(restricted, studentEnrolledA)).toBe(false);
    expect(permissions.canView(restricted, lecturerA)).toBe(false);
  });

  it("private docs are visible only to uploader, owner, or admin", () => {
    const priv = doc({
      visibility: "private",
      uploaderId: "lect-a",
      ownerId: "lect-a",
    });
    expect(permissions.canView(priv, lecturerA)).toBe(true);
    expect(permissions.canView(priv, lecturerB)).toBe(false);
    expect(permissions.canView(priv, studentEnrolledA)).toBe(false);
    expect(permissions.canView(priv, admin)).toBe(true);
  });
});

describe("permissions.canEdit / canDelete", () => {
  it("for a course-scoped doc, only the course's lecturer (or admin) can manage", () => {
    const d = doc({
      uploaderId: "someone-else",
      ownerId: "someone-else",
      courseId: "c-A",
    });
    expect(permissions.canEdit(d, lecturerA)).toBe(true);
    expect(permissions.canDelete(d, lecturerA)).toBe(true);
    expect(permissions.canEdit(d, lecturerB)).toBe(false);
    expect(permissions.canDelete(d, lecturerB)).toBe(false);
  });

  it("uploader/owner CANNOT manage a course-scoped doc they no longer teach", () => {
    // lecturerA uploaded the doc but is not enrolled as lecturer in c-B
    const d = doc({
      uploaderId: lecturerA.id,
      ownerId: lecturerA.id,
      courseId: "c-B",
    });
    expect(permissions.canEdit(d, lecturerA)).toBe(false);
    expect(permissions.canDelete(d, lecturerA)).toBe(false);
  });

  it("students cannot edit even when enrolled", () => {
    const d = doc({
      uploaderId: "someone-else",
      ownerId: "someone-else",
      courseId: "c-A",
    });
    expect(permissions.canEdit(d, studentEnrolledA)).toBe(false);
  });

  it("for a course-less (private/orphan) doc, only uploader/owner/admin can manage", () => {
    const d = doc({
      uploaderId: studentEnrolledA.id,
      ownerId: studentEnrolledA.id,
      courseId: null,
      visibility: "private",
    });
    expect(permissions.canEdit(d, studentEnrolledA)).toBe(true);
    expect(permissions.canEdit(d, studentEnrolledNone)).toBe(false);
    expect(permissions.canEdit(d, admin)).toBe(true);
  });

  it("admin can always edit", () => {
    const d = doc({
      uploaderId: "x",
      ownerId: "y",
      courseId: "c-B",
      visibility: "private",
    });
    expect(permissions.canEdit(d, admin)).toBe(true);
  });
});

describe("permissions.canComment mirrors canView", () => {
  it("non-enrolled students cannot comment on restricted docs", () => {
    const d = doc({
      visibility: "restricted",
      uploaderId: "x",
      ownerId: "y",
      courseId: "c-A",
    });
    expect(permissions.canComment(d, studentEnrolledNone)).toBe(false);
    expect(permissions.canComment(d, studentEnrolledA)).toBe(true);
  });
});

describe("permissions.canModerateCommentOnDocument", () => {
  it("only admins and the course's lecturer can moderate others' comments", () => {
    const d = doc({ courseId: "c-A" });
    expect(permissions.canModerateCommentOnDocument(d, admin)).toBe(true);
    expect(permissions.canModerateCommentOnDocument(d, lecturerA)).toBe(true);
    expect(permissions.canModerateCommentOnDocument(d, lecturerB)).toBe(false);
    expect(permissions.canModerateCommentOnDocument(d, studentEnrolledA)).toBe(
      false,
    );
  });
});

describe("permissions.canUpload", () => {
  // Sprint-3 completion: students with at least one enrollment are
  // eligible uploaders — the per-course gate + forced-draft +
  // review-workflow live in `canUploadToCourse` + `uploadDocuments`.
  it("admins, lecturers, and enrolled students can upload", () => {
    expect(permissions.canUpload(admin)).toBe(true);
    expect(permissions.canUpload(lecturerA)).toBe(true);
    expect(permissions.canUpload(studentEnrolledA)).toBe(true);
  });

  it("SP4: any authenticated user may upload (even a student with no enrollments)", () => {
    const detached = makeUser({
      id: "stu-detached",
      roles: ["student"],
      primaryRole: "student",
    });
    expect(permissions.canUpload(detached)).toBe(true);
  });
});

describe("permissions.canUploadToCourse", () => {
  it("admin can upload to any course or no course", () => {
    expect(permissions.canUploadToCourse(admin, "c-A")).toBe(true);
    expect(permissions.canUploadToCourse(admin, "c-X")).toBe(true);
    expect(permissions.canUploadToCourse(admin, null)).toBe(true);
  });

  it("lecturer can only upload to courses they teach", () => {
    expect(permissions.canUploadToCourse(lecturerA, "c-A")).toBe(true);
    expect(permissions.canUploadToCourse(lecturerA, "c-AA")).toBe(true);
    expect(permissions.canUploadToCourse(lecturerA, "c-B")).toBe(false);
  });

  it("lecturer with no enrollments cannot upload course-less material", () => {
    const detached = makeUser({
      id: "lec-detached",
      roles: ["lecturer"],
      primaryRole: "lecturer",
    });
    expect(permissions.canUploadToCourse(detached, null)).toBe(false);
    expect(permissions.canUploadToCourse(detached, "c-A")).toBe(false);
  });

  it("lecturer with at least one taught course can upload course-less material", () => {
    expect(permissions.canUploadToCourse(lecturerA, null)).toBe(true);
  });

  // Sprint-3 completion: students can upload to courses they're
  // enrolled in (the service forces draft + routes through M2 review).
  it("student can upload to an enrolled course but not others, and never course-less", () => {
    expect(permissions.canUploadToCourse(studentEnrolledA, "c-A")).toBe(true);
    expect(permissions.canUploadToCourse(studentEnrolledA, "c-B")).toBe(false);
    // Course-less student uploads are never allowed — review router
    // needs a course to find a lecturer reviewer.
    expect(permissions.canUploadToCourse(studentEnrolledA, null)).toBe(false);
  });
});

describe("permissions.canFulfilRequest", () => {
  it("admin can always fulfil", () => {
    expect(
      permissions.canFulfilRequest(admin, {
        requestedBy: "x",
        courseId: "c-A",
      }),
    ).toBe(true);
  });

  it("the request author can change status on their own request", () => {
    expect(
      permissions.canFulfilRequest(studentEnrolledA, {
        requestedBy: studentEnrolledA.id,
        courseId: "c-A",
      }),
    ).toBe(true);
  });

  it("a lecturer can fulfil only when they teach the request's course", () => {
    expect(
      permissions.canFulfilRequest(lecturerA, {
        requestedBy: "stu",
        courseId: "c-A",
      }),
    ).toBe(true);
    expect(
      permissions.canFulfilRequest(lecturerA, {
        requestedBy: "stu",
        courseId: "c-B",
      }),
    ).toBe(false);
  });

  it("any lecturer can fulfil course-less requests", () => {
    expect(
      permissions.canFulfilRequest(lecturerB, {
        requestedBy: "stu",
        courseId: null,
      }),
    ).toBe(true);
  });

  it("students cannot fulfil other people's requests", () => {
    expect(
      permissions.canFulfilRequest(studentEnrolledA, {
        requestedBy: "other",
        courseId: "c-A",
      }),
    ).toBe(false);
  });
});

describe("permissions.visibleDocumentFilter", () => {
  it("returns undefined for admins (no scoping)", () => {
    expect(permissions.visibleDocumentFilter(admin)).toBeUndefined();
  });

  // Sprint-3 M2 + completion: the visibility filter is now AND-composed
  // with a status clause that hides `draft`/`pending_review`/`rejected`
  // from anyone who isn't the uploader/owner (or a course lecturer who
  // can review). `draft` joined the hidden set in Sprint-3 completion
  // to close the "public-draft never submitted" review-gate bypass.
  const statusClauseFor = (uid: string) => ({
    OR: [
      { status: { notIn: ["draft", "pending_review", "rejected", "pending_admin_approval"] } },
      { uploaderId: uid },
      { ownerId: uid },
    ],
  });

  it("for an enrolled student: public + restricted-in-enrolled + own private", () => {
    const f = permissions.visibleDocumentFilter(studentEnrolledA);
    expect(f).toEqual({
      AND: [
        {
          OR: [
            { visibility: "public" },
            { visibility: "restricted", courseId: { in: ["c-A"] } },
            {
              visibility: "private",
              OR: [
                { uploaderId: studentEnrolledA.id },
                { ownerId: studentEnrolledA.id },
              ],
            },
          ],
        },
        statusClauseFor(studentEnrolledA.id),
      ],
    });
  });

  it("for a user with no enrollments, restricted clause is empty", () => {
    const f = permissions.visibleDocumentFilter(studentEnrolledNone);
    expect(f).toEqual({
      AND: [
        {
          OR: [
            { visibility: "public" },
            { id: { in: [] } },
            {
              visibility: "private",
              OR: [
                { uploaderId: studentEnrolledNone.id },
                { ownerId: studentEnrolledNone.id },
              ],
            },
          ],
        },
        statusClauseFor(studentEnrolledNone.id),
      ],
    });
  });
});
