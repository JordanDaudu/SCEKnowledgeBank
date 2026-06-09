import { describe, expect, it } from "vitest";
import {
  scoreFromStats,
  levelForScore,
  earnedBadgeKeys,
  type ReputationStats,
} from "./reputation";

const ZERO: ReputationStats = {
  publishedUploads: 0,
  downloadsReceived: 0,
  favoritesReceived: 0,
  publicCollections: 0,
  followersReceived: 0,
  comments: 0,
  reactionsReceived: 0,
  requests: 0,
};

describe("scoreFromStats", () => {
  it("is zero for a user with no activity", () => {
    expect(scoreFromStats(ZERO)).toBe(0);
  });

  it("weights uploads (10) + downloads (2) + favorites (3)", () => {
    const s = scoreFromStats({
      ...ZERO,
      publishedUploads: 2,
      downloadsReceived: 5,
      favoritesReceived: 3,
    });
    expect(s).toBe(2 * 10 + 5 * 2 + 3 * 3); // 39
  });

  it("counts comments, reactions, collections, followers, requests", () => {
    const s = scoreFromStats({
      ...ZERO,
      comments: 4,
      reactionsReceived: 6,
      publicCollections: 2,
      followersReceived: 3,
      requests: 5,
    });
    expect(s).toBe(4 * 2 + 6 * 1 + 2 * 5 + 3 * 2 + 5 * 1); // 35
  });
});

describe("levelForScore", () => {
  it("maps thresholds to named levels", () => {
    expect(levelForScore(0).key).toBe("novice");
    expect(levelForScore(50).key).toBe("contributor");
    expect(levelForScore(250).key).toBe("scholar");
    expect(levelForScore(1000).key).toBe("sage");
  });

  it("picks the highest level at or below the score", () => {
    expect(levelForScore(49).key).toBe("novice");
    expect(levelForScore(249).key).toBe("contributor");
    expect(levelForScore(999).key).toBe("scholar");
    expect(levelForScore(5000).key).toBe("sage");
  });
});

describe("earnedBadgeKeys", () => {
  it("awards first_upload at 1 upload but not prolific until 10", () => {
    const keys = earnedBadgeKeys({ ...ZERO, publishedUploads: 1 });
    expect(keys).toContain("first_upload");
    expect(keys).not.toContain("prolific");
  });

  it("awards prolific at 10 uploads", () => {
    expect(earnedBadgeKeys({ ...ZERO, publishedUploads: 10 })).toContain("prolific");
  });

  it("awards popular at 100 downloads received", () => {
    expect(earnedBadgeKeys({ ...ZERO, downloadsReceived: 100 })).toContain("popular");
  });

  it("awards nothing for a blank user", () => {
    expect(earnedBadgeKeys(ZERO)).toEqual([]);
  });
});
