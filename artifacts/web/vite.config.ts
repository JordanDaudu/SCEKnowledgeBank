import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { VitePWA } from "vite-plugin-pwa";

// PORT/BASE_PATH are required by the dev/preview server but not by `vite build`,
// which only emits static assets. Allow builds to run without them so the
// monorepo-wide `pnpm run build` succeeds in CI / containers.
const isBuild = process.argv.includes("build");

const rawPort = process.env.PORT;
if (!isBuild && !rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}
const port = rawPort ? Number(rawPort) : 0;
if (rawPort && (Number.isNaN(port) || port <= 0)) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? (isBuild ? "/" : "");
if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    // PWA foundation (Phase 1): precache the app shell so the SPA boots
    // offline, and ship an installable manifest. Offline content (saved
    // favorites) is handled separately via IndexedDB in Phase 2.
    VitePWA({
      registerType: "autoUpdate",
      // "script-defer" injects the registerSW.js <script> with a `defer`
      // attribute so it no longer blocks first render.
      injectRegister: "script-defer",
      includeAssets: ["favicon.svg", "robots.txt"],
      manifest: {
        name: "Knowledge Bank",
        short_name: "KnowledgeBank",
        description: "SCE Knowledge Bank — course materials and study resources.",
        theme_color: "#0f172a",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        // Offline SPA routing: unknown navigations fall back to the cached
        // app shell. But /api/* are real server requests (now same-origin and
        // reverse-proxied) — file preview (<iframe>) and download
        // (window.open) are navigations, so they MUST bypass the app-shell
        // fallback and hit the network, or the SW serves index.html instead
        // of the file. /healthz is a server probe, never a client route.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/healthz$/],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Chunking is a balance between two competing performance budgets the CQC
    // scanner enforces: no single file should blow past the ~500KB size
    // threshold, but the page must not load more than ~10 JS files either.
    // So we keep the few large, slow-changing dependencies in their own
    // cacheable chunks and collapse the long tail of small packages into a
    // single shared vendor chunk (an earlier per-package strategy produced 30+
    // requests and tripped the "too many JS files" budget).
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // Preview-only heavy libraries are dynamically imported (see
          // DocxPreview / SheetPreview), so they already split into async
          // chunks that stay off the initial page load. jszip is shared by
          // both xlsx and docx-preview — give it its own async chunk so a DOCX
          // preview doesn't drag in the much larger xlsx chunk (and vice
          // versa), and so it never lands on the homepage.
          if (/[\\/]jszip[\\/]/.test(id)) return "jszip-vendor";
          if (/[\\/]xlsx[\\/]/.test(id)) return "xlsx-vendor";
          if (/[\\/]docx-preview[\\/]/.test(id)) return "docx-vendor";
          // Recharts (+ its d3/lodash deps) is the heaviest static chunk;
          // isolate it so it caches independently and never pushes the shared
          // vendor chunk over the size threshold.
          if (/[\\/]recharts[\\/]/.test(id)) return "charts-vendor";
          // Core framework + routing. use-sync-external-store is a React shim;
          // keeping it with React avoids a circular chunk reference.
          if (/[\\/](react|react-dom|scheduler|wouter|use-sync-external-store)[\\/]/.test(id))
            return "react-vendor";
          // Radix UI is large and changes rarely — its own cacheable chunk.
          if (id.includes("@radix-ui")) return "radix-vendor";
          // Everything else — tanstack, lucide, i18next, react-hook-form/zod,
          // floating-ui, and the long tail of small deps — collapses into ONE
          // shared vendor chunk. This keeps the initial request count low while
          // each individual chunk stays well under the per-file size limit.
          return "vendor";
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET ?? "http://localhost:8080",
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
