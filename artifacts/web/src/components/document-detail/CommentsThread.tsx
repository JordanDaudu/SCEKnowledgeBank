import { useState } from "react";
import {
  type Comment,
  useListDocumentComments,
  useCreateDocumentComment,
  useDeleteComment,
  useUpdateComment,
  useGetCurrentUser,
  getListDocumentCommentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { MessageSquare, Trash2, Reply, Edit, Hash, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/format";
import MentionPicker from "./MentionPicker";

interface Props {
  documentId: string;
  commentCount: number;
  isPdf: boolean;
}

interface CurrentUser {
  id: string;
  roles?: string[];
}

interface CommentNodeProps {
  comment: Comment;
  depth: number;
  isPdf: boolean;
  user: CurrentUser | undefined;
  editingCommentId: string | null;
  editBody: string;
  editPageNumber: string;
  isSavePending: boolean;
  setReplyingTo: (id: string) => void;
  onStartEdit: (c: { id: string; body: string; pageNumber?: number }) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string) => void;
  onDelete: (id: string) => void;
  setEditBody: (s: string) => void;
  setEditPageNumber: (s: string) => void;
}

/**
 * Renders a single comment node and its descendants recursively.
 * Task #29 dropped the hard-coded two-level structure that previously
 * existed here — replies can now nest arbitrarily deep. Visual depth
 * is bounded by a left-border indent that caps after a few levels so
 * very deep threads still read comfortably.
 */
function CommentNode(props: CommentNodeProps) {
  const {
    comment,
    depth,
    isPdf,
    user,
    editingCommentId,
    editBody,
    editPageNumber,
    isSavePending,
    setReplyingTo,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
    onDelete,
    setEditBody,
    setEditPageNumber,
  } = props;

  const isAdmin = user?.roles?.includes("admin");
  const canModify = isAdmin || user?.id === comment.author.id;
  const isEditing = editingCommentId === comment.id;

  return (
    <div data-testid={`comment-${comment.id}`} className="space-y-2">
      <div className="bg-card border rounded-lg p-4 shadow-sm">
        <div className="flex justify-between items-start mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
              {comment.author.displayName.charAt(0)}
            </div>
            <span className="text-sm font-medium">{comment.author.displayName}</span>
            <span className="text-xs text-muted-foreground">
              {formatDateTime(comment.createdAt)}
              {comment.editedAt && (
                <span className="italic ml-1" data-testid="comment-edited-marker">(edited)</span>
              )}
            </span>
            {comment.pageNumber != null && !isEditing && (
              <Badge variant="outline" className="gap-1 text-xs">
                <Hash className="h-3 w-3" /> p.{comment.pageNumber}
              </Badge>
            )}
            {comment.mentions && comment.mentions.length > 0 && !isEditing && (
              <div
                className="flex items-center gap-1 flex-wrap"
                data-testid={`mentions-${comment.id}`}
              >
                {comment.mentions.map((m) => (
                  <Badge key={m.id} variant="secondary" className="text-xs">
                    @{m.displayName}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          {!isEditing && (
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setReplyingTo(comment.id)}
                aria-label="Reply"
                data-testid={`reply-${comment.id}`}
              >
                <Reply className="h-3 w-3" />
              </Button>
              {canModify && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => onStartEdit(comment)}
                    data-testid={`edit-comment-${comment.id}`}
                    aria-label="Edit comment"
                  >
                    <Edit className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => onDelete(comment.id)}
                    aria-label="Delete comment"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
        {isEditing ? (
          <div className="space-y-3 pl-8">
            <MentionPicker
              value={editBody}
              onChange={setEditBody}
              rows={3}
              textareaTestId={`edit-comment-textarea-${comment.id}`}
            />
            <div className="flex items-center justify-between gap-2 flex-wrap">
              {isPdf ? (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Hash className="h-3 w-3" /> Pin to page
                  </label>
                  <Input
                    type="number"
                    min={1}
                    value={editPageNumber}
                    onChange={(e) => setEditPageNumber(e.target.value)}
                    placeholder="optional"
                    className="h-8 w-24"
                    data-testid={`edit-comment-page-input-${comment.id}`}
                  />
                  {editPageNumber && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setEditPageNumber("")}
                      aria-label="Clear page"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={onCancelEdit}>Cancel</Button>
                <Button
                  size="sm"
                  onClick={() => onSaveEdit(comment.id)}
                  disabled={isSavePending || !editBody.trim()}
                  data-testid={`save-comment-${comment.id}`}
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm pl-8 whitespace-pre-wrap">{comment.body}</p>
        )}
      </div>
      {comment.replies && comment.replies.length > 0 && (
        <div
          className={
            depth < 4
              ? "pl-4 border-l-2 ml-4 space-y-2"
              : "pl-2 border-l-2 ml-2 space-y-2"
          }
          data-testid={`replies-${comment.id}`}
        >
          {comment.replies.map((reply) => (
            <CommentNode {...props} key={reply.id} comment={reply} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function CommentsThread({ documentId, commentCount, isPdf }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetCurrentUser();

  const { data: comments, isLoading: isCommentsLoading } = useListDocumentComments(documentId, {
    query: { enabled: !!documentId, queryKey: getListDocumentCommentsQueryKey(documentId) },
  });

  const commentMutation = useCreateDocumentComment();
  const deleteCommentMutation = useDeleteComment();
  const updateCommentMutation = useUpdateComment();

  const [commentBody, setCommentBody] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState<string>("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editPageNumber, setEditPageNumber] = useState<string>("");

  const handleCommentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentBody.trim()) return;

    const parsedPage = pageNumber ? Number(pageNumber) : undefined;
    if (parsedPage != null && (!Number.isFinite(parsedPage) || parsedPage < 1)) {
      toast({ variant: "destructive", title: "Invalid page", description: "Page number must be 1 or greater." });
      return;
    }

    commentMutation.mutate({
      id: documentId,
      data: {
        body: commentBody,
        parentId: replyingTo || undefined,
        pageNumber: parsedPage,
      },
    }, {
      onSuccess: () => {
        setCommentBody("");
        setReplyingTo(null);
        setPageNumber("");
        queryClient.invalidateQueries({ queryKey: getListDocumentCommentsQueryKey(documentId) });
        toast({ title: "Comment posted" });
      },
    });
  };

  const handleStartEdit = (c: { id: string; body: string; pageNumber?: number }) => {
    setEditingCommentId(c.id);
    setEditBody(c.body);
    setEditPageNumber(c.pageNumber != null ? String(c.pageNumber) : "");
  };

  const handleCancelEdit = () => {
    setEditingCommentId(null);
    setEditBody("");
    setEditPageNumber("");
  };

  const handleSaveEdit = (commentId: string) => {
    if (!editBody.trim()) {
      toast({ variant: "destructive", title: "Comment cannot be empty" });
      return;
    }
    const trimmed = editPageNumber.trim();
    let pageValue: number | null;
    if (trimmed === "") {
      pageValue = null;
    } else {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 1) {
        toast({ variant: "destructive", title: "Invalid page", description: "Page number must be 1 or greater." });
        return;
      }
      pageValue = n;
    }
    const data: { body: string; pageNumber: number | null } = {
      body: editBody.trim(),
      pageNumber: pageValue,
    };
    updateCommentMutation.mutate(
      { commentId, data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListDocumentCommentsQueryKey(documentId) });
          handleCancelEdit();
          toast({ title: "Comment updated" });
        },
        onError: (err) => {
          const data = (err as { data?: { error?: { message?: string } } })?.data;
          toast({
            variant: "destructive",
            title: "Update failed",
            description: data?.error?.message || (err as Error)?.message,
          });
        },
      },
    );
  };

  const handleDeleteComment = (commentId: string) => {
    if (!confirm("Delete this comment?")) return;
    deleteCommentMutation.mutate({ commentId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDocumentCommentsQueryKey(documentId) });
        toast({ title: "Comment deleted" });
      },
    });
  };

  return (
    <div>
      <h3 className="font-serif font-semibold text-lg flex items-center gap-2 mb-4">
        <MessageSquare className="h-5 w-5 text-primary" />
        Discussion ({commentCount})
      </h3>

      <form onSubmit={handleCommentSubmit} className="mb-6 space-y-3">
        {replyingTo && (
          <div className="flex justify-between items-center text-xs bg-secondary px-3 py-1.5 rounded-md">
            <span>Replying to comment</span>
            <Button variant="ghost" size="sm" className="h-auto p-0" onClick={() => setReplyingTo(null)}>Cancel</Button>
          </div>
        )}
        <MentionPicker
          value={commentBody}
          onChange={setCommentBody}
          placeholder="Add your thoughts, or @mention someone..."
          rows={3}
          textareaTestId="comment-body-input"
        />
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {isPdf ? (
            <div className="flex items-center gap-2">
              <label htmlFor="comment-page" className="text-xs text-muted-foreground flex items-center gap-1">
                <Hash className="h-3 w-3" /> Pin to page
              </label>
              <Input
                id="comment-page"
                type="number"
                min={1}
                value={pageNumber}
                onChange={(e) => setPageNumber(e.target.value)}
                placeholder="optional"
                className="h-8 w-24"
                data-testid="comment-page-input"
              />
              {pageNumber && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setPageNumber("")}
                  aria-label="Clear page"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          ) : (
            <span />
          )}
          <Button type="submit" disabled={commentMutation.isPending || !commentBody.trim()}>
            Post Comment
          </Button>
        </div>
      </form>

      <div className="space-y-4">
        {isCommentsLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          (comments ?? []).map((c) => (
            <CommentNode
              key={c.id}
              comment={c}
              depth={0}
              isPdf={isPdf}
              user={user}
              editingCommentId={editingCommentId}
              editBody={editBody}
              editPageNumber={editPageNumber}
              isSavePending={updateCommentMutation.isPending}
              setReplyingTo={setReplyingTo}
              onStartEdit={handleStartEdit}
              onCancelEdit={handleCancelEdit}
              onSaveEdit={handleSaveEdit}
              onDelete={handleDeleteComment}
              setEditBody={setEditBody}
              setEditPageNumber={setEditPageNumber}
            />
          ))
        )}
      </div>
    </div>
  );
}
