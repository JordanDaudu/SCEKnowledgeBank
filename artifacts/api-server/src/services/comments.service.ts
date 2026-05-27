import * as commentsRepo from "../repositories/comments.repo";
import * as reactionsRepo from "../repositories/reactions.repo";
import * as docsRepo from "../repositories/documents.repo";
import * as usersRepo from "../repositories/users.repo";
import * as usersService from "./users.service";
import * as auditService from "./audit.service";
import * as notificationsService from "./notifications.service";
import * as favoritesService from "./favorites.service";
import * as permissions from "./permissions.service";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { logger } from "../lib/logger";
import type { AuthenticatedUser } from "../middlewares/auth";

export interface CommentAuthorDTO {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  isActive: boolean;
  createdAt: string;
}

export interface CommentReactionDTO {
  kind: string;
  count: number;
  viewerReacted: boolean;
}

export interface CommentDTO {
  id: string;
  documentId: string;
  parentId?: string;
  body: string;
  pageNumber?: number;
  author: CommentAuthorDTO;
  createdAt: string;
  editedAt?: string;
  replies: CommentDTO[];
  mentions: usersService.UserSummaryDTO[];
  reactions: CommentReactionDTO[];
}

async function loadReadableDocument(
  documentId: string,
  user: AuthenticatedUser,
): Promise<docsRepo.DocumentRow> {
  const doc = await docsRepo.findByIdAlive(documentId);
  if (!doc) throw notFound("Document not found");
  if (!permissions.canComment(doc, user))
    throw forbidden("Cannot access this document");
  return doc;
}

function toDTO(
  r: commentsRepo.CommentRow,
  authors: Map<string, usersService.UserSummaryDTO>,
  mentionsByComment: Map<string, string[]>,
  reactionsByComment: Map<string, reactionsRepo.ReactionSummary[]>,
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
    mentions: (mentionsByComment.get(r.id) ?? [])
      .map((uid) => authors.get(uid))
      .filter((u): u is usersService.UserSummaryDTO => !!u),
    reactions: reactionsByComment.get(r.id) ?? [],
  };
  if (r.parentId) dto.parentId = r.parentId;
  if (r.pageNumber != null) dto.pageNumber = r.pageNumber;
  if (r.updatedAt && r.updatedAt.getTime() > r.createdAt.getTime()) {
    dto.editedAt = r.updatedAt.toISOString();
  }
  return dto;
}

// ─── @mention parsing ────────────────────────────────────────────────
//
// Two accepted token shapes in the comment body:
//   1. `@displayName`   — letters/digits/_./- after the @ until
//                         whitespace or end-of-string. Matched
//                         case-insensitively against User.displayName.
//   2. `@[uuid]`        — explicit user-id reference; useful when the
//                         picker has already resolved a target.
// Tokens that don't resolve to an active user are dropped silently;
// they remain plain text in the body but produce no row.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ParsedMentionTokens {
  displayNames: string[];
  userIds: string[];
}

export function parseMentionTokens(body: string): ParsedMentionTokens {
  const displayNames = new Set<string>();
  const userIds = new Set<string>();
  // `@[uuid]` first so the surrounding brackets aren't matched by the
  // looser displayName regex below.
  const idRe = /@\[([0-9a-f-]{36})\]/gi;
  let m: RegExpExecArray | null;
  while ((m = idRe.exec(body)) !== null) {
    if (UUID_RE.test(m[1]!)) userIds.add(m[1]!.toLowerCase());
  }
  const nameRe = /(?<![A-Za-z0-9_])@([A-Za-z0-9_][A-Za-z0-9_.\-]{0,63})/g;
  while ((m = nameRe.exec(body)) !== null) {
    const tok = m[1]!;
    // Skip if this captured the start of an @[uuid] token — those are
    // handled above and we don't want to also resolve `[uuid` as a
    // display name.
    if (tok.startsWith("[")) continue;
    displayNames.add(tok);
  }
  return {
    displayNames: Array.from(displayNames),
    userIds: Array.from(userIds),
  };
}

async function resolveMentionUserIds(body: string): Promise<string[]> {
  const { displayNames, userIds } = parseMentionTokens(body);
  const resolved = new Set<string>();
  if (displayNames.length > 0) {
    const matches = await usersRepo.findActiveByDisplayNames(displayNames);
    for (const u of matches) resolved.add(u.id);
  }
  if (userIds.length > 0) {
    const matches = await usersRepo.findActiveByIds(userIds);
    for (const u of matches) resolved.add(u.id);
  }
  return Array.from(resolved);
}

export async function listForDocument(
  documentId: string,
  user: AuthenticatedUser,
): Promise<CommentDTO[]> {
  await loadReadableDocument(documentId, user);
  const rows = await commentsRepo.listAliveByDocument(documentId);
  const ids = rows.map((r) => r.id);
  const [mentionsByComment, reactionsByComment] = await Promise.all([
    commentsRepo.listMentionsByCommentIds(ids),
    reactionsRepo.summariseByCommentIds(ids, user.id),
  ]);
  // Authors map needs to cover both comment authors and everyone the
  // comments mention so the DTO's `mentions[]` can hydrate to full
  // UserSummary objects in a single query.
  const userIds = new Set<string>();
  for (const r of rows) userIds.add(r.authorId);
  for (const list of mentionsByComment.values())
    for (const id of list) userIds.add(id);
  const authors = await usersService.loadUserSummaries(Array.from(userIds));

  const map = new Map<string, CommentDTO>();
  const roots: CommentDTO[] = [];
  for (const r of rows)
    map.set(r.id, toDTO(r, authors, mentionsByComment, reactionsByComment));
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
  await loadReadableDocument(documentId, user);
  // Replies of any depth are allowed (task #29 dropped the previous
  // one-level cap); we still validate that the parent exists and
  // belongs to the same document.
  let parentComment: Awaited<ReturnType<typeof commentsRepo.findAliveById>> | null = null;
  if (body.parentId) {
    parentComment = await commentsRepo.findAliveById(body.parentId);
    if (!parentComment || parentComment.documentId !== documentId) {
      throw badRequest("Invalid parent comment");
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

  const mentionUserIds = await resolveMentionUserIds(body.body);
  await commentsRepo.insertMentions(c.id, mentionUserIds);

  const allUserIds = new Set<string>([c.authorId, ...mentionUserIds]);
  const authors = await usersService.loadUserSummaries(Array.from(allUserIds));
  const mentionsByComment = new Map<string, string[]>([
    [c.id, mentionUserIds],
  ]);
  // A brand-new comment has no reactions yet; an empty map keeps toDTO
  // happy without an extra query.
  const reactionsByComment = new Map<
    string,
    reactionsRepo.ReactionSummary[]
  >();
  await auditService.record(user.id, "comment.create", "comment", c.id, {
    documentId,
    mentionCount: mentionUserIds.length,
  });

  // Producer hooks (Sprint-3 M1). Fire-and-forget: notifications must
  // never fail the comment write. The service-level helper already
  // swallows errors and respects FEATURE_NOTIFICATIONS / no-self-notify,
  // so the only thing we still defend against here is an unexpected
  // synchronous throw.
  const deepLink = `/documents/${documentId}#comment-${c.id}`;
  // Wrap notify() so both async rejections AND synchronous throws are
  // swallowed — `Promise.resolve().then(...)` turns any sync throw
  // inside the callback into a rejection that .catch can absorb.
  const fireAndForget = (
    args: Parameters<typeof notificationsService.notify>[0],
    label: string,
  ) => {
    void Promise.resolve()
      .then(() => notificationsService.notify(args))
      .catch((err) => logger.warn({ err }, `${label} notify threw`));
  };
  // Dedup precedence: when the parent author also appears in the
  // mention list, the reply notification supersedes the mention so
  // the recipient sees exactly one row for this comment (matches the
  // per-(recipient, subject) unique key in the DB). Reply wins
  // because it's the stronger signal — a direct response to the
  // recipient's own content.
  const replyRecipient =
    parentComment && parentComment.authorId !== user.id
      ? parentComment.authorId
      : null;
  const notified = new Set<string>();
  if (replyRecipient) notified.add(replyRecipient);
  for (const mentionedId of mentionUserIds) {
    if (notified.has(mentionedId)) continue;
    notified.add(mentionedId);
    fireAndForget(
      {
        recipientId: mentionedId,
        actorId: user.id,
        type: "comment.mention",
        subjectType: "comment",
        subjectId: c.id,
        body: body.body.slice(0, 280),
        url: deepLink,
      },
      "comment.mention",
    );
  }
  if (replyRecipient) {
    fireAndForget(
      {
        recipientId: replyRecipient,
        actorId: user.id,
        type: "comment.reply",
        subjectType: "comment",
        subjectId: c.id,
        body: body.body.slice(0, 280),
        url: deepLink,
      },
      "comment.reply",
    );
  }

  // Sprint-3 M6: fan out a `document.activity` ping to everyone who
  // has favorited this doc — minus the actor, the reply recipient,
  // and anyone we already notified via @mention. Order matters: the
  // dedup `notified` set already holds those stronger signals, so a
  // favoriter who is also mentioned only gets the mention.
  const favoriteRecipients =
    await favoritesService.recipientsForDocumentActivity(
      documentId,
      [user.id, ...(replyRecipient ? [replyRecipient] : []), ...mentionUserIds],
    );
  for (const recipientId of favoriteRecipients) {
    if (notified.has(recipientId)) continue;
    notified.add(recipientId);
    fireAndForget(
      {
        recipientId,
        actorId: user.id,
        type: "document.activity",
        // Subject is the *comment*, not the document — the notification
        // store enforces uniqueness on (recipient, type, subject) and
        // collapsing every new comment under the same documentId would
        // suppress all but the first activity ping per follower per
        // document.
        subjectType: "comment",
        subjectId: c.id,
        body: body.body.slice(0, 280),
        url: deepLink,
      },
      "document.activity",
    );
  }

  return toDTO(c, authors, mentionsByComment, reactionsByComment);
}

export async function updateComment(
  commentId: string,
  body: { body?: string; pageNumber?: number | null },
  user: AuthenticatedUser,
): Promise<CommentDTO> {
  const c = await commentsRepo.findAliveById(commentId);
  if (!c) throw notFound("Comment not found");
  // Only the author may edit a comment (see permissions.canEditComment).
  // Moderation lets lecturers/admins remove a comment but not rewrite it.
  if (!permissions.canEditComment(c, user)) {
    throw forbidden("Cannot edit this comment");
  }
  if (body.body === undefined && body.pageNumber === undefined) {
    throw badRequest("No changes provided");
  }
  const patch: commentsRepo.CommentUpdate = {};
  if (body.body !== undefined) patch.body = body.body;
  if (body.pageNumber !== undefined) patch.pageNumber = body.pageNumber;
  const updated = await commentsRepo.updateById(commentId, patch);

  // Re-parse mentions when the body changes (Sprint-2 audit fix):
  // an edit can both introduce new @mentions and remove old ones, so
  // we wipe the existing rows for this comment and re-insert based on
  // the new body. Body-untouched edits (e.g. just a pageNumber tweak)
  // leave mentions alone. Unresolved tokens still degrade silently —
  // same semantics as create.
  if (body.body !== undefined) {
    const newMentionIds = await resolveMentionUserIds(body.body);
    await commentsRepo.deleteMentionsByCommentId(commentId);
    await commentsRepo.insertMentions(commentId, newMentionIds);
  }
  const mentionsByComment = await commentsRepo.listMentionsByCommentIds([
    commentId,
  ]);
  const userIds = new Set<string>([updated.authorId]);
  for (const id of mentionsByComment.get(commentId) ?? []) userIds.add(id);
  const authors = await usersService.loadUserSummaries(Array.from(userIds));
  const reactionsByComment = await reactionsRepo.summariseByCommentIds(
    [commentId],
    user.id,
  );
  await auditService.record(user.id, "comment.update", "comment", commentId, {
    documentId: updated.documentId,
  });
  return toDTO(updated, authors, mentionsByComment, reactionsByComment);
}

export async function deleteComment(
  commentId: string,
  user: AuthenticatedUser,
): Promise<void> {
  const c = await commentsRepo.findAliveById(commentId);
  if (!c) throw notFound("Comment not found");
  // Author OR a doc-level moderator (see permissions.canDeleteComment).
  const doc = await docsRepo.findByIdAlive(c.documentId);
  if (!doc || !permissions.canDeleteComment(c, doc, user)) {
    throw forbidden("Cannot delete this comment");
  }
  await commentsRepo.softDeleteById(commentId);
  await auditService.record(user.id, "comment.delete", "comment", commentId);
}
