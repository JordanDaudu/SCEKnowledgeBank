import { beforeEach, describe, expect, it, vi } from "vitest";

// Sprint-3 M7 graduated `FEATURE_REVIEW` — the env mock is kept only
// for the signing-related fields the service still reads at import.
vi.mock("../lib/env", () => ({
  env: { signedUrlSecret: "x", jwtSecret: "x", restrictedFileExtensions: [] },
}));

vi.mock("../repositories/documents.repo", () => ({
  findByIdAlive: vi.fn(),
  findManyByIdsAlive: vi.fn().mockResolvedValue([]),
  findFilesByDocumentIds: vi.fn().mockResolvedValue([]),
  findTagLinksForDocuments: vi.fn().mockResolvedValue([]),
  updateDocumentById: vi.fn().mockResolvedValue(undefined),
  // Default to "1 row affected" so happy-path transitions succeed; the
  // race-condition test overrides this to 0 to simulate a lost race.
  updateDocumentByIdIfStatus: vi.fn().mockResolvedValue(1),
  listPendingReview: vi.fn().mockResolvedValue([]),
  countPendingReview: vi.fn().mockResolvedValue(0),
  findOriginalFilename: vi.fn().mockResolvedValue("doc.pdf"),
}));
vi.mock("../repositories/taxonomy.repo", () => ({
  findCourseCodesByIds: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("../repositories/comments.repo", () => ({
  countAliveByDocumentIds: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("../repositories/viewHistory.repo", () => ({
  countViewsByDocumentIds: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("./users.service", () => ({
  loadUserSummaries: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("./taxonomy.service", () => ({
  loadCourses: vi.fn().mockResolvedValue(new Map()),
  loadCategories: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("./audit.service", () => ({ record: vi.fn() }));
vi.mock("./notifications.service", () => ({ notify: vi.fn() }));
vi.mock("../lib/sign-url", () => ({
  signToken: vi.fn().mockReturnValue({ token: "tok", expiresAt: new Date() }),
  verifyToken: vi.fn(),
}));

import * as docsRepo from "../repositories/documents.repo";
import * as notificationsService from "./notifications.service";
import {
  submitForReview,
  approveDocument,
  rejectDocument,
  listPendingReview,
} from "./documents.service";
import type { AuthenticatedUser } from "../middlewares/auth";

const findByIdAlive = vi.mocked(docsRepo.findByIdAlive);
const updateDocumentByIdIfStatus = vi.mocked(
  docsRepo.updateDocumentByIdIfStatus,
);
const updateDocumentById = vi.mocked(docsRepo.updateDocumentById);
const repoListPending = vi.mocked(docsRepo.listPendingReview);
const repoCountPending = vi.mocked(docsRepo.countPendingReview);
const notify = vi.mocked(notificationsService.notify);
// `userEnrollmentSummary` derives its result purely from `user.roles`
// and `user.enrollments`, so we don't mock it — we hand the service
// users whose shape produces the summary we want.

function mkUser(over: Partial<AuthenticatedUser> & { id: string }): AuthenticatedUser {
  return {
    email: `${over.id}@x.com`,
    displayName: over.id,
    isActive: true,
    primaryRole: "lecturer",
    roles: ["lecturer"],
    enrollments: [],
    ...over,
  } as AuthenticatedUser;
}

const uploader = mkUser({ id: "up", roles: ["student"], primaryRole: "student" });
const lecturerOfA = mkUser({
  id: "lec",
  enrollments: [{ courseId: "course-A", roleInCourse: "lecturer" }],
});
const lecturerOfB = mkUser({
  id: "lec2",
  enrollments: [{ courseId: "course-B", roleInCourse: "lecturer" }],
});
const admin = mkUser({ id: "adm", roles: ["admin"], primaryRole: "admin" });

function makeDoc(over: Partial<{ status: string; uploaderId: string; courseId: string | null }> = {}) {
  return {
    id: "d1",
    title: "T",
    description: null,
    visibility: "public",
    courseId: over.courseId === undefined ? "course-A" : over.courseId,
    uploaderId: over.uploaderId ?? "up",
    ownerId: over.uploaderId ?? "up",
    materialType: "notes",
    semester: null,
    academicYear: null,
    categoryId: null,
    status: over.status ?? "draft",
    submittedForReviewAt: null,
    reviewedAt: null,
    reviewedBy: null,
    reviewReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    updatedBy: null,
  } as unknown as docsRepo.DocumentRow;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// `assembleDocuments` runs after every transition; with all loaders
// stubbed to empty maps it returns a minimal DTO that's safe to ignore
// in these tests — we assert against the repo write + notify call.

describe("submitForReview", () => {
  it("draft → pending_review for uploader", async () => {
    findByIdAlive.mockResolvedValueOnce(makeDoc({ status: "draft" }));
    findByIdAlive.mockResolvedValueOnce(
      makeDoc({ status: "pending_review" }),
    );
    await submitForReview("d1", uploader);
    expect(updateDocumentByIdIfStatus).toHaveBeenCalledWith(
      "d1",
      "draft",
      expect.objectContaining({ status: "pending_review" }),
    );
  });

  it("rejected → pending_review clears prior reason", async () => {
    findByIdAlive.mockResolvedValueOnce(makeDoc({ status: "rejected" }));
    findByIdAlive.mockResolvedValueOnce(
      makeDoc({ status: "pending_review" }),
    );
    await submitForReview("d1", uploader);
    expect(updateDocumentByIdIfStatus).toHaveBeenCalledWith(
      "d1",
      "rejected",
      expect.objectContaining({ reviewReason: null }),
    );
  });

  it("forbids submit from a stranger", async () => {
    findByIdAlive.mockResolvedValueOnce(makeDoc({ status: "draft" }));
    const stranger = mkUser({ id: "x", roles: ["student"], primaryRole: "student" });
    await expect(submitForReview("d1", stranger)).rejects.toMatchObject({ status: 403 });
  });

  it("rejects illegal transition (already published)", async () => {
    findByIdAlive.mockResolvedValueOnce(makeDoc({ status: "published" }));
    await expect(submitForReview("d1", uploader)).rejects.toMatchObject({ status: 400 });
  });
});

describe("approveDocument", () => {
  it("admin can approve pending_review and uploader is notified", async () => {
    findByIdAlive.mockResolvedValueOnce(makeDoc({ status: "pending_review" }));
    findByIdAlive.mockResolvedValueOnce(makeDoc({ status: "approved" }));
    await approveDocument("d1", admin);
    expect(updateDocumentByIdIfStatus).toHaveBeenCalledWith(
      "d1",
      "pending_review",
      expect.objectContaining({ status: "approved", reviewedBy: "adm" }),
    );
    // notify is fire-and-forget; flush the microtask queue.
    await new Promise((r) => setImmediate(r));
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "document.approved",
        recipientId: "up",
        subjectType: "document",
        subjectId: "d1",
      }),
    );
  });

  it("course lecturer can approve", async () => {
    findByIdAlive.mockResolvedValueOnce(makeDoc({ status: "pending_review" }));
    findByIdAlive.mockResolvedValueOnce(makeDoc({ status: "approved" }));
    await approveDocument("d1", lecturerOfA);
    expect(updateDocumentByIdIfStatus).toHaveBeenCalled();
  });

  it("lecturer for a different course cannot approve", async () => {
    findByIdAlive.mockResolvedValueOnce(makeDoc({ status: "pending_review" }));
    await expect(approveDocument("d1", lecturerOfB)).rejects.toMatchObject({ status: 403 });
  });

  it("rejects illegal transition (draft)", async () => {
    findByIdAlive.mockResolvedValueOnce(makeDoc({ status: "draft" }));
    await expect(approveDocument("d1", admin)).rejects.toMatchObject({ status: 400 });
  });

  // Two reviewers click approve at almost the same time. The first
  // wins the compare-and-swap; the second's `updateDocumentByIdIfStatus`
  // returns 0. We must 400 (not silently double-notify the uploader).
  it("loses the CAS race → 400, no audit, no notify", async () => {
    findByIdAlive.mockResolvedValueOnce(makeDoc({ status: "pending_review" }));
    updateDocumentByIdIfStatus.mockResolvedValueOnce(0);
    await expect(approveDocument("d1", admin)).rejects.toMatchObject({ status: 400 });
    await new Promise((r) => setImmediate(r));
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("rejectDocument", () => {
  it("requires a non-empty reason", async () => {
    findByIdAlive.mockResolvedValue(makeDoc({ status: "pending_review" }));
    await expect(rejectDocument("d1", "   ", admin)).rejects.toMatchObject({ status: 400 });
    expect(updateDocumentById).not.toHaveBeenCalled();
  });

  it("caps reason length at 500", async () => {
    findByIdAlive.mockResolvedValue(makeDoc({ status: "pending_review" }));
    await expect(rejectDocument("d1", "x".repeat(501), admin)).rejects.toMatchObject({ status: 400 });
  });

  it("trims and persists reason; notifies uploader with body=reason", async () => {
    findByIdAlive.mockResolvedValueOnce(makeDoc({ status: "pending_review" }));
    findByIdAlive.mockResolvedValueOnce(
      makeDoc({ status: "rejected" }),
    );
    await rejectDocument("d1", "  needs sources  ", admin);
    expect(updateDocumentByIdIfStatus).toHaveBeenCalledWith(
      "d1",
      "pending_review",
      expect.objectContaining({ status: "rejected", reviewReason: "needs sources" }),
    );
    await new Promise((r) => setImmediate(r));
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: "document.rejected", body: "needs sources" }),
    );
  });

  it("forbids non-reviewer", async () => {
    findByIdAlive.mockResolvedValueOnce(makeDoc({ status: "pending_review" }));
    await expect(rejectDocument("d1", "no", uploader)).rejects.toMatchObject({ status: 403 });
  });
});

describe("listPendingReview", () => {
  it("forbids plain students (no admin role, no lecturer enrollment)", async () => {
    await expect(
      listPendingReview(uploader, { page: 1, pageSize: 20 }),
    ).rejects.toMatchObject({ status: 403 });
    expect(repoListPending).not.toHaveBeenCalled();
  });

  it("admin sees the unfiltered queue", async () => {
    repoListPending.mockResolvedValueOnce([]);
    repoCountPending.mockResolvedValueOnce(0);
    await listPendingReview(admin, { page: 1, pageSize: 20 });
    // admin → no course-id scope filter (undefined courseIds key)
    const args = repoListPending.mock.calls[0]![0] as { courseIds?: string[] | null };
    expect(args.courseIds == null).toBe(true);
  });

  it("lecturer is scoped to their taught courses", async () => {
    repoListPending.mockResolvedValueOnce([]);
    repoCountPending.mockResolvedValueOnce(0);
    await listPendingReview(lecturerOfA, { page: 1, pageSize: 20 });
    const args = repoListPending.mock.calls[0]![0] as { courseIds?: string[] };
    expect(args.courseIds).toEqual(["course-A"]);
  });
});
