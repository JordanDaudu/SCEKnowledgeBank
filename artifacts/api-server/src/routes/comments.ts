import { Router, type IRouter } from "express";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, comments, documents } from "@workspace/db";
import {
  CreateDocumentCommentBody,
  CreateDocumentCommentParams,
  DeleteCommentParams,
  ListDocumentCommentsParams,
} from "@workspace/api-zod";
import { requireAuth, isAdmin } from "../middlewares/auth";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { loadUserSummaries } from "../lib/mappers";
import { audit } from "../lib/audit";

async function assertDocumentReadable(
  documentId: string,
  userId: string,
  roles: string[],
): Promise<void> {
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
    .limit(1);
  const doc = rows[0];
  if (!doc) throw notFound("Document not found");
  if (doc.visibility === "private") {
    const allowed =
      doc.uploaderId === userId ||
      doc.ownerId === userId ||
      roles.includes("admin");
    if (!allowed) throw forbidden("Cannot access this document");
  }
}

const router: IRouter = Router();

interface CommentAuthor {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  isActive: boolean;
  createdAt: string;
}

interface CommentDTO {
  id: string;
  documentId: string;
  parentId?: string;
  body: string;
  pageNumber?: number;
  author: CommentAuthor;
  createdAt: string;
  replies: CommentDTO[];
}

router.get("/documents/:id/comments", requireAuth, async (req, res, next) => {
  try {
    const { id } = ListDocumentCommentsParams.parse(req.params);
    await assertDocumentReadable(id, req.authUser!.id, req.authUser!.roles);
    const rows = await db
      .select()
      .from(comments)
      .where(and(eq(comments.documentId, id), isNull(comments.deletedAt)))
      .orderBy(asc(comments.createdAt));
    const authors = await loadUserSummaries(rows.map((r) => r.authorId));
    const map = new Map<string, CommentDTO>();
    const roots: CommentDTO[] = [];
    for (const r of rows) {
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
      map.set(r.id, dto);
    }
    for (const r of rows) {
      const dto = map.get(r.id)!;
      if (r.parentId && map.has(r.parentId)) {
        map.get(r.parentId)!.replies.push(dto);
      } else {
        roots.push(dto);
      }
    }
    res.json(roots);
  } catch (err) {
    next(err);
  }
});

router.post("/documents/:id/comments", requireAuth, async (req, res, next) => {
  try {
    const { id } = CreateDocumentCommentParams.parse(req.params);
    await assertDocumentReadable(id, req.authUser!.id, req.authUser!.roles);
    const body = CreateDocumentCommentBody.parse(req.body);
    if (body.parentId) {
      const parent = await db
        .select()
        .from(comments)
        .where(and(eq(comments.id, body.parentId), isNull(comments.deletedAt)))
        .limit(1);
      if (!parent[0] || parent[0].documentId !== id) {
        throw badRequest("Invalid parent comment");
      }
      // Enforce single-level nesting: replies can only target a root comment.
      if (parent[0].parentId) {
        throw badRequest(
          "Replies are limited to one level deep; reply to the top-level comment instead.",
        );
      }
    }
    const insertValues: typeof comments.$inferInsert = {
      documentId: id,
      authorId: req.authUser!.id,
      body: body.body,
    };
    if (body.parentId) insertValues.parentId = body.parentId;
    if (body.pageNumber != null) insertValues.pageNumber = body.pageNumber;
    const inserted = await db
      .insert(comments)
      .values(insertValues)
      .returning();
    const c = inserted[0];
    const authors = await loadUserSummaries([c.authorId]);
    await audit(req.authUser!.id, "comment.create", "comment", c.id, {
      documentId: id,
    });
    const dto: CommentDTO = {
      id: c.id,
      documentId: c.documentId,
      body: c.body,
      author: authors.get(c.authorId) ?? {
        id: c.authorId,
        email: "",
        displayName: "Unknown",
        roles: [],
        isActive: false,
        createdAt: c.createdAt.toISOString(),
      },
      createdAt: c.createdAt.toISOString(),
      replies: [],
    };
    if (c.parentId) dto.parentId = c.parentId;
    if (c.pageNumber != null) dto.pageNumber = c.pageNumber;
    res.status(201).json(dto);
  } catch (err) {
    next(err);
  }
});

router.delete("/comments/:commentId", requireAuth, async (req, res, next) => {
  try {
    const { commentId } = DeleteCommentParams.parse(req.params);
    const found = await db
      .select()
      .from(comments)
      .where(and(eq(comments.id, commentId), isNull(comments.deletedAt)))
      .limit(1);
    const c = found[0];
    if (!c) throw notFound("Comment not found");
    if (c.authorId !== req.authUser!.id && !isAdmin(req.authUser)) {
      throw forbidden("Cannot delete this comment");
    }
    await db
      .update(comments)
      .set({ deletedAt: new Date() })
      .where(eq(comments.id, commentId));
    await audit(req.authUser!.id, "comment.delete", "comment", commentId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
