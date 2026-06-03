'use strict';

// ipcRenderer is always available in Electron webview preloads.
// path + fs are Node.js builtins; they may be absent if the webview sandbox
// is active, so we require them lazily and fail gracefully.
const { ipcRenderer } = require('electron');
console.log('[webview-preload] LOADED — ipcRenderer ok');

let _path = null;
let _fs   = null;
try { _path = require('path'); } catch (_) { /* sandboxed — asset injection disabled */ }
try { _fs   = require('fs');   } catch (_) { /* sandboxed — asset injection disabled */ }

// ── helpers ──────────────────────────────────────────────────────────────────

function dispatchToPage(message) {
  window.dispatchEvent(new MessageEvent('message', { data: message }));
}

// Resolve the dist directory from the file:// URL of index.html.
function getDistDir() {
  const pathname = new URL(location.href).pathname;
  const localPath = process.platform === 'win32'
    ? pathname.replace(/^\//, '')   // strip leading / before drive letter
    : pathname;
  return _path.dirname(decodeURIComponent(localPath));
}

// ── asset injection ───────────────────────────────────────────────────────────

// Inject asset catalog + empty sprite arrays so pixel-agents can initialize.
// Called synchronously inside postMessage so assets arrive before layoutLoaded.
function injectAssets() {
  if (!_fs || !_path) {
    // Sandboxed: send empty payloads so pixel-agents doesn't wait forever.
    dispatchToPage({ type: 'furnitureAssetsLoaded', catalog: [], sprites: {} });
    dispatchToPage({ type: 'characterSpritesLoaded', characters: [] });
    dispatchToPage({ type: 'floorTilesLoaded',       sprites: [] });
    dispatchToPage({ type: 'wallTilesLoaded',         sets: [] });
    console.warn('[webview-preload] Running sandboxed — asset data unavailable, sending empty payloads');
    return;
  }

  const distDir = getDistDir();

  // 1. furnitureAssetsLoaded — full catalog JSON
  try {
    const catalog = JSON.parse(
      _fs.readFileSync(_path.join(distDir, 'assets/furniture-catalog.json'), 'utf-8')
    );
    dispatchToPage({ type: 'furnitureAssetsLoaded', catalog, sprites: {} });
    console.log('[webview-preload] Injected furnitureAssetsLoaded (' + catalog.length + ' items)');
  } catch (e) {
    dispatchToPage({ type: 'furnitureAssetsLoaded', catalog: [], sprites: {} });
    console.warn('[webview-preload] Could not load furniture-catalog.json:', e.message);
  }

  // 2-4. Sprite arrays — empty until proper PNG decoding is implemented
  dispatchToPage({ type: 'characterSpritesLoaded', characters: [] });
  dispatchToPage({ type: 'floorTilesLoaded',       sprites: [] });
  dispatchToPage({ type: 'wallTilesLoaded',         sets: [] });
}

// ── vscodeApi mock ────────────────────────────────────────────────────────────

// MUST be defined before pixel-agents' useEffect runs, or it falls back to
// browser mode (h.postMessage = console.log only — ipcRenderer never called).
window.acquireVsCodeApi = () => ({
  postMessage(data) {
    console.log('[webview-preload] postMessage type:', data?.type);
    try {
      if (data?.type === 'webviewReady') {
        injectAssets(); // synchronous: fires before layoutLoaded arrives
      }
    } catch (e) {
      console.error('[webview-preload] injectAssets error:', e);
    }
    ipcRenderer.sendToHost('pa:out', data);
  },
  getState:  () => ({}),
  setState:  () => {},
});

// ── inbound bridge ────────────────────────────────────────────────────────────

// Forward messages from React renderer → pixel-agents event system
ipcRenderer.on('pa:in', (_event, message) => {
  console.log('[webview-preload] pa:in received type:', message?.type);
  dispatchToPage(message);
});
