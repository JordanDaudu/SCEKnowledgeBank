import { useParams, useLocation } from "wouter";
import {
  useGetDocument,
  type DocumentDetail as DocumentDetailDto,
  useGetDocumentPreviewToken,
  getDocumentDownloadToken,
  useListDocumentComments,
  useCreateDocumentComment,
  useDeleteComment,
  useUpdateDocument,
  useDeleteDocument,
  useGetCurrentUser,
  useListCourses,
  useListCategories,
  useListTags,
  getGetDocumentQueryKey,
  getGetDocumentPreviewTokenQueryKey,
  getListDocumentCommentsQueryKey,
  type UpdateDocumentRequest,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { formatDateTime, formatBytes } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FileText, Download, Clock, User, MessageSquare, Trash2, Reply, Edit, FileQuestion, Hash, X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Visibility = NonNullable<UpdateDocumentRequest["visibility"]>;
type Semester = NonNullable<UpdateDocumentRequest["semester"]>;

const MATERIAL_TYPES = [
  "lecture-notes", "problem-set", "exam", "syllabus", "slides", "project-report", "textbook",
];

function isPreviewableInIframe(mime: string | undefined): boolean {
  if (!mime) return false;
  if (mime === "application/pdf") return true;
  if (mime.startsWith("image/")) return true;
  return false;
}

export default function DocumentDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetCurrentUser();

  const { data: doc, isLoading: isDocLoading } = useGetDocument(id, {
    query: { enabled: !!id, queryKey: getGetDocumentQueryKey(id) },
  });

  const mime = doc?.file?.mimeType;
  const isPdf = mime === "application/pdf";
  const canIframe = isPreviewableInIframe(mime);

  const { data: previewToken, isLoading: isPreviewLoading } = useGetDocumentPreviewToken(id, {
    query: {
      enabled: !!id && canIframe,
      queryKey: getGetDocumentPreviewTokenQueryKey(id),
    },
  });

  const { data: comments, isLoading: isCommentsLoading } = useListDocumentComments(id, {
    query: { enabled: !!id, queryKey: getListDocumentCommentsQueryKey(id) },
  });

  const commentMutation = useCreateDocumentComment();
  const deleteCommentMutation = useDeleteComment();
  const updateDocMutation = useUpdateDocument();
  const deleteDocMutation = useDeleteDocument();

  const [commentBody, setCommentBody] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState<string>("");
  const [editOpen, setEditOpen] = useState(false);

  const isAdmin = user?.roles?.includes("admin");
  const isUploader = user?.id === doc?.uploader?.id;
  const canEdit = isAdmin || isUploader;

  const handleDownload = async () => {
    try {
      const data = await getDocumentDownloadToken(id);
      window.open(data.url, "_blank");
    } catch {
      toast({ variant: "destructive", title: "Download failed", description: "Could not generate download link." });
    }
  };

  const handleCommentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentBody.trim()) return;

    const parsedPage = pageNumber ? Number(pageNumber) : undefined;
    if (parsedPage != null && (!Number.isFinite(parsedPage) || parsedPage < 1)) {
      toast({ variant: "destructive", title: "Invalid page", description: "Page number must be 1 or greater." });
      return;
    }

    commentMutation.mutate({
      id,
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
        queryClient.invalidateQueries({ queryKey: getListDocumentCommentsQueryKey(id) });
        toast({ title: "Comment posted" });
      },
    });
  };

  const handleDeleteComment = (commentId: string) => {
    if (!confirm("Delete this comment?")) return;
    deleteCommentMutation.mutate({ commentId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDocumentCommentsQueryKey(id) });
        toast({ title: "Comment deleted" });
      },
    });
  };

  const handleDeleteDoc = () => {
    if (!confirm("Are you sure you want to delete this document? This cannot be undone.")) return;
    deleteDocMutation.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Document deleted" });
        setLocation("/browse");
      },
    });
  };

  const handleToggleStatus = () => {
    if (!doc) return;
    const newStatus = doc.status === "published" ? "archived" : "published";
    updateDocMutation.mutate({ id, data: { status: newStatus } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetDocumentQueryKey(id) });
        toast({ title: `Document ${newStatus}` });
      },
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
                <span className="uppercase">{doc.file.mimeType.split("/").pop()}</span>
              </div>
            )}
          </div>
          <div className="flex-1 bg-secondary/20 relative">
            {!canIframe ? (
              <div
                className="absolute inset-0 flex flex-col items-center justify-center text-center p-8"
                data-testid="preview-unavailable"
              >
                <div className="bg-secondary p-4 rounded-full mb-4">
                  <FileQuestion className="h-10 w-10 text-muted-foreground" />
                </div>
                <h3 className="font-serif font-semibold text-lg mb-1">Preview unavailable</h3>
                <p className="text-sm text-muted-foreground max-w-sm mb-6">
                  {mime
                    ? `In-browser preview is not supported for ${mime}.`
                    : "This file type cannot be previewed in the browser."}
                  {" "}Download the file to view its contents.
                </p>
                <Button onClick={handleDownload}>
                  <Download className="mr-2 h-4 w-4" /> Download file
                </Button>
              </div>
            ) : isPreviewLoading ? (
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
          <div className="flex justify-between items-start mb-2 gap-2">
            <h1 className="text-2xl font-serif font-bold">{doc.title}</h1>
            {canEdit && (
              <div className="flex gap-1 ml-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditOpen(true)}
                  data-testid="edit-metadata-trigger"
                  aria-label="Edit metadata"
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={handleToggleStatus} disabled={updateDocMutation.isPending}>
                  {doc.status === "published" ? "Archive" : "Publish"}
                </Button>
                <Button variant="destructive" size="sm" onClick={handleDeleteDoc} disabled={deleteDocMutation.isPending} aria-label="Delete">
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
            {doc.tags?.map((t) => <Badge key={t.id} variant="secondary" className="opacity-70">{t.name}</Badge>)}
          </div>
          <p className="text-muted-foreground text-sm mb-6">{doc.description}</p>

          <div className="flex items-center justify-between text-sm text-muted-foreground mb-6 pb-6 border-b">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1"><User className="h-3 w-3" /> {doc.uploader.displayName}</div>
              <div className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatDateTime(doc.createdAt)}</div>
            </div>
          </div>

          <Button className="w-full mb-8" size="lg" onClick={handleDownload}>
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
            ) : comments?.map((comment) => (
              <div key={comment.id} className="bg-card border rounded-lg p-4 shadow-sm">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                      {comment.author.displayName.charAt(0)}
                    </div>
                    <span className="text-sm font-medium">{comment.author.displayName}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(comment.createdAt)}</span>
                    {comment.pageNumber != null && (
                      <Badge variant="outline" className="gap-1 text-xs">
                        <Hash className="h-3 w-3" /> p.{comment.pageNumber}
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setReplyingTo(comment.id)}>
                      <Reply className="h-3 w-3" />
                    </Button>
                    {(isAdmin || user?.id === comment.author.id) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleDeleteComment(comment.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-sm pl-8">{comment.body}</p>

                {/* Nested Replies */}
                {comment.replies && comment.replies.length > 0 && (
                  <div className="mt-4 pl-4 border-l-2 ml-4 space-y-4">
                    {comment.replies.map((reply) => (
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

      {canEdit && (
        <EditMetadataDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          docId={id}
          doc={doc}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────── Edit Dialog
function EditMetadataDialog({
  open,
  onOpenChange,
  docId,
  doc,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  docId: string;
  doc: DocumentDetailDto;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: courses } = useListCourses();
  const { data: categories } = useListCategories();
  const { data: tags } = useListTags();
  const updateDocMutation = useUpdateDocument();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [courseId, setCourseId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("none");
  const [materialType, setMaterialType] = useState<string>("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [semester, setSemester] = useState<Semester | "">("");
  const [academicYear, setAcademicYear] = useState<string>("");

  // Reset form whenever the dialog opens for a (possibly refreshed) doc
  useEffect(() => {
    if (!open || !doc) return;
    setTitle(doc.title);
    setDescription(doc.description ?? "");
    setCourseId(doc.course?.id ?? "");
    setCategoryId(doc.category?.id ?? "none");
    setMaterialType(doc.materialType);
    setTagIds(doc.tags?.map((t) => t.id) ?? []);
    setVisibility(doc.visibility);
    setSemester(doc.semester ?? "");
    setAcademicYear(doc.academicYear != null ? String(doc.academicYear) : "");
  }, [open, doc]);

  const toggleTag = (id: string) =>
    setTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));

  const handleSave = () => {
    if (!title.trim()) {
      toast({ variant: "destructive", title: "Title required" });
      return;
    }
    const body: UpdateDocumentRequest = {
      title: title.trim(),
      description: description.trim(),
      courseId: courseId || undefined,
      categoryId: categoryId === "none" ? undefined : categoryId,
      materialType,
      semester: (semester || undefined) as UpdateDocumentRequest["semester"],
      academicYear: academicYear ? Number(academicYear) : undefined,
      visibility,
      tagIds,
    };

    updateDocMutation.mutate(
      { id: docId, data: body },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetDocumentQueryKey(docId) });
          toast({ title: "Document updated" });
          onOpenChange(false);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="edit-metadata-dialog">
        <DialogHeader>
          <DialogTitle>Edit document metadata</DialogTitle>
          <DialogDescription>
            Update the title, description, classification and visibility of this document.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Course</label>
              <Select value={courseId} onValueChange={setCourseId}>
                <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                <SelectContent>
                  {courses?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.code} — {c.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Category</label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {categories?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Material type</label>
              <Select value={materialType} onValueChange={setMaterialType}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {MATERIAL_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">{t.replace("-", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Visibility</label>
              <Select value={visibility} onValueChange={(v) => setVisibility(v as Visibility)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public (Everyone)</SelectItem>
                  <SelectItem value="restricted">Restricted (Enrolled only)</SelectItem>
                  <SelectItem value="private">Private (Only me)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Semester</label>
              <Select
                value={semester || "none"}
                onValueChange={(v) => setSemester(v === "none" ? "" : (v as Semester))}
              >
                <SelectTrigger><SelectValue placeholder="Select semester" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="fall">Fall</SelectItem>
                  <SelectItem value="spring">Spring</SelectItem>
                  <SelectItem value="summer">Summer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Academic year</label>
              <Input
                type="number"
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                placeholder="e.g. 2024"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Tags</label>
            <div className="flex flex-wrap gap-2">
              {tags?.length ? tags.map((tag) => (
                <Badge
                  key={tag.id}
                  variant={tagIds.includes(tag.id) ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => toggleTag(tag.id)}
                >
                  {tag.name}
                </Badge>
              )) : (
                <p className="text-xs text-muted-foreground">No tags available.</p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={updateDocMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={updateDocMutation.isPending} data-testid="edit-metadata-save">
            {updateDocMutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
