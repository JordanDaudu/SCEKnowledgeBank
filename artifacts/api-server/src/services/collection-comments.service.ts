/**
 * Phase 2 — flat comments on PUBLIC collections. Create / edit-own /
 * delete-own. A non-owner comment notifies the collection owner (the notify
 * bus self-skips when author === owner, so self-comments are silent).
 */
import * as collectionsRepo from "../repositories/collections.repo";
import * as commentsRepo from "../repositories/collection-comments.repo";
import * as notifications from "./notifications.service";
import * as permissions from "./permissions.service";
import { badRequest, forbidden, notFound } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";

export interface CollectionCommentDTO {
  id: string;
  collectionId: string;
  author: { id: string; displayName: string };
  body: string;
  createdAt: string;
  updatedAt: string;
  editable: boolean;
}

function isPublic(c: collectionsRepo.CollectionRow): boolean {
  return c.visibility === "public" || c.isOfficial;
}

/** Writable target: public/official AND not hidden (404 otherwise, any role). */
async function loadEngageable(
  id: string,
): Promise<collectionsRepo.CollectionRow> {
  const c = await collectionsRepo.findCollectionById(id);
  if (!c || !isPublic(c) || c.hiddenAt) throw notFound("Collection not found");
  return c;
}

/** Readable target: public/official; hidden ones are visible only to admins. */
async function loadViewable(
  id: string,
  user: AuthenticatedUser,
): Promise<collectionsRepo.CollectionRow> {
  const c = await collectionsRepo.findCollectionById(id);
  if (!c || !isPublic(c)) throw notFound("Collection not found");
  if (c.hiddenAt && !permissions.isAdmin(user)) throw notFound("Collection not found");
  return c;
}

function toDTO(
  row: commentsRepo.CommentRow,
  user: AuthenticatedUser,
): CollectionCommentDTO {
  return {
    id: row.id,
    collectionId: row.collectionId,
    author: {
      id: row.author.id,
      displayName: row.author.deletedAt ? "Original author removed" : row.author.displayName,
    },
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    editable: row.author.id === user.id,
  };
}

export async function listComments(
  id: string,
  user: AuthenticatedUser,
): Promise<CollectionCommentDTO[]> {
  await loadViewable(id, user);
  const rows = await commentsRepo.listComments(id);
  return rows.map((r) => toDTO(r, user));
}

export async function createComment(
  id: string,
  user: AuthenticatedUser,
  body: string,
): Promise<CollectionCommentDTO> {
  const trimmed = body?.trim();
  if (!trimmed) throw badRequest("Comment cannot be empty");
  const c = await loadEngageable(id);
  const row = await commentsRepo.createComment(id, user.id, trimmed);
  // notify() self-skips when actorId === recipientId (owner self-comment).
  await notifications.notify({
    recipientId: c.ownerId,
    actorId: user.id,
    type: "collection.comment",
    subjectType: "study_collection",
    subjectId: c.id,
    body: `${row.author.displayName} commented on "${c.title}"`,
    url: `/prep-hub/${c.id}`,
  });
  return toDTO(row, user);
}

export async function editComment(
  commentId: string,
  user: AuthenticatedUser,
  body: string,
): Promise<CollectionCommentDTO> {
  const trimmed = body?.trim();
  if (!trimmed) throw badRequest("Comment cannot be empty");
  const existing = await commentsRepo.findCommentById(commentId);
  if (!existing) throw notFound("Comment not found");
  if (existing.author.id !== user.id) throw forbidden("Not your comment");
  await commentsRepo.updateCommentBody(commentId, trimmed);
  const updated = await commentsRepo.findCommentById(commentId);
  return toDTO(updated!, user);
}

export async function deleteComment(
  commentId: string,
  user: AuthenticatedUser,
): Promise<void> {
  const existing = await commentsRepo.findCommentById(commentId);
  if (!existing) throw notFound("Comment not found");
  if (existing.author.id !== user.id) throw forbidden("Not your comment");
  await commentsRepo.softDeleteComment(commentId);
}
