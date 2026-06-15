import { defineConfig } from "vitest/config";
import path from "path";

// Standalone config for unit tests — intentionally does NOT reuse
// vite.config.ts, which throws unless PORT/BASE_PATH are set (those are
// dev/preview-server concerns irrelevant to running tests).
export default defineConfig({
  // Use the automatic JSX runtime so component tests don't need React in scope.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    // Default to node for fast pure-logic tests. Component tests opt into a DOM
    // per-file with a `// @vitest-environment jsdom` docblock.
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: ["src/test/setup-dom.ts"],
  },
});
