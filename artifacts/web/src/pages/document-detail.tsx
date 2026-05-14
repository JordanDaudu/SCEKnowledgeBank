import { useParams, useLocation } from "wouter";
import { 
  useGetDocument, 
  useGetDocumentPreviewToken,
  getDocumentDownloadToken,
  useListDocumentComments,
  useCreateDocumentComment,
  useDeleteComment,
  useUpdateDocument,
  useDeleteDocument,
  useGetCurrentUser,
  getGetDocumentQueryKey,
  getGetDocumentPreviewTokenQueryKey,
  getListDocumentCommentsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatDateTime, formatBytes } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { FileText, Download, Clock, User, MessageSquare, Trash2, Reply, Edit } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function DocumentDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetCurrentUser();
  
  const { data: doc, isLoading: isDocLoading } = useGetDocument(id, { 
    query: { enabled: !!id, queryKey: getGetDocumentQueryKey(id) } 
  });
  
  const { data: previewToken, isLoading: isPreviewLoading } = useGetDocumentPreviewToken(id, {
    query: { enabled: !!id, queryKey: getGetDocumentPreviewTokenQueryKey(id) }
  });

  const { data: comments, isLoading: isCommentsLoading } = useListDocumentComments(id, {
    query: { enabled: !!id, queryKey: getListDocumentCommentsQueryKey(id) }
  });

  const commentMutation = useCreateDocumentComment();
  const deleteCommentMutation = useDeleteComment();
  const updateDocMutation = useUpdateDocument();
  const deleteDocMutation = useDeleteDocument();

  const [commentBody, setCommentBody] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  
  const isAdmin = user?.roles?.includes("admin");
  const isUploader = user?.id === doc?.uploader?.id;
  const canEdit = isAdmin || isUploader;

  const handleDownload = async () => {
    try {
      const data = await getDocumentDownloadToken(id);
      window.open(data.url, '_blank');
    } catch {
      toast({ variant: "destructive", title: "Download failed", description: "Could not generate download link." });
    }
  };

  const handleCommentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentBody.trim()) return;

    commentMutation.mutate({
      id,
      data: {
        body: commentBody,
        parentId: replyingTo || undefined
      }
    }, {
      onSuccess: () => {
        setCommentBody("");
        setReplyingTo(null);
        queryClient.invalidateQueries({ queryKey: getListDocumentCommentsQueryKey(id) });
        toast({ title: "Comment posted" });
      }
    });
  };

  const handleDeleteComment = (commentId: string) => {
    if (!confirm("Delete this comment?")) return;
    deleteCommentMutation.mutate({ commentId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDocumentCommentsQueryKey(id) });
        toast({ title: "Comment deleted" });
      }
    });
  };

  const handleDeleteDoc = () => {
    if (!confirm("Are you sure you want to delete this document? This cannot be undone.")) return;
    deleteDocMutation.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Document deleted" });
        setLocation("/browse");
      }
    });
  };

  const handleToggleStatus = () => {
    if (!doc) return;
    const newStatus = doc.status === "published" ? "archived" : "published";
    updateDocMutation.mutate({ id, data: { status: newStatus } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetDocumentQueryKey(id) });
        toast({ title: `Document ${newStatus}` });
      }
    });
  };

  if (isDocLoading) {
    return <div className="space-y-6"><Skeleton className="h-12 w-2/3" /><Skeleton className="h-[600px] w-full" /></div>;
  }

  if (!doc) {
    return <div className="text-center py-20">Document not found</div>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* Left Column: Preview */}
      <div className="lg:col-span-2 space-y-6">
        <div className="bg-card border rounded-xl overflow-hidden shadow-sm flex flex-col h-[700px]">
          <div className="border-b p-3 bg-muted/30 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileText className="h-4 w-4 text-primary" />
              {doc.file?.originalFilename || "Document Preview"}
            </div>
            {doc.file && (
              <div className="text-xs text-muted-foreground flex gap-3">
                <span>{formatBytes(doc.file.sizeBytes)}</span>
                <span className="uppercase">{doc.file.mimeType.split('/').pop()}</span>
              </div>
            )}
          </div>
          <div className="flex-1 bg-secondary/20 relative">
            {isPreviewLoading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Skeleton className="w-full h-full" />
              </div>
            ) : previewToken?.url ? (
              <iframe 
                src={previewToken.url} 
                className="w-full h-full border-0"
                title="Document Preview"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                Preview not available
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right Column: Metadata & Comments */}
      <div className="space-y-6">
        <div>
          <div className="flex justify-between items-start mb-2">
            <h1 className="text-2xl font-serif font-bold">{doc.title}</h1>
            {canEdit && (
              <div className="flex gap-1 ml-2">
                <Button variant="outline" size="sm" onClick={handleToggleStatus} disabled={updateDocMutation.isPending}>
                  {doc.status === "published" ? "Archive" : "Publish"}
                </Button>
                <Button variant="destructive" size="sm" onClick={handleDeleteDoc} disabled={deleteDocMutation.isPending}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            {doc.status !== "published" && <Badge variant="destructive">{doc.status}</Badge>}
            {doc.course && <Badge variant="secondary" className="font-mono">{doc.course.code}</Badge>}
            <Badge variant="outline" className="capitalize">{doc.materialType.replace("-", " ")}</Badge>
            {doc.semester && <Badge variant="outline" className="capitalize">{doc.semester} {doc.academicYear}</Badge>}
            {doc.tags?.map(t => <Badge key={t.id} variant="secondary" className="opacity-70">{t.name}</Badge>)}
          </div>
          <p className="text-muted-foreground text-sm mb-6">{doc.description}</p>
          
          <div className="flex items-center justify-between text-sm text-muted-foreground mb-6 pb-6 border-b">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1"><User className="h-3 w-3" /> {doc.uploader.displayName}</div>
              <div className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatDateTime(doc.createdAt)}</div>
            </div>
          </div>

          <Button 
            className="w-full mb-8" 
            size="lg" 
            onClick={handleDownload}
          >
            <Download className="mr-2 h-4 w-4" /> Download Material
          </Button>
        </div>

        {/* Comments Section */}
        <div>
          <h3 className="font-serif font-semibold text-lg flex items-center gap-2 mb-4">
            <MessageSquare className="h-5 w-5 text-primary" />
            Discussion ({doc.commentCount})
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
            <Button type="submit" disabled={commentMutation.isPending || !commentBody.trim()}>
              Post Comment
            </Button>
          </form>

          <div className="space-y-4">
            {isCommentsLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : comments?.map(comment => (
              <div key={comment.id} className="bg-card border rounded-lg p-4 shadow-sm">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                      {comment.author.displayName.charAt(0)}
                    </div>
                    <span className="text-sm font-medium">{comment.author.displayName}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(comment.createdAt)}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setReplyingTo(comment.id)}>
                      <Reply className="h-3 w-3" />
                    </Button>
                    {(isAdmin || user?.id === comment.author.id) && (
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDeleteComment(comment.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-sm pl-8">{comment.body}</p>
                
                {/* Nested Replies */}
                {comment.replies && comment.replies.length > 0 && (
                  <div className="mt-4 pl-4 border-l-2 ml-4 space-y-4">
                    {comment.replies.map(reply => (
                      <div key={reply.id}>
                        <div className="flex justify-between items-start mb-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{reply.author.displayName}</span>
                            <span className="text-xs text-muted-foreground">{formatDateTime(reply.createdAt)}</span>
                          </div>
                          {(isAdmin || user?.id === reply.author.id) && (
                            <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive" onClick={() => handleDeleteComment(reply.id)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{reply.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
