/**
 * Refinement Phase 6 — per-user study progress (reviewed / completed).
 */
import * as studyProgressRepo from "../repositories/studyProgress.repo";
import * as docsRepo from "../repositories/documents.repo";
import * as documentsService from "./documents.service";
import * as permissions from "./permissions.service";
import { badRequest, notFound } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";

const STATUSES = ["reviewing", "completed"] as const;

export async function setProgress(
  documentId: string,
  status: string,
  user: AuthenticatedUser,
): Promise<{ status: studyProgressRepo.ProgressStatus | null }> {
  // "none" clears progress; otherwise it must be a known status.
  if (status === "none") {
    await studyProgressRepo.clearProgress(user.id, documentId);
    return { status: null };
  }
  if (!(STATUSES as readonly string[]).includes(status)) {
    throw badRequest(`Unknown status. Allowed: ${STATUSES.join(", ")}, none`);
  }
  const doc = await docsRepo.findByIdAlive(documentId);
  if (!doc || !permissions.canView(doc, user)) throw notFound("Document not found");
  await studyProgressRepo.setProgress(
    user.id,
    documentId,
    status as studyProgressRepo.ProgressStatus,
  );
  return { status: status as studyProgressRepo.ProgressStatus };
}

/** "Continue studying" — documents the user is currently reviewing. */
export async function listInProgress(
  user: AuthenticatedUser,
  limit = 12,
): Promise<documentsService.DocumentDTO[]> {
  const ids = await studyProgressRepo.listInProgressDocumentIds(user.id, limit);
  if (ids.length === 0) return [];
  const docs = await docsRepo.findManyByIdsAlive(ids);
  const visible = docs.filter((d) => permissions.canView(d, user));
  const order = new Map(ids.map((id, i) => [id, i]));
  visible.sort(
    (a, b) =>
      (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
  return documentsService.assembleDocuments(visible, user);
}
