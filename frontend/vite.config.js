import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'https://bob-production-4e27.up.railway.app',
        changeOrigin: true
      },
      // Notifications and call signalling share this one socket. Without a
      // proxy entry the dev server has nowhere to send it: RealtimeContext
      // falls back to the page's own origin when VITE_REALTIME_URL is unset,
      // which in dev is Vite itself. Set VITE_REALTIME_URL to point at a local
      // backend instead.
      '/realtime': {
        target: 'wss://bob-production-4e27.up.railway.app',
        ws: true,
        changeOrigin: true
      }
    }
  }
});
