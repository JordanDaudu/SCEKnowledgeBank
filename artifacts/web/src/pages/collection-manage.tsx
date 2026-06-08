import { useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import {
  useGetCollection,
  getGetCollectionQueryKey,
  useUpdateCollection,
  useAddCollectionItem,
  useRemoveCollectionItem,
  useReorderCollection,
  useDeleteCollection,
  useDuplicateCollection,
  useSetDocumentProgress,
  useListCategories,
  useListTags,
  getListMyCollectionsQueryKey,
  type StudyCollectionItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { formatMaterialType } from "@/lib/material-types";
import { KIND_LABEL } from "@/components/collections/CollectionCard";
import {
  CollectionMetadataFields,
  EMPTY_METADATA,
  buildUpdateMetadata,
  type CollectionMetadataState,
} from "@/components/collections/CollectionMetadataFields";
import { MaterialsPicker, type PickedDoc } from "@/components/collections/MaterialsPicker";
import {
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  Trash2,
  FolderOpen,
  CheckCircle2,
  Users,
  TrendingUp,
  Pencil,
  Plus,
  Copy,
  Share2,
  EyeOff,
} from "lucide-react";

function EditCollectionDialog({
  id,
  initial,
  initialTitle,
  initialDescription,
  initialKind,
}: {
  id: string;
  initial: CollectionMetadataState;
  initialTitle: string;
  initialDescription: string;
  initialKind: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [kind, setKind] = useState(initialKind);
  const [meta, setMeta] = useState<CollectionMetadataState>(initial);
  const updateMut = useUpdateCollection();
  const { t } = useTranslation();

  // Re-seed local state each time the dialog opens so edits reflect the
  // latest server data.
  const handleOpenChange = (v: boolean) => {
    if (v) {
      setTitle(initialTitle);
      setDescription(initialDescription);
      setKind(initialKind);
      setMeta(initial);
    }
    setOpen(v);
  };

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    updateMut.mutate(
      {
        id,
        data: {
          title: trimmed,
          description: description.trim(),
          kind: kind as
            | "collection"
            | "exam_prep"
            | "revision"
            | "semester"
            | "learning_path",
          ...buildUpdateMetadata(meta),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetCollectionQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListMyCollectionsQueryKey() });
          setOpen(false);
          toast({ title: t("collectionManage.updated") });
        },
        onError: () => toast({ variant: "destructive", title: t("collectionManage.saveFailed") }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" data-testid="collection-edit">
          <Pencil className="h-4 w-4" /> {t("collectionManage.edit")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("collectionManage.editCollection")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">{t("collections.titleLabel")}</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">{t("collections.description")}</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">{t("collections.kind")}</label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="collection">{t("collections.kindCollection")}</SelectItem>
                <SelectItem value="exam_prep">{t("collections.kindExamPrep")}</SelectItem>
                <SelectItem value="revision">{t("collections.kindRevision")}</SelectItem>
                <SelectItem value="semester">{t("collections.kindSemester")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <CollectionMetadataFields value={meta} onChange={setMeta} />
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!title.trim() || updateMut.isPending}>
            {updateMut.isPending ? t("collectionManage.saving") : t("collectionManage.saveChanges")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddMaterialsDialog({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<PickedDoc[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const addMut = useAddCollectionItem();
  const { t } = useTranslation();

  const togglePick = (d: PickedDoc) =>
    setPicked((prev) =>
      prev.some((p) => p.id === d.id)
        ? prev.filter((p) => p.id !== d.id)
        : [...prev, d],
    );

  const submit = async () => {
    if (picked.length === 0) return;
    setIsSubmitting(true);
    try {
      for (const p of picked) {
        await addMut.mutateAsync({ id, data: { documentId: p.id } });
      }
      queryClient.invalidateQueries({ queryKey: getGetCollectionQueryKey(id) });
      toast({ title: t("collectionManage.added", { count: picked.length }) });
      setPicked([]);
      setOpen(false);
    } catch {
      toast({ variant: "destructive", title: t("collectionManage.addFailed") });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" data-testid="collection-add-materials">
          <Plus className="h-4 w-4" /> {t("collectionManage.addMaterials")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("collectionManage.addMaterials")}</DialogTitle>
        </DialogHeader>
        <MaterialsPicker
          picked={picked}
          onToggle={togglePick}
          enabled={open}
          label={t("collectionManage.searchLibrary")}
        />
        <DialogFooter>
          <Button onClick={submit} disabled={isSubmitting || picked.length === 0}>
            {t("collectionManage.add")} {picked.length > 0 ? `(${picked.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CollectionManage() {
  const { id = "" } = useParams();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();

  const key = getGetCollectionQueryKey(id);
  const { data: col, isLoading } = useGetCollection(id, {
    query: { queryKey: key, enabled: !!id },
  });
  const { data: categories } = useListCategories();
  const { data: tags } = useListTags();

  const removeMut = useRemoveCollectionItem();
  const reorderMut = useReorderCollection();
  const deleteMut = useDeleteCollection();
  const progressMut = useSetDocumentProgress();
  const duplicateMut = useDuplicateCollection();

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const items = col?.items ?? [];
  const orderedIds = items.map((i) => i.document.id);

  const move = (index: number, dir: -1 | 1) => {
    const next = [...orderedIds];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    reorderMut.mutate({ id, data: { documentIds: next } }, { onSuccess: refresh });
  };

  const remove = (documentId: string) =>
    removeMut.mutate({ id, documentId }, { onSuccess: refresh });

  const setProgress = (documentId: string, status: string) =>
    progressMut.mutate(
      { id: documentId, data: { status: status as "reviewing" | "completed" | "none" } },
      { onSuccess: refresh },
    );

  const deleteCollection = () => {
    if (!confirm(t("collectionManage.deleteConfirm"))) return;
    deleteMut.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: t("collectionManage.deleted") });
          queryClient.invalidateQueries({ queryKey: getListMyCollectionsQueryKey() });
          navigate("/collections");
        },
      },
    );
  };

  const duplicate = () =>
    duplicateMut.mutate(
      { id },
      {
        onSuccess: (created) => {
          queryClient.invalidateQueries({ queryKey: getListMyCollectionsQueryKey() });
          toast({ title: t("collectionManage.duplicated") });
          navigate(`/collections/${created.id}`);
        },
        onError: () => toast({ variant: "destructive", title: t("collectionManage.duplicateFailed") }),
      },
    );

  const share = async () => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const link = `${window.location.origin}${base}/prep-hub/${id}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      toast({ variant: "destructive", title: t("collectionManage.copyLinkFailed") });
      return;
    }
    toast({
      title:
        col?.visibility === "public"
          ? t("collectionManage.linkCopied")
          : t("collectionManage.linkCopiedPublicHint"),
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (!col) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        {t("collectionManage.notFound")}{" "}
        <Link href="/collections" className="text-primary hover:underline">
          {t("collectionManage.backToCollections")}
        </Link>
      </div>
    );
  }

  const categoryName = col.categoryId
    ? categories?.find((c) => c.id === col.categoryId)?.name
    : undefined;
  const tagNames = (col.tagIds ?? [])
    .map((tid) => tags?.find((t) => t.id === tid)?.name)
    .filter((n): n is string => !!n);
  const semesterLabel = col.semester
    ? col.semester.charAt(0).toUpperCase() + col.semester.slice(1)
    : undefined;
  const hasMeta =
    !!categoryName ||
    !!col.examName ||
    !!semesterLabel ||
    !!col.academicYear ||
    tagNames.length > 0;

  const editInitial: CollectionMetadataState = {
    ...EMPTY_METADATA,
    visibility: col.visibility,
    categoryId: col.categoryId ?? "none",
    examName: col.examName ?? "",
    semester: col.semester ?? "none",
    academicYear: col.academicYear != null ? String(col.academicYear) : "",
    tagIds: col.tagIds ?? [],
  };

  return (
    <div className="space-y-6">
      <Link
        href="/collections"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> {t("collectionManage.collectionsBack")}
      </Link>

      {col.hiddenAt && (
        <Alert variant="destructive" data-testid="collection-hidden-banner">
          <EyeOff className="h-4 w-4" />
          <AlertTitle>{t("collectionManage.hiddenTitle")}</AlertTitle>
          <AlertDescription>
            {t("collectionManage.hiddenDescPrefix")}
            {col.hiddenReason ? `: ${col.hiddenReason}` : ""}
            {t("collectionManage.hiddenDescSuffix")}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <FolderOpen className="h-6 w-6 text-primary" />
            <h1 className="font-serif text-3xl font-bold text-foreground">{col.title}</h1>
            <Badge variant="outline">{KIND_LABEL[col.kind] ?? col.kind}</Badge>
          </div>
          {col.description && <p className="text-muted-foreground">{col.description}</p>}
          {hasMeta && (
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {categoryName && (
                <span>
                  {t("collectionManage.subject")} <span className="text-foreground">{categoryName}</span>
                </span>
              )}
              {col.examName && (
                <span>
                  {t("collectionManage.exam")} <span className="text-foreground">{col.examName}</span>
                </span>
              )}
              {(semesterLabel || col.academicYear) && (
                <span>
                  {semesterLabel}
                  {semesterLabel && col.academicYear ? " " : ""}
                  {col.academicYear ?? ""}
                </span>
              )}
              {tagNames.length > 0 && (
                <span className="flex flex-wrap items-center gap-1">
                  {tagNames.map((n) => (
                    <Badge key={n} variant="secondary" className="text-[10px]">
                      {n}
                    </Badge>
                  ))}
                </span>
              )}
            </p>
          )}
          <p className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
            <span>
              {t("collectionManage.documentCount", { count: col.itemCount })}
            </span>
            <span className="inline-flex items-center gap-1" title={t("collectionManage.followers")}>
              <Users className="h-3.5 w-3.5" />
              {col.followerCount}
            </span>
            <span
              className="inline-flex items-center gap-1 text-primary/80"
              title={t("collectionManage.popularityTitle")}
            >
              <TrendingUp className="h-3.5 w-3.5" />
              {col.popularityScore}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <EditCollectionDialog
            id={id}
            initial={editInitial}
            initialTitle={col.title}
            initialDescription={col.description ?? ""}
            initialKind={col.kind}
          />
          <AddMaterialsDialog id={id} />
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={duplicate}
            disabled={duplicateMut.isPending}
            data-testid="collection-duplicate"
          >
            <Copy className="h-4 w-4" /> {t("collectionManage.duplicate")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={share}
            data-testid="collection-share"
          >
            <Share2 className="h-4 w-4" /> {t("collectionManage.share")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1 text-destructive"
            onClick={deleteCollection}
            data-testid="collection-delete"
          >
            <Trash2 className="h-4 w-4" /> {t("collectionManage.delete")}
          </Button>
        </div>
      </div>

      {col.itemCount > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">{t("collectionManage.studyProgress")}</span>
            <span className="text-muted-foreground tabular-nums">
              {t("collectionManage.progressDetail", { completed: col.completedCount, total: col.itemCount, pct: col.progressPercent })}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${col.progressPercent}%` }}
              role="progressbar"
              aria-valuenow={col.progressPercent}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card py-16 text-center" data-testid="collection-empty">
          <p className="text-muted-foreground">
            {t("collectionManage.emptyUse")}{" "}
            <span className="font-medium">{t("collectionManage.emptyAddMaterials")}</span>{" "}
            {t("collectionManage.emptyAboveOr")}{" "}
            <Link href="/browse" className="text-primary hover:underline">
              {t("collectionManage.browseLibrary")}
            </Link>
            .
          </p>
        </div>
      ) : (
        <ul className="space-y-2" data-testid="collection-items">
          {items.map((item: StudyCollectionItem, index: number) => (
            <li key={item.document.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center gap-3 p-3">
                  <div className="flex flex-col">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      disabled={index === 0 || reorderMut.isPending}
                      onClick={() => move(index, -1)}
                      aria-label={t("collectionManage.moveUp")}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      disabled={index === items.length - 1 || reorderMut.isPending}
                      onClick={() => move(index, 1)}
                      aria-label={t("collectionManage.moveDown")}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/documents/${item.document.id}`}
                        className="truncate font-medium hover:text-primary"
                      >
                        {item.document.title}
                      </Link>
                      {item.progress === "completed" && (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatMaterialType(item.document.materialType)}
                      {item.document.course ? ` · ${item.document.course.code}` : ""}
                    </p>
                    {item.note && (
                      <p className="mt-0.5 text-xs italic text-muted-foreground">"{item.note}"</p>
                    )}
                  </div>
                  <Select
                    value={item.progress ?? "none"}
                    onValueChange={(v) => setProgress(item.document.id, v)}
                  >
                    <SelectTrigger className="h-8 w-32" data-testid="item-progress">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("collectionManage.notStarted")}</SelectItem>
                      <SelectItem value="reviewing">{t("collectionManage.reviewing")}</SelectItem>
                      <SelectItem value="completed">{t("collectionManage.completed")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    disabled={removeMut.isPending}
                    onClick={() => remove(item.document.id)}
                    aria-label={t("collectionManage.removeFromCollection")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
