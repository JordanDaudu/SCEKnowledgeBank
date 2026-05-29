import * as reactionsRepo from "../repositories/reactions.repo";
import * as commentsRepo from "../repositories/comments.repo";
import * as docsRepo from "../repositories/documents.repo";
import * as notificationsService from "./notifications.service";
import * as permissions from "./permissions.service";
import * as auditService from "./audit.service";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { logger } from "../lib/logger";
import type { AuthenticatedUser } from "../middlewares/auth";

/**
 * Fixed allow-list of reaction kinds (Sprint-3 M6, "out of scope:
 * custom reaction sets / emoji upload"). Anything outside this set is
 * rejected with 400.
 */
export const REACTION_KINDS = [
  "like",
  "love",
  "insightful",
  "celebrate",
  "thanks",
  "question",
] as const;

export type ReactionKind = (typeof REACTION_KINDS)[number];

function assertKind(kind: string): ReactionKind {
  if (!(REACTION_KINDS as readonly string[]).includes(kind)) {
    throw badRequest(
      `Unknown reaction kind. Allowed: ${REACTION_KINDS.join(", ")}`,
    );
  }
  return kind as ReactionKind;
}

async function loadCommentForReact(
  commentId: string,
  user: AuthenticatedUser,
) {
  const c = await commentsRepo.findAliveById(commentId);
  if (!c) throw notFound("Comment not found");
  const doc = await docsRepo.findByIdAlive(c.documentId);
  // canComment governs read-access to the underlying document; if the
  // user can comment on the doc they may also react to its comments.
  if (!doc || !permissions.canComment(doc, user)) {
    throw forbidden("Cannot react to this comment");
  }
  return c;
}

async function summaryFor(
  commentId: string,
  user: AuthenticatedUser,
): Promise<reactionsRepo.ReactionSummary[]> {
  const map = await reactionsRepo.summariseByCommentIds([commentId], user.id);
  return map.get(commentId) ?? [];
}

export async function addReaction(
  commentId: string,
  kind: string,
  user: AuthenticatedUser,
): Promise<reactionsRepo.ReactionSummary[]> {
  const validKind = assertKind(kind);
  const comment = await loadCommentForReact(commentId, user);
  const inserted = await reactionsRepo.insertIfAbsent(
    commentId,
    user.id,
    validKind,
  );
  if (inserted) {
    // Audit only on an actual insert (no duplicate events for re-reacts).
    await auditService.record(user.id, "comment.reaction", "comment", commentId, {
      kind: validKind,
    });
  }
  if (inserted && comment.authorId !== user.id) {
    // Producer hook (M1 bus). Fire-and-forget; notify swallows its own
    // errors but we still wrap to defend against sync throws.
    void Promise.resolve()
      .then(() =>
        notificationsService.notify({
          recipientId: comment.authorId,
          actorId: user.id,
          type: "comment.reaction",
          subjectType: "comment",
          subjectId: commentId,
          body: validKind,
          url: `/documents/${comment.documentId}#comment-${commentId}`,
        }),
      )
      .catch((err) => logger.warn({ err }, "comment.reaction notify threw"));
  }
  return summaryFor(commentId, user);
}

export async function removeReaction(
  commentId: string,
  kind: string,
  user: AuthenticatedUser,
): Promise<reactionsRepo.ReactionSummary[]> {
  const validKind = assertKind(kind);
  await loadCommentForReact(commentId, user);
  await reactionsRepo.deleteOne(commentId, user.id, validKind);
  return summaryFor(commentId, user);
}
