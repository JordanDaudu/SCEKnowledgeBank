/**
 * Refinement Phase 2 — ranking constants.
 *
 * Configurable weights for the deterministic document ranking score. Kept in
 * one place so the scoring policy is easy to tune without touching SQL. All
 * counts are dampened with ln(1+x) in the SQL so a runaway view count can't
 * dominate; recency uses an exponential half-life decay.
 */
export const RANKING = {
  /** Multipliers on ln(1 + count) for each engagement signal. */
  viewWeight: 1.0,
  downloadWeight: 1.5,
  favoriteWeight: 2.0,
  /** Weight + half-life (days) of the recency boost in the base score. */
  recencyWeight: 2.0,
  recencyHalfLifeDays: 30,
  /** Weight on metadata completeness (0..1) — a quality indicator. */
  metadataWeight: 1.0,
  /** Shorter half-life (days) used by the "trending" sort so fresh, engaged
   *  documents surface; older ones decay out quickly. */
  trendingHalfLifeDays: 7,
} as const;
