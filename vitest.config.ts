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
          // Absolute so a git-worktree checkout resolves its OWN setup file;
          // the relative form silently bound to the canonical checkout's copy.
          setupFiles: [path.resolve(__dirname, "src/test/setup.ts")],
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
        // The bridge agent consumes this package as a built tarball; tests
        // read its source directly so no build step is needed first.
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "./src"),
            "@popdam/path-filters": path.resolve(__dirname, "packages/path-filters/index.ts"),
          },
        },
        test: {
          name: "agents",
          environment: "node",
          // The agent config refuses to load without a server URL, and any
          // handler import reaches it. Fixture it here so a test of a pure
          // helper does not depend on the runner's environment. Never
          // contacted: tests mock or avoid the API client.
          env: { POPDAM_SERVER_URL: "https://fixture.supabase.co" },
          include: ["apps/**/src/**/*.vitest.ts"],
        },
      },
    ],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
