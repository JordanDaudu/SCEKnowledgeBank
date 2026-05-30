import { useState } from "react";
import {
  useListCollectionComments,
  useCreateCollectionComment,
  useEditCollectionComment,
  useDeleteCollectionComment,
  useRemoveCollectionComment,
  getListCollectionCommentsQueryKey,
  type StudyCollectionComment,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare, Edit, Trash2, ShieldX } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/format";

interface Props {
  collectionId: string;
  canComment: boolean;
  canModerate?: boolean;
  onCountChange?: () => void;
}

interface CommentRowProps {
  comment: StudyCollectionComment;
  canModerate?: boolean;
  onEdit: (c: StudyCollectionComment) => void;
  onDelete: (commentId: string) => void;
  onRemove: (commentId: string) => void;
}

function CommentRow({ comment, canModerate, onEdit, onDelete, onRemove }: CommentRowProps) {
  return (
    <div className="bg-card border rounded-lg p-4 shadow-sm space-y-1" data-testid={`collection-comment-${comment.id}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
            {comment.author.displayName.charAt(0).toUpperCase()}
          </div>
          <span className="text-sm font-medium">{comment.author.displayName}</span>
          <span className="text-xs text-muted-foreground">
            {formatDateTime(comment.createdAt)}
            {comment.updatedAt !== comment.createdAt && (
              <span className="italic ml-1">(edited)</span>
            )}
          </span>
        </div>
        <div className="flex gap-1 shrink-0">
          {comment.editable && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                aria-label="Edit comment"
                onClick={() => onEdit(comment)}
                data-testid={`edit-collection-comment-${comment.id}`}
              >
                <Edit className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                aria-label="Delete comment"
                onClick={() => onDelete(comment.id)}
                data-testid={`delete-collection-comment-${comment.id}`}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </>
          )}
          {canModerate && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
              aria-label="Remove comment (admin)"
              onClick={() => onRemove(comment.id)}
              data-testid={`remove-collection-comment-${comment.id}`}
            >
              <ShieldX className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      <p className="text-sm pl-8 whitespace-pre-wrap">{comment.body}</p>
    </div>
  );
}

export default function CollectionComments({ collectionId, canComment, canModerate, onCountChange }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const commentsKey = getListCollectionCommentsQueryKey(collectionId);
  const { data: comments, isLoading } = useListCollectionComments(collectionId, {
    query: { queryKey: commentsKey, enabled: !!collectionId },
  });

  const createMut = useCreateCollectionComment();
  const editMut = useEditCollectionComment();
  const deleteMut = useDeleteCollectionComment();
  const removeMut = useRemoveCollectionComment();

  const [newBody, setNewBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  const handleError = (err: unknown) => {
    const data = (err as { data?: { error?: { message?: string } } })?.data;
    const message = data?.error?.message ?? (err as Error)?.message ?? "Something went wrong";
    toast({ variant: "destructive", title: "Action failed", description: message });
  };

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: commentsKey });
    onCountChange?.();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBody.trim()) return;
    createMut.mutate(
      { id: collectionId, data: { body: newBody.trim() } },
      {
        onSuccess: () => {
          setNewBody("");
          refreshAll();
          toast({ title: "Comment posted" });
        },
        onError: handleError,
      },
    );
  };

  const handleStartEdit = (comment: StudyCollectionComment) => {
    setEditingId(comment.id);
    setEditBody(comment.body);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditBody("");
  };

  const handleSaveEdit = (commentId: string) => {
    if (!editBody.trim()) {
      toast({ variant: "destructive", title: "Comment cannot be empty" });
      return;
    }
    editMut.mutate(
      { commentId, data: { body: editBody.trim() } },
      {
        onSuccess: () => {
          setEditingId(null);
          setEditBody("");
          refreshAll();
          toast({ title: "Comment updated" });
        },
        onError: handleError,
      },
    );
  };

  const handleDelete = (commentId: string) => {
    if (!confirm("Delete this comment?")) return;
    deleteMut.mutate(
      { commentId },
      {
        onSuccess: () => {
          refreshAll();
          toast({ title: "Comment deleted" });
        },
        onError: handleError,
      },
    );
  };

  const handleRemove = (commentId: string) => {
    if (!confirm("Remove this comment as admin?")) return;
    removeMut.mutate(
      { commentId },
      {
        onSuccess: () => {
          refreshAll();
          toast({ title: "Comment removed" });
        },
        onError: handleError,
      },
    );
  };

  const list = comments ?? [];

  return (
    <div className="space-y-4">
      <h2 className="font-serif font-semibold text-xl flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-primary" />
        Discussion
        <span className="text-sm font-normal text-muted-foreground">({list.length})</span>
      </h2>

      {canComment && (
        <form onSubmit={handleSubmit} className="space-y-2">
          <Textarea
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            placeholder="Share your thoughts on this collection..."
            rows={3}
            data-testid="collection-comment-input"
          />
          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              disabled={createMut.isPending || !newBody.trim()}
              data-testid="collection-comment-submit"
            >
              Post Comment
            </Button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {isLoading ? (
          <>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No comments yet.</p>
        ) : (
          list.map((comment) =>
            editingId === comment.id ? (
              <div key={comment.id} className="bg-card border rounded-lg p-4 shadow-sm space-y-2">
                <Textarea
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  rows={3}
                  autoFocus
                  data-testid={`edit-collection-comment-textarea-${comment.id}`}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    disabled={editMut.isPending || !editBody.trim()}
                    onClick={() => handleSaveEdit(comment.id)}
                    data-testid={`save-collection-comment-${comment.id}`}
                  >
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <CommentRow
                key={comment.id}
                comment={comment}
                canModerate={canModerate}
                onEdit={handleStartEdit}
                onDelete={handleDelete}
                onRemove={handleRemove}
              />
            ),
          )
        )}
      </div>
    </div>
  );
}
