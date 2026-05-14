import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db, materialRequests, requestVotes } from "@workspace/db";

export type RequestRow = typeof materialRequests.$inferSelect;
export type RequestInsert = typeof materialRequests.$inferInsert;
export type VoteRow = typeof requestVotes.$inferSelect;

export interface ListRequestsFilters {
  status?: string;
  courseId?: string;
}

export async function listAliveIds(
  filters: ListRequestsFilters,
): Promise<string[]> {
  const conds: SQL[] = [isNull(materialRequests.deletedAt)];
  if (filters.status) conds.push(eq(materialRequests.status, filters.status));
  if (filters.courseId)
    conds.push(eq(materialRequests.courseId, filters.courseId));
  const rows = await db
    .select({ id: materialRequests.id })
    .from(materialRequests)
    .where(and(...conds))
    .orderBy(desc(materialRequests.createdAt));
  return rows.map((r) => r.id);
}

export async function findAliveByIds(ids: string[]): Promise<RequestRow[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(materialRequests)
    .where(
      and(
        isNull(materialRequests.deletedAt),
        inArray(materialRequests.id, ids),
      ),
    );
}

export async function findAliveById(id: string): Promise<RequestRow | null> {
  const rows = await db
    .select()
    .from(materialRequests)
    .where(and(eq(materialRequests.id, id), isNull(materialRequests.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertRequest(
  values: RequestInsert,
): Promise<RequestRow> {
  const rows = await db.insert(materialRequests).values(values).returning();
  return rows[0];
}

export async function updateRequestById(
  id: string,
  patch: Partial<RequestInsert>,
): Promise<void> {
  await db
    .update(materialRequests)
    .set(patch)
    .where(eq(materialRequests.id, id));
}

export async function countVotesByRequestIds(
  requestIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (requestIds.length === 0) return result;
  const rows = await db
    .select({
      requestId: requestVotes.requestId,
      count: sql<number>`count(*)::int`,
    })
    .from(requestVotes)
    .where(inArray(requestVotes.requestId, requestIds))
    .groupBy(requestVotes.requestId);
  for (const r of rows) result.set(r.requestId, Number(r.count));
  return result;
}

export async function findUserVotedRequestIds(
  userId: string,
  requestIds: string[],
): Promise<Set<string>> {
  const result = new Set<string>();
  if (requestIds.length === 0) return result;
  const rows = await db
    .select({ requestId: requestVotes.requestId })
    .from(requestVotes)
    .where(
      and(
        eq(requestVotes.userId, userId),
        inArray(requestVotes.requestId, requestIds),
      ),
    );
  for (const r of rows) result.add(r.requestId);
  return result;
}

export async function findVote(
  requestId: string,
  userId: string,
): Promise<VoteRow | null> {
  const rows = await db
    .select()
    .from(requestVotes)
    .where(
      and(
        eq(requestVotes.requestId, requestId),
        eq(requestVotes.userId, userId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function insertVote(
  requestId: string,
  userId: string,
): Promise<void> {
  await db.insert(requestVotes).values({ requestId, userId });
}
