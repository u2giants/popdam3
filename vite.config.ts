import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { execSync } from "child_process";

function resolveFullHash(shortHash: string | undefined): string {
  // version.json must carry the full sha so the deploy check can compare it
  // with the merged commit. CI passes APP_COMMIT_FULL; local builds fall back
  // to git, then to whatever short hash is already known.
  const envFull = process.env.APP_COMMIT_FULL?.trim();
  if (envFull) {
    return envFull;
  }
  try {
    return execSync("git rev-parse HEAD").toString().trim();
  } catch {
    return shortHash || "unknown";
  }
}

function getGitInfo() {
  // Prefer build-time env vars (set by Docker/CI). Falls back to git, then "unknown".
  const envHash = process.env.APP_COMMIT?.trim();
  const envDate = process.env.APP_DATE?.trim();
  if (envHash && envDate) {
    return { hash: envHash, date: envDate, fullHash: resolveFullHash(envHash) };
  }
  try {
    const hash = execSync("git rev-parse --short HEAD").toString().trim();
    const date = execSync("git log -1 --format=%cI").toString().trim();
    return { hash, date, fullHash: resolveFullHash(hash) };
  } catch {
    return {
      hash: envHash || "unknown",
      date: envDate || "unknown",
      fullHash: resolveFullHash(envHash),
    };
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const { hash, date, fullHash } = getGitInfo();
  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
      // Dev parity with the nginx /spaces/ proxy (see nginx.conf): the product
      // mockup tool fetches item thumbnails same-origin.
      proxy: {
        "/spaces": {
          target: "https://popdam.nyc3.digitaloceanspaces.com",
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/spaces/, ""),
        },
      },
    },
    define: {
      __APP_COMMIT__: JSON.stringify(hash),
      __APP_DATE__: JSON.stringify(date),
    },
    plugins: [
      react(),
      mode === "development" && componentTagger(),
      {
        // dist/version.json is the known version path the deploy check reads
        // after Coolify deploys; nginx serves the real file before the SPA
        // fallback (try_files $uri /index.html).
        name: "emit-version-json",
        apply: "build",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "version.json",
            source:
              JSON.stringify({ git_sha: fullHash, commit: hash, date }) + "\n",
          });
        },
      } satisfies Plugin,
    ].filter(Boolean),
    build: {
      rollupOptions: {
        output: {
          // Split large third-party libraries into their own long-cacheable
          // chunks so the main entry stays small and app deploys don't
          // invalidate vendor code (#193). Heavy libs used only by lazy pages
          // (AG Grid, recharts, exceljs) stay off the initial load.
          manualChunks: {
            "vendor-react": ["react", "react-dom", "react-router-dom"],
            "vendor-supabase": ["@supabase/supabase-js"],
            "vendor-query": ["@tanstack/react-query"],
            "vendor-ag-grid": ["ag-grid-community", "ag-grid-enterprise", "ag-grid-react"],
          },
        },
      },
    },
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: {
        "@": path.resolve(__dirname, "./src"),
        react: path.resolve(__dirname, "./node_modules/react"),
        "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
        "react/jsx-runtime": path.resolve(__dirname, "./node_modules/react/jsx-runtime.js"),
        "react/jsx-dev-runtime": path.resolve(__dirname, "./node_modules/react/jsx-dev-runtime.js"),
      },
    },
  };
});
