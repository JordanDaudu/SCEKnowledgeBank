import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/analytics.repo", () => ({
  fetchOverviewTotals: vi.fn(),
  fetchTopDocumentsByViews: vi.fn().mockResolvedValue([]),
  fetchTopDocumentsByDownloads: vi.fn().mockResolvedValue([]),
  fetchActiveUploaders: vi.fn().mockResolvedValue([]),
  fetchDailyUploads: vi.fn().mockResolvedValue([]),
  fetchTopCategories: vi.fn().mockResolvedValue([]),
  fetchDuplicateGroups: vi.fn().mockResolvedValue([]),
  fetchCourseInfo: vi.fn(),
  fetchCourseTotals: vi.fn(),
  fetchCourseTopDocumentsByViews: vi.fn().mockResolvedValue([]),
  fetchCourseTopDocumentsByDownloads: vi.fn().mockResolvedValue([]),
  fetchCourseActiveUploaders: vi.fn().mockResolvedValue([]),
}));

import * as analyticsRepo from "../repositories/analytics.repo";
import {
  _resetCacheForTests,
  getAdminOverview,
  getCourseAnalytics,
} from "./analytics.service";
import type { AuthenticatedUser } from "../middlewares/auth";

const fetchOverviewTotals = vi.mocked(analyticsRepo.fetchOverviewTotals);
const fetchCourseInfo = vi.mocked(analyticsRepo.fetchCourseInfo);
const fetchCourseTotals = vi.mocked(analyticsRepo.fetchCourseTotals);

const EMPTY_TOTALS: analyticsRepo.OverviewTotals = {
  totalDocuments: 0,
  totalUsers: 0,
  totalComments: 0,
  pendingReviewCount: 0,
  viewsThisWeek: 0,
  viewsPriorWeek: 0,
  downloadsThisWeek: 0,
  downloadsPriorWeek: 0,
  uploadsThisWeek: 0,
};

const EMPTY_COURSE_TOTALS: analyticsRepo.CourseTotals = {
  totalDocuments: 0,
  pendingReviewCount: 0,
  totalComments: 0,
  viewsThisWeek: 0,
  viewsPriorWeek: 0,
  downloadsThisWeek: 0,
  downloadsPriorWeek: 0,
  uploadsThisWeek: 0,
};

function mkUser(over: Partial<AuthenticatedUser> & { id: string }): AuthenticatedUser {
  return {
    email: `${over.id}@x.com`,
    displayName: over.id,
    isActive: true,
    primaryRole: "student",
    roles: ["student"],
    enrollments: [],
    ...over,
  } as AuthenticatedUser;
}

const COURSE_A = "11111111-1111-1111-1111-111111111111";
const COURSE_B = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  _resetCacheForTests();
  fetchOverviewTotals.mockResolvedValue(EMPTY_TOTALS);
  fetchCourseTotals.mockResolvedValue(EMPTY_COURSE_TOTALS);
  fetchCourseInfo.mockResolvedValue({
    id: COURSE_A,
    code: "CS101",
    title: "Intro",
  });
});

describe("analytics.service — admin overview", () => {
  it("rejects non-admin callers", async () => {
    const student = mkUser({ id: "s1" });
    await expect(getAdminOverview(student)).rejects.toMatchObject({
      status: 403,
    });
    expect(fetchOverviewTotals).not.toHaveBeenCalled();
  });

  it("returns the assembled overview for an admin", async () => {
    const admin = mkUser({ id: "a1", roles: ["admin"], primaryRole: "admin" });
    const dto = await getAdminOverview(admin);
    expect(dto.totals).toEqual(EMPTY_TOTALS);
    expect(dto.generatedAt).toMatch(/T/);
    expect(fetchOverviewTotals).toHaveBeenCalledTimes(1);
  });

  it("serves the cached entry within the TTL window", async () => {
    const admin = mkUser({ id: "a1", roles: ["admin"], primaryRole: "admin" });
    await getAdminOverview(admin, 60_000);
    await getAdminOverview(admin, 60_000);
    await getAdminOverview(admin, 60_000);
    expect(fetchOverviewTotals).toHaveBeenCalledTimes(1);
  });

  it("re-fetches once the TTL expires", async () => {
    const admin = mkUser({ id: "a1", roles: ["admin"], primaryRole: "admin" });
    await getAdminOverview(admin, 1);
    await new Promise((r) => setTimeout(r, 5));
    await getAdminOverview(admin, 1);
    expect(fetchOverviewTotals).toHaveBeenCalledTimes(2);
  });
});

describe("analytics.service — course analytics", () => {
  it("rejects students even when enrolled", async () => {
    const student = mkUser({
      id: "s1",
      enrollments: [{ courseId: COURSE_A, roleInCourse: "student" }],
    });
    await expect(getCourseAnalytics(COURSE_A, student)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("rejects lecturers teaching a different course", async () => {
    const lecturer = mkUser({
      id: "l1",
      roles: ["lecturer"],
      primaryRole: "lecturer",
      enrollments: [{ courseId: COURSE_B, roleInCourse: "lecturer" }],
    });
    await expect(getCourseAnalytics(COURSE_A, lecturer)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("allows the course's lecturer and admins", async () => {
    const lecturer = mkUser({
      id: "l1",
      roles: ["lecturer"],
      primaryRole: "lecturer",
      enrollments: [{ courseId: COURSE_A, roleInCourse: "lecturer" }],
    });
    const admin = mkUser({ id: "a1", roles: ["admin"], primaryRole: "admin" });
    const dtoLecturer = await getCourseAnalytics(COURSE_A, lecturer);
    const dtoAdmin = await getCourseAnalytics(COURSE_A, admin);
    expect(dtoLecturer.course.code).toBe("CS101");
    expect(dtoAdmin.course.code).toBe("CS101");
  });

  it("404s when the course id is unknown", async () => {
    fetchCourseInfo.mockResolvedValueOnce(null);
    const admin = mkUser({ id: "a1", roles: ["admin"], primaryRole: "admin" });
    await expect(getCourseAnalytics(COURSE_A, admin)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("caches per-course independently", async () => {
    const admin = mkUser({ id: "a1", roles: ["admin"], primaryRole: "admin" });
    fetchCourseInfo.mockResolvedValue({
      id: COURSE_A,
      code: "CS101",
      title: "Intro",
    });
    await getCourseAnalytics(COURSE_A, admin, 60_000);
    await getCourseAnalytics(COURSE_A, admin, 60_000);
    expect(fetchCourseTotals).toHaveBeenCalledTimes(1);

    fetchCourseInfo.mockResolvedValue({
      id: COURSE_B,
      code: "CS200",
      title: "Algorithms",
    });
    await getCourseAnalytics(COURSE_B, admin, 60_000);
    expect(fetchCourseTotals).toHaveBeenCalledTimes(2);
  });
});
