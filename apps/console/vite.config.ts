import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
