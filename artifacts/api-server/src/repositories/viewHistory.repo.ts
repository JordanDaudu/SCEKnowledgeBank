import { db } from "@workspace/db";

export async function recordView(
  documentId: string,
  userId: string,
): Promise<void> {
  await db.materialViewHistory.create({ data: { documentId, userId } });
}

export async function tryRecordView(
  documentId: string,
  userId: string,
): Promise<void> {
  try {
    await db.materialViewHistory.create({ data: { documentId, userId } });
  } catch {
    // Non-fatal — preserves previous Drizzle behaviour where a failed insert
    // (e.g. FK race when a document is being soft-deleted) is silently ignored.
  }
}

export async function listRecentDocumentIdsForUser(
  userId: string,
  limit: number,
): Promise<string[]> {
  // Prisma can't express `ORDER BY max(viewed_at)` with groupBy directly in
  // a portable way that returns the IDs sorted by recency. Use a raw query
  // (same SQL semantics as the previous Drizzle implementation).
  const rows = await db.$queryRaw<Array<{ document_id: string }>>`
    SELECT document_id
    FROM material_view_history
    WHERE user_id = ${userId}::uuid
    GROUP BY document_id
    ORDER BY max(viewed_at) DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => r.document_id);
}

export async function countViewsByDocumentIds(
  ids: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const rows = await db.materialViewHistory.groupBy({
    by: ["documentId"],
    where: { documentId: { in: ids } },
    _count: { _all: true },
  });
  for (const r of rows) map.set(r.documentId, r._count._all);
  return map;
}
