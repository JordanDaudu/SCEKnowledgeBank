import { useEffect, useRef, useState } from "react";
import {
  useSearchUsers,
  getSearchUsersQueryKey,
  type UserSummary,
} from "@workspace/api-client-react";

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  textareaTestId?: string;
}

/**
 * A textarea with an inline `@` picker (task #29).
 *
 * When the caret is positioned inside an `@token` that has at least
 * one character, we issue an authenticated user search and render a
 * small dropdown below the textarea. Selecting a user replaces the
 * partial token with `@displayName ` (trailing space) — exactly the
 * shape the backend `parseMentionTokens` parser will resolve later.
 *
 * Falls back to a plain textarea silently when the search errors or
 * returns no matches.
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

  const searchParams = { q: activeQuery ?? "", limit: 6 };
  const { data: suggestions } = useSearchUsers(searchParams, {
    query: {
      enabled: !!activeQuery && activeQuery.length >= 1,
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
    const inserted = `@${u.displayName} `;
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

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyUp={refreshTokenFromCaret}
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
          {suggestions!.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => applyChoice(u)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                data-testid={`mention-option-${u.id}`}
              >
                <span className="font-medium">{u.displayName}</span>
                <span className="text-xs text-muted-foreground truncate">
                  {u.email}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
