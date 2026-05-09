/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Vitest picks up its config from the same file; exclude the Playwright
  // e2e suite so `pnpm -C apps/web test` (which is `vitest run`) does not
  // try to load specs that import @playwright/test.
  test: {
    environment: 'happy-dom',
    exclude: ['node_modules', 'dist', 'tests/e2e/**', 'tests/perf/**'],
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        target: (globalThis as any).process?.env?.VAC_BRIDGE_URL ?? 'http://127.0.0.1:7777',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');
          if (
            normalizedId.includes('/node_modules/react/') ||
            normalizedId.includes('/node_modules/react-dom/')
          ) {
            return 'react';
          }
          if (
            normalizedId.includes('/node_modules/@tanstack/react-query/') ||
            normalizedId.includes('/node_modules/@tanstack/react-virtual/')
          ) {
            return 'tanstack';
          }
          return undefined;
        }
      },
    },
  },
  worker: {
    format: 'es',
  },
});
