import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/collections.repo", () => ({
  createCollection: vi.fn(),
  listCollectionsForOwner: vi.fn(),
  findCollectionById: vi.fn(),
  updateCollection: vi.fn(),
  softDeleteCollection: vi.fn(),
  listItems: vi.fn().mockResolvedValue([]),
  addItem: vi.fn(),
  removeItem: vi.fn(),
  updateItemNote: vi.fn(),
  reorderItems: vi.fn(),
  // Exam Prep Hub additions (followers, popularity, progress, discovery)
  followCollection: vi.fn(),
  unfollowCollection: vi.fn(),
  isFollowing: vi.fn().mockResolvedValue(false),
  countFollowers: vi.fn().mockResolvedValue(0),
  countFollowersForCollections: vi.fn().mockResolvedValue(new Map()),
  listFollowedCollectionIds: vi.fn().mockResolvedValue(new Set()),
  countItems: vi.fn().mockResolvedValue(0),
  setPopularityScore: vi.fn(),
  countCompletedForCollections: vi.fn().mockResolvedValue(new Map()),
  listDiscoverable: vi.fn().mockResolvedValue([]),
  recommendCollections: vi.fn().mockResolvedValue([]),
}));
vi.mock("../repositories/studyProgress.repo", () => ({
  getProgressForDocuments: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("../repositories/documents.repo", () => ({
  findByIdAlive: vi.fn(),
  findManyByIdsAlive: vi.fn().mockResolvedValue([]),
}));
vi.mock("./documents.service", () => ({ assembleDocuments: vi.fn().mockResolvedValue([]) }));
vi.mock("./recommendations.service", () => ({
  getInterestCourseIds: vi.fn().mockResolvedValue({ courseIds: [], seenDocIds: [] }),
}));
vi.mock("./permissions.service", () => ({ canView: vi.fn() }));

import * as collectionsRepo from "../repositories/collections.repo";
import * as docsRepo from "../repositories/documents.repo";
import * as permissions from "./permissions.service";
import {
  createCollection,
  getCollection,
  addDocument,
  reorder,
} from "./collections.service";
import { HttpError } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";

const createRepo = vi.mocked(collectionsRepo.createCollection);
const findById = vi.mocked(collectionsRepo.findCollectionById);
const addItem = vi.mocked(collectionsRepo.addItem);
const reorderItems = vi.mocked(collectionsRepo.reorderItems);
const findDoc = vi.mocked(docsRepo.findByIdAlive);
const canView = vi.mocked(permissions.canView);

const user = { id: "u1", roles: ["student"], enrollments: [] } as unknown as AuthenticatedUser;
const owned = {
  id: "col1",
  ownerId: "u1",
  title: "Exam prep",
  description: "",
  kind: "exam_prep",
  isOfficial: false,
  courseId: null,
  categoryId: null,
  examName: null,
  semester: null,
  academicYear: null,
  visibility: "private",
  popularityScore: 0,
  examDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("collections.service", () => {
  it("rejects creating a collection with a blank title", async () => {
    await expect(createCollection(user, { title: "   " })).rejects.toBeInstanceOf(HttpError);
    expect(createRepo).not.toHaveBeenCalled();
  });

  it("creates a collection and returns a summary", async () => {
    createRepo.mockResolvedValue({ ...owned, title: "My set" });
    const dto = await createCollection(user, { title: "My set", kind: "revision" });
    expect(dto.title).toBe("My set");
    expect(dto.itemCount).toBe(0);
    expect(createRepo).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: "u1", title: "My set", kind: "revision" }),
    );
  });

  it("blocks managing a collection the user does not own", async () => {
    findById.mockResolvedValue({ ...owned, ownerId: "someone-else" });
    await expect(getCollection("col1", user)).rejects.toBeInstanceOf(HttpError);
  });

  it("adds a visible document but rejects one the user cannot see", async () => {
    findById.mockResolvedValue(owned);
    // visible doc → added
    findDoc.mockResolvedValue({ id: "d1" } as never);
    canView.mockReturnValue(true);
    await addDocument("col1", user, "d1");
    expect(addItem).toHaveBeenCalledWith("col1", "d1", undefined);

    // invisible doc → notFound, not added
    addItem.mockClear();
    canView.mockReturnValue(false);
    await expect(addDocument("col1", user, "d2")).rejects.toBeInstanceOf(HttpError);
    expect(addItem).not.toHaveBeenCalled();
  });

  it("reorders items for the owner", async () => {
    findById.mockResolvedValue(owned);
    await reorder("col1", user, ["d3", "d1", "d2"]);
    expect(reorderItems).toHaveBeenCalledWith("col1", ["d3", "d1", "d2"]);
  });
});
