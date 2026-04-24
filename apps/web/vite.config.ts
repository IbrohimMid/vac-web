import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
        manualChunks: {
          react: ['react', 'react-dom'],
          tanstack: ['@tanstack/react-query', '@tanstack/react-virtual'],
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
});
