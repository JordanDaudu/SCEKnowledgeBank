import { useState, useRef, useMemo } from "react";
import {
  useListCourses,
  useListCategories,
  useListTags,
  useGetMyStorageQuota,
  useGetCurrentUser,
  getGetMyStorageQuotaQueryKey,
  getListDocumentsQueryKey,
  getListRecentDocumentsQueryKey,
  suggestDocumentMetadata,
  type Document as ApiDocument,
  type UploadResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { UploadCloud, Loader2, AlertTriangle, HardDrive } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiEndpoints } from "@/lib/api-url";
import { isUnlimitedQuota } from "@/lib/format";
import {
  FileMetadataCard,
  type CardItem,
} from "@/components/upload/FileMetadataCard";
import {
  applySuggestion,
  defaultItemMeta,
  isItemReady,
  type ItemMeta,
} from "@/lib/upload-analysis";

const MAX_UPLOAD_MB = Number(import.meta.env.VITE_MAX_UPLOAD_MB ?? 50);
const MAX_FILE_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const ALLOWED_EXTENSIONS = [
  "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx",
  "txt", "md", "csv", "png", "jpg", "jpeg", "zip",
];

interface QueueItem extends CardItem {
  file: File;
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

function validateFile(file: File): string | null {
  if (file.size > MAX_FILE_BYTES) {
    return `File exceeds ${MAX_UPLOAD_MB}MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB).`;
  }
  if (file.size === 0) return "File is empty.";
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
    xhr.onerror = () => reject(new Error("Upload failed due to network error"));
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
  const analysisAbortsRef = useRef<Map<string, AbortController>>(new Map());

  const currentYear = new Date().getFullYear().toString();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [autoSubmitForReview, setAutoSubmitForReview] = useState(true);

  const { data: user } = useGetCurrentUser();
  const { data: allCourses } = useListCourses();
  const { data: categories } = useListCategories();
  const { data: availableTags } = useListTags();
  const { data: quota } = useGetMyStorageQuota();

  const isStudentUploader =
    !!user && !user.roles.includes("admin") && !user.roles.includes("lecturer");

  const courses = useMemo(() => {
    if (!allCourses) return undefined;
    if (!isStudentUploader || !user) return allCourses;
    const enrolledIds = new Set(user.enrollments.map((e) => e.courseId));
    return allCourses.filter((c) => enrolledIds.has(c.id));
  }, [allCourses, isStudentUploader, user]);

  const updateItem = (id: string, patch: Partial<QueueItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const analyzeItem = (id: string, file: File) => {
    const controller = new AbortController();
    analysisAbortsRef.current.set(id, controller);
    suggestDocumentMetadata(
      { file },
      { signal: controller.signal, credentials: "include" },
    )
      .then((suggestion) => {
        if (controller.signal.aborted) return;
        // Apply auto-fill against the item's CURRENT meta so we never clobber
        // edits the user made while analysis was in flight.
        setItems((prev) =>
          prev.map((it) =>
            it.id === id
              ? { ...it, suggestion, analyzing: false, ...applySuggestion(it, suggestion, currentYear) }
              : it,
          ),
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) updateItem(id, { analyzing: false });
      })
      .finally(() => {
        analysisAbortsRef.current.delete(id);
      });
  };

  const addFiles = (files: File[]) => {
    const next: QueueItem[] = files.map((file) => {
      const err = validateFile(file);
      const meta: ItemMeta = defaultItemMeta(currentYear);
      return {
        ...meta,
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        filename: file.name,
        sizeBytes: file.size,
        status: err ? "failed" : "queued",
        progress: 0,
        error: err ?? undefined,
        errorCode: err ? "client_validation" : undefined,
        suggestion: null,
        analyzing: !err,
      };
    });
    setItems((prev) => [...prev, ...next]);
    // Kick off analysis for each newly added, client-valid file. Browser
    // connection limits provide natural throttling for large batches.
    for (const it of next) {
      if (it.status === "queued") analyzeItem(it.id, it.file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files?.length) addFiles(Array.from(e.dataTransfer.files));
  };
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) addFiles(Array.from(e.target.files));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeItem = (id: string) => {
    analysisAbortsRef.current.get(id)?.abort();
    analysisAbortsRef.current.delete(id);
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const retryItem = (id: string) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const err = validateFile(it.file);
        return {
          ...it,
          status: err ? "failed" : "queued",
          progress: 0,
          error: err ?? undefined,
          errorCode: err ? "client_validation" : undefined,
          duplicateOfDocumentId: undefined,
          duplicateOfTitle: undefined,
        };
      }),
    );
  };

  const readyCount = useMemo(
    () => items.filter((i) => i.status === "queued" && isItemReady(i)).length,
    [items],
  );
  const needsInfoCount = useMemo(
    () => items.filter((i) => i.status === "queued" && !isItemReady(i)).length,
    [items],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const toUpload = items.filter(
      (i) => i.status === "queued" && isItemReady(i),
    );
    if (toUpload.length === 0) {
      toast({
        variant: "destructive",
        title: "Nothing ready to upload",
        description: "Fill in Course and Material Type on at least one file.",
      });
      return;
    }

    setIsUploading(true);
    let okCount = 0;
    let failCount = 0;

    for (const item of toUpload) {
      const fields: Record<string, string | undefined> = {
        courseId: item.courseId,
        categoryId: item.categoryId || undefined,
        materialType: item.materialType,
        visibility: item.visibility,
        semester: item.semester || undefined,
        academicYear: item.academicYear || undefined,
        title: item.title.trim() || undefined,
        autoSubmitForReview:
          isStudentUploader && autoSubmitForReview ? "true" : undefined,
      };
      updateItem(item.id, { status: "uploading", progress: 0, error: undefined });
      const handle = uploadOne(item.file, fields, item.tagIds, (pct) =>
        updateItem(item.id, { progress: pct }),
      );
      try {
        const result = await handle.promise;
        const fileResult = result.results[0];
        if (fileResult?.success && fileResult.document) {
          const doc = fileResult.document as ApiDocument;
          okCount++;
          updateItem(item.id, {
            status: "success",
            progress: 100,
            displayFilename: doc.file?.displayFilename,
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
    await queryClient.invalidateQueries({ queryKey: getGetMyStorageQuotaQueryKey() });

    if (okCount > 0) {
      toast({
        title: `Uploaded ${okCount} file${okCount === 1 ? "" : "s"}`,
        description: failCount > 0 ? `${failCount} failed — see per-file errors.` : "",
      });
    }
    if (failCount > 0 && okCount === 0) {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: "See per-file errors below.",
      });
    }
    // Navigate away only when everything that was attempted succeeded AND
    // nothing still needs info on screen.
    if (failCount === 0 && okCount > 0 && needsInfoCount === 0) {
      setTimeout(() => setLocation("/browse"), 1500);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">Upload Materials</h1>
        <p className="text-muted-foreground mt-1">
          Each file gets its own details. Files with Course and Material Type filled in upload right away.
        </p>
      </div>

      {quota && (
        <Card data-testid="storage-quota-strip">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-primary/8 text-primary shrink-0 mt-0.5">
                <HardDrive className="h-4 w-4" />
              </div>
              <div className="flex-1 space-y-2 min-w-0">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Storage quota</span>
                  {isUnlimitedQuota(quota.quotaBytes) ? (
                    <span className="text-muted-foreground text-xs tabular-nums">
                      <span data-testid="quota-used">{formatBytes(quota.usedBytes)}</span>
                      {" used · "}
                      <span data-testid="quota-total" className="text-primary/80 font-medium">Unlimited</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs tabular-nums">
                      <span data-testid="quota-used">{formatBytes(quota.usedBytes)}</span>
                      {" / "}
                      <span data-testid="quota-total">{formatBytes(quota.quotaBytes)}</span>
                      {" · "}
                      <span data-testid="quota-remaining" className="text-primary/80 font-medium">{formatBytes(quota.remainingBytes)}</span>
                      {" free"}
                    </span>
                  )}
                </div>
                {!isUnlimitedQuota(quota.quotaBytes) && (
                  <Progress
                    value={quota.quotaBytes > 0 ? Math.min(100, (quota.usedBytes / quota.quotaBytes) * 100) : 0}
                    className="h-1.5"
                  />
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isStudentUploader && (
        <div
          className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm"
          data-testid="upload-student-notice"
        >
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <span className="font-medium">Student uploads require lecturer or admin approval before they appear publicly.</span>{" "}
            <span className="text-muted-foreground">
              You can only upload to courses you are enrolled in.
            </span>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold border border-primary/20">1</span>
              <div>
                <CardTitle>Select Files</CardTitle>
                <CardDescription className="mt-0.5">
                  Drag & drop or click to browse. PDF, DOCX, PPTX, XLSX, images — up to {MAX_UPLOAD_MB}MB each.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div
              className="border-2 border-dashed border-primary/30 rounded-xl p-8 text-center hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer group"
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              data-testid="upload-dropzone"
            >
              <div className="mx-auto mb-4 h-14 w-14 rounded-xl bg-primary/8 flex items-center justify-center group-hover:bg-primary/12 transition-colors">
                <UploadCloud className="h-7 w-7 text-primary" />
              </div>
              <p className="font-semibold text-foreground">Click to browse or drag files here</p>
              <p className="text-sm text-muted-foreground mt-1.5">
                PDF, DOCX, PPTX, XLSX, PNG, JPG, ZIP · up to {MAX_UPLOAD_MB}MB per file
              </p>
              <input type="file" multiple className="hidden" ref={fileInputRef} onChange={handleFileSelect} />
            </div>
          </CardContent>
        </Card>

        {items.length > 0 && (
          <div className="space-y-3" data-testid="upload-queue">
            {items.map((item) => (
              <FileMetadataCard
                key={item.id}
                item={item}
                courses={courses}
                categories={categories}
                availableTags={availableTags}
                disabled={isUploading}
                onChange={(patch) => updateItem(item.id, patch)}
                onRemove={() => removeItem(item.id)}
                onRetry={() => retryItem(item.id)}
              />
            ))}
          </div>
        )}

        {isStudentUploader && items.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border bg-secondary/40 px-3 py-2" data-testid="upload-autosubmit-row">
            <input
              id="upload-autosubmit"
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={autoSubmitForReview}
              onChange={(e) => setAutoSubmitForReview(e.target.checked)}
              data-testid="upload-autosubmit"
            />
            <label htmlFor="upload-autosubmit" className="text-sm flex-1 cursor-pointer">
              <span className="font-medium">Submit for review immediately after upload</span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                Recommended. Uncheck to keep documents as drafts and submit later.
              </span>
            </label>
          </div>
        )}

        <div className="space-y-4 border-t pt-6">
          <div className="flex items-center gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold border border-primary/20">2</span>
            <div>
              <p className="text-sm font-semibold text-foreground">Review & Upload</p>
              <p className="text-xs text-muted-foreground">
                {items.length === 0
                  ? "Add files above to continue"
                  : `${readyCount} ready · ${needsInfoCount} need${needsInfoCount === 1 ? "s" : ""} info`}
              </p>
            </div>
          </div>
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setLocation("/")} disabled={isUploading}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="lg"
              disabled={readyCount === 0 || isUploading}
              data-testid="upload-submit"
              className="sm:min-w-[180px]"
            >
              {isUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isUploading ? "Uploading…" : `Upload ${readyCount} ${readyCount === 1 ? "File" : "Files"}`}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
