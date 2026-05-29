import { defineConfig } from "vitest/config";
import path from "path";

// Standalone config for unit tests — intentionally does NOT reuse
// vite.config.ts, which throws unless PORT/BASE_PATH are set (those are
// dev/preview-server concerns irrelevant to running tests).
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
