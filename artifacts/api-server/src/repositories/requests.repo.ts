import { db } from "@workspace/db";
import type { Prisma } from "@workspace/db";

export interface RequestRow {
  id: string;
  title: string;
  description: string;
  courseId: string | null;
  requestedBy: string;
  status: string;
  fulfillingDocumentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export type RequestInsert = Prisma.MaterialRequestUncheckedCreateInput;

export interface VoteRow {
  id: string;
  requestId: string;
  userId: string;
  createdAt: Date;
}

export interface ListRequestsFilters {
  status?: string;
  courseId?: string;
  /**
   * Visibility scoping (Sprint-2 audit). When set, only requests whose
   * `courseId` is `null` (global) OR included in
   * `visibleCourseIds` are returned. Admins pass `undefined` here to
   * skip the scope clause and see everything.
   */
  visibleCourseIds?: string[];
}

export async function listAliveIds(
  filters: ListRequestsFilters,
): Promise<string[]> {
  const where: Prisma.MaterialRequestWhereInput = {
    deletedAt: null,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.courseId ? { courseId: filters.courseId } : {}),
  };
  if (filters.visibleCourseIds !== undefined) {
    where.OR = [
      { courseId: null },
      { courseId: { in: filters.visibleCourseIds } },
    ];
  }
  const rows = await db.materialRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function findAliveByIds(ids: string[]): Promise<RequestRow[]> {
  if (ids.length === 0) return [];
  return db.materialRequest.findMany({
    where: { deletedAt: null, id: { in: ids } },
  });
}

export async function findAliveById(id: string): Promise<RequestRow | null> {
  return db.materialRequest.findFirst({ where: { id, deletedAt: null } });
}

export async function insertRequest(
  values: RequestInsert,
): Promise<RequestRow> {
  return db.materialRequest.create({ data: values });
}

export async function updateRequestById(
  id: string,
  patch: Prisma.MaterialRequestUncheckedUpdateInput,
): Promise<void> {
  await db.materialRequest.update({ where: { id }, data: patch });
}

export async function countVotesByRequestIds(
  requestIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (requestIds.length === 0) return result;
  const rows = await db.requestVote.groupBy({
    by: ["requestId"],
    where: { requestId: { in: requestIds } },
    _count: { _all: true },
  });
  for (const r of rows) result.set(r.requestId, r._count._all);
  return result;
}

export async function findUserVotedRequestIds(
  userId: string,
  requestIds: string[],
): Promise<Set<string>> {
  const result = new Set<string>();
  if (requestIds.length === 0) return result;
  const rows = await db.requestVote.findMany({
    where: { userId, requestId: { in: requestIds } },
    select: { requestId: true },
  });
  for (const r of rows) result.add(r.requestId);
  return result;
}

export async function findVote(
  requestId: string,
  userId: string,
): Promise<VoteRow | null> {
  return db.requestVote.findFirst({ where: { requestId, userId } });
}

/**
 * Insert a vote race-safely. Returns true when this call inserted a new vote,
 * false when the user already had a vote on this request. Relies on the
 * `request_votes_user_request_unique` unique index over (user_id, request_id).
 */
export async function insertVoteIfAbsent(
  requestId: string,
  userId: string,
): Promise<boolean> {
  const result = await db.requestVote.createMany({
    data: [{ requestId, userId }],
    skipDuplicates: true,
  });
  return result.count > 0;
}
