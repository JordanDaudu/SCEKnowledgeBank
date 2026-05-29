import { db } from "@workspace/db";

export type ProgressStatus = "reviewing" | "completed";

/** Upsert the viewer's progress on a document. */
export async function setProgress(
  userId: string,
  documentId: string,
  status: ProgressStatus,
): Promise<void> {
  await db.studyProgress.upsert({
    where: { userId_documentId: { userId, documentId } },
    create: { userId, documentId, status },
    update: { status, updatedAt: new Date() },
  });
}

/** Clear progress (e.g. "mark not started"). */
export async function clearProgress(
  userId: string,
  documentId: string,
): Promise<void> {
  await db.studyProgress.deleteMany({ where: { userId, documentId } });
}

/** Map of documentId → status for the given documents and user. */
export async function getProgressForDocuments(
  userId: string,
  documentIds: string[],
): Promise<Map<string, ProgressStatus>> {
  const map = new Map<string, ProgressStatus>();
  if (documentIds.length === 0) return map;
  const rows = await db.studyProgress.findMany({
    where: { userId, documentId: { in: documentIds } },
    select: { documentId: true, status: true },
  });
  for (const r of rows) map.set(r.documentId, r.status as ProgressStatus);
  return map;
}

/** Document ids the user is currently "reviewing" (for Continue studying),
 *  most-recently-updated first. */
export async function listInProgressDocumentIds(
  userId: string,
  limit = 12,
): Promise<string[]> {
  const rows = await db.studyProgress.findMany({
    where: { userId, status: "reviewing" },
    orderBy: { updatedAt: "desc" },
    select: { documentId: true },
    take: limit,
  });
  return rows.map((r) => r.documentId);
}
