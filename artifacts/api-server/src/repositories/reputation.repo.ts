/**
 * Derived reputation stats — the single source of truth for a user's score.
 *
 * Every figure is computed from CURRENT state (raw SQL, like analytics.repo),
 * counting only alive/published content and excluding self-engagement. This is
 * what makes the hybrid point rule fall out for free: deleting, unpublishing,
 * or moderating content simply removes its rows from these counts — no
 * compensating writes anywhere. The service turns these stats into a score so
 * the weighting formula lives in exactly one place (`lib/reputation.ts`).
 */
import { db } from "@workspace/db";
import type { ReputationStats } from "../lib/reputation";

const EMPTY = (): ReputationStats => ({
  publishedUploads: 0,
  downloadsReceived: 0,
  favoritesReceived: 0,
  publicCollections: 0,
  followersReceived: 0,
  comments: 0,
  reactionsReceived: 0,
  requests: 0,
});

/**
 * Compute reputation stats for a set of users in a fixed number of batched
 * queries (no N+1). Users with no activity come back with all-zero stats.
 */
export async function computeStatsForUsers(
  userIds: string[],
): Promise<Map<string, ReputationStats>> {
  const out = new Map<string, ReputationStats>();
  if (userIds.length === 0) return out;
  for (const id of userIds) out.set(id, EMPTY());

  // Published, alive uploads.
  const uploadRows = await db.$queryRaw<Array<{ user_id: string; uploads: bigint }>>`
    SELECT uploader_id::text AS user_id, COUNT(*)::bigint AS uploads
    FROM documents
    WHERE deleted_at IS NULL AND status = 'published'
      AND uploader_id = ANY(${userIds}::uuid[])
    GROUP BY uploader_id`;
  for (const r of uploadRows) out.get(r.user_id)!.publishedUploads = Number(r.uploads);

  // Favorites received on your alive/published docs, excluding self-favorites.
  const favRows = await db.$queryRaw<Array<{ user_id: string; favs: bigint }>>`
    SELECT d.uploader_id::text AS user_id, COUNT(*)::bigint AS favs
    FROM document_favorites f
    JOIN documents d ON d.id = f.document_id
    WHERE d.deleted_at IS NULL AND d.status = 'published'
      AND f.user_id <> d.uploader_id
      AND d.uploader_id = ANY(${userIds}::uuid[])
    GROUP BY d.uploader_id`;
  for (const r of favRows) out.get(r.user_id)!.favoritesReceived = Number(r.favs);

  // Downloads received on your alive/published docs, excluding self-downloads.
  const dlRows = await db.$queryRaw<Array<{ user_id: string; downloads: bigint }>>`
    SELECT d.uploader_id::text AS user_id, COUNT(*)::bigint AS downloads
    FROM audit_logs a
    JOIN documents d ON d.id::text = a.entity_id
    WHERE a.action = 'document.download' AND a.entity_type = 'document'
      AND d.deleted_at IS NULL AND d.status = 'published'
      AND a.actor_user_id IS NOT NULL AND a.actor_user_id <> d.uploader_id
      AND d.uploader_id = ANY(${userIds}::uuid[])
    GROUP BY d.uploader_id`;
  for (const r of dlRows) out.get(r.user_id)!.downloadsReceived = Number(r.downloads);

  // Public/official, non-hidden collections you own + followers across them.
  const colRows = await db.$queryRaw<Array<{ user_id: string; cols: bigint; followers: bigint }>>`
    SELECT owner_id::text AS user_id,
           COUNT(*)::bigint AS cols,
           COALESCE(SUM(follower_count), 0)::bigint AS followers
    FROM study_collections
    WHERE deleted_at IS NULL AND hidden_at IS NULL
      AND (visibility = 'public' OR is_official = true)
      AND owner_id = ANY(${userIds}::uuid[])
    GROUP BY owner_id`;
  for (const r of colRows) {
    const s = out.get(r.user_id)!;
    s.publicCollections = Number(r.cols);
    s.followersReceived = Number(r.followers);
  }

  // Comments you authored (alive).
  const cmtRows = await db.$queryRaw<Array<{ user_id: string; comments: bigint }>>`
    SELECT author_id::text AS user_id, COUNT(*)::bigint AS comments
    FROM comments
    WHERE deleted_at IS NULL AND author_id = ANY(${userIds}::uuid[])
    GROUP BY author_id`;
  for (const r of cmtRows) out.get(r.user_id)!.comments = Number(r.comments);

  // Reactions others left on your alive comments, excluding self-reactions.
  const reactRows = await db.$queryRaw<Array<{ user_id: string; reactions: bigint }>>`
    SELECT c.author_id::text AS user_id, COUNT(*)::bigint AS reactions
    FROM comment_reactions r
    JOIN comments c ON c.id = r.comment_id
    WHERE c.deleted_at IS NULL AND r.user_id <> c.author_id
      AND c.author_id = ANY(${userIds}::uuid[])
    GROUP BY c.author_id`;
  for (const r of reactRows) out.get(r.user_id)!.reactionsReceived = Number(r.reactions);

  // Material requests you authored (alive).
  const reqRows = await db.$queryRaw<Array<{ user_id: string; requests: bigint }>>`
    SELECT requested_by::text AS user_id, COUNT(*)::bigint AS requests
    FROM material_requests
    WHERE deleted_at IS NULL AND requested_by = ANY(${userIds}::uuid[])
    GROUP BY requested_by`;
  for (const r of reqRows) out.get(r.user_id)!.requests = Number(r.requests);

  return out;
}

export async function computeUserStats(userId: string): Promise<ReputationStats> {
  return (await computeStatsForUsers([userId])).get(userId)!;
}

export interface LeaderboardCandidate {
  userId: string;
  displayName: string;
  username: string | null;
  hasAvatar: boolean;
}

/**
 * Users eligible for the leaderboard: ACTIVE, non-deleted, non-anonymized, and
 * with at least one published upload (keeps the board to genuine contributors
 * and bounds the stat computation). The service scores + ranks them.
 */
export async function fetchLeaderboardCandidates(): Promise<LeaderboardCandidate[]> {
  const rows = await db.$queryRaw<
    Array<{ user_id: string; display_name: string; username: string | null; has_avatar: boolean }>
  >`
    SELECT u.id::text AS user_id, u.display_name, u.username,
           (u.avatar_storage_path IS NOT NULL) AS has_avatar
    FROM users u
    WHERE u.status = 'ACTIVE' AND u.deleted_at IS NULL AND u.anonymized_at IS NULL
      AND EXISTS (
        SELECT 1 FROM documents d
        WHERE d.uploader_id = u.id AND d.deleted_at IS NULL AND d.status = 'published'
      )`;
  return rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    username: r.username,
    hasAvatar: r.has_avatar,
  }));
}
