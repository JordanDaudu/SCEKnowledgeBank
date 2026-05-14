import { useState, useRef, useMemo } from "react";
import {
  useListCourses,
  useListCategories,
  useListTags,
  getListDocumentsQueryKey,
  getListRecentDocumentsQueryKey,
  type Document as ApiDocument,
  type UploadResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { UploadCloud, X, File as FileIcon, CheckCircle2, AlertCircle, Loader2, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

type Visibility = "public" | "restricted" | "private";
type Semester = "fall" | "spring" | "summer" | "";

type ItemStatus = "queued" | "uploading" | "success" | "failed";

interface QueueItem {
  id: string;
  file: File;
  status: ItemStatus;
  progress: number;
  error?: string;
  errorCode?: string;
  storedFilename?: string;
  documentId?: string;
}

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [
  "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx",
  "txt", "md", "csv", "png", "jpg", "jpeg", "gif", "webp", "zip",
];

function validateFile(file: File): string | null {
  if (file.size > MAX_FILE_BYTES) {
    return `File exceeds 50MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB).`;
  }
  if (file.size === 0) {
    return "File is empty.";
  }
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return `Unsupported file type ".${ext || "unknown"}". Allowed: ${ALLOWED_EXTENSIONS.join(", ")}.`;
  }
  return null;
}

function uploadOne(
  file: File,
  fields: Record<string, string | undefined>,
  tagIds: string[],
  onProgress: (pct: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("files", file);
    for (const [k, v] of Object.entries(fields)) {
      if (v != null && v !== "") form.append(k, v);
    }
    for (const t of tagIds) form.append("tagIds", t);

    xhr.open("POST", "/api/documents/upload");
    xhr.withCredentials = true;
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload aborted"));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as UploadResult);
      } else {
        const data = xhr.response as { error?: { message?: string } } | null;
        reject(new Error(data?.error?.message || `HTTP ${xhr.status}`));
      }
    };
    xhr.send(form);
  });
}

export default function Upload() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<QueueItem[]>([]);
  const [courseId, setCourseId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [materialType, setMaterialType] = useState<string>("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [semester, setSemester] = useState<Semester>("");
  const [academicYear, setAcademicYear] = useState<string>(new Date().getFullYear().toString());
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const { data: courses } = useListCourses();
  const { data: categories } = useListCategories();
  const { data: availableTags } = useListTags();

  const addFiles = (files: File[]) => {
    const next: QueueItem[] = files.map((file) => {
      const err = validateFile(file);
      return {
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        status: err ? "failed" : "queued",
        progress: 0,
        error: err ?? undefined,
        errorCode: err ? "client_validation" : undefined,
      };
    });
    setItems((prev) => [...prev, ...next]);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files?.length) addFiles(Array.from(e.dataTransfer.files));
  };
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) addFiles(Array.from(e.target.files));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const toggleTag = (tagId: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId],
    );
  };

  const updateItem = (id: string, patch: Partial<QueueItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const pendingCount = useMemo(
    () => items.filter((i) => i.status === "queued").length,
    [items],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pendingCount === 0) {
      toast({ variant: "destructive", title: "Nothing to upload", description: "Add at least one valid file." });
      return;
    }
    if (!courseId || !materialType) {
      toast({ variant: "destructive", title: "Missing fields", description: "Course and Material Type are required." });
      return;
    }

    setIsUploading(true);
    const fields: Record<string, string | undefined> = {
      courseId,
      categoryId: categoryId && categoryId !== "none" ? categoryId : undefined,
      materialType,
      visibility,
      semester: semester || undefined,
      academicYear: academicYear || undefined,
    };

    const toUpload = items.filter((i) => i.status === "queued");
    let okCount = 0;
    let failCount = 0;
    let renamedCount = 0;

    for (const item of toUpload) {
      updateItem(item.id, { status: "uploading", progress: 0, error: undefined });
      try {
        const result = await uploadOne(
          item.file,
          fields,
          selectedTags,
          (pct) => updateItem(item.id, { progress: pct }),
        );
        const fileResult = result.results[0];
        if (fileResult?.success && fileResult.document) {
          const doc = fileResult.document as ApiDocument;
          const stored = doc.file?.originalFilename;
          const renamed = stored && stored !== item.file.name;
          if (renamed) renamedCount++;
          okCount++;
          updateItem(item.id, {
            status: "success",
            progress: 100,
            storedFilename: stored,
            documentId: doc.id,
          });
        } else {
          failCount++;
          updateItem(item.id, {
            status: "failed",
            error: fileResult?.error || "Upload rejected by server",
            errorCode: fileResult?.errorCode,
          });
        }
      } catch (err) {
        failCount++;
        updateItem(item.id, {
          status: "failed",
          error: err instanceof Error ? err.message : "Upload failed",
          errorCode: "network",
        });
      }
    }

    setIsUploading(false);
    await queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getListRecentDocumentsQueryKey() });

    if (okCount > 0) {
      toast({
        title: `Uploaded ${okCount} file${okCount === 1 ? "" : "s"}`,
        description:
          (failCount > 0 ? `${failCount} failed. ` : "") +
          (renamedCount > 0
            ? `${renamedCount} renamed to avoid duplicate names.`
            : ""),
      });
    }
    if (failCount > 0 && okCount === 0) {
      toast({
        variant: "destructive",
        title: "All uploads failed",
        description: "See per-file errors below.",
      });
    }

    if (failCount === 0 && okCount > 0) {
      setTimeout(() => setLocation("/browse"), 1500);
    }
  };

  const materialTypes = [
    "lecture-notes", "problem-set", "exam", "syllabus", "slides", "project-report", "textbook",
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">Upload Materials</h1>
        <p className="text-muted-foreground mt-1">Share documents with the university community.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Files</CardTitle>
            <CardDescription>
              Drag & drop or select files to upload. PDF, DOCX, PPTX, XLSX, images and more — up to 50MB each.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className="border-2 border-dashed border-primary/20 rounded-xl p-10 text-center hover:bg-primary/5 transition-colors cursor-pointer"
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              data-testid="upload-dropzone"
            >
              <UploadCloud className="h-10 w-10 text-primary mx-auto mb-4" />
              <p className="font-medium">Click to browse or drag files here</p>
              <p className="text-sm text-muted-foreground mt-1">
                Each file is queued and uploaded with its own progress.
              </p>
              <input
                type="file"
                multiple
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileSelect}
              />
            </div>

            {items.length > 0 && (
              <ul className="mt-6 space-y-3" data-testid="upload-queue">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="p-3 bg-secondary rounded-lg border space-y-2"
                    data-testid={`upload-item-${item.status}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <FileIcon className="h-5 w-5 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{item.file.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {(item.file.size / 1024 / 1024).toFixed(2)} MB
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {item.status === "queued" && (
                          <Badge variant="outline" className="gap-1">
                            <Clock className="h-3 w-3" /> Queued
                          </Badge>
                        )}
                        {item.status === "uploading" && (
                          <Badge variant="outline" className="gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" /> {item.progress}%
                          </Badge>
                        )}
                        {item.status === "success" && (
                          <Badge variant="default" className="gap-1 bg-green-600 hover:bg-green-600">
                            <CheckCircle2 className="h-3 w-3" /> Uploaded
                          </Badge>
                        )}
                        {item.status === "failed" && (
                          <Badge variant="destructive" className="gap-1">
                            <AlertCircle className="h-3 w-3" /> Failed
                          </Badge>
                        )}
                        {item.status !== "uploading" && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeItem(item.id)}
                            className="h-7 w-7"
                            aria-label="Remove file"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {item.status === "uploading" && (
                      <Progress value={item.progress} className="h-1.5" />
                    )}

                    {item.status === "failed" && item.error && (
                      <p className="text-xs text-destructive pl-8" data-testid="upload-error">
                        {item.error}
                      </p>
                    )}

                    {item.status === "success" &&
                      item.storedFilename &&
                      item.storedFilename !== item.file.name && (
                        <p className="text-xs text-muted-foreground pl-8" data-testid="upload-rename">
                          Uploaded as <span className="font-mono">{item.storedFilename}</span> to avoid duplicate name.
                        </p>
                      )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Metadata</CardTitle>
            <CardDescription>Applied to all files in this batch.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Course *</label>
                <Select value={courseId} onValueChange={setCourseId}>
                  <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                  <SelectContent>
                    {courses?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.code} - {c.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Material Type *</label>
                <Select value={materialType} onValueChange={setMaterialType}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    {materialTypes.map((t) => (
                      <SelectItem key={t} value={t} className="capitalize">{t.replace("-", " ")}</SelectItem>
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
                <label className="text-sm font-medium">Visibility</label>
                <Select value={visibility} onValueChange={(val) => setVisibility(val as Visibility)}>
                  <SelectTrigger><SelectValue placeholder="Visibility" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">Public (Everyone)</SelectItem>
                    <SelectItem value="restricted">Restricted (Enrolled only)</SelectItem>
                    <SelectItem value="private">Private (Only me)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Semester</label>
                <Select value={semester} onValueChange={(val) => setSemester(val === "none" ? "" : (val as Semester))}>
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
                <label className="text-sm font-medium">Academic Year</label>
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
                {availableTags?.map((tag) => (
                  <Badge
                    key={tag.id}
                    variant={selectedTags.includes(tag.id) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => toggleTag(tag.id)}
                  >
                    {tag.name}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-4">
          <Button type="button" variant="outline" onClick={() => setLocation("/")} disabled={isUploading}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={pendingCount === 0 || !courseId || !materialType || isUploading}
            data-testid="upload-submit"
          >
            {isUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Upload {pendingCount} {pendingCount === 1 ? "File" : "Files"}
          </Button>
        </div>
      </form>
    </div>
  );
}
