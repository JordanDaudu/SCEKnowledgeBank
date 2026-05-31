import { useState } from "react";
import type { SuggestMetadataResponse } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  File as FileIcon,
  X,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Clock,
  RotateCcw,
  Sparkles,
  ChevronDown,
} from "lucide-react";
import { MATERIAL_TYPES } from "@/lib/material-types";
import {
  type ItemMeta,
  type Semester,
  type Visibility,
  isItemReady,
  missingRequiredFields,
} from "@/lib/upload-analysis";

export type ItemStatus = "queued" | "uploading" | "success" | "failed";

export interface CardItem extends ItemMeta {
  id: string;
  filename: string;
  sizeBytes: number;
  status: ItemStatus;
  progress: number;
  error?: string;
  errorCode?: string;
  displayFilename?: string;
  duplicateOfDocumentId?: string;
  duplicateOfTitle?: string;
  suggestion?: SuggestMetadataResponse | null;
  analyzing: boolean;
}

interface Course {
  id: string;
  code: string;
  title: string;
}
interface NamedRow {
  id: string;
  name: string;
}

interface Props {
  item: CardItem;
  courses: Course[] | undefined;
  categories: NamedRow[] | undefined;
  availableTags: NamedRow[] | undefined;
  disabled: boolean;
  onChange: (patch: Partial<ItemMeta>) => void;
  onRemove: () => void;
  onRetry: () => void;
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function FileMetadataCard({
  item,
  courses,
  categories,
  availableTags,
  disabled,
  onChange,
  onRemove,
  onRetry,
}: Props) {
  const [showMore, setShowMore] = useState(false);
  const ready = isItemReady(item);
  const missing = missingRequiredFields(item);
  const s = item.suggestion;

  const toggleTag = (tagId: string) => {
    const next = item.tagIds.includes(tagId)
      ? item.tagIds.filter((t) => t !== tagId)
      : [...item.tagIds, tagId];
    onChange({ tagIds: next });
  };

  return (
    <Card data-testid={`upload-item-${item.status}`}>
      <CardContent className="py-4 space-y-3">
        {/* Header: filename + status */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <FileIcon className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{item.filename}</p>
              <p className="text-xs text-muted-foreground">
                {formatMb(item.sizeBytes)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {item.analyzing && (
              <Badge variant="outline" className="gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Analyzing…
              </Badge>
            )}
            {!item.analyzing && item.status === "queued" && ready && (
              <Badge variant="outline" className="gap-1" data-testid="card-ready">
                <CheckCircle2 className="h-3 w-3 text-green-600" /> Ready
              </Badge>
            )}
            {!item.analyzing && item.status === "queued" && !ready && (
              <Badge
                variant="outline"
                className="gap-1 border-amber-400 text-amber-700"
                data-testid="card-needs-info"
              >
                <AlertTriangle className="h-3 w-3" /> Needs info
              </Badge>
            )}
            {item.status === "uploading" && (
              <Badge variant="outline" className="gap-1">
                <Clock className="h-3 w-3" /> {item.progress}%
              </Badge>
            )}
            {item.status === "success" && (
              <Badge
                variant="default"
                className="gap-1 bg-green-600 hover:bg-green-600"
              >
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
                onClick={onRetry}
                className="h-7 w-7"
                aria-label="Retry upload"
                data-testid="upload-retry"
                disabled={disabled}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            )}
            {item.status !== "uploading" && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onRemove}
                className="h-7 w-7"
                aria-label="Remove file"
                disabled={disabled}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Required fields — always visible while editable */}
        {(item.status === "queued" || item.status === "failed") && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor={`${item.id}-course`} className="text-xs font-medium">Course *</label>
                <Select
                  value={item.courseId}
                  onValueChange={(v) => onChange({ courseId: v })}
                  disabled={disabled}
                >
                  <SelectTrigger id={`${item.id}-course`} data-testid="card-course-select">
                    <SelectValue placeholder="Select course" />
                  </SelectTrigger>
                  <SelectContent>
                    {courses?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.code} - {c.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`${item.id}-type`} className="text-xs font-medium">Material Type *</label>
                <Select
                  value={item.materialType}
                  onValueChange={(v) => onChange({ materialType: v })}
                  disabled={disabled}
                >
                  <SelectTrigger id={`${item.id}-type`} data-testid="card-type-select">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {MATERIAL_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Low-confidence + secondary suggestion chips */}
            {s && (
              <SuggestionChips
                suggestion={s}
                item={item}
                onChange={onChange}
                toggleTag={toggleTag}
              />
            )}

            {/* Collapsible optional metadata */}
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowMore((v) => !v)}
            >
              <ChevronDown
                className={`h-3 w-3 transition-transform ${showMore ? "rotate-180" : ""}`}
              />
              More details
            </button>
            {showMore && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                <div className="space-y-1.5">
                  <label htmlFor={`${item.id}-category`} className="text-xs font-medium">Category</label>
                  <Select
                    value={item.categoryId || "none"}
                    onValueChange={(v) =>
                      onChange({ categoryId: v === "none" ? "" : v })
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger id={`${item.id}-category`}>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {categories?.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor={`${item.id}-visibility`} className="text-xs font-medium">Visibility</label>
                  <Select
                    value={item.visibility}
                    onValueChange={(v) =>
                      onChange({ visibility: v as Visibility })
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger id={`${item.id}-visibility`}>
                      <SelectValue placeholder="Visibility" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">Public (Everyone)</SelectItem>
                      <SelectItem value="restricted">
                        Restricted (Enrolled only)
                      </SelectItem>
                      <SelectItem value="private">Private (Only me)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor={`${item.id}-semester`} className="text-xs font-medium">Semester</label>
                  <Select
                    value={item.semester || "none"}
                    onValueChange={(v) =>
                      onChange({ semester: v === "none" ? "" : (v as Semester) })
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger id={`${item.id}-semester`}>
                      <SelectValue placeholder="Select semester" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="fall">Fall</SelectItem>
                      <SelectItem value="spring">Spring</SelectItem>
                      <SelectItem value="summer">Summer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor={`${item.id}-year`} className="text-xs font-medium">Academic Year</label>
                  <Input
                    id={`${item.id}-year`}
                    type="number"
                    value={item.academicYear}
                    onChange={(e) => onChange({ academicYear: e.target.value })}
                    placeholder="e.g. 2024"
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <label htmlFor={`${item.id}-title`} className="text-xs font-medium">Title</label>
                  <Input
                    id={`${item.id}-title`}
                    type="text"
                    value={item.title}
                    onChange={(e) => onChange({ title: e.target.value })}
                    placeholder="Defaults to the filename if blank"
                    maxLength={300}
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-medium">Tags</label>
                  <div className="flex flex-wrap gap-2">
                    {availableTags?.map((tag) => {
                      const active = item.tagIds.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => toggleTag(tag.id)}
                          disabled={disabled}
                          className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                            active
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background text-foreground border-border hover:border-primary/40"
                          }`}
                        >
                          {tag.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Needs-info hint */}
            {item.status === "queued" && !ready && !item.analyzing && (
              <p
                className="text-xs text-amber-700"
                data-testid="card-missing"
              >
                {missing.map((f) => `${f} is required.`).join(" ")}
              </p>
            )}

            {/* Advisory duplicate warning from analysis */}
            {s?.duplicate && item.status !== "failed" && (
              <p
                className="text-xs text-amber-700"
                data-testid="card-duplicate-warning"
              >
                Possible duplicate of{" "}
                <a
                  href={`/documents/${s.duplicate.documentId}`}
                  className="underline font-medium"
                >
                  {s.duplicate.title}
                </a>
                .
              </p>
            )}
          </>
        )}

        {/* Failed: server/network error + duplicate link */}
        {item.status === "failed" && item.error && (
          <p className="text-xs text-destructive" data-testid="upload-error">
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
                    {item.duplicateOfTitle ? ` "${item.duplicateOfTitle}"` : ""}
                  </a>
                </>
              )}
          </p>
        )}

        {/* Success: server rename notice */}
        {item.status === "success" &&
          item.displayFilename &&
          item.displayFilename !== item.filename && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="upload-rename"
            >
              Uploaded as{" "}
              <span className="font-mono">{item.displayFilename}</span> to avoid
              a duplicate name.
            </p>
          )}
      </CardContent>
    </Card>
  );
}

function SuggestionChips({
  suggestion: s,
  item,
  onChange,
  toggleTag,
}: {
  suggestion: SuggestMetadataResponse;
  item: CardItem;
  onChange: (patch: Partial<ItemMeta>) => void;
  toggleTag: (tagId: string) => void;
}) {
  const showCourseChip =
    s.course && s.courseConfidence === "low" && item.courseId !== s.course.id;
  const showCategoryChip = s.category && item.categoryId !== s.category.id;
  const suggestedTags = (s.tags ?? []).filter(
    (t) => !item.tagIds.includes(t.id),
  );

  if (!showCourseChip && !showCategoryChip && suggestedTags.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/20 bg-primary/5 p-2">
      <Sparkles className="h-3.5 w-3.5 text-primary" />
      {showCourseChip && s.course && (
        <Badge
          variant="outline"
          className="cursor-pointer"
          onClick={() => onChange({ courseId: s.course!.id })}
          data-testid="suggestion-course"
        >
          Suggested course: {s.course.code} - {s.course.title}
        </Badge>
      )}
      {showCategoryChip && s.category && (
        <Badge
          variant="outline"
          className="cursor-pointer"
          onClick={() => onChange({ categoryId: s.category!.id })}
          data-testid="suggestion-category"
        >
          + {s.category.name}
        </Badge>
      )}
      {suggestedTags.map((t) => (
        <Badge
          key={t.id}
          variant="outline"
          className="cursor-pointer"
          onClick={() => toggleTag(t.id)}
          data-testid="suggestion-tag"
        >
          + {t.name}
        </Badge>
      ))}
    </div>
  );
}
