/**
 * Bundle popularity score (US-55). Pure (no DB) so it can be unit-tested in
 * isolation. Followers are weighted more heavily than item count; the result
 * is clamped to >= 0. Persisted to study_collections.popularity_score and
 * recomputed by the collections service whenever followers or items change.
 */
export function computePopularity(
  followerCount: number,
  itemCount: number,
): number {
  return Math.max(0, Math.max(0, followerCount) * 3 + Math.max(0, itemCount));
}
