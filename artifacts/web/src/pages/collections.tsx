import { useState } from "react";
import { useLocation } from "wouter";
import {
  useListMyCollections,
  getListMyCollectionsQueryKey,
  useCreateCollection,
  useListFollowedCollections,
  getListFollowedCollectionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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
import { FolderOpen, Plus } from "lucide-react";
import { CollectionGrid } from "@/components/collections/CollectionCard";
import {
  CollectionMetadataFields,
  EMPTY_METADATA,
  buildCreateMetadata,
  type CollectionMetadataState,
} from "@/components/collections/CollectionMetadataFields";
import { MaterialsPicker, type PickedDoc } from "@/components/collections/MaterialsPicker";

function CreateCollectionDialog() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("collection");
  const [meta, setMeta] = useState<CollectionMetadataState>(EMPTY_METADATA);
  const [picked, setPicked] = useState<PickedDoc[]>([]);
  const createMut = useCreateCollection();

  const togglePick = (d: PickedDoc) =>
    setPicked((prev) =>
      prev.some((p) => p.id === d.id)
        ? prev.filter((p) => p.id !== d.id)
        : [...prev, d],
    );

  const reset = () => {
    setTitle("");
    setDescription("");
    setKind("collection");
    setMeta(EMPTY_METADATA);
    setPicked([]);
  };

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    createMut.mutate(
      {
        data: {
          title: trimmed,
          ...(description.trim() ? { description: description.trim() } : {}),
          kind: kind as
            | "collection"
            | "exam_prep"
            | "revision"
            | "semester"
            | "learning_path",
          ...buildCreateMetadata(meta),
          ...(picked.length > 0 ? { documentIds: picked.map((p) => p.id) } : {}),
        },
      },
      {
        onSuccess: (col) => {
          queryClient.invalidateQueries({ queryKey: getListMyCollectionsQueryKey() });
          setOpen(false);
          reset();
          navigate(`/collections/${col.id}`);
        },
        onError: () =>
          toast({ variant: "destructive", title: t("collections.createFailed") }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-1.5" data-testid="new-collection">
          <Plus className="h-4 w-4" /> {t("collections.newCollection")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("collections.newCollectionTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">{t("collections.titleLabel")}</label>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("collections.titlePlaceholder")}
            />
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

          <MaterialsPicker picked={picked} onToggle={togglePick} enabled={open} />
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!title.trim() || createMut.isPending}>
            {t("collections.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Collections() {
  const { t } = useTranslation();
  const { data: collections, isLoading } = useListMyCollections({
    query: { queryKey: getListMyCollectionsQueryKey(), staleTime: 15_000 },
  });
  const { data: followed, isLoading: followedLoading } = useListFollowedCollections({
    query: { queryKey: getListFollowedCollectionsQueryKey(), staleTime: 15_000 },
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2.5">
            <div className="shrink-0 rounded-lg bg-primary/10 p-1.5">
              <FolderOpen className="h-5 w-5 text-primary" />
            </div>
            <h1 className="font-serif text-3xl font-bold text-foreground">{t("collections.title")}</h1>
          </div>
          <p className="text-muted-foreground">
            {t("collections.subtitle")}
          </p>
        </div>
        <CreateCollectionDialog />
      </div>

      <section aria-label={t("collections.myCollections")}>
        <h2 className="mb-3 font-serif text-xl font-bold text-foreground">
          {t("collections.myCollections")}
        </h2>
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        ) : collections && collections.length > 0 ? (
          <CollectionGrid
            collections={collections}
            basePath="/collections"
            testid="collections-grid"
          />
        ) : (
          <div
            className="rounded-xl border border-dashed bg-card py-16 text-center"
            data-testid="collections-empty"
          >
            <FolderOpen className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="text-muted-foreground">
              {t("collections.myCollectionsEmpty")}
            </p>
          </div>
        )}
      </section>

      <section aria-label={t("collections.followed")}>
        <h2 className="mb-3 font-serif text-xl font-bold text-foreground">
          {t("collections.followed")}
        </h2>
        {followedLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        ) : followed && followed.length > 0 ? (
          <CollectionGrid
            collections={followed}
            basePath="/prep-hub"
            testid="followed-collections-grid"
          />
        ) : (
          <div
            className="rounded-xl border border-dashed bg-card py-12 text-center"
            data-testid="followed-collections-empty"
          >
            <p className="text-sm text-muted-foreground">
              {t("collections.followedEmpty")}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
