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
