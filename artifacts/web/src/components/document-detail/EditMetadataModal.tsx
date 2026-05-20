import { useEffect, useState } from "react";
import {
  type DocumentDetail as DocumentDetailDto,
  useUpdateDocument,
  useListCourses,
  useListCategories,
  useListTags,
  getGetDocumentQueryKey,
  type UpdateDocumentRequest,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { MATERIAL_TYPES } from "@/lib/material-types";

type Visibility = NonNullable<UpdateDocumentRequest["visibility"]>;
type Semester = NonNullable<UpdateDocumentRequest["semester"]>;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  docId: string;
  doc: DocumentDetailDto;
}

export default function EditMetadataModal({ open, onOpenChange, docId, doc }: Props) {
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
                    <SelectItem key={t.value} value={t.value} className="capitalize">{t.label}</SelectItem>
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
