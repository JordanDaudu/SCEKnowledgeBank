// Trigger a browser file download for a (signed) same-origin API URL.
//
// We use a top-level navigation (`window.location.assign`). The download
// endpoint responds with `Content-Disposition: attachment`, so the browser
// saves the file instead of navigating away — the page stays put.
//
// Why not `window.open(url, "_blank")` or a programmatic `<a download>.click()`?
// Both require *transient user activation* on iOS Safari/WebKit. Our download
// URL needs an async token fetch first, so by the time we trigger the download
// the activation from the user's tap has already expired and Safari silently
// drops the popup / synthetic click — the Download button looks dead on
// iPhone/iPad while working everywhere else. A top-level navigation is neither
// a popup nor activation-gated, so it downloads reliably on iOS too.
//
// The PWA service worker already excludes `/api/*` from its app-shell
// navigateFallback (see vite.config.ts), so this request reaches the network
// (nginx proxy → file) rather than being served the cached index.html.
export function triggerDownload(url: string): void {
  window.location.assign(url);
}
