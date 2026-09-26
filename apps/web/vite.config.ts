import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    hmr: false, // 彻底禁用 HMR
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '^/api/projects/[^/]+/context': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api/generate': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api/preview-retrieval': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // http-proxy 把 0 当成未设置，会回落到默认 120s；thinking 首包经常超过
        timeout: 1_800_000,
        proxyTimeout: 1_800_000,
      },
    },
  },
});
