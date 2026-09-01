import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // MapLibre creates its worker through a module URL. Prebundling it can leave
  // Vite pointing at an evicted worker artifact during long recordings.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: {
    port: 3000,
    proxy: {
      '/api/royal-duke': {
        target: process.env.ROYAL_DUKE_CONTROLLER_URL ?? 'http://127.0.0.1:9400',
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api\/royal-duke/, '/api/v1'),
      },
    },
  },
});
