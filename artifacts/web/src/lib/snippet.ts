// Sprint-3 M3: render search-hit snippets produced by Postgres
// `ts_headline`. The server emits sentinel markers
// `[[KBMARK]]match[[/KBMARK]]` around hits (not real `<mark>` tags)
// so we can HTML-escape the user-supplied haystack first and then
// swap the sentinels for `<mark>`. This avoids HTML injection if a
// document title or extracted text happens to contain literal
// `<script>` or similar.

const OPEN = "[[KBMARK]]";
const CLOSE = "[[/KBMARK]]";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Convert a server-emitted snippet into a safe HTML string with `<mark>` highlights. */
export function renderSnippetHtml(snippet: string): string {
  // Escape first, then re-introduce the markers as escaped placeholders
  // would also be escaped, so the marker rewrite has to walk over the
  // escaped string using the escaped form of the sentinels (none of
  // their characters need escaping — `[` `]` `/` `K` `B` `M` `A` `R`
  // are all literal so escapeHtml passes them through unchanged).
  const escaped = escapeHtml(snippet);
  return escaped.split(OPEN).join("<mark>").split(CLOSE).join("</mark>");
}
