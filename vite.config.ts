import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          // The charting and PDF libraries are the bulk of the bundle and are
          // not needed to render the landing page. Splitting them lets the
          // browser cache them separately and skip them on first paint.
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            // recharts draws the dashboard, so it loads up front. Keeping
            // lightweight-charts in the same group dragged it along even after
            // its only consumer (TradingViewChart) became a lazy import —
            // a manualChunks group is pulled in whole as soon as anything in
            // it is referenced. Its own entry lets it stay on the Live Chart tab.
            charts: ['recharts'],
            'chart-live': ['lightweight-charts'],
            motion: ['motion'],
            icons: ['lucide-react'],
          },
        },
      },
    },
  };
});
