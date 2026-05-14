import { desc, eq, inArray, sql } from "drizzle-orm";
import { db, materialViewHistory } from "@workspace/db";

export async function recordView(
  documentId: string,
  userId: string,
): Promise<void> {
  await db.insert(materialViewHistory).values({ documentId, userId });
}

export async function tryRecordView(
  documentId: string,
  userId: string,
): Promise<void> {
  try {
    await db.insert(materialViewHistory).values({ documentId, userId });
  } catch {
    // Non-fatal
  }
}

export async function listRecentDocumentIdsForUser(
  userId: string,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({
      documentId: materialViewHistory.documentId,
      viewedAt: sql<Date>`max(${materialViewHistory.viewedAt})`,
    })
    .from(materialViewHistory)
    .where(eq(materialViewHistory.userId, userId))
    .groupBy(materialViewHistory.documentId)
    .orderBy(desc(sql`max(${materialViewHistory.viewedAt})`))
    .limit(limit);
  return rows.map((r) => r.documentId);
}

export async function countViewsByDocumentIds(
  ids: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({
      documentId: materialViewHistory.documentId,
      n: sql<number>`count(*)::int`,
    })
    .from(materialViewHistory)
    .where(inArray(materialViewHistory.documentId, ids))
    .groupBy(materialViewHistory.documentId);
  for (const r of rows) map.set(r.documentId, r.n);
  return map;
}

