import { useState, useRef, useEffect } from "react";
import { useDocumentSuggestions, getDocumentSuggestionsQueryKey } from "@workspace/api-client-react";
import { useDebounce } from "@/hooks/use-debounce";
import { Search, Loader2, FileText, ChevronRight } from "lucide-react";
import { Input } from "./ui/input";
import { Link, useLocation } from "wouter";

export function SearchBar({ className = "", autoFocus = false }: { className?: string, autoFocus?: boolean }) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [, setLocation] = useLocation();

  const { data: suggestions, isLoading } = useDocumentSuggestions(
    { q: debouncedQuery, limit: 5 },
    { query: { enabled: debouncedQuery.length > 1, queryKey: getDocumentSuggestionsQueryKey({ q: debouncedQuery, limit: 5 }) } }
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && query.trim()) {
      setIsOpen(false);
      setLocation(`/browse?q=${encodeURIComponent(query.trim())}`);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search for lecture notes, syllabi, past exams..."
          className="w-full pl-10 pr-4 py-6 text-base bg-card border-2 border-border focus-visible:ring-primary focus-visible:border-primary rounded-xl"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          autoFocus={autoFocus}
        />
        {isLoading && debouncedQuery.length > 1 && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground animate-spin" />
        )}
      </div>

      {isOpen && debouncedQuery.length > 1 && suggestions && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-card border rounded-xl shadow-lg overflow-hidden z-50">
          <ul className="py-2">
            {suggestions.map((suggestion) => (
              <li key={suggestion.id}>
                <Link 
                  href={`/documents/${suggestion.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-secondary transition-colors"
                  onClick={() => setIsOpen(false)}
                >
                  <div className="flex items-center gap-3">
                    <div className="bg-primary/10 p-2 rounded-lg text-primary">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-medium text-foreground">{suggestion.title}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                        {suggestion.courseCode && <span className="font-mono bg-secondary px-1.5 rounded">{suggestion.courseCode}</span>}
                        {suggestion.materialType && <span className="capitalize">{suggestion.materialType.replace("-", " ")}</span>}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
          <div className="bg-secondary/50 px-4 py-3 text-sm text-center border-t">
            <Link 
              href={`/browse?q=${encodeURIComponent(debouncedQuery)}`}
              className="text-primary font-medium hover:underline flex items-center justify-center gap-1"
              onClick={() => setIsOpen(false)}
            >
              See all results <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
