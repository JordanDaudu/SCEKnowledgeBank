import {
  Activity as ActivityIcon,
  FileText,
  MessageSquare,
  User,
  type LucideIcon,
} from "lucide-react";

/**
 * Shared activity-feed formatting (Phase 5). Used by the Activity page and
 * the home "Recent activity" widget so the action vocabulary stays in one
 * place. Add new audit action strings here when the server emits them.
 */
export const ACTION_LABELS: Record<string, string> = {
  "document.upload": "uploaded",
  "document.update": "updated",
  "document.delete": "deleted",
  "document.download": "downloaded",
  "document.submit_for_review": "submitted for review",
  "document.approve": "approved",
  "document.reject": "rejected",
  "document.version.create": "added a new version of",
  "document.version.restore": "restored a version of",
  "document.favorite": "favorited",
  "document.unfavorite": "removed a favorite on",
  "comment.create": "commented on",
  "comment.update": "edited a comment on",
  "comment.delete": "deleted a comment on",
  "comment.reaction": "reacted to a comment on",
  "request.create": "created a request",
  "request.update": "updated a request",
  "request.status": "changed a request's status",
  "request.vote": "voted on a request",
  "user.register": "registered an account",
  "user.login": "signed in",
  "user.logout": "signed out",
  "user.approve": "approved an account",
  "user.disable": "disabled an account",
};

export function describeAction(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  // Fall back to a readable form of the raw action key.
  return action.replace(/^[a-z]+\./, "").replace(/[._]/g, " ");
}

export function iconForEntity(entityType: string): LucideIcon {
  switch (entityType) {
    case "document":
      return FileText;
    case "comment":
      return MessageSquare;
    case "user":
      return User;
    default:
      return ActivityIcon;
  }
}
