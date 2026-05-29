import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/documents.repo", () => ({
  findManyByIdsAlive: vi.fn(),
  recommendDocuments: vi.fn(),
}));
vi.mock("../repositories/viewHistory.repo", () => ({
  listRecentDocumentIdsForUser: vi.fn(),
}));
vi.mock("../repositories/favorites.repo", () => ({
  listDocumentIdsForUser: vi.fn(),
}));
vi.mock("../repositories/studyProgress.repo", () => ({
  listInProgressDocumentIds: vi.fn(),
}));
vi.mock("./documents.service", () => ({
  assembleDocuments: vi.fn().mockResolvedValue([]),
}));
vi.mock("./permissions.service", () => ({
  visibleDocumentFilterSql: vi.fn().mockReturnValue("VISIBLE"),
}));

import * as docsRepo from "../repositories/documents.repo";
import * as viewRepo from "../repositories/viewHistory.repo";
import * as favoritesRepo from "../repositories/favorites.repo";
import * as studyProgressRepo from "../repositories/studyProgress.repo";
import { getRecommendations } from "./recommendations.service";
import type { AuthenticatedUser } from "../middlewares/auth";

const recent = vi.mocked(viewRepo.listRecentDocumentIdsForUser);
const favs = vi.mocked(favoritesRepo.listDocumentIdsForUser);
const inprog = vi.mocked(studyProgressRepo.listInProgressDocumentIds);
const findMany = vi.mocked(docsRepo.findManyByIdsAlive);
const recommend = vi.mocked(docsRepo.recommendDocuments);

const user = {
  id: "u1",
  roles: ["student"],
  enrollments: [{ courseId: "courseA", roleInCourse: "student" }],
} as unknown as AuthenticatedUser;

beforeEach(() => {
  vi.clearAllMocks();
  recent.mockResolvedValue(["d-viewed"]);
  favs.mockResolvedValue(["d-fav"]);
  inprog.mockResolvedValue([]);
  // engaged docs belong to courseB
  findMany.mockResolvedValue([
    { id: "d-viewed", courseId: "courseB" },
    { id: "d-fav", courseId: "courseB" },
  ] as never);
  recommend.mockResolvedValue([]);
});

describe("recommendations.service", () => {
  it("scopes to interest courses (enrolments + engaged) and excludes seen docs", async () => {
    recommend.mockResolvedValueOnce([{ id: "rec1" } as never]); // primary fills up
    await getRecommendations(user, 1);
    expect(recommend).toHaveBeenCalledWith(
      "VISIBLE",
      expect.objectContaining({
        courseIds: expect.arrayContaining(["courseA", "courseB"]),
        excludeIds: expect.arrayContaining(["d-viewed", "d-fav"]),
        limit: 1,
      }),
    );
  });

  it("falls back to a global pass when the course-scoped pass is short", async () => {
    recommend
      .mockResolvedValueOnce([{ id: "rec1" } as never]) // primary returns 1
      .mockResolvedValueOnce([{ id: "rec2" } as never]); // global top-up
    await getRecommendations(user, 3);
    expect(recommend).toHaveBeenCalledTimes(2);
    // Second (global) call has no course filter and tops up the remaining 2,
    // excluding already-picked rec1.
    const second = recommend.mock.calls[1][1];
    expect(second.courseIds).toBeUndefined();
    expect(second.limit).toBe(2);
    expect(second.excludeIds).toContain("rec1");
  });
});
