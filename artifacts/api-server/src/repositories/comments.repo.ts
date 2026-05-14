import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, comments } from "@workspace/db";

export type CommentRow = typeof comments.$inferSelect;
export type CommentInsert = typeof comments.$inferInsert;

export async function listAliveByDocument(
  documentId: string,
): Promise<CommentRow[]> {
  return db
    .select()
    .from(comments)
    .where(and(eq(comments.documentId, documentId), isNull(comments.deletedAt)))
    .orderBy(asc(comments.createdAt));
}

export async function findAliveById(id: string): Promise<CommentRow | null> {
  const rows = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, id), isNull(comments.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertComment(
  values: CommentInsert,
): Promise<CommentRow> {
  const rows = await db.insert(comments).values(values).returning();
  return rows[0];
}

export async function softDeleteById(id: string): Promise<void> {
  await db
    .update(comments)
    .set({ deletedAt: new Date() })
    .where(eq(comments.id, id));
}

export async function countAliveByDocumentIds(
  ids: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({
      documentId: comments.documentId,
      n: sql<number>`count(*)::int`,
    })
    .from(comments)
    .where(and(inArray(comments.documentId, ids), isNull(comments.deletedAt)))
    .groupBy(comments.documentId);
  for (const r of rows) map.set(r.documentId, r.n);
  return map;
}
