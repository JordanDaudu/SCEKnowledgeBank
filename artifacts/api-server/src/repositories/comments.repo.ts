import { db } from "@workspace/db";
import type { Prisma } from "@workspace/db";

export interface CommentRow {
  id: string;
  documentId: string;
  authorId: string;
  parentId: string | null;
  body: string;
  pageNumber: number | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export type CommentInsert = Prisma.CommentUncheckedCreateInput;

export async function listAliveByDocument(
  documentId: string,
): Promise<CommentRow[]> {
  return db.comment.findMany({
    where: { documentId, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
}

export async function findAliveById(id: string): Promise<CommentRow | null> {
  return db.comment.findFirst({ where: { id, deletedAt: null } });
}

export async function insertComment(
  values: CommentInsert,
): Promise<CommentRow> {
  return db.comment.create({ data: values });
}

export async function softDeleteById(id: string): Promise<void> {
  await db.comment.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

export interface CommentUpdate {
  body?: string;
  pageNumber?: number | null;
}

export async function updateById(
  id: string,
  patch: CommentUpdate,
): Promise<CommentRow> {
  const data: Prisma.CommentUncheckedUpdateInput = { updatedAt: new Date() };
  if (patch.body !== undefined) data.body = patch.body;
  if (patch.pageNumber !== undefined) data.pageNumber = patch.pageNumber;
  return db.comment.update({ where: { id }, data });
}

export async function countAliveByDocumentIds(
  ids: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const rows = await db.comment.groupBy({
    by: ["documentId"],
    where: { documentId: { in: ids }, deletedAt: null },
    _count: { _all: true },
  });
  for (const r of rows) map.set(r.documentId, r._count._all);
  return map;
}

// ─── @mentions ─────────────────────────────────────────────────────

export interface CommentMentionRow {
  commentId: string;
  mentionedUserId: string;
}

export async function insertMentions(
  commentId: string,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  // Dedupe defensively — the unique constraint on
  // (comment_id, mentioned_user_id) would otherwise fail the batch if
  // the parser produced the same id twice (e.g. user mentioned by
  // @displayName and by explicit id token in the same comment).
  const unique = Array.from(new Set(userIds));
  await db.commentMention.createMany({
    data: unique.map((uid) => ({ commentId, mentionedUserId: uid })),
    skipDuplicates: true,
  });
}

export async function listMentionsByCommentIds(
  commentIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (commentIds.length === 0) return out;
  const rows = await db.commentMention.findMany({
    where: { commentId: { in: commentIds } },
    select: { commentId: true, mentionedUserId: true },
  });
  for (const r of rows) {
    const list = out.get(r.commentId) ?? [];
    list.push(r.mentionedUserId);
    out.set(r.commentId, list);
  }
  return out;
}
