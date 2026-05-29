import {
  useSearchAutocomplete,
  getSearchAutocompleteQueryKey,
  type SearchAutocomplete,
} from "@workspace/api-client-react";
import { useDebounce } from "@/hooks/use-debounce";
import { Tag, BookOpen, User } from "lucide-react";

interface Props {
  query: string;
  /** Picking a free-text suggestion fills the search bar with it (legacy contract). */
  onSelect: (title: string) => void;
  onPickCourse?: (id: string) => void;
  onPickUploader?: (id: string) => void;
  onPickTag?: (id: string) => void;
}

type Group = "tag" | "course" | "uploader";

interface Row {
  key: string;
  group: Group;
  label: string;
  hint?: string;
  onPick: () => void;
}

/**
 * M3 autocomplete dropdown. Calls the v2 autocomplete endpoint which
 * groups results by tag / course / uploader. Selecting a structured
 * hit applies the corresponding filter (via the optional pick
 * callbacks); legacy free-text behaviour is preserved by `onSelect`
 * — picking a course/uploader/tag also clears the search bar so the
 * filter is doing the work.
 */
export default function SearchSuggestions({
  query,
  onSelect,
  onPickCourse,
  onPickUploader,
  onPickTag,
}: Props) {
  const debounced = useDebounce(query, 200);
  const enabled = debounced.trim().length >= 2;
  const acParams = { q: debounced, limit: 5 };
  const { data } = useSearchAutocomplete(acParams, {
    query: { enabled, queryKey: getSearchAutocompleteQueryKey(acParams) },
  });

  const rows = enabled ? toRows(data, { onSelect, onPickCourse, onPickUploader, onPickTag }) : [];
  if (!enabled || rows.length === 0) return null;

  return (
    <div
      className="absolute left-0 right-0 top-full mt-1 z-20 bg-popover border rounded-md shadow-md overflow-hidden"
      data-testid="search-suggestions"
      role="listbox"
    >
      {rows.map((r) => (
        <button
          key={r.key}
          type="button"
          role="option"
          aria-selected={false}
          onMouseDown={(e) => {
            e.preventDefault();
            r.onPick();
          }}
          className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-accent"
          data-testid={`search-suggestion-${r.group}`}
        >
          {r.group === "tag" && <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          {r.group === "course" && <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          {r.group === "uploader" && <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          <span className="truncate flex-1">{r.label}</span>
          {r.hint && (
            <span className="text-xs text-muted-foreground shrink-0">{r.hint}</span>
          )}
        </button>
      ))}
    </div>
  );
}

function toRows(
  data: SearchAutocomplete | undefined,
  picks: {
    onSelect: (s: string) => void;
    onPickCourse?: (id: string) => void;
    onPickUploader?: (id: string) => void;
    onPickTag?: (id: string) => void;
  },
): Row[] {
  if (!data) return [];
  const out: Row[] = [];
  for (const t of data.tags.slice(0, 5)) {
    out.push({
      key: `tag:${t.id}`,
      group: "tag",
      label: t.name,
      hint: `${t.count}`,
      onPick: () => {
        if (picks.onPickTag) picks.onPickTag(t.id);
        else picks.onSelect(t.name);
      },
    });
  }
  for (const c of data.courses.slice(0, 5)) {
    out.push({
      key: `course:${c.id}`,
      group: "course",
      label: `${c.code} · ${c.title}`,
      hint: `${c.count}`,
      onPick: () => {
        if (picks.onPickCourse) picks.onPickCourse(c.id);
        else picks.onSelect(c.code);
      },
    });
  }
  for (const u of data.uploaders.slice(0, 5)) {
    out.push({
      key: `uploader:${u.id}`,
      group: "uploader",
      label: u.displayName,
      hint: `${u.count}`,
      onPick: () => {
        if (picks.onPickUploader) picks.onPickUploader(u.id);
        else picks.onSelect(u.displayName);
      },
    });
  }
  return out;
}
