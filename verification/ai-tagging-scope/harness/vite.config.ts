import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

/**
 * Standalone config for the synthetic visual harness. It is deliberately separate
 * from the app config so the harness can never be bundled into a production build.
 */
export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "../../../src") } },
  server: { port: 5199, strictPort: true },
});
