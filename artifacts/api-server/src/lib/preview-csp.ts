// Framing policy for inline preview / thumbnail responses.
//
// PDF and image previews are loaded inside an <iframe> on the web app. The
// browser only renders the frame if the embedding page's origin satisfies the
// response's `frame-ancestors` Content-Security-Policy. When the web app and
// API share an origin (production behind one router) `'self'` is enough — but
// in local dev the web app (:5173) and API (:8080) are *different* origins, so
// the web origin must be listed explicitly or Chrome blocks the frame and
// shows "localhost refused to connect".
//
// We build the allowlist from the same configured web origins used for CORS
// (`env.webOrigins`: WEB_ORIGIN + auto-detected Replit deploy domains) plus
// the Replit workspace wildcards, so the preview renders whether the SPA is
// same-origin or cross-origin. We deliberately do NOT emit X-Frame-Options —
// it can't express an origin list and would override this CSP in older
// browsers.

const REPLIT_FRAME_ANCESTORS = [
  "https://*.replit.dev",
  "https://*.replit.com",
  "https://replit.com",
  "https://*.replit.app",
] as const;

/**
 * Build the `Content-Security-Policy` value that lets the configured web
 * origins (plus `'self'` and Replit workspaces) embed a preview/thumbnail
 * response in an <iframe>. Pure so it can be unit-tested without the DB.
 */
export function buildPreviewFrameAncestors(
  webOrigins: readonly string[],
): string {
  const sources = ["'self'", ...webOrigins, ...REPLIT_FRAME_ANCESTORS];
  // De-dupe so an explicit WEB_ORIGIN that matches a Replit host (or repeats)
  // doesn't bloat the header.
  const unique = Array.from(new Set(sources));
  return `frame-ancestors ${unique.join(" ")}`;
}
