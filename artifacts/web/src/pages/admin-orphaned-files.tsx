import { useState } from "react";
import {
  useListOrphanedFiles,
  getListOrphanedFilesQueryKey,
  useReassignOrphanedFile,
  useDeleteOrphanedFile,
  useSearchUsers,
  getSearchUsersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { FileWarning } from "lucide-react";

function Reassign({ documentId, onDone }: { documentId: string; onDone: () => void }) {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const debounced = useDebounce(q, 300);
  const params = { q: debounced.trim(), limit: 6 };
  const { data: users } = useSearchUsers(params, {
    query: { queryKey: getSearchUsersQueryKey(params), enabled: debounced.trim().length > 0 },
  });
  const reassignMut = useReassignOrphanedFile();
  return (
    <div className="space-y-1">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Reassign to… (search active users)"
        className="h-8"
        data-testid="reassign-search"
      />
      {debounced.trim().length > 0 && users && users.length > 0 && (
        <ul className="rounded-md border bg-popover">
          {users.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                disabled={reassignMut.isPending}
                onClick={() =>
                  reassignMut.mutate(
                    { documentId, data: { newOwnerId: u.id } },
                    {
                      onSuccess: () => { onDone(); toast({ title: `Reassigned to ${u.displayName}` }); },
                      onError: () => toast({ variant: "destructive", title: "Could not reassign" }),
                    },
                  )
                }
              >
                {u.displayName} · {u.email}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AdminOrphanedFiles() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: files, isLoading } = useListOrphanedFiles({
    query: { queryKey: getListOrphanedFilesQueryKey() },
  });
  const deleteMut = useDeleteOrphanedFile();
  const refresh = () => queryClient.invalidateQueries({ queryKey: getListOrphanedFilesQueryKey() });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-2.5">
        <div className="rounded-lg bg-primary/10 p-1.5"><FileWarning className="h-5 w-5 text-primary" /></div>
        <h1 className="font-serif text-3xl font-bold text-foreground">Orphaned files</h1>
      </div>
      <p className="text-muted-foreground">
        Documents whose uploader's account was deleted. Keep them as-is, reassign to an active
        user, or delete.
      </p>
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : files && files.length > 0 ? (
        <ul className="space-y-3" data-testid="orphaned-files">
          {files.map((f) => (
            <li key={f.id}>
              <Card>
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">
                      {f.title}
                      {f.courseCode ? <span className="text-muted-foreground"> · {f.courseCode}</span> : null}
                    </span>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={deleteMut.isPending}
                      onClick={() =>
                        deleteMut.mutate(
                          { documentId: f.id },
                          { onSuccess: () => { refresh(); toast({ title: "File deleted" }); } },
                        )
                      }
                      data-testid="orphan-delete"
                    >
                      Delete
                    </Button>
                  </div>
                  <Reassign documentId={f.id} onDone={refresh} />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed bg-card py-16 text-center">
          <p className="text-muted-foreground">No orphaned files.</p>
        </div>
      )}
    </div>
  );
}
