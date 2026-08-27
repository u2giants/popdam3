import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // Edge-function tests live outside src/ and were previously never run by
    // CI (`bun run test`), so failures there went unnoticed. They are plain
    // Node modules, so give them the node environment.
    projects: [
      {
        extends: true,
        test: {
          name: "src",
          environment: "jsdom",
          setupFiles: ["./src/test/setup.ts"],
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "edge-functions",
          environment: "node",
          include: ["supabase/functions/**/*.{test,spec}.ts"],
        },
      },
      {
        // The agent apps run their own suites on node:test. A few files are
        // written against vitest (vi.mock) instead; they carry a .vitest.ts
        // suffix so each runner picks up only what it can execute. Before
        // this split neither runner ran them.
        extends: true,
        test: {
          name: "agents",
          environment: "node",
          include: ["apps/**/src/**/*.vitest.ts"],
        },
      },
    ],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
