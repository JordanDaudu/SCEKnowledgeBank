import { db } from "@workspace/db";

export interface ReactionRow {
  commentId: string;
  userId: string;
  kind: string;
}

/**
 * Insert a reaction row. Idempotent thanks to the unique index on
 * (comment_id, user_id, kind) — duplicates are silently absorbed.
 * Returns true when a row was actually inserted (useful for deciding
 * whether to fire the producer-side notification).
 */
export async function insertIfAbsent(
  commentId: string,
  userId: string,
  kind: string,
): Promise<boolean> {
  const r = await db.commentReaction.createMany({
    data: [{ commentId, userId, kind }],
    skipDuplicates: true,
  });
  return r.count > 0;
}

export async function deleteOne(
  commentId: string,
  userId: string,
  kind: string,
): Promise<boolean> {
  const r = await db.commentReaction.deleteMany({
    where: { commentId, userId, kind },
  });
  return r.count > 0;
}

/**
 * Aggregate reaction rows for a set of comments. Returns a map from
 * comment id to a list of {kind, count, viewerReacted} entries
 * suitable for direct serialisation into the CommentDTO.
 */
export interface ReactionSummary {
  kind: string;
  count: number;
  viewerReacted: boolean;
}

export async function summariseByCommentIds(
  commentIds: string[],
  viewerUserId: string,
): Promise<Map<string, ReactionSummary[]>> {
  const out = new Map<string, ReactionSummary[]>();
  if (commentIds.length === 0) return out;
  const rows = await db.commentReaction.findMany({
    where: { commentId: { in: commentIds } },
    select: { commentId: true, userId: true, kind: true },
  });
  // (commentId -> (kind -> {count, viewerReacted}))
  const byComment = new Map<string, Map<string, { count: number; viewer: boolean }>>();
  for (const r of rows) {
    let m = byComment.get(r.commentId);
    if (!m) {
      m = new Map();
      byComment.set(r.commentId, m);
    }
    const cur = m.get(r.kind) ?? { count: 0, viewer: false };
    cur.count += 1;
    if (r.userId === viewerUserId) cur.viewer = true;
    m.set(r.kind, cur);
  }
  for (const [cid, m] of byComment) {
    const entries: ReactionSummary[] = [];
    for (const [kind, v] of m) {
      entries.push({ kind, count: v.count, viewerReacted: v.viewer });
    }
    entries.sort((a, b) => (b.count - a.count) || a.kind.localeCompare(b.kind));
    out.set(cid, entries);
  }
  return out;
}
