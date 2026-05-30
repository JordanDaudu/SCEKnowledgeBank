import { useState } from "react";
import {
  useSearchDocumentsV2,
  getSearchDocumentsV2QueryKey,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Search, Plus, X } from "lucide-react";

export interface PickedDoc {
  id: string;
  title: string;
}

/** Search + multi-select picker for library documents, reused by the create
 *  dialog (collect picked docs) and the manage "Add materials" dialog. */
export function MaterialsPicker({
  picked,
  onToggle,
  enabled = true,
  label = "Add materials (optional)",
}: {
  picked: PickedDoc[];
  onToggle: (d: PickedDoc) => void;
  enabled?: boolean;
  label?: string;
}) {
  const [q, setQ] = useState("");
  const searchParams = { q: q.trim() || undefined, page: 1, pageSize: 8 } as const;
  const { data: searchResults } = useSearchDocumentsV2(searchParams, {
    query: {
      queryKey: getSearchDocumentsV2QueryKey(searchParams),
      enabled: enabled && q.trim().length >= 2,
      staleTime: 15_000,
    },
  });

  const pickedIds = new Set(picked.map((p) => p.id));

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {picked.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="picked-materials">
          {picked.map((p) => (
            <span
              key={p.id}
              className="inline-flex max-w-[16rem] items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
            >
              <span className="truncate">{p.title}</span>
              <button
                type="button"
                onClick={() => onToggle(p)}
                aria-label={`Remove ${p.title}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search documents to add…"
          className="pl-8"
        />
      </div>
      {q.trim().length >= 2 && (
        <div className="max-h-40 divide-y overflow-auto rounded-md border">
          {(searchResults?.items ?? [])
            .filter((d) => !pickedIds.has(d.id))
            .map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => onToggle({ id: d.id, title: d.title })}
                className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <span className="truncate">{d.title}</span>
                <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            ))}
          {searchResults &&
            searchResults.items.filter((d) => !pickedIds.has(d.id)).length === 0 && (
              <p className="px-2 py-2 text-xs text-muted-foreground">No matches.</p>
            )}
        </div>
      )}
    </div>
  );
}
