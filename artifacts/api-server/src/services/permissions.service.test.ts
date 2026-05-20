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
  it("uploader and owner can always edit/delete", () => {
    const d = doc({ uploaderId: "lect-a", ownerId: "lect-a" });
    expect(permissions.canEdit(d, lecturerA)).toBe(true);
    expect(permissions.canDelete(d, lecturerA)).toBe(true);
  });

  it("a lecturer can manage docs in courses they teach, even if not the uploader", () => {
    const d = doc({
      uploaderId: "someone-else",
      ownerId: "someone-else",
      courseId: "c-A",
    });
    expect(permissions.canEdit(d, lecturerA)).toBe(true);
    expect(permissions.canDelete(d, lecturerA)).toBe(true);
  });

  it("a lecturer cannot manage another lecturer's course", () => {
    const d = doc({
      uploaderId: "someone-else",
      ownerId: "someone-else",
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
  it("admins and lecturers can upload; students cannot", () => {
    expect(permissions.canUpload(admin)).toBe(true);
    expect(permissions.canUpload(lecturerA)).toBe(true);
    expect(permissions.canUpload(studentEnrolledA)).toBe(false);
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

  it("for an enrolled student, includes public + own + restricted-in-enrolled-courses", () => {
    const f = permissions.visibleDocumentFilter(studentEnrolledA);
    expect(f).toEqual({
      OR: [
        { visibility: "public" },
        { visibility: "restricted", courseId: { in: ["c-A"] } },
        { uploaderId: studentEnrolledA.id },
        { ownerId: studentEnrolledA.id },
      ],
    });
  });

  it("for a user with no enrollments, restricted clause is empty", () => {
    const f = permissions.visibleDocumentFilter(studentEnrolledNone);
    expect(f).toEqual({
      OR: [
        { visibility: "public" },
        { id: { in: [] } },
        { uploaderId: studentEnrolledNone.id },
        { ownerId: studentEnrolledNone.id },
      ],
    });
  });
});
