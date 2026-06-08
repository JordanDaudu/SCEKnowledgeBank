// Trigger a browser file download for a (signed) API URL.
//
// We deliberately use a programmatic `<a download>` click rather than
// `window.open(url, "_blank")`. On iOS Safari, `window.open` is only honored
// inside a *synchronous* user gesture. Our download URLs require an async
// token fetch first, so by the time `open()` runs it is outside the gesture
// and Safari's popup blocker silently drops it — the Download button looks
// dead on iPhones/iPads while working everywhere else.
//
// An anchor-initiated download is not a popup, so iOS allows it even after
// the await, and the server's `Content-Disposition: attachment` header forces
// the save (and supplies the real filename) on every browser. Passing an
// explicit `filename` is only a same-origin hint; the server header wins.
export function triggerDownload(url: string, filename = ""): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
