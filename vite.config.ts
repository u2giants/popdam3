import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { execSync } from "child_process";

function getGitInfo() {
  try {
    const hash = execSync("git rev-parse --short HEAD").toString().trim();
    const date = execSync("git log -1 --format=%cd --date=format:%Y-%m-%d").toString().trim();
    return { hash, date };
  } catch {
    return { hash: "unknown", date: "unknown" };
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const { hash, date } = getGitInfo();
  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    define: {
      __APP_COMMIT__: JSON.stringify(hash),
      __APP_DATE__: JSON.stringify(date),
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
