import { Router, type IRouter } from "express";
import {
  CreateDocumentCommentBody,
  CreateDocumentCommentParams,
  DeleteCommentParams,
  ListDocumentCommentsParams,
  UpdateCommentBody,
  UpdateCommentParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import * as commentsService from "../services/comments.service";

const router: IRouter = Router();

router.get("/documents/:id/comments", requireAuth, async (req, res, next) => {
  try {
    const { id } = ListDocumentCommentsParams.parse(req.params);
    const tree = await commentsService.listForDocument(id, req.authUser!);
    res.json(tree);
  } catch (err) {
    next(err);
  }
});

router.post("/documents/:id/comments", requireAuth, async (req, res, next) => {
  try {
    const { id } = CreateDocumentCommentParams.parse(req.params);
    const body = CreateDocumentCommentBody.parse(req.body);
    const dto = await commentsService.createForDocument(
      id,
      body,
      req.authUser!,
    );
    res.status(201).json(dto);
  } catch (err) {
    next(err);
  }
});

router.patch("/comments/:commentId", requireAuth, async (req, res, next) => {
  try {
    const { commentId } = UpdateCommentParams.parse(req.params);
    const body = UpdateCommentBody.parse(req.body);
    const dto = await commentsService.updateComment(
      commentId,
      body,
      req.authUser!,
    );
    res.json(dto);
  } catch (err) {
    next(err);
  }
});

router.delete("/comments/:commentId", requireAuth, async (req, res, next) => {
  try {
    const { commentId } = DeleteCommentParams.parse(req.params);
    await commentsService.deleteComment(commentId, req.authUser!);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
