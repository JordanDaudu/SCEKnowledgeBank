import { describe, it, expect } from "vitest";
import { buildPreviewFrameAncestors } from "./preview-csp";

// Regression: PDF/image previews load inside an <iframe>. When the web app
// is served from a different origin than the API (local dev: web :5173,
// api :8080), the preview response's `frame-ancestors` must list the web
// origin or Chrome blocks the frame ("localhost refused to connect").
describe("buildPreviewFrameAncestors", () => {
  it("always permits the framed resource's own origin and Replit workspaces", () => {
    const csp = buildPreviewFrameAncestors([]);
    expect(csp.startsWith("frame-ancestors ")).toBe(true);
    expect(csp).toContain("'self'");
    expect(csp).toContain("https://*.replit.dev");
  });

  it("includes every configured web origin so a cross-origin SPA can frame the preview", () => {
    const csp = buildPreviewFrameAncestors([
      "http://localhost:5173",
      "https://kb.example.edu",
    ]);
    expect(csp).toContain("http://localhost:5173");
    expect(csp).toContain("https://kb.example.edu");
  });

  it("de-dupes origins that repeat across the configured + Replit lists", () => {
    const csp = buildPreviewFrameAncestors(["'self'", "https://replit.com"]);
    expect(csp.match(/'self'/g)).toHaveLength(1);
    expect(csp.match(/https:\/\/replit\.com/g)).toHaveLength(1);
  });
});
