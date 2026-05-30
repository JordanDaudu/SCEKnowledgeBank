import { useState } from "react";
import {
  useListMyCollections,
  useCreateCollection,
  useAddCollectionItem,
  getListMyCollectionsQueryKey,
  useGetCurrentUser,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { FolderPlus, Plus, Check } from "lucide-react";

/**
 * Phase 6c — add a document to one of the user's study collections (or a new
 * one) from anywhere. Used on the document detail page.
 *
 * Admins have no Collections workspace so this affordance is hidden for them.
 */
export function AddToCollection({ documentId }: { documentId: string }) {
  const { data: user } = useGetCurrentUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const { data: collections } = useListMyCollections({
    query: { queryKey: getListMyCollectionsQueryKey(), enabled: open },
  });
  const createMut = useCreateCollection();
  const addMut = useAddCollectionItem();

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getListMyCollectionsQueryKey() });

  const addTo = (collectionId: string, title: string) => {
    addMut.mutate(
      { id: collectionId, data: { documentId } },
      {
        onSuccess: () => {
          toast({ title: `Added to "${title}"` });
          refresh();
          setOpen(false);
        },
        onError: () =>
          toast({ variant: "destructive", title: "Could not add to collection" }),
      },
    );
  };

  const createAndAdd = () => {
    const title = newTitle.trim();
    if (!title) return;
    createMut.mutate(
      { data: { title } },
      {
        onSuccess: (col) => {
          setNewTitle("");
          addTo(col.id, col.title);
        },
        onError: () =>
          toast({ variant: "destructive", title: "Could not create collection" }),
      },
    );
  };

  const busy = addMut.isPending || createMut.isPending;

  // Admins manage the platform; they have no Collections workspace.
  if (user?.roles?.includes("admin")) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="add-to-collection"
          className="inline-flex w-full items-center justify-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          <FolderPlus className="h-4 w-4" />
          Add to collection
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
          Add to a collection
        </p>
        <div className="max-h-56 space-y-0.5 overflow-y-auto">
          {collections && collections.length > 0 ? (
            collections.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={busy}
                onClick={() => addTo(c.id, c.title)}
                className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
              >
                <span className="truncate">{c.title}</span>
                <Check className="h-3.5 w-3.5 shrink-0 opacity-0" />
              </button>
            ))
          ) : (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              No collections yet.
            </p>
          )}
        </div>
        <div className="mt-2 flex items-center gap-1 border-t pt-2">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="New collection…"
            className="h-8 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") createAndAdd();
            }}
          />
          <Button
            size="sm"
            className="h-8 shrink-0 px-2"
            disabled={busy || !newTitle.trim()}
            onClick={createAndAdd}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
