import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

process.env.VITE_BUILD_SHA ??= 'dev'
process.env.VITE_BUILD_DATE ??= 'dev'

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_SHA__: JSON.stringify(process.env.VITE_BUILD_SHA ?? 'dev'),
    __BUILD_DATE__: JSON.stringify(process.env.VITE_BUILD_DATE ?? 'dev'),
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    exclude: ['tests/browser/**', 'node_modules/**', 'dist/**'],
    // RevoGrid is a Stencil web component: under jsdom it hydrates asynchronously and can
    // leave a debounced resize running past teardown, which throws and fails the RUN while
    // every test passes. That made the required `verify` check a coin flip (issue #1186).
    // Swap it for a stub in the jsdom suite only. This alias does NOT affect `vite build`,
    // so the application still bundles and ships the real grid, and the real grid is
    // covered by the Playwright suite in `tests/browser/`.
    alias: {
      '@revolist/react-datagrid': fileURLToPath(
        new URL('./src/test/revogrid-stub.tsx', import.meta.url),
      ),
    },
  },
})
