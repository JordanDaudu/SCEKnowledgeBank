// Single source of truth for resolving server-issued or hand-written API paths
// against the API origin. The server returns relative URLs for signed
// preview/download tokens (e.g. `/api/documents/:id/preview?token=...`).
// When the web app is served from a different host than the API
// (Docker compose, separate deploys, etc.), VITE_API_BASE provides the
// API origin. When blank, paths stay relative and are reverse-proxied
// from the same origin.

const RAW_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
const BASE = RAW_BASE.replace(/\/+$/, "");

const ABSOLUTE_URL = /^https?:\/\//i;

export function apiUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return BASE || "";
  if (ABSOLUTE_URL.test(pathOrUrl)) return pathOrUrl;
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return BASE ? `${BASE}${path}` : path;
}

// Named endpoints — keep raw `/api/...` strings out of page components.
// If/when the OpenAPI gains a public-facing helper for these we can swap
// implementations without touching pages.
export const apiEndpoints = {
  uploadDocuments: () => apiUrl("/api/documents/upload"),
} as const;
