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
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { MessageSquare, Trash2, Reply, Edit, Hash, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/format";

interface Props {
  documentId: string;
  commentCount: number;
  isPdf: boolean;
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

  const isAdmin = user?.roles?.includes("admin");

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
        <Textarea
          placeholder="Add your thoughts or ask a question..."
          value={commentBody}
          onChange={(e) => setCommentBody(e.target.value)}
          className="resize-none"
          rows={3}
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
        ) : comments?.map((comment) => {
          const canModify = isAdmin || user?.id === comment.author.id;
          const isEditing = editingCommentId === comment.id;
          return (
          <div key={comment.id} className="bg-card border rounded-lg p-4 shadow-sm" data-testid={`comment-${comment.id}`}>
            <div className="flex justify-between items-start mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                  {comment.author.displayName.charAt(0)}
                </div>
                <span className="text-sm font-medium">{comment.author.displayName}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(comment.createdAt)}
                  {comment.editedAt && <span className="italic ml-1" data-testid="comment-edited-marker">(edited)</span>}
                </span>
                {comment.pageNumber != null && !isEditing && (
                  <Badge variant="outline" className="gap-1 text-xs">
                    <Hash className="h-3 w-3" /> p.{comment.pageNumber}
                  </Badge>
                )}
              </div>
              {!isEditing && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setReplyingTo(comment.id)} aria-label="Reply">
                    <Reply className="h-3 w-3" />
                  </Button>
                  {canModify && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => handleStartEdit(comment)}
                        data-testid={`edit-comment-${comment.id}`}
                        aria-label="Edit comment"
                      >
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleDeleteComment(comment.id)}
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
                <Textarea
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  className="resize-none"
                  rows={3}
                  data-testid={`edit-comment-textarea-${comment.id}`}
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
                    <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleSaveEdit(comment.id)}
                      disabled={updateCommentMutation.isPending || !editBody.trim()}
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

            {/* Nested Replies */}
            {comment.replies && comment.replies.length > 0 && (
              <div className="mt-4 pl-4 border-l-2 ml-4 space-y-4">
                {comment.replies.map((reply: Comment) => {
                  const canModifyReply = isAdmin || user?.id === reply.author.id;
                  const isEditingReply = editingCommentId === reply.id;
                  return (
                  <div key={reply.id} data-testid={`comment-${reply.id}`}>
                    <div className="flex justify-between items-start mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{reply.author.displayName}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(reply.createdAt)}
                          {reply.editedAt && <span className="italic ml-1" data-testid="comment-edited-marker">(edited)</span>}
                        </span>
                      </div>
                      {!isEditingReply && canModifyReply && (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={() => handleStartEdit(reply)}
                            data-testid={`edit-comment-${reply.id}`}
                            aria-label="Edit reply"
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 text-destructive"
                            onClick={() => handleDeleteComment(reply.id)}
                            aria-label="Delete reply"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                    {isEditingReply ? (
                      <div className="space-y-2">
                        <Textarea
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          className="resize-none"
                          rows={2}
                          data-testid={`edit-comment-textarea-${reply.id}`}
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
                                data-testid={`edit-comment-page-input-${reply.id}`}
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
                            <Button variant="ghost" size="sm" onClick={handleCancelEdit}>Cancel</Button>
                            <Button
                              size="sm"
                              onClick={() => handleSaveEdit(reply.id)}
                              disabled={updateCommentMutation.isPending || !editBody.trim()}
                              data-testid={`save-comment-${reply.id}`}
                            >
                              Save
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{reply.body}</p>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}
