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

  // Alive, publicly-live uploads. "Live" means the canonical visible set
  // (`published` OR `approved`) — the same set browse/listing uses. Counting
  // only `published` would silently exclude student uploads, which go through
  // review and land as `approved`, keeping them off the leaderboard.
  const uploadRows = await db.$queryRaw<Array<{ user_id: string; uploads: bigint }>>`
    SELECT uploader_id::text AS user_id, COUNT(*)::bigint AS uploads
    FROM documents
    WHERE deleted_at IS NULL AND status IN ('published', 'approved')
      AND uploader_id = ANY(${userIds}::uuid[])
    GROUP BY uploader_id`;
  for (const r of uploadRows) out.get(r.user_id)!.publishedUploads = Number(r.uploads);

  // Favorites received on your alive/live docs, excluding self-favorites.
  const favRows = await db.$queryRaw<Array<{ user_id: string; favs: bigint }>>`
    SELECT d.uploader_id::text AS user_id, COUNT(*)::bigint AS favs
    FROM document_favorites f
    JOIN documents d ON d.id = f.document_id
    WHERE d.deleted_at IS NULL AND d.status IN ('published', 'approved')
      AND f.user_id <> d.uploader_id
      AND d.uploader_id = ANY(${userIds}::uuid[])
    GROUP BY d.uploader_id`;
  for (const r of favRows) out.get(r.user_id)!.favoritesReceived = Number(r.favs);

  // Downloads received on your alive/live docs, excluding self-downloads.
  const dlRows = await db.$queryRaw<Array<{ user_id: string; downloads: bigint }>>`
    SELECT d.uploader_id::text AS user_id, COUNT(*)::bigint AS downloads
    FROM audit_logs a
    JOIN documents d ON d.id::text = a.entity_id
    WHERE a.action = 'document.download' AND a.entity_type = 'document'
      AND d.deleted_at IS NULL AND d.status IN ('published', 'approved')
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

/**
 * Lightweight batched count of each user's publicly-live uploads
 * (`published` OR `approved`). Cheaper than {@link computeStatsForUsers} when
 * the caller only needs the upload tally — e.g. deriving the "verified" mark.
 * Users with no uploads come back as 0.
 */
export async function countLiveUploadsByUsers(
  userIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (userIds.length === 0) return out;
  for (const id of userIds) out.set(id, 0);
  const rows = await db.$queryRaw<Array<{ user_id: string; uploads: bigint }>>`
    SELECT uploader_id::text AS user_id, COUNT(*)::bigint AS uploads
    FROM documents
    WHERE deleted_at IS NULL AND status IN ('published', 'approved')
      AND uploader_id = ANY(${userIds}::uuid[])
    GROUP BY uploader_id`;
  for (const r of rows) out.set(r.user_id, Number(r.uploads));
  return out;
}

export interface LeaderboardCandidate {
  userId: string;
  displayName: string;
  username: string | null;
  hasAvatar: boolean;
  roles: string[];
}

/**
 * Users eligible for the leaderboard: ACTIVE, non-deleted, non-anonymized, and
 * with at least one publicly-live upload (keeps the board to genuine
 * contributors and bounds the stat computation). "Live" is the canonical
 * visible set (`published` OR `approved`) — so students whose uploads were
 * approved through review qualify, not just lecturers who publish directly.
 * Role is intentionally NOT filtered: anyone who contributes can appear.
 */
export async function fetchLeaderboardCandidates(): Promise<LeaderboardCandidate[]> {
  const rows = await db.$queryRaw<
    Array<{
      user_id: string;
      display_name: string;
      username: string | null;
      has_avatar: boolean;
      roles: string[];
    }>
  >`
    SELECT u.id::text AS user_id, u.display_name, u.username,
           (u.avatar_storage_path IS NOT NULL) AS has_avatar,
           COALESCE(
             array_agg(r.name) FILTER (WHERE r.name IS NOT NULL),
             '{}'::text[]
           ) AS roles
    FROM users u
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles r ON r.id = ur.role_id
    WHERE u.status = 'ACTIVE' AND u.deleted_at IS NULL AND u.anonymized_at IS NULL
      AND EXISTS (
        SELECT 1 FROM documents d
        WHERE d.uploader_id = u.id AND d.deleted_at IS NULL
          AND d.status IN ('published', 'approved')
      )
    GROUP BY u.id, u.display_name, u.username, u.avatar_storage_path`;
  return rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    username: r.username,
    hasAvatar: r.has_avatar,
    roles: Array.from(new Set(r.roles ?? [])),
  }));
}
