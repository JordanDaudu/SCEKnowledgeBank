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
    // Split the single ~1.3MB app bundle into cacheable vendor chunks so no one
    // file blows past the 500KB performance threshold and big, rarely-changing
    // dependencies stay cached across deploys.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // Heavy, preview-only libraries get their own chunks so they never
          // bloat the shared vendor bundle (and can be cached independently).
          if (/[\\/]xlsx[\\/]/.test(id)) return "xlsx-vendor";
          if (/[\\/]docx-preview[\\/]/.test(id)) return "docx-vendor";
          if (/recharts|d3-|victory|internmap/.test(id)) return "charts-vendor";
          if (id.includes("framer-motion")) return "motion-vendor";
          // Core framework + routing. use-sync-external-store is a React shim;
          // keeping it with React avoids a circular chunk reference.
          if (/[\\/](react|react-dom|scheduler|wouter|use-sync-external-store)[\\/]/.test(id))
            return "react-vendor";
          if (id.includes("@radix-ui")) return "radix-vendor";
          if (id.includes("@tanstack")) return "query-vendor";
          if (id.includes("lucide-react")) return "icons-vendor";
          if (/i18next|react-i18next/.test(id)) return "i18n-vendor";
          if (/react-hook-form|@hookform|zod/.test(id)) return "form-vendor";
          // Everything else: one chunk per top-level package so no single file
          // dominates the bundle.
          const m = id.replace(/\\/g, "/").match(/node_modules\/(@[^/]+\/[^/]+|[^/]+)/);
          if (m) return `vendor-${m[1].replace(/[@/]/g, "-").replace(/^-/, "")}`;
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
