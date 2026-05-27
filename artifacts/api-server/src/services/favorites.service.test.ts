import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/favorites.repo", () => ({
  insertIfAbsent: vi.fn(),
  deleteOne: vi.fn(),
  isFavorited: vi.fn(),
  listDocumentIdsForUser: vi.fn(),
  listSubscribersForDocument: vi.fn(),
}));
vi.mock("../repositories/documents.repo", () => ({
  findByIdAlive: vi.fn(),
  findManyByIdsAlive: vi.fn(),
}));
vi.mock("./documents.service", () => ({
  assembleDocuments: vi.fn(),
}));
vi.mock("./permissions.service", () => ({ canView: vi.fn() }));

import * as favoritesRepo from "../repositories/favorites.repo";
import * as docsRepo from "../repositories/documents.repo";
import * as documentsService from "./documents.service";
import * as permissions from "./permissions.service";
import {
  favoriteDocument,
  unfavoriteDocument,
  listFavoritesForUser,
  recipientsForDocumentActivity,
} from "./favorites.service";
import { HttpError } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";

const insertIfAbsent = vi.mocked(favoritesRepo.insertIfAbsent);
const deleteOne = vi.mocked(favoritesRepo.deleteOne);
const listIds = vi.mocked(favoritesRepo.listDocumentIdsForUser);
const listSubs = vi.mocked(favoritesRepo.listSubscribersForDocument);
const findDoc = vi.mocked(docsRepo.findByIdAlive);
const findMany = vi.mocked(docsRepo.findManyByIdsAlive);
const assemble = vi.mocked(documentsService.assembleDocuments);
const canView = vi.mocked(permissions.canView);

const user: AuthenticatedUser = {
  id: "u1",
  email: "u@e",
  displayName: "U",
  roles: ["student"],
  enrollments: [],
} as unknown as AuthenticatedUser;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("favorites.service", () => {
  it("rejects favoriting a document the user cannot view", async () => {
    findDoc.mockResolvedValue({ id: "d1" } as never);
    canView.mockReturnValue(false);
    await expect(favoriteDocument("d1", user)).rejects.toBeInstanceOf(
      HttpError,
    );
    expect(insertIfAbsent).not.toHaveBeenCalled();
  });

  it("404s favoriting a missing document", async () => {
    findDoc.mockResolvedValue(null);
    await expect(favoriteDocument("d1", user)).rejects.toBeInstanceOf(
      HttpError,
    );
  });

  it("inserts on favorite", async () => {
    findDoc.mockResolvedValue({ id: "d1" } as never);
    canView.mockReturnValue(true);
    await favoriteDocument("d1", user);
    expect(insertIfAbsent).toHaveBeenCalledWith("u1", "d1");
  });

  it("unfavorite skips visibility check (lets users unsubscribe even after revoke)", async () => {
    await unfavoriteDocument("d1", user);
    expect(findDoc).not.toHaveBeenCalled();
    expect(canView).not.toHaveBeenCalled();
    expect(deleteOne).toHaveBeenCalledWith("u1", "d1");
  });

  it("listFavoritesForUser filters out docs the viewer can no longer see", async () => {
    listIds.mockResolvedValue(["d1", "d2"]);
    findMany.mockResolvedValue([
      { id: "d1" },
      { id: "d2" },
    ] as never);
    canView.mockImplementation(
      (doc) => (doc as unknown as { id: string }).id === "d1",
    );
    assemble.mockResolvedValue([{ id: "d1" }] as never);
    const out = await listFavoritesForUser(user);
    expect(assemble).toHaveBeenCalledWith([{ id: "d1" }], user);
    expect(out).toEqual([{ id: "d1" }]);
  });

  it("listFavoritesForUser short-circuits when empty", async () => {
    listIds.mockResolvedValue([]);
    const out = await listFavoritesForUser(user);
    expect(out).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("recipientsForDocumentActivity excludes the actor + reply/mention set", async () => {
    listSubs.mockResolvedValue(["u1", "u2", "u3", "u4"]);
    const out = await recipientsForDocumentActivity("d1", ["u1", "u3"]);
    expect(out).toEqual(["u2", "u4"]);
  });
});
