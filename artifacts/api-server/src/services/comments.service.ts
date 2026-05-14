import * as commentsRepo from "../repositories/comments.repo";
import * as docsRepo from "../repositories/documents.repo";
import * as usersService from "./users.service";
import * as auditService from "./audit.service";
import { badRequest, forbidden, notFound } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";

export interface CommentAuthorDTO {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  isActive: boolean;
  createdAt: string;
}

export interface CommentDTO {
  id: string;
  documentId: string;
  parentId?: string;
  body: string;
  pageNumber?: number;
  author: CommentAuthorDTO;
  createdAt: string;
  replies: CommentDTO[];
}

async function assertDocumentReadable(
  documentId: string,
  user: AuthenticatedUser,
): Promise<void> {
  const doc = await docsRepo.findByIdAlive(documentId);
  if (!doc) throw notFound("Document not found");
  if (doc.visibility === "private") {
    const allowed =
      doc.uploaderId === user.id ||
      doc.ownerId === user.id ||
      user.roles.includes("admin");
    if (!allowed) throw forbidden("Cannot access this document");
  }
}

function toDTO(
  r: commentsRepo.CommentRow,
  authors: Map<string, usersService.UserSummaryDTO>,
): CommentDTO {
  const dto: CommentDTO = {
    id: r.id,
    documentId: r.documentId,
    body: r.body,
    author: authors.get(r.authorId) ?? {
      id: r.authorId,
      email: "",
      displayName: "Unknown",
      roles: [],
      isActive: false,
      createdAt: r.createdAt.toISOString(),
    },
    createdAt: r.createdAt.toISOString(),
    replies: [],
  };
  if (r.parentId) dto.parentId = r.parentId;
  if (r.pageNumber != null) dto.pageNumber = r.pageNumber;
  return dto;
}

export async function listForDocument(
  documentId: string,
  user: AuthenticatedUser,
): Promise<CommentDTO[]> {
  await assertDocumentReadable(documentId, user);
  const rows = await commentsRepo.listAliveByDocument(documentId);
  const authors = await usersService.loadUserSummaries(
    rows.map((r) => r.authorId),
  );
  const map = new Map<string, CommentDTO>();
  const roots: CommentDTO[] = [];
  for (const r of rows) map.set(r.id, toDTO(r, authors));
  for (const r of rows) {
    const dto = map.get(r.id)!;
    if (r.parentId && map.has(r.parentId)) {
      map.get(r.parentId)!.replies.push(dto);
    } else {
      roots.push(dto);
    }
  }
  return roots;
}

export async function createForDocument(
  documentId: string,
  body: { body: string; parentId?: string; pageNumber?: number },
  user: AuthenticatedUser,
): Promise<CommentDTO> {
  await assertDocumentReadable(documentId, user);
  if (body.parentId) {
    const parent = await commentsRepo.findAliveById(body.parentId);
    if (!parent || parent.documentId !== documentId) {
      throw badRequest("Invalid parent comment");
    }
    if (parent.parentId) {
      throw badRequest(
        "Replies are limited to one level deep; reply to the top-level comment instead.",
      );
    }
  }
  const insertValues: commentsRepo.CommentInsert = {
    documentId,
    authorId: user.id,
    body: body.body,
  };
  if (body.parentId) insertValues.parentId = body.parentId;
  if (body.pageNumber != null) insertValues.pageNumber = body.pageNumber;
  const c = await commentsRepo.insertComment(insertValues);
  const authors = await usersService.loadUserSummaries([c.authorId]);
  await auditService.record(user.id, "comment.create", "comment", c.id, {
    documentId,
  });
  return toDTO(c, authors);
}

export async function deleteComment(
  commentId: string,
  user: AuthenticatedUser,
): Promise<void> {
  const c = await commentsRepo.findAliveById(commentId);
  if (!c) throw notFound("Comment not found");
  if (c.authorId !== user.id && !user.roles.includes("admin")) {
    throw forbidden("Cannot delete this comment");
  }
  await commentsRepo.softDeleteById(commentId);
  await auditService.record(user.id, "comment.delete", "comment", commentId);
}
