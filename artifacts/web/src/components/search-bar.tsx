import { useState, useRef, useEffect, useMemo } from "react";
import { Search, FileText, GraduationCap, Tag, User } from "lucide-react";
import { Input } from "./ui/input";
import { useLocation } from "wouter";
import {
  useSearchAutocomplete,
  getSearchAutocompleteQueryKey,
} from "@workspace/api-client-react";
import { useDebounce } from "@/hooks/use-debounce";

// Minimum characters before we ask the server for suggestions — below
// this the result set is too broad to be useful.
const MIN_CHARS = 2;
const PER_GROUP = 5;

type Suggestion =
  | { kind: "document"; id: string; label: string }
  | { kind: "course"; id: string; label: string; sub: string; count: number }
  | { kind: "tag"; id: string; label: string; count: number }
  | { kind: "uploader"; id: string; label: string; count: number };

const GROUP_META: Record<
  Suggestion["kind"],
  { heading: string; icon: typeof Search }
> = {
  document: { heading: "Documents", icon: FileText },
  course: { heading: "Courses", icon: GraduationCap },
  tag: { heading: "Tags", icon: Tag },
  uploader: { heading: "People", icon: User },
};

export function SearchBar({
  className = "",
  autoFocus = false,
}: {
  className?: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [, setLocation] = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);

  const debounced = useDebounce(query.trim(), 250);
  const enabled = open && debounced.length >= MIN_CHARS;

  // Memoize the request params and the derived query key on the primitive
  // `debounced` so TanStack Query keys stay referentially stable between
  // renders — mirrors the convention in browse.tsx and avoids needless
  // observer churn / duplicate in-flight fetches.
  const acParams = useMemo(
    () => ({ q: debounced || "_", limit: PER_GROUP }),
    [debounced],
  );
  const acQueryKey = useMemo(
    () => getSearchAutocompleteQueryKey(acParams),
    [acParams],
  );
  const { data, isFetching } = useSearchAutocomplete(acParams, {
    query: {
      enabled,
      staleTime: 30_000,
      queryKey: acQueryKey,
    },
  });

  // Flatten the grouped response into a single ordered list so the
  // keyboard highlight can move across groups seamlessly.
  const suggestions = useMemo<Suggestion[]>(() => {
    if (!data) return [];
    return [
      ...data.documents.map(
        (d): Suggestion => ({ kind: "document", id: d.id, label: d.title }),
      ),
      ...data.courses.map(
        (c): Suggestion => ({
          kind: "course",
          id: c.id,
          label: c.code,
          sub: c.title,
          count: c.count,
        }),
      ),
      ...data.tags.map(
        (t): Suggestion => ({
          kind: "tag",
          id: t.id,
          label: t.name,
          count: t.count,
        }),
      ),
      ...data.uploaders.map(
        (u): Suggestion => ({
          kind: "uploader",
          id: u.id,
          label: u.displayName,
          count: u.count,
        }),
      ),
    ];
  }, [data]);

  // Reset the highlight whenever the suggestion set changes.
  useEffect(() => setActiveIndex(-1), [suggestions]);

  // Close the dropdown on outside click.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const runTextSearch = (text: string) => {
    const t = text.trim();
    if (!t) return;
    setOpen(false);
    setLocation(`/browse?q=${encodeURIComponent(t)}`);
  };

  const go = (s: Suggestion) => {
    setOpen(false);
    switch (s.kind) {
      case "document":
        setLocation(`/documents/${s.id}`);
        break;
      case "course":
        setLocation(`/browse?courseId=${s.id}`);
        break;
      case "tag":
        setLocation(`/browse?tagIds=${s.id}`);
        break;
      case "uploader":
        setLocation(`/browse?uploaderId=${s.id}`);
        break;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        e.preventDefault();
        go(suggestions[activeIndex]);
      } else {
        runTextSearch(query);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  const showPanel = enabled && (suggestions.length > 0 || !isFetching);
  let flatIndex = -1; // running index across groups, mirrors `suggestions`

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <Input
          type="search"
          role="combobox"
          aria-expanded={showPanel}
          aria-autocomplete="list"
          placeholder="Search for lecture notes, syllabi, past exams..."
          className="w-full pl-10 pr-4 py-6 text-base bg-card border-2 border-border focus-visible:ring-primary focus-visible:border-primary rounded-xl"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => query.trim().length >= MIN_CHARS && setOpen(true)}
          onKeyDown={handleKeyDown}
          autoFocus={autoFocus}
        />
      </div>

      {showPanel && (
        <div
          className="absolute z-50 mt-2 w-full overflow-hidden rounded-xl border bg-popover shadow-lg"
          role="listbox"
          data-testid="search-suggestions"
        >
          {suggestions.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              No matches — press Enter to search “{debounced}”.
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto py-1">
              {(["document", "course", "tag", "uploader"] as const).map(
                (kind) => {
                  const group = suggestions.filter((s) => s.kind === kind);
                  if (group.length === 0) return null;
                  const { heading, icon: Icon } = GROUP_META[kind];
                  return (
                    <div key={kind} className="py-1">
                      <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {heading}
                      </div>
                      {group.map((s) => {
                        flatIndex += 1;
                        const idx = flatIndex;
                        const active = idx === activeIndex;
                        return (
                          <button
                            key={`${s.kind}-${s.id}`}
                            type="button"
                            role="option"
                            aria-selected={active}
                            onMouseEnter={() => setActiveIndex(idx)}
                            onClick={() => go(s)}
                            className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${
                              active ? "bg-accent" : "hover:bg-accent/60"
                            }`}
                            data-testid={`suggestion-${s.kind}-${s.id}`}
                          >
                            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate">
                              <span className="font-medium">{s.label}</span>
                              {s.kind === "course" && (
                                <span className="text-muted-foreground">
                                  {" "}
                                  — {s.sub}
                                </span>
                              )}
                            </span>
                            {s.kind !== "document" && (
                              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                {s.count}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                },
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
