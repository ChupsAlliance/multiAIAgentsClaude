'use strict';
const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

// ── helpers ──────────────────────────────────────────────────────────────────

function dispatchToPage(message) {
  window.dispatchEvent(new MessageEvent('message', { data: message }));
}

// Resolve the dist directory from the file:// URL of index.html.
// Electron sets location.href to something like:
//   file:///C:/path/to/pixel-agents-webview/index.html   (Windows)
//   file:///home/.../pixel-agents-webview/index.html      (Unix)
function getDistDir() {
  const pathname = new URL(location.href).pathname;
  const localPath = process.platform === 'win32'
    ? pathname.replace(/^\//, '')   // strip leading / before drive letter
    : pathname;
  return path.dirname(decodeURIComponent(localPath));
}

// ── asset injection ───────────────────────────────────────────────────────────

// Inject all asset messages synchronously when webviewReady fires.
// pixel-agents needs these before it can render anything meaningful.
function injectAssets() {
  const distDir = getDistDir();

  // 1. furnitureAssetsLoaded — we have the full catalog JSON
  try {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(distDir, 'assets/furniture-catalog.json'), 'utf-8')
    );
    dispatchToPage({ type: 'furnitureAssetsLoaded', catalog, sprites: {} });
    console.log('[webview-preload] Injected furnitureAssetsLoaded (' + catalog.length + ' items)');
  } catch (e) {
    console.warn('[webview-preload] Could not load furniture-catalog.json:', e.message);
  }

  // 2. characterSpritesLoaded — dist only has PNGs, send empty array as fallback
  // Agents will appear without sprites until proper sprite decoding is implemented
  dispatchToPage({ type: 'characterSpritesLoaded', characters: [] });
  console.log('[webview-preload] Injected characterSpritesLoaded (empty — sprite decoding pending)');

  // 3. floorTilesLoaded
  dispatchToPage({ type: 'floorTilesLoaded', sprites: [] });
  console.log('[webview-preload] Injected floorTilesLoaded (empty)');

  // 4. wallTilesLoaded
  dispatchToPage({ type: 'wallTilesLoaded', sets: [] });
  console.log('[webview-preload] Injected wallTilesLoaded (empty)');
}

// ── vscodeApi mock ────────────────────────────────────────────────────────────

// pixel-agents calls acquireVsCodeApi() during React module initialization.
// We intercept webviewReady to inject assets synchronously before the renderer
// processes the event — guaranteeing assets arrive before layoutLoaded.
window.acquireVsCodeApi = () => ({
  postMessage(data) {
    if (data?.type === 'webviewReady') {
      injectAssets(); // synchronous: event listeners run before dispatchEvent returns
    }
    ipcRenderer.sendToHost('pa:out', data);
  },
  getState:  () => ({}),
  setState:  () => {},
});

// ── inbound bridge ────────────────────────────────────────────────────────────

// Forward messages from React renderer → pixel-agents event system
ipcRenderer.on('pa:in', (_event, message) => {
  dispatchToPage(message);
});
