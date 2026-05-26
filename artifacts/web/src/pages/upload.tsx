import { useState, useRef, useMemo } from "react";
import {
  useListCourses,
  useListCategories,
  useListTags,
  useGetMyStorageQuota,
  getGetMyStorageQuotaQueryKey,
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
import { UploadCloud, X, File as FileIcon, CheckCircle2, AlertCircle, Loader2, Clock, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { apiEndpoints } from "@/lib/api-url";
import { MATERIAL_TYPES } from "@/lib/material-types";

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
  displayFilename?: string;
  documentId?: string;
  duplicateOfDocumentId?: string;
  duplicateOfTitle?: string;
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

// Keep in sync with the backend MAX_UPLOAD_MB / ALLOWED_MIME_TYPES env config.
// Web-side defaults match the server defaults (50 MB, listed mime types).
// Override at build time with VITE_MAX_UPLOAD_MB if the backend is configured
// differently.
const MAX_UPLOAD_MB = Number(import.meta.env.VITE_MAX_UPLOAD_MB ?? 50);
const MAX_FILE_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
// File extensions whose content the backend's magic-byte sniffer can actually
// verify (mime-sniff.ts). gif/webp are deliberately excluded — the server has
// no sniff branch for them and would reject any upload as mime_mismatch.
const ALLOWED_EXTENSIONS = [
  "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx",
  "txt", "md", "csv", "png", "jpg", "jpeg", "zip",
];

function validateFile(file: File): string | null {
  if (file.size > MAX_FILE_BYTES) {
    return `File exceeds ${MAX_UPLOAD_MB}MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB).`;
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

interface UploadHandle {
  promise: Promise<UploadResult>;
  abort: () => void;
}

function uploadOne(
  file: File,
  fields: Record<string, string | undefined>,
  tagIds: string[],
  onProgress: (pct: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<UploadResult>((resolve, reject) => {
    const form = new FormData();
    form.append("files", file);
    for (const [k, v] of Object.entries(fields)) {
      if (v != null && v !== "") form.append(k, v);
    }
    for (const t of tagIds) form.append("tagIds", t);

    xhr.open("POST", apiEndpoints.uploadDocuments());
    xhr.withCredentials = true;
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => {
      const err = new Error("Upload canceled");
      (err as Error & { code?: string }).code = "canceled";
      reject(err);
    };
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
  return { promise, abort: () => xhr.abort() };
}

export default function Upload() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<QueueItem[]>([]);
  // Track in-flight XHRs by item id so the user can cancel an upload
  // mid-flight (per file or for the whole batch).
  const activeUploadsRef = useRef<Map<string, () => void>>(new Map());
  const canceledIdsRef = useRef<Set<string>>(new Set());
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
  const { data: quota } = useGetMyStorageQuota();

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

  const retryItem = (id: string) => {
    // Clear any prior cancel marker so the next submit pass actually
    // picks this item up.
    canceledIdsRef.current.delete(id);
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        // Re-run client-side validation so a previously rejected
        // oversized/unsupported file doesn't requeue invalidly.
        const err = validateFile(it.file);
        if (err) {
          return {
            ...it,
            status: "failed",
            progress: 0,
            error: err,
            errorCode: "client_validation",
            duplicateOfDocumentId: undefined,
            duplicateOfTitle: undefined,
          };
        }
        return {
          ...it,
          status: "queued",
          progress: 0,
          error: undefined,
          errorCode: undefined,
          duplicateOfDocumentId: undefined,
          duplicateOfTitle: undefined,
        };
      }),
    );
  };

  const cancelItem = (id: string) => {
    canceledIdsRef.current.add(id);
    const abort = activeUploadsRef.current.get(id);
    if (abort) {
      abort();
    } else {
      // Not yet started — mark it failed so the loop will skip it.
      updateItem(id, {
        status: "failed",
        error: "Upload canceled",
        errorCode: "canceled",
      });
    }
  };

  const cancelAll = () => {
    // Abort any in-flight XHRs.
    for (const [id, abort] of activeUploadsRef.current.entries()) {
      canceledIdsRef.current.add(id);
      abort();
    }
    // Mark every still-queued item as canceled AND register it in
    // canceledIdsRef so the in-progress handleSubmit loop (which
    // iterates a precomputed snapshot) skips them on the next tick.
    setItems((prev) =>
      prev.map((it) => {
        if (it.status === "queued") {
          canceledIdsRef.current.add(it.id);
          return { ...it, status: "failed", error: "Upload canceled", errorCode: "canceled" };
        }
        return it;
      }),
    );
  };

  const retryAllFailed = () => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.status !== "failed") return it;
        const err = validateFile(it.file);
        if (err) return it;
        // Clear any prior cancel marker so the next submit picks it up.
        canceledIdsRef.current.delete(it.id);
        return {
          ...it,
          status: "queued",
          progress: 0,
          error: undefined,
          errorCode: undefined,
          duplicateOfDocumentId: undefined,
          duplicateOfTitle: undefined,
        };
      }),
    );
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
  const failedCount = useMemo(
    () => items.filter((i) => i.status === "failed").length,
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
      // canceledIdsRef is the single source of truth for "skip this
      // item" — cancelAll() and cancelItem() add to it synchronously,
      // so a click between iterations is observed here even though
      // the `items` closure above is stale.
      if (canceledIdsRef.current.has(item.id)) continue;
      updateItem(item.id, { status: "uploading", progress: 0, error: undefined });
      const handle = uploadOne(
        item.file,
        fields,
        selectedTags,
        (pct) => updateItem(item.id, { progress: pct }),
      );
      activeUploadsRef.current.set(item.id, handle.abort);
      try {
        const result = await handle.promise;
        const fileResult = result.results[0];
        if (fileResult?.success && fileResult.document) {
          const doc = fileResult.document as ApiDocument;
          const display = doc.file?.displayFilename;
          const renamed = display && display !== item.file.name;
          if (renamed) renamedCount++;
          okCount++;
          updateItem(item.id, {
            status: "success",
            progress: 100,
            displayFilename: display,
            documentId: doc.id,
          });
        } else {
          failCount++;
          updateItem(item.id, {
            status: "failed",
            error: fileResult?.error || "Upload rejected by server",
            errorCode: fileResult?.errorCode,
            duplicateOfDocumentId: fileResult?.duplicateOfDocumentId,
            duplicateOfTitle: fileResult?.duplicateOfTitle,
          });
        }
      } catch (err) {
        failCount++;
        const code = (err as Error & { code?: string })?.code;
        updateItem(item.id, {
          status: "failed",
          error: err instanceof Error ? err.message : "Upload failed",
          errorCode: code === "canceled" ? "canceled" : "network",
        });
      } finally {
        activeUploadsRef.current.delete(item.id);
      }
    }

    canceledIdsRef.current.clear();
    setIsUploading(false);
    await queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getListRecentDocumentsQueryKey() });
    // Refresh the quota strip; even partial-success batches changed the
    // user's `usedBytes` on the server.
    await queryClient.invalidateQueries({ queryKey: getGetMyStorageQuotaQueryKey() });

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

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">Upload Materials</h1>
        <p className="text-muted-foreground mt-1">Share documents with the university community.</p>
      </div>

      {quota && (
        <Card data-testid="storage-quota-strip">
          <CardContent className="py-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Storage</span>
              <span className="text-muted-foreground">
                <span data-testid="quota-used">{formatBytes(quota.usedBytes)}</span>
                {" of "}
                <span data-testid="quota-total">{formatBytes(quota.quotaBytes)}</span>
                {" used — "}
                <span data-testid="quota-remaining">{formatBytes(quota.remainingBytes)}</span>
                {" remaining"}
              </span>
            </div>
            <Progress
              value={
                quota.quotaBytes > 0
                  ? Math.min(100, (quota.usedBytes / quota.quotaBytes) * 100)
                  : 0
              }
              className="h-2"
            />
          </CardContent>
        </Card>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Files</CardTitle>
            <CardDescription>
              Drag & drop or select files to upload. PDF, DOCX, PPTX, XLSX, images and more — up to {MAX_UPLOAD_MB}MB each.
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

            {failedCount > 0 && (
              <div className="mt-6 flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
                <span className="text-destructive">
                  {failedCount} file{failedCount === 1 ? "" : "s"} failed.
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={retryAllFailed}
                  disabled={isUploading}
                  data-testid="upload-retry-all"
                >
                  <RotateCcw className="mr-2 h-3 w-3" /> Retry failed
                </Button>
              </div>
            )}

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
                          <>
                            <Badge variant="outline" className="gap-1">
                              <Loader2 className="h-3 w-3 animate-spin" /> {item.progress}%
                            </Badge>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => cancelItem(item.id)}
                              className="h-7 w-7"
                              aria-label="Cancel upload"
                              data-testid="upload-cancel"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </>
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
                        {item.status === "failed" && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => retryItem(item.id)}
                            className="h-7 w-7"
                            aria-label="Retry upload"
                            data-testid="upload-retry"
                            disabled={isUploading}
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        )}
                        {item.status !== "uploading" && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeItem(item.id)}
                            className="h-7 w-7"
                            aria-label="Remove file"
                            disabled={isUploading}
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
                        {item.errorCode === "duplicate_file" &&
                          item.duplicateOfDocumentId && (
                            <>
                              {" "}
                              <a
                                href={`/documents/${item.duplicateOfDocumentId}`}
                                className="underline font-medium"
                                data-testid="duplicate-link"
                              >
                                View original
                                {item.duplicateOfTitle
                                  ? ` "${item.duplicateOfTitle}"`
                                  : ""}
                              </a>
                            </>
                          )}
                      </p>
                    )}

                    {item.status === "success" &&
                      item.displayFilename &&
                      item.displayFilename !== item.file.name && (
                        <p className="text-xs text-muted-foreground pl-8" data-testid="upload-rename">
                          Uploaded as <span className="font-mono">{item.displayFilename}</span> to avoid a duplicate name. Your original filename (<span className="font-mono">{item.file.name}</span>) is preserved on the record.
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
                    {MATERIAL_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
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
          {isUploading && (
            <Button
              type="button"
              variant="outline"
              onClick={cancelAll}
              data-testid="upload-cancel-all"
            >
              Cancel uploads
            </Button>
          )}
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
