/**
 * Phase 3 — collection ranking policy. Pure constants (no DB); the scoring
 * math lives in collections.repo SQL. Tune weights/scales here. Mirrors the
 * lib/ranking.ts pattern for documents.
 */
export const COLLECTION_RANKING = {
  // Weighted blend for the combined discovery/search score (sums to 1.0).
  relevanceWeight: 0.4,
  ratingWeight: 0.2,
  likeWeight: 0.15,
  saveWeight: 0.15,
  viewWeight: 0.1,
  // Soft-cap scales for ln-normalising unbounded counts to ~[0,1]:
  //   norm(x) = LEAST(ln(1+x) / ln(1+SCALE), 1)
  likeScale: 50,
  saveScale: 50,
  viewScale: 500,
  // Bayesian prior for the Highest-Rated section.
  ratingPriorMean: 3.5,
  ratingPriorWeight: 5,
  // Trending: trailing window (days) + per-event weights.
  trendingWindowDays: 7,
  trendingViewWeight: 1,
  trendingLikeWeight: 3,
  trendingFollowWeight: 4,
  trendingCommentWeight: 2,
} as const;
