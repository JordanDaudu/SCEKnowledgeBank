import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useBulkDocumentAction,
  type Document,
  type Tag,
  type Category,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/document-detail/StatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/format";
import { formatMaterialType } from "@/lib/material-types";
import { apiUrl } from "@/lib/api-url";
import {
  iconForFallbackType,
  type FallbackIconType,
} from "@/lib/fallback-icon";
import { renderSnippetHtml } from "@/lib/snippet";
import {
  SlidersHorizontal,
  Tag as TagIcon,
  FolderClosed,
  Trash2,
  Loader2,
  X,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
} from "lucide-react";

interface Props {
  items: (Document & { headline?: string })[];
  tags?: Tag[];
  categories?: Category[];
  /** Current sort value (from Browse) — drives the column-header indicators. */
  sort?: string;
  /** Called when a sortable column header is clicked. */
  onSortChange?: (sort: string) => void;
}

/** A clickable, sort-aware column header. `asc`/`desc` name the sort values
 *  this column toggles between (desc omitted for title, which is asc-only). */
function SortHeader({
  label,
  asc,
  desc,
  sort,
  onSortChange,
  className,
}: {
  label: string;
  asc: string;
  desc?: string;
  sort?: string;
  onSortChange?: (s: string) => void;
  className?: string;
}) {
  if (!onSortChange) return <span className={className}>{label}</span>;
  const isAsc = sort === asc;
  const isDesc = desc != null && sort === desc;
  const active = isAsc || isDesc;
  const next = desc == null ? asc : isDesc ? asc : desc;
  return (
    <button
      type="button"
      onClick={() => onSortChange(next)}
      className={
        "inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
        (active ? "text-foreground font-medium" : "") +
        (className ? ` ${className}` : "")
      }
      data-testid={`sort-${label.toLowerCase()}`}
    >
      {label}
      {isAsc ? (
        <ArrowUp className="h-3.5 w-3.5" />
      ) : isDesc ? (
        <ArrowDown className="h-3.5 w-3.5" />
      ) : (
        <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
      )}
    </button>
  );
}

type ColumnKey = "course" | "type" | "status" | "uploaded";

const COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: "course", label: "Course" },
  { key: "type", label: "Type" },
  { key: "status", label: "Status" },
  { key: "uploaded", label: "Uploaded" },
];

const COLS_KEY = "kb:browse:cols";

function readHiddenCols(): ColumnKey[] {
  try {
    const raw = localStorage.getItem(COLS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((k): k is ColumnKey =>
      COLUMNS.some((c) => c.key === k),
    );
  } catch {
    return [];
  }
}

export default function DocumentTable({
  items,
  tags,
  categories,
  sort,
  onSortChange,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const bulk = useBulkDocumentAction();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hiddenCols, setHiddenCols] = useState<ColumnKey[]>(() => readHiddenCols());
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify(hiddenCols));
    } catch {
      /* ignore */
    }
  }, [hiddenCols]);

  // Drop selections that are no longer in the current page of results.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const ids = new Set(items.map((d) => d.id));
      const next = new Set<string>();
      for (const id of prev) if (ids.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  const isVisible = (key: ColumnKey) => !hiddenCols.includes(key);
  const toggleCol = (key: ColumnKey) =>
    setHiddenCols((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );

  const allSelected = items.length > 0 && selected.size === items.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(items.map((d) => d.id)));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  const invalidate = () =>
    queryClient.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey?.[0];
        return (
          k === "/v2/documents/search" ||
          k === "/v2/documents/facets" ||
          (typeof k === "string" && k.includes("documents"))
        );
      },
    });

  const runBulk = (
    body: Parameters<typeof bulk.mutate>[0]["data"],
    successMsg: (ok: number, fail: number) => string,
  ) => {
    bulk.mutate(
      { data: body },
      {
        onSuccess: async (res) => {
          const ok = res.results.filter((r) => r.success).length;
          const fail = res.results.length - ok;
          await invalidate();
          setSelected(new Set());
          toast({
            title: successMsg(ok, fail),
            variant: fail > 0 ? "destructive" : undefined,
          });
        },
        onError: () => {
          toast({ variant: "destructive", title: "Bulk action failed" });
        },
      },
    );
  };

  const handleDelete = () => {
    setConfirmDelete(false);
    runBulk(
      { action: "delete", ids: selectedIds },
      (ok, fail) =>
        fail > 0
          ? `Deleted ${ok}, ${fail} failed`
          : `Deleted ${ok} document${ok === 1 ? "" : "s"}`,
    );
  };

  const handleAddTag = (tagId: string) =>
    runBulk(
      { action: "add_tag", ids: selectedIds, tagId },
      (ok, fail) =>
        fail > 0 ? `Tagged ${ok}, ${fail} failed` : `Tagged ${ok} document${ok === 1 ? "" : "s"}`,
    );

  const handleAssignCategory = (categoryId: string | null) =>
    runBulk(
      { action: "assign_category", ids: selectedIds, categoryId },
      (ok, fail) =>
        fail > 0
          ? `Updated ${ok}, ${fail} failed`
          : `Updated ${ok} document${ok === 1 ? "" : "s"}`,
    );

  const colCount = 2 + COLUMNS.filter((c) => isVisible(c.key)).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-h-9 flex items-center">
          {selected.size > 0 ? (
            <div
              className="flex items-center gap-2 flex-wrap"
              data-testid="bulk-toolbar"
            >
              <span className="text-sm font-medium" data-testid="bulk-count">
                {selected.size} selected
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => setSelected(new Set())}
              >
                <X className="h-3.5 w-3.5" /> Clear
              </Button>

              {tags && tags.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={bulk.isPending}
                      data-testid="bulk-tag-trigger"
                    >
                      <TagIcon className="h-3.5 w-3.5" /> Add tag
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                    <DropdownMenuLabel>Add a tag to selected</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {tags.map((t) => (
                      <DropdownMenuItem key={t.id} onSelect={() => handleAddTag(t.id)}>
                        {t.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {categories && categories.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={bulk.isPending}
                      data-testid="bulk-category-trigger"
                    >
                      <FolderClosed className="h-3.5 w-3.5" /> Set category
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                    <DropdownMenuLabel>Assign category to selected</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {categories.map((c) => (
                      <DropdownMenuItem
                        key={c.id}
                        onSelect={() => handleAssignCategory(c.id)}
                      >
                        {c.name}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => handleAssignCategory(null)}>
                      Clear category
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              <Button
                variant="outline"
                size="sm"
                className="h-8 text-destructive hover:text-destructive"
                disabled={bulk.isPending}
                onClick={() => setConfirmDelete(true)}
                data-testid="bulk-delete-trigger"
              >
                {bulk.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Delete
              </Button>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">
              Select rows to act on multiple documents.
            </span>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8" data-testid="column-toggle">
              <SlidersHorizontal className="h-3.5 w-3.5" /> Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {COLUMNS.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.key}
                checked={isVisible(c.key)}
                onCheckedChange={() => toggleCol(c.key)}
                onSelect={(e) => e.preventDefault()}
              >
                {c.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                  data-testid="select-all"
                />
              </TableHead>
              <TableHead>
                <SortHeader
                  label="Title"
                  asc="title"
                  sort={sort}
                  onSortChange={onSortChange}
                />
              </TableHead>
              {isVisible("course") && <TableHead>Course</TableHead>}
              {isVisible("type") && <TableHead>Type</TableHead>}
              {isVisible("status") && <TableHead>Status</TableHead>}
              {isVisible("uploaded") && (
                <TableHead>
                  <SortHeader
                    label="Uploaded"
                    asc="oldest"
                    desc="recent"
                    sort={sort}
                    onSortChange={onSortChange}
                  />
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colCount} className="text-center text-muted-foreground py-8">
                  No documents.
                </TableCell>
              </TableRow>
            ) : (
              items.map((doc) => {
                const checked = selected.has(doc.id);
                return (
                  <TableRow
                    key={doc.id}
                    data-state={checked ? "selected" : undefined}
                    className="cursor-pointer"
                  >
                    <TableCell className="w-10">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleOne(doc.id)}
                        aria-label={`Select ${doc.title}`}
                        data-testid="row-select"
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link href={`/documents/${doc.id}`}>
                        <span className="inline-flex items-center gap-2 hover:underline">
                          {doc.thumbnailUrl ? (
                            <img
                              src={apiUrl(doc.thumbnailUrl)}
                              alt=""
                              aria-hidden="true"
                              loading="lazy"
                              className="h-6 w-6 object-cover rounded border"
                            />
                          ) : (
                            (() => {
                              const Icon = iconForFallbackType(
                                doc.fallbackIconType as FallbackIconType | undefined,
                              );
                              return (
                                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                              );
                            })()
                          )}
                          {doc.title}
                        </span>
                      </Link>
                      {doc.headline && (
                        <div
                          className="text-xs text-muted-foreground mt-1 line-clamp-1 [&_mark]:bg-yellow-200/60 [&_mark]:text-foreground [&_mark]:rounded [&_mark]:px-0.5"
                          data-testid="doc-snippet"
                          dangerouslySetInnerHTML={{ __html: renderSnippetHtml(doc.headline) }}
                        />
                      )}
                    </TableCell>
                    {isVisible("course") && (
                      <TableCell>
                        {doc.course ? (
                          <Badge variant="outline" className="font-mono font-normal">
                            {doc.course.code}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                    )}
                    {isVisible("type") && (
                      <TableCell>
                        <Badge variant="secondary" className="capitalize text-xs font-normal">
                          {formatMaterialType(doc.materialType)}
                        </Badge>
                      </TableCell>
                    )}
                    {isVisible("status") && (
                      <TableCell>
                        {doc.status !== "published" ? (
                          <StatusBadge status={doc.status} />
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                    )}
                    {isVisible("uploaded") && (
                      <TableCell className="text-muted-foreground text-xs">
                        {formatDateTime(doc.createdAt)}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selected.size} document{selected.size === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This moves the selected documents to the recycle bin using the same
              per-document delete used elsewhere. This action is audited.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
