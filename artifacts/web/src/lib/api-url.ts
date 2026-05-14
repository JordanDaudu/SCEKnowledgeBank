// Central helper for building API URLs from the web app.
// Backend signed-URL endpoints return paths like `/api/documents/:id/preview?token=...`.
// When the web app and API run on different origins (e.g. Vite dev on :22333
// and the API on :8080), those relative URLs would resolve against the web
// origin and 404. Resolve everything through VITE_API_BASE here.

const RAW_BASE = (import.meta.env.VITE_API_BASE ?? "").trim();
const BASE = RAW_BASE.replace(/\/+$/, "");

/**
 * Resolve an API path or server-issued URL to a fully-qualified URL the
 * browser can fetch / open / use as an <iframe src>.
 *
 * Accepts:
 *  - absolute URLs (returned as-is)
 *  - `/api/...` paths from the server (joined to VITE_API_BASE if set)
 *  - bare endpoint paths like `documents/upload` (prepended with `/api/`)
 */
export function apiUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  let path = pathOrUrl;
  if (!path.startsWith("/")) path = "/api/" + path.replace(/^\/+/, "");
  return BASE ? BASE + path : path;
}
