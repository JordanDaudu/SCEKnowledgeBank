import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "./ui/input";
import { useLocation } from "wouter";

// Sprint-3 M7: the legacy `/documents/suggestions` autocomplete was
// retired. The search bar now just routes Enter → `/browse?q=…`,
// where the rank-aware v2 search surface takes over.
export function SearchBar({ className = "", autoFocus = false }: { className?: string, autoFocus?: boolean }) {
  const [query, setQuery] = useState("");
  const [, setLocation] = useLocation();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && query.trim()) {
      setLocation(`/browse?q=${encodeURIComponent(query.trim())}`);
    }
  };

  return (
    <div className={`relative ${className}`}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search for lecture notes, syllabi, past exams..."
          className="w-full pl-10 pr-4 py-6 text-base bg-card border-2 border-border focus-visible:ring-primary focus-visible:border-primary rounded-xl"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus={autoFocus}
        />
      </div>
    </div>
  );
}
