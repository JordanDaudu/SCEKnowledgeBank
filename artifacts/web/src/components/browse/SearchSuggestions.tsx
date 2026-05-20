import { useMemo } from "react";
import { useListDocuments, getListDocumentsQueryKey } from "@workspace/api-client-react";
import { useDebounce } from "@/hooks/use-debounce";
import { FileText } from "lucide-react";

interface Props {
  query: string;
  onSelect: (title: string) => void;
}

export default function SearchSuggestions({ query, onSelect }: Props) {
  const debounced = useDebounce(query, 200);
  const enabled = debounced.trim().length >= 2;

  const params = { q: debounced || undefined, page: 1, pageSize: 10 };
  const { data } = useListDocuments(params, {
    query: { enabled, queryKey: getListDocumentsQueryKey(params) },
  });

  const suggestions = useMemo(() => {
    if (!enabled || !data?.items) return [];
    const seen = new Set<string>();
    const out: { id: string; title: string }[] = [];
    for (const item of data.items) {
      const key = item.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: item.id, title: item.title });
      if (out.length >= 5) break;
    }
    return out;
  }, [data, enabled]);

  if (!enabled || suggestions.length === 0) return null;

  return (
    <div
      className="absolute left-0 right-0 top-full mt-1 z-20 bg-popover border rounded-md shadow-md overflow-hidden"
      data-testid="search-suggestions"
      role="listbox"
    >
      {suggestions.map((s) => (
        <button
          key={s.id}
          type="button"
          role="option"
          aria-selected={false}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(s.title);
          }}
          className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-accent"
          data-testid="search-suggestion-item"
        >
          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="truncate">{s.title}</span>
        </button>
      ))}
    </div>
  );
}
