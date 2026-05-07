# pixel-agents iframe Embed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CSS DOM Virtual Office renderer with pixel-agents' canvas pixel-art renderer embedded in an Electron `<webview>` tag.

**Architecture:** Build pixel-agents' webview-ui once and vendor the dist into `src/assets/pixel-agents-webview/`. Load it in a `<webview>` with a custom preload that (a) mocks `acquireVsCodeApi` so pixel-agents thinks it's in VS Code, (b) self-injects sprite/tile asset messages from the bundled JSON files the moment React sends `webviewReady`, and (c) bridges bidirectional IPC via `ipcRenderer.sendToHost()` ↔ `webviewRef.current.send()`. The React renderer sends `layoutLoaded` + `agentCreated` / `agentToolStart` / `agentToolDone` / `agentStatus` messages; pixel-agents sends `webviewReady` / `saveLayout` / `saveAgentSeats` back.

**Tech Stack:** Electron `<webview>` tag, Node.js `fs` in preload script, pixel-agents (React 19 + Vite canvas renderer), Vitest

---

## File Structure

**New files:**
- `scripts/build-pixel-agents.js` — clone + build + copy pixel-agents webview-ui dist
- `src/assets/pixel-agents-webview/` — vendored dist (git-committed)
- `electron/webview-preload.cjs` — vscodeApi mock + asset injection + IPC bridge
- `electron/ipc/pixelAgents.cjs` — `pa:save-layout` and `pa:save-seats` handlers
- `src/components/office/bridge/pixelAgentsProtocol.js` — pure translation functions
- `src/components/office/bridge/pixelAgentsProtocol.test.js` — unit tests

**Modified files:**
- `electron/main.cjs` — add `webviewTag: true`, CSP headers, register pixelAgents IPC
- `electron/preload.cjs` — add `getPaths()`, add `pa:save-layout`/`pa:save-seats` to allowlist
- `src/components/office/VirtualOffice.jsx` — replace CSS rendering with `<webview>`
- `src/components/office/hooks/useAgentSync.js` — accept `webviewRef`, send protocol messages

**Deleted after Task 8:**
- `src/components/office/rendering/OfficeTileGrid.jsx`
- `src/components/office/rendering/AgentSprite.jsx`
- `src/components/office/rendering/SpeechBubble.jsx`
- `src/components/office/hooks/useAnimationTick.js`

---

## Task 1: Build script + vendor pixel-agents dist

**Files:**
- Create: `scripts/build-pixel-agents.js`
- Create: `src/assets/pixel-agents-webview/` (result of running the script)

- [ ] **Step 1: Write `scripts/build-pixel-agents.js`**

```js
#!/usr/bin/env node
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO_URL = 'https://github.com/pablodelucca/pixel-agents.git';
const DEST_DIR = path.join(__dirname, '../src/assets/pixel-agents-webview');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-agents-'));
console.log(`Cloning into ${tmp}...`);
execSync(`git clone --depth 1 ${REPO_URL} "${tmp}"`, { stdio: 'inherit' });

const webviewDir = path.join(tmp, 'webview-ui');
console.log('Installing dependencies...');
execSync('npm install', { cwd: webviewDir, stdio: 'inherit' });

console.log('Building...');
execSync('npm run build', { cwd: webviewDir, stdio: 'inherit' });

// vite.config.ts sets outDir: '../dist/webview' (relative to webview-ui/)
const builtDir = path.join(tmp, 'dist', 'webview');

if (!fs.existsSync(builtDir)) {
  console.error(`Build output not found at ${builtDir}.`);
  console.error('Check webview-ui/vite.config.ts for the actual outDir.');
  process.exit(1);
}

if (fs.existsSync(DEST_DIR)) fs.rmSync(DEST_DIR, { recursive: true });
fs.cpSync(builtDir, DEST_DIR, { recursive: true });
fs.rmSync(tmp, { recursive: true });

console.log(`\nDone! Vendored to:\n  ${DEST_DIR}\n`);
console.log('Contents:');
const list = (dir, indent = '') => {
  for (const f of fs.readdirSync(dir)) {
    console.log(indent + f);
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) list(full, indent + '  ');
  }
};
list(DEST_DIR);
```

- [ ] **Step 2: Run the build script**

```bash
cd agent-teams-guide && node scripts/build-pixel-agents.js
```

Expected: script prints the dist contents. Build takes ~1-2 minutes.

- [ ] **Step 3: Record the exact asset JSON paths**

```bash
find agent-teams-guide/src/assets/pixel-agents-webview -name "*.json" | sort
```

You need to find files for these four message types. Record their paths relative to the dist root:
- `characterSpritesLoaded` → a file with character/sprite pixel data
- `floorTilesLoaded` → floor tile data
- `wallTilesLoaded` → wall tile data
- `furnitureAssetsLoaded` → furniture catalog data

Expected paths (may differ — use actual output):
- `assets/decoded/characters.json`
- `assets/decoded/floors.json`
- `assets/decoded/walls.json`
- `assets/furniture-catalog.json`

**You will use these paths in Task 5.**

- [ ] **Step 4: Verify `index.html` exists**

```bash
head -5 agent-teams-guide/src/assets/pixel-agents-webview/index.html
```

Expected: standard HTML with `<script>` tags referencing `./assets/...`

- [ ] **Step 5: Commit vendored dist**

```bash
cd agent-teams-guide
git add scripts/build-pixel-agents.js src/assets/pixel-agents-webview/
git commit -m "vendor: add pixel-agents webview-ui dist + build script"
```

---

## Task 2: Electron main — `webviewTag` + CSP + register IPC

**Files:**
- Modify: `electron/main.cjs`

- [ ] **Step 1: Add `webviewTag: true` and import `session`**

In `electron/main.cjs`, change line 2:
```js
const { app, BrowserWindow } = require('electron');
```
To:
```js
const { app, BrowserWindow, session } = require('electron');
```

In `createWindow()`, add `webviewTag: true` to `webPreferences`:
```js
webPreferences: {
  preload: path.join(__dirname, 'preload.cjs'),
  contextIsolation: true,
  nodeIntegration: false,
  webviewTag: true,
},
```

- [ ] **Step 2: Add CSP headers and register pixelAgents IPC**

Replace the `app.whenReady().then(() => {` block:
```js
app.whenReady().then(() => {
  // Allow file:// resources for pixel-agents <webview>
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' file:; script-src 'self' 'unsafe-inline' file:; style-src 'self' 'unsafe-inline' file:; img-src 'self' file: data: blob:; font-src 'self' file:; connect-src 'self' file:;"
        ],
      },
    });
  });

  createWindow();
  registerSystem(getMainWindow);
  registerFiles(getMainWindow);
  registerHistory(getMainWindow);
  registerMission(getMainWindow);
  registerPixelAgents(getMainWindow);

  console.log('[Electron] App ready, all IPC handlers registered');
});
```

Also add the require at the top of the file, alongside the other IPC requires:
```js
const registerPixelAgents = require('./ipc/pixelAgents.cjs');
```

- [ ] **Step 3: Verify the file is syntactically valid**

```bash
node --check agent-teams-guide/electron/main.cjs
```

Expected: no output (no syntax errors)

- [ ] **Step 4: Commit**

```bash
git add agent-teams-guide/electron/main.cjs
git commit -m "feat: enable webviewTag and CSP for pixel-agents webview"
```

---

## Task 3: IPC handlers — `pa:save-layout` + `pa:save-seats`

**Files:**
- Create: `electron/ipc/pixelAgents.cjs`
- Modify: `electron/preload.cjs`

- [ ] **Step 1: Create `electron/ipc/pixelAgents.cjs`**

```js
'use strict';
const { ipcMain, app } = require('electron');
const fs = require('fs/promises');
const path = require('path');

module.exports = function registerPixelAgents(_getMainWindow) {
  const LAYOUT_FILE = path.join(app.getPath('userData'), 'pa-office-layout.json');
  const SEATS_FILE  = path.join(app.getPath('userData'), 'pa-office-seats.json');

  ipcMain.handle('pa:save-layout', async (_event, { layout }) => {
    const json = JSON.stringify(layout);
    if (json.length > 5_000_000) throw new Error('Layout payload too large');
    await fs.writeFile(LAYOUT_FILE, json, 'utf-8');
  });

  ipcMain.handle('pa:save-seats', async (_event, { seats }) => {
    const json = JSON.stringify(seats);
    if (json.length > 1_000_000) throw new Error('Seats payload too large');
    await fs.writeFile(SEATS_FILE, json, 'utf-8');
  });

  console.log('[IPC] pixelAgents OK');
};
```

- [ ] **Step 2: Verify syntax**

```bash
node --check agent-teams-guide/electron/ipc/pixelAgents.cjs
```

Expected: no output

- [ ] **Step 3: Add `pa:save-layout`, `pa:save-seats` to `ALLOWED_COMMANDS` in `electron/preload.cjs`**

In `electron/preload.cjs`, the `ALLOWED_COMMANDS` array currently ends with `'read_superpowers_skill'` then the office section. Add two entries to the array:

```js
// pixel-agents persistence
'pa:save-layout', 'pa:save-seats',
```

- [ ] **Step 4: Add `getPaths()` to the contextBridge in `electron/preload.cjs`**

Add `const path = require('path');` on the second line (after `'use strict';`).

In the `contextBridge.exposeInMainWorld('electronAPI', {` block, add `getPaths` as a new property:

```js
getPaths() {
  return {
    webviewPreload: path.join(__dirname, 'webview-preload.cjs'),
    pixelAgentsDist: path.join(__dirname, '../src/assets/pixel-agents-webview'),
  };
},
```

- [ ] **Step 5: Verify preload syntax**

```bash
node --check agent-teams-guide/electron/preload.cjs
```

Expected: no output

- [ ] **Step 6: Commit**

```bash
git add electron/ipc/pixelAgents.cjs electron/preload.cjs
git commit -m "feat: add pa IPC handlers and expose getPaths via preload"
```

---

## Task 4: `pixelAgentsProtocol.js` — translation functions + tests

**Files:**
- Create: `src/components/office/bridge/pixelAgentsProtocol.js`
- Create: `src/components/office/bridge/pixelAgentsProtocol.test.js`

Background: pixel-agents messages use numeric `id` (not agent name strings) and numeric `toolId`. `AgentIdMap` maintains a name→id mapping. `ToolIdCounter` generates unique tool IDs.

- [ ] **Step 1: Write failing tests**

Create `src/components/office/bridge/pixelAgentsProtocol.test.js`:

```js
import { describe, it, expect } from 'vitest'
import {
  AgentIdMap,
  ToolIdCounter,
  makeLayoutLoaded,
  makeAgentCreated,
  makeAgentClosed,
  makeAgentToolStart,
  makeAgentToolDone,
  makeAgentStatus,
} from './pixelAgentsProtocol.js'

describe('AgentIdMap', () => {
  it('assigns sequential numeric IDs to new agents', () => {
    const map = new AgentIdMap()
    expect(map.getId('alice')).toBe(0)
    expect(map.getId('bob')).toBe(1)
    expect(map.getId('alice')).toBe(0)
  })

  it('removes an entry (counter keeps incrementing, no reuse)', () => {
    const map = new AgentIdMap()
    map.getId('alice') // 0
    map.remove('alice')
    expect(map.getId('carol')).toBe(1)
  })

  it('clear() resets all IDs', () => {
    const map = new AgentIdMap()
    map.getId('alice') // 0
    map.clear()
    expect(map.getId('bob')).toBe(0)
  })
})

describe('ToolIdCounter', () => {
  it('returns incrementing IDs starting at 0', () => {
    const counter = new ToolIdCounter()
    expect(counter.next()).toBe(0)
    expect(counter.next()).toBe(1)
    expect(counter.next()).toBe(2)
  })
})

describe('makeLayoutLoaded', () => {
  it('returns layoutLoaded with wasReset false and no layout object', () => {
    expect(makeLayoutLoaded()).toEqual({ type: 'layoutLoaded', wasReset: false })
  })
})

describe('makeAgentCreated', () => {
  it('returns correct shape', () => {
    expect(makeAgentCreated(3)).toEqual({ type: 'agentCreated', id: 3 })
  })
})

describe('makeAgentClosed', () => {
  it('returns correct shape', () => {
    expect(makeAgentClosed(3)).toEqual({ type: 'agentClosed', id: 3 })
  })
})

describe('makeAgentToolStart', () => {
  it('returns correct shape with toolName', () => {
    expect(makeAgentToolStart(0, 5, 'Read')).toEqual({
      type: 'agentToolStart',
      id: 0,
      toolId: 5,
      status: 'active',
      toolName: 'Read',
    })
  })
})

describe('makeAgentToolDone', () => {
  it('returns correct shape', () => {
    expect(makeAgentToolDone(0, 5)).toEqual({
      type: 'agentToolDone',
      id: 0,
      toolId: 5,
    })
  })
})

describe('makeAgentStatus', () => {
  it('maps "waiting" state to pixel-agents "waiting"', () => {
    expect(makeAgentStatus(1, 'waiting')).toEqual({
      type: 'agentStatus', id: 1, status: 'waiting',
    })
  })

  it('maps all other states to "active"', () => {
    for (const s of ['idle', 'coding', 'reading', 'working', 'spawning', 'managing', 'celebrating']) {
      expect(makeAgentStatus(1, s).status).toBe('active')
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd agent-teams-guide && npm test -- src/components/office/bridge/pixelAgentsProtocol.test.js
```

Expected: FAIL — "Cannot find module './pixelAgentsProtocol.js'"

- [ ] **Step 3: Implement `pixelAgentsProtocol.js`**

Create `src/components/office/bridge/pixelAgentsProtocol.js`:

```js
// Pure translation layer: our state → pixel-agents wire protocol.
// No React. No side effects. Importable in both browser and Node.

export class AgentIdMap {
  #map = new Map()  // agentName → numeric id
  #next = 0

  getId(name) {
    if (this.#map.has(name)) return this.#map.get(name)
    const id = this.#next++
    this.#map.set(name, id)
    return id
  }

  remove(name) {
    this.#map.delete(name)
  }

  clear() {
    this.#map.clear()
    this.#next = 0
  }
}

export class ToolIdCounter {
  #next = 0
  next() { return this.#next++ }
}

// ── message builders ──────────────────────────────────────────────────────────

export const makeLayoutLoaded = () =>
  ({ type: 'layoutLoaded', wasReset: false })

export const makeAgentCreated = (id) =>
  ({ type: 'agentCreated', id })

export const makeAgentClosed = (id) =>
  ({ type: 'agentClosed', id })

export const makeAgentToolStart = (id, toolId, toolName) =>
  ({ type: 'agentToolStart', id, toolId, status: 'active', toolName })

export const makeAgentToolDone = (id, toolId) =>
  ({ type: 'agentToolDone', id, toolId })

// Maps our AgentAnimationState to pixel-agents status string.
// pixel-agents knows: 'active' | 'waiting'
export const makeAgentStatus = (id, ourState) => ({
  type: 'agentStatus',
  id,
  status: ourState === 'waiting' ? 'waiting' : 'active',
})
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/components/office/bridge/pixelAgentsProtocol.test.js
```

Expected: all 13 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/components/office/bridge/
git commit -m "feat: add pixel-agents protocol translation layer with tests"
```

---

## Task 5: `webview-preload.cjs` — vscodeApi mock + asset injection

**Files:**
- Create: `electron/webview-preload.cjs`

Background: This preload script runs in the webview's Node.js context **before** pixel-agents scripts load. It:
1. Sets `window.acquireVsCodeApi` — pixel-agents calls this during module init to get the messaging API
2. When `webviewReady` is sent by pixel-agents (React mounted), synchronously injects all sprite/tile asset messages from the bundled JSON files **before** forwarding the event to our renderer
3. Forwards subsequent inbound `pa:in` messages from renderer into pixel-agents' event system

**IMPORTANT — update `ASSET_FILES` with actual paths from Task 1 Step 3.**

The `dispatchToPage` call is synchronous: event listeners run before `dispatchEvent` returns. This guarantees assets are processed by pixel-agents **before** `webviewReady` reaches our renderer and before we send `layoutLoaded`.

- [ ] **Step 1: Create `electron/webview-preload.cjs`**

```js
'use strict';
const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

// ── helpers ──────────────────────────────────────────────────────────────────

function dispatchToPage(message) {
  window.dispatchEvent(new MessageEvent('message', { data: message }));
}

// Compute local filesystem path to the webview's dist directory.
// In Electron, location.href = file:///C:/path/to/.../index.html (Windows)
//                            = file:///home/.../index.html         (Unix)
function getDistDir() {
  const pathname = new URL(location.href).pathname;
  const localPath = process.platform === 'win32'
    ? pathname.replace(/^\//, '')   // remove leading / before drive letter
    : pathname;
  return path.dirname(decodeURIComponent(localPath));
}

// ── ASSET_FILES ───────────────────────────────────────────────────────────────
// Map each JSON file (relative to dist root) to its pixel-agents message type.
// UPDATE these paths based on what Task 1 Step 3 found in the actual dist.
// The `key` is the property name in the message (e.g. { type, [key]: data }).
// For furnitureAssetsLoaded, use spread: set key to null and handle separately.
const ASSET_FILES = [
  { file: 'assets/decoded/characters.json', type: 'characterSpritesLoaded', key: 'characters' },
  { file: 'assets/decoded/floors.json',     type: 'floorTilesLoaded',       key: 'sprites'    },
  { file: 'assets/decoded/walls.json',      type: 'wallTilesLoaded',        key: 'sets'       },
  { file: 'assets/furniture-catalog.json',  type: 'furnitureAssetsLoaded',  key: null         },
];

// Inject all asset messages synchronously.
// Called inside acquireVsCodeApi.postMessage when type === 'webviewReady',
// so React is guaranteed to be mounted and listening before this runs.
function injectAssets() {
  const distDir = getDistDir();
  for (const { file, type, key } of ASSET_FILES) {
    const fullPath = path.join(distDir, file);
    try {
      const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
      // key === null: spread entire JSON object (for multi-field messages like furnitureAssetsLoaded)
      const message = key === null
        ? { type, ...data }
        : { type, [key]: data };
      dispatchToPage(message);
      console.log(`[webview-preload] Injected ${type}`);
    } catch (e) {
      console.warn(`[webview-preload] Could not load ${file}: ${e.message}`);
    }
  }
}

// ── vscodeApi mock ────────────────────────────────────────────────────────────

// pixel-agents calls acquireVsCodeApi() during module initialization.
// We inject sprites synchronously here when webviewReady is sent,
// before forwarding the event to our React renderer.
window.acquireVsCodeApi = () => ({
  postMessage(data) {
    if (data?.type === 'webviewReady') {
      injectAssets(); // synchronous — guaranteed before ipcRenderer.sendToHost below
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
```

- [ ] **Step 2: Verify syntax**

```bash
node --check agent-teams-guide/electron/webview-preload.cjs
```

Expected: no output

- [ ] **Step 3: Commit**

```bash
git add electron/webview-preload.cjs
git commit -m "feat: add webview preload with vscodeApi mock and asset self-injection"
```

---

## Task 6: `VirtualOffice.jsx` — replace with `<webview>`

**Files:**
- Modify: `src/components/office/VirtualOffice.jsx`

Background: Remove all CSS animation/rendering logic. The component now mounts a `<webview>`, handles inbound `ipc-message` events (webviewReady, saveLayout, saveAgentSeats), and delegates all agent state bridging to `useAgentSync`. The `TileEditor` modal is kept.

- [ ] **Step 1: Replace the entire file**

```jsx
import { useRef, useCallback, useState } from 'react'
import { TileEditor } from './editor/TileEditor'
import { useOfficeLayout } from './hooks/useOfficeLayout'
import { useAgentSync } from './hooks/useAgentSync'

export function VirtualOffice({ missionState, isRunning, logs }) {
  const webviewRef = useRef(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [webviewReady, setWebviewReady] = useState(false)

  const { layout, isLoading, saveLayout } = useOfficeLayout()

  // Absolute paths resolved by the Electron preload
  const { webviewPreload, pixelAgentsDist } = window.electronAPI.getPaths()

  // Normalize Windows backslashes so file:// URLs work cross-platform
  const distSrc     = `file:///${pixelAgentsDist.replace(/\\/g, '/')}/index.html`
  const preloadSrc  = `file:///${webviewPreload.replace(/\\/g, '/')}`

  // Handle messages FROM pixel-agents webview
  const handleInbound = useCallback((e) => {
    if (e.channel !== 'pa:out') return  // filter to our channel only
    const data = e.args?.[0]
    if (!data) return
    if (data.type === 'webviewReady') {
      setWebviewReady(true)
    } else if (data.type === 'saveLayout') {
      window.electronAPI.invoke('pa:save-layout', { layout: data.layout }).catch(console.error)
    } else if (data.type === 'saveAgentSeats') {
      window.electronAPI.invoke('pa:save-seats', { seats: data.seats }).catch(console.error)
    }
  }, [])

  // Attach/detach ipc-message listener via ref callback (handles mount and unmount)
  const webviewCallback = useCallback((node) => {
    if (node) {
      webviewRef.current = node
      node.addEventListener('ipc-message', handleInbound)
    } else {
      webviewRef.current?.removeEventListener('ipc-message', handleInbound)
      webviewRef.current = null
    }
  }, [handleInbound])

  const handleSaveLayout = useCallback(async (newLayout) => {
    await saveLayout(newLayout)
    setEditorOpen(false)
  }, [saveLayout])

  useAgentSync(missionState, isRunning, logs, webviewRef, webviewReady)

  return (
    <div className="relative flex flex-col h-full bg-slate-950">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800 shrink-0">
        <span className="text-xs text-slate-400 font-medium">Virtual Office</span>
        <button
          onClick={() => setEditorOpen(true)}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          Edit Office
        </button>
      </div>

      {/* pixel-agents canvas */}
      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-slate-500 text-xs">
            Loading office...
          </div>
        ) : (
          <webview
            ref={webviewCallback}
            src={distSrc}
            preload={preloadSrc}
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
        )}
      </div>

      {/* TileEditor modal */}
      {editorOpen && layout && (
        <TileEditor
          layout={layout}
          isRunning={isRunning}
          onSave={handleSaveLayout}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Build to verify no TypeScript/import errors**

```bash
cd agent-teams-guide && npm run build
```

Expected: build completes with no errors (some unused import warnings are OK)

- [ ] **Step 3: Commit**

```bash
git add src/components/office/VirtualOffice.jsx
git commit -m "feat: replace CSS Virtual Office with pixel-agents <webview>"
```

---

## Task 7: `useAgentSync.js` — add webview bridge

**Files:**
- Modify: `src/components/office/hooks/useAgentSync.js`

Background: The hook now accepts `webviewRef` and `webviewReady`. It no longer manages `agents` state (pixel-agents renders characters). It sends `layoutLoaded` + all `agentCreated` when `webviewReady` becomes true, sends `agentCreated`/`agentClosed` on roster changes, and sends `agentToolStart`/`agentToolDone`/`agentStatus` on log events. No return value needed.

- [ ] **Step 1: Replace the entire file**

```js
import { useRef, useEffect } from 'react'
import { mapLogEntryToState } from '../agent-bridge/AgentStateMapper'
import {
  AgentIdMap,
  ToolIdCounter,
  makeLayoutLoaded,
  makeAgentCreated,
  makeAgentClosed,
  makeAgentToolStart,
  makeAgentToolDone,
  makeAgentStatus,
} from '../bridge/pixelAgentsProtocol.js'

function sendToWebview(webviewRef, message) {
  webviewRef.current?.send('pa:in', message)
}

export function useAgentSync(missionState, isRunning, logs, webviewRef, webviewReady) {
  const agentsRef      = useRef({})                  // name → { state }
  const idMapRef       = useRef(new AgentIdMap())
  const toolCounterRef = useRef(new ToolIdCounter())
  const activeToolsRef = useRef({})                  // agentName → toolId | null

  // On first webviewReady: flush layoutLoaded + all existing agents
  useEffect(() => {
    if (!webviewReady) return
    sendToWebview(webviewRef, makeLayoutLoaded())
    for (const name of Object.keys(agentsRef.current)) {
      sendToWebview(webviewRef, makeAgentCreated(idMapRef.current.getId(name)))
    }
  }, [webviewReady, webviewRef])

  // Sync agent roster from missionState
  useEffect(() => {
    if (!missionState?.agents) return
    const currentNames = new Set(missionState.agents.map(a => a.name))

    for (const agent of missionState.agents) {
      if (!agentsRef.current[agent.name]) {
        agentsRef.current[agent.name] = { state: 'spawning' }
        if (webviewReady) {
          sendToWebview(webviewRef, makeAgentCreated(idMapRef.current.getId(agent.name)))
        }
      }
    }

    for (const name of Object.keys(agentsRef.current)) {
      if (!currentNames.has(name)) {
        if (webviewReady) {
          sendToWebview(webviewRef, makeAgentClosed(idMapRef.current.getId(name)))
        }
        idMapRef.current.remove(name)
        delete agentsRef.current[name]
        delete activeToolsRef.current[name]
      }
    }
  }, [missionState?.agents, webviewReady, webviewRef])

  // Process latest log entry → send tool start/done + status
  useEffect(() => {
    if (!logs?.length || !webviewReady) return
    const latest = logs[logs.length - 1]
    if (!latest?.agent || !agentsRef.current[latest.agent]) return

    const agentName = latest.agent
    const id = idMapRef.current.getId(agentName)
    const newState = mapLogEntryToState(latest)

    agentsRef.current[agentName] = { ...agentsRef.current[agentName], state: newState }

    if (latest.log_type === 'tool' && latest.tool_name) {
      // Close previous tool if still open
      const prevToolId = activeToolsRef.current[agentName]
      if (prevToolId != null) {
        sendToWebview(webviewRef, makeAgentToolDone(id, prevToolId))
      }
      const toolId = toolCounterRef.current.next()
      activeToolsRef.current[agentName] = toolId
      sendToWebview(webviewRef, makeAgentToolStart(id, toolId, latest.tool_name))
    } else if (latest.log_type === 'result') {
      const toolId = activeToolsRef.current[agentName]
      if (toolId != null) {
        sendToWebview(webviewRef, makeAgentToolDone(id, toolId))
        activeToolsRef.current[agentName] = null
      }
      sendToWebview(webviewRef, makeAgentStatus(id, newState))
    }
  }, [logs, webviewReady, webviewRef])

  // Reset on mission stop
  useEffect(() => {
    if (!isRunning) {
      agentsRef.current = {}
      idMapRef.current.clear()
      toolCounterRef.current = new ToolIdCounter()
      activeToolsRef.current = {}
    }
  }, [isRunning])
}
```

- [ ] **Step 2: Build to confirm no errors**

```bash
npm run build
```

Expected: clean build

- [ ] **Step 3: Run the test suite**

```bash
npm test
```

Expected: all tests pass (including the protocol tests from Task 4)

- [ ] **Step 4: Commit**

```bash
git add src/components/office/hooks/useAgentSync.js
git commit -m "feat: update useAgentSync to bridge mission state to pixel-agents protocol"
```

---

## Task 8: Cleanup + integration smoke test

**Files:**
- Delete: `src/components/office/rendering/OfficeTileGrid.jsx`
- Delete: `src/components/office/rendering/AgentSprite.jsx`
- Delete: `src/components/office/rendering/SpeechBubble.jsx`
- Delete: `src/components/office/hooks/useAnimationTick.js`

- [ ] **Step 1: Delete old CSS rendering files**

```bash
cd agent-teams-guide
rm src/components/office/rendering/OfficeTileGrid.jsx
rm src/components/office/rendering/AgentSprite.jsx
rm src/components/office/rendering/SpeechBubble.jsx
rm src/components/office/hooks/useAnimationTick.js
```

- [ ] **Step 2: Build to confirm nothing imports the deleted files**

```bash
npm run build
```

Expected: clean build with no "module not found" or "not exported" errors

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 4: Start the app and verify pixel-agents renders**

```bash
npm run electron:dev
```

Open the Virtual Office panel. Open DevTools (F12) on the webview (right-click → Inspect Element on the webview). Check the Console tab.

Expected:
- Console shows `[webview-preload] Injected characterSpritesLoaded` (and floor/wall/furniture lines)
- The office panel shows pixel-art canvas rendering (not CSS divs)
- No red CSP errors in the console

If assets fail to load (file not found), re-examine the paths from Task 1 Step 3 and update `ASSET_FILES` in `electron/webview-preload.cjs` to match the actual dist file names.

- [ ] **Step 5: Start a mission and verify agents appear**

Start any mission in the app. Watch the Virtual Office panel.

Expected:
- Agent sprites appear and walk to desks
- Tool activity is shown on agents as they run tools
- Agents disappear when the mission ends

- [ ] **Step 6: Verify layout drag-and-drop saves**

If pixel-agents shows a layout editor, make a change. Check that `pa-office-layout.json` is written to the Electron userData directory.

```bash
# Windows — userData is usually at:
ls "$APPDATA/agent-teams-guide/"
# or check Electron's app.getPath('userData') via DevTools console:
# require('electron').app.getPath('userData')
```

Expected: `pa-office-layout.json` created or updated

- [ ] **Step 7: Commit final cleanup**

```bash
git add -A
git commit -m "feat: remove old CSS rendering — pixel-agents integration complete"
```
