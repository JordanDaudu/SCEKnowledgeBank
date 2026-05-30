import { useState } from "react";
import { useLocation } from "wouter";
import {
  useListMyCollections,
  getListMyCollectionsQueryKey,
  useCreateCollection,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
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
    setKind("collection");
    setMeta(EMPTY_METADATA);
    setPicked([]);
  };

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    createMut.mutate(
      {
        data: {
          title: t,
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
          toast({ variant: "destructive", title: "Could not create collection" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-1.5" data-testid="new-collection">
          <Plus className="h-4 w-4" /> New collection
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New study collection</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Title</label>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. CS101 Final Prep"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Kind</label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="collection">Collection</SelectItem>
                <SelectItem value="exam_prep">Exam prep</SelectItem>
                <SelectItem value="revision">Revision</SelectItem>
                <SelectItem value="semester">Semester</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <CollectionMetadataFields value={meta} onChange={setMeta} />

          <MaterialsPicker picked={picked} onToggle={togglePick} enabled={open} />
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!title.trim() || createMut.isPending}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Collections() {
  const { data: collections, isLoading } = useListMyCollections({
    query: { queryKey: getListMyCollectionsQueryKey(), staleTime: 15_000 },
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2.5">
            <div className="shrink-0 rounded-lg bg-primary/10 p-1.5">
              <FolderOpen className="h-5 w-5 text-primary" />
            </div>
            <h1 className="font-serif text-3xl font-bold text-foreground">Collections</h1>
          </div>
          <p className="text-muted-foreground">
            Create and organize bundles of approved materials.
          </p>
        </div>
        <CreateCollectionDialog />
      </div>

      <section aria-label="My collections">
        <h2 className="mb-3 font-serif text-xl font-bold text-foreground">
          My collections
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
              No collections yet. Create one to start organizing your study materials.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
