import { db } from "@workspace/db";

export interface CollectionRow {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  kind: string;
  isOfficial: boolean;
  courseId: string | null;
  visibility: string;
  examDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CollectionItemRow {
  id: string;
  collectionId: string;
  documentId: string;
  position: number;
  note: string | null;
  createdAt: Date;
}

export interface CreateCollectionInput {
  ownerId: string;
  title: string;
  description?: string;
  kind?: string;
  courseId?: string | null;
  visibility?: string;
  examDate?: Date | null;
}

export async function createCollection(
  input: CreateCollectionInput,
): Promise<CollectionRow> {
  return db.studyCollection.create({
    data: {
      ownerId: input.ownerId,
      title: input.title,
      description: input.description ?? "",
      kind: input.kind ?? "collection",
      courseId: input.courseId ?? null,
      visibility: input.visibility ?? "private",
      examDate: input.examDate ?? null,
    },
  });
}

export async function listCollectionsForOwner(
  ownerId: string,
): Promise<Array<CollectionRow & { itemCount: number }>> {
  const rows = await db.studyCollection.findMany({
    where: { ownerId, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { items: true } } },
  });
  return rows.map(({ _count, ...r }) => ({ ...r, itemCount: _count.items }));
}

export async function findCollectionById(
  id: string,
): Promise<CollectionRow | null> {
  return db.studyCollection.findFirst({ where: { id, deletedAt: null } });
}

export async function updateCollection(
  id: string,
  patch: Partial<Pick<CollectionRow, "title" | "description" | "kind" | "visibility" | "courseId" | "examDate">>,
): Promise<void> {
  await db.studyCollection.update({
    where: { id },
    data: { ...patch, updatedAt: new Date() },
  });
}

export async function softDeleteCollection(id: string): Promise<void> {
  await db.studyCollection.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

export async function listItems(
  collectionId: string,
): Promise<CollectionItemRow[]> {
  return db.studyCollectionItem.findMany({
    where: { collectionId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}

/** Append a document to a collection at the next position. Idempotent on the
 *  (collection, document) unique key — a re-add is a no-op returning false. */
export async function addItem(
  collectionId: string,
  documentId: string,
  note?: string,
): Promise<boolean> {
  const agg = await db.studyCollectionItem.aggregate({
    where: { collectionId },
    _max: { position: true },
  });
  const nextPos = (agg._max.position ?? -1) + 1;
  const r = await db.studyCollectionItem.createMany({
    data: [{ collectionId, documentId, position: nextPos, note: note ?? null }],
    skipDuplicates: true,
  });
  if (r.count > 0) await touch(collectionId);
  return r.count > 0;
}

export async function removeItem(
  collectionId: string,
  documentId: string,
): Promise<boolean> {
  const r = await db.studyCollectionItem.deleteMany({
    where: { collectionId, documentId },
  });
  if (r.count > 0) await touch(collectionId);
  return r.count > 0;
}

export async function updateItemNote(
  collectionId: string,
  documentId: string,
  note: string | null,
): Promise<void> {
  await db.studyCollectionItem.updateMany({
    where: { collectionId, documentId },
    data: { note },
  });
}

/** Set explicit positions from an ordered list of document ids. Documents not
 *  in `orderedDocumentIds` keep their existing position (sorted after). */
export async function reorderItems(
  collectionId: string,
  orderedDocumentIds: string[],
): Promise<void> {
  await db.$transaction(
    orderedDocumentIds.map((documentId, index) =>
      db.studyCollectionItem.updateMany({
        where: { collectionId, documentId },
        data: { position: index },
      }),
    ),
  );
  await touch(collectionId);
}

async function touch(collectionId: string): Promise<void> {
  await db.studyCollection.update({
    where: { id: collectionId },
    data: { updatedAt: new Date() },
  });
}
