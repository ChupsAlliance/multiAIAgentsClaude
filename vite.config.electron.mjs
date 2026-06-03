// Vite config for Electron builds ONLY
// Does NOT touch vite.config.js (Tauri keeps using that)
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],

  // file:// protocol needs relative paths
  base: './',

  // Redirect @tauri-apps/* imports to our shim layer
  resolve: {
    alias: {
      '@tauri-apps/api/core':      path.resolve(__dirname, 'src/lib/tauri-shim/core.js'),
      '@tauri-apps/api/event':     path.resolve(__dirname, 'src/lib/tauri-shim/event.js'),
      '@tauri-apps/api/webview':   path.resolve(__dirname, 'src/lib/tauri-shim/webview.js'),
      '@tauri-apps/api':           path.resolve(__dirname, 'src/lib/tauri-shim/core.js'),
      '@tauri-apps/plugin-opener': path.resolve(__dirname, 'src/lib/tauri-shim/plugin-opener.js'),
    },
  },

  clearScreen: false,

  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
    watch: {
      ignored: ['**/src-tauri/**', '**/electron/**'],
    },
  },

  build: {
    outDir: 'dist-electron',
    emptyOutDir: true,
  },
});
