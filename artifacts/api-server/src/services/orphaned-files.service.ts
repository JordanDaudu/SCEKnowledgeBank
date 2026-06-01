import * as docsRepo from "../repositories/documents.repo";
import * as usersRepo from "../repositories/users.repo";
import * as auditService from "./audit.service";
import { notFound } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";

export interface OrphanedFileDTO {
  id: string;
  title: string;
  materialType: string;
  courseCode: string | null;
  createdAt: string;
}

export async function listOrphanedFiles(): Promise<OrphanedFileDTO[]> {
  const rows = await docsRepo.listByDeletedUploaders(200);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    materialType: r.materialType,
    courseCode: r.courseCode,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function reassignDocument(
  admin: AuthenticatedUser,
  documentId: string,
  newOwnerId: string,
): Promise<void> {
  const doc = await docsRepo.findByIdAlive(documentId);
  if (!doc) throw notFound("Document not found");
  const target = await usersRepo.findById(newOwnerId); // active (deletedAt:null) only
  if (!target) throw notFound("Target user not found");
  await docsRepo.updateDocumentById(documentId, { uploaderId: newOwnerId, ownerId: newOwnerId });
  await auditService.record(admin.id, "document.reassign", "document", documentId, {
    from: doc.uploaderId,
    to: newOwnerId,
  });
}
