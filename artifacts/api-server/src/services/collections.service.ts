/**
 * Refinement Phase 6 — study collections (Prep Hub).
 *
 * Collections are user-owned ordered groupings of EXISTING documents. This
 * service owns ownership enforcement, document-visibility checks on add, and
 * DTO assembly (reusing documentsService so item cards match the rest of the
 * app). Items reference documents by id only — nothing is duplicated.
 */
import * as collectionsRepo from "../repositories/collections.repo";
import * as studyProgressRepo from "../repositories/studyProgress.repo";
import * as docsRepo from "../repositories/documents.repo";
import * as documentsService from "./documents.service";
import * as permissions from "./permissions.service";
import { badRequest, forbidden, notFound } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";

const COLLECTION_KINDS = [
  "collection",
  "exam_prep",
  "revision",
  "semester",
] as const;

export interface CollectionSummaryDTO {
  id: string;
  title: string;
  description: string;
  kind: string;
  visibility: string;
  examDate?: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionItemDTO {
  document: documentsService.DocumentDTO;
  note?: string;
  position: number;
  progress?: studyProgressRepo.ProgressStatus;
}

export interface CollectionDetailDTO extends CollectionSummaryDTO {
  items: CollectionItemDTO[];
}

function toSummary(
  c: collectionsRepo.CollectionRow & { itemCount: number },
): CollectionSummaryDTO {
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    kind: c.kind,
    visibility: c.visibility,
    examDate: c.examDate?.toISOString(),
    itemCount: c.itemCount,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** Load a collection the user is allowed to MANAGE (owner only). */
async function loadOwned(
  id: string,
  user: AuthenticatedUser,
): Promise<collectionsRepo.CollectionRow> {
  const c = await collectionsRepo.findCollectionById(id);
  if (!c) throw notFound("Collection not found");
  if (c.ownerId !== user.id) throw forbidden("Not your collection");
  return c;
}

export async function createCollection(
  user: AuthenticatedUser,
  input: {
    title: string;
    description?: string;
    kind?: string;
    courseId?: string | null;
    examDate?: Date | null;
  },
): Promise<CollectionSummaryDTO> {
  const title = input.title?.trim();
  if (!title) throw badRequest("Title is required");
  if (input.kind && !(COLLECTION_KINDS as readonly string[]).includes(input.kind)) {
    throw badRequest(`Unknown kind. Allowed: ${COLLECTION_KINDS.join(", ")}`);
  }
  const created = await collectionsRepo.createCollection({
    ownerId: user.id,
    title,
    description: input.description?.trim() ?? "",
    kind: input.kind ?? "collection",
    courseId: input.courseId ?? null,
    examDate: input.examDate ?? null,
  });
  return toSummary({ ...created, itemCount: 0 });
}

export async function listMyCollections(
  user: AuthenticatedUser,
): Promise<CollectionSummaryDTO[]> {
  const rows = await collectionsRepo.listCollectionsForOwner(user.id);
  return rows.map(toSummary);
}

export async function getCollection(
  id: string,
  user: AuthenticatedUser,
): Promise<CollectionDetailDTO> {
  const c = await loadOwned(id, user);
  const itemRows = await collectionsRepo.listItems(id);
  const docIds = itemRows.map((i) => i.documentId);
  const docs = await docsRepo.findManyByIdsAlive(docIds);
  // Only surface documents the user can still see (access may have changed
  // since the item was added). Item order is preserved from itemRows.
  const visible = docs.filter((d) => permissions.canView(d, user));
  const dtos = await documentsService.assembleDocuments(visible, user);
  const dtoById = new Map(dtos.map((d) => [d.id, d]));
  const progress = await studyProgressRepo.getProgressForDocuments(
    user.id,
    docIds,
  );
  const items: CollectionItemDTO[] = itemRows
    .filter((i) => dtoById.has(i.documentId))
    .map((i) => ({
      document: dtoById.get(i.documentId)!,
      note: i.note ?? undefined,
      position: i.position,
      progress: progress.get(i.documentId),
    }));
  return { ...toSummary({ ...c, itemCount: items.length }), items };
}

export async function updateCollection(
  id: string,
  user: AuthenticatedUser,
  patch: { title?: string; description?: string; kind?: string; examDate?: Date | null },
): Promise<void> {
  await loadOwned(id, user);
  const data: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const t = patch.title.trim();
    if (!t) throw badRequest("Title cannot be empty");
    data.title = t;
  }
  if (patch.description !== undefined) data.description = patch.description.trim();
  if (patch.kind !== undefined) {
    if (!(COLLECTION_KINDS as readonly string[]).includes(patch.kind)) {
      throw badRequest(`Unknown kind. Allowed: ${COLLECTION_KINDS.join(", ")}`);
    }
    data.kind = patch.kind;
  }
  if (patch.examDate !== undefined) data.examDate = patch.examDate;
  await collectionsRepo.updateCollection(id, data);
}

export async function deleteCollection(
  id: string,
  user: AuthenticatedUser,
): Promise<void> {
  await loadOwned(id, user);
  await collectionsRepo.softDeleteCollection(id);
}

export async function addDocument(
  id: string,
  user: AuthenticatedUser,
  documentId: string,
  note?: string,
): Promise<void> {
  await loadOwned(id, user);
  // The document must exist and be visible to the user — you can't stash a
  // document you can't see.
  const doc = await docsRepo.findByIdAlive(documentId);
  if (!doc || !permissions.canView(doc, user)) {
    throw notFound("Document not found");
  }
  await collectionsRepo.addItem(id, documentId, note?.trim() || undefined);
}

export async function removeDocument(
  id: string,
  user: AuthenticatedUser,
  documentId: string,
): Promise<void> {
  await loadOwned(id, user);
  await collectionsRepo.removeItem(id, documentId);
}

export async function setItemNote(
  id: string,
  user: AuthenticatedUser,
  documentId: string,
  note: string | null,
): Promise<void> {
  await loadOwned(id, user);
  await collectionsRepo.updateItemNote(id, documentId, note?.trim() || null);
}

export async function reorder(
  id: string,
  user: AuthenticatedUser,
  orderedDocumentIds: string[],
): Promise<void> {
  await loadOwned(id, user);
  await collectionsRepo.reorderItems(id, orderedDocumentIds);
}
