import { db } from "@workspace/db";

export interface AiSuggestionRow {
  id: string;
  documentId: string;
  summary: string;
  suggestedTagIds: string[];
  status: string; // pending | accepted | dismissed | failed
  error: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

/** Minimal document context for permission checks + generation. */
export interface DocContextRow {
  id: string;
  title: string;
  description: string;
  uploaderId: string;
  ownerId: string;
  visibility: string;
  courseId: string | null;
  status: string;
  courseTitle: string | null;
  /** From the latest DocumentFile version. */
  extractedText: string | null;
  language: string | null;
}

export async function findDocContext(
  documentId: string,
): Promise<DocContextRow | null> {
  const doc = await db.document.findFirst({
    where: { id: documentId, deletedAt: null },
    select: {
      id: true,
      title: true,
      description: true,
      uploaderId: true,
      ownerId: true,
      visibility: true,
      courseId: true,
      status: true,
      course: { select: { title: true } },
      files: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { extractedText: true, language: true },
      },
    },
  });
  if (!doc) return null;
  const file = doc.files[0];
  return {
    id: doc.id,
    title: doc.title,
    description: doc.description,
    uploaderId: doc.uploaderId,
    ownerId: doc.ownerId,
    visibility: doc.visibility,
    courseId: doc.courseId,
    status: doc.status,
    courseTitle: doc.course?.title ?? null,
    extractedText: file?.extractedText ?? null,
    language: file?.language ?? null,
  };
}

export async function listTagCatalog(): Promise<
  Array<{ id: string; name: string }>
> {
  return db.tag.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function findByDocument(
  documentId: string,
): Promise<AiSuggestionRow | null> {
  return db.documentAiSuggestion.findUnique({ where: { documentId } });
}

/** Regeneration overwrites the single per-document row in place. */
export async function upsertForDocument(values: {
  documentId: string;
  summary: string;
  suggestedTagIds: string[];
  status: "pending" | "failed";
  error?: string | null;
}): Promise<AiSuggestionRow> {
  const data = {
    summary: values.summary,
    suggestedTagIds: values.suggestedTagIds,
    status: values.status,
    error: values.error ?? null,
    createdAt: new Date(),
    resolvedAt: null,
  };
  return db.documentAiSuggestion.upsert({
    where: { documentId: values.documentId },
    create: { documentId: values.documentId, ...data },
    update: data,
  });
}

/**
 * Apply an acceptance atomically: optionally copy the summary onto the
 * document, attach the chosen tags (duplicates ignored), and resolve
 * the suggestion row.
 */
export async function applyAcceptance(args: {
  documentId: string;
  summary: string | null; // null = summary not accepted
  tagIds: string[];
}): Promise<AiSuggestionRow> {
  return db.$transaction(async (tx) => {
    if (args.summary !== null) {
      await tx.document.update({
        where: { id: args.documentId },
        data: { aiSummary: args.summary },
      });
    }
    if (args.tagIds.length > 0) {
      await tx.documentTag.createMany({
        data: args.tagIds.map((tagId) => ({
          documentId: args.documentId,
          tagId,
        })),
        skipDuplicates: true,
      });
    }
    return tx.documentAiSuggestion.update({
      where: { documentId: args.documentId },
      data: { status: "accepted", resolvedAt: new Date() },
    });
  });
}

export async function markDismissed(
  documentId: string,
): Promise<AiSuggestionRow> {
  return db.documentAiSuggestion.update({
    where: { documentId },
    data: { status: "dismissed", resolvedAt: new Date() },
  });
}
