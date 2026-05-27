import { useEffect, useRef, useState } from "react";
import {
  useSearchUsers,
  getSearchUsersQueryKey,
  type UserSummary,
} from "@workspace/api-client-react";
import { useDebounce } from "@/hooks/use-debounce";

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  textareaTestId?: string;
}

/**
 * A textarea with an inline `@` picker.
 *
 * Sprint-3 M6 polish:
 * - Search input is debounced 200ms so we don't fire one request per
 *   keystroke as the user types out a partial token.
 * - Keyboard nav: ArrowUp/Down to move the highlighted suggestion,
 *   Enter to apply it, Esc to close the dropdown without changing the
 *   text.
 * - Each suggestion shows an avatar bubble (the user's display-name
 *   initial) so the picker is scannable when several names share a
 *   prefix.
 *
 * Selecting a user replaces the partial token with `@[<userId>] ` —
 * the explicit-id form the backend `parseMentionTokens` parser
 * resolves unambiguously, even for users whose display name contains
 * spaces ("Dr. Maya Cohen"), which would otherwise be truncated to
 * the first word by the contiguous-token regex.
 */
export default function MentionPicker({
  value,
  onChange,
  placeholder,
  rows = 3,
  textareaTestId,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [tokenStart, setTokenStart] = useState<number | null>(null);
  const [highlightIdx, setHighlightIdx] = useState(0);

  // Debounce the *search* query (what we send to the API), not the
  // picker open/close decision — we still want the dropdown to open
  // immediately as the user types so it doesn't feel laggy.
  const debouncedQuery = useDebounce(activeQuery ?? "", 200);

  // Detect the currently-being-typed @token (if any) at the caret.
  function refreshTokenFromCaret() {
    const el = textareaRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? value.length;
    const head = value.slice(0, caret);
    const match = /(?:^|\s)@([A-Za-z0-9_][A-Za-z0-9_.\-]{0,63})$/.exec(head);
    if (match) {
      setTokenStart(caret - match[1]!.length - 1);
      setActiveQuery(match[1]!);
    } else {
      setTokenStart(null);
      setActiveQuery(null);
    }
  }

  useEffect(() => {
    refreshTokenFromCaret();
    // We intentionally only refresh on value/selection changes via the
    // event handlers below — running on every render would race with
    // controlled-input updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Reset highlight whenever the query changes so we don't point at a
  // stale row index when the suggestion list shrinks.
  useEffect(() => {
    setHighlightIdx(0);
  }, [debouncedQuery]);

  const searchParams = { q: debouncedQuery, limit: 6 };
  const { data: suggestions } = useSearchUsers(searchParams, {
    query: {
      enabled: !!activeQuery && debouncedQuery.length >= 1,
      staleTime: 30_000,
      queryKey: getSearchUsersQueryKey(searchParams),
    },
  });

  function applyChoice(u: UserSummary) {
    if (tokenStart == null) return;
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, tokenStart);
    const after = value.slice(caret);
    // Use the explicit `@[uuid]` form so multi-word display names are
    // resolved unambiguously by the backend mention parser.
    const inserted = `@[${u.id}] `;
    const next = `${before}${inserted}${after}`;
    onChange(next);
    setActiveQuery(null);
    setTokenStart(null);
    // Restore caret position just past the inserted mention.
    queueMicrotask(() => {
      const target = textareaRef.current;
      if (!target) return;
      const pos = before.length + inserted.length;
      target.focus();
      target.setSelectionRange(pos, pos);
    });
  }

  const showDropdown =
    activeQuery !== null &&
    Array.isArray(suggestions) &&
    suggestions.length > 0;

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!showDropdown || !suggestions) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const choice = suggestions[Math.min(highlightIdx, suggestions.length - 1)];
      if (choice) applyChoice(choice);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setActiveQuery(null);
      setTokenStart(null);
    }
  }

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyUp={refreshTokenFromCaret}
        onKeyDown={handleKeyDown}
        onClick={refreshTokenFromCaret}
        placeholder={placeholder}
        rows={rows}
        data-testid={textareaTestId}
        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
      />
      {showDropdown && (
        <ul
          data-testid="mention-picker-dropdown"
          className="absolute z-10 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-md border bg-popover shadow-md"
        >
          {suggestions!.map((u, idx) => {
            const isActive = idx === highlightIdx;
            return (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => applyChoice(u)}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  className={
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm " +
                    (isActive ? "bg-accent" : "hover:bg-accent")
                  }
                  data-testid={`mention-option-${u.id}`}
                  aria-selected={isActive}
                >
                  <span
                    aria-hidden
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary"
                  >
                    {(u.displayName || u.email || "?").charAt(0).toUpperCase()}
                  </span>
                  <span className="font-medium">{u.displayName}</span>
                  <span className="text-xs text-muted-foreground truncate">
                    {u.email}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
