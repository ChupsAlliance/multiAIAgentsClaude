# pixel-agents iframe Embed Design

## Goal

Replace the CSS DOM-based Virtual Office rendering with pixel-agents' canvas pixel-art renderer, embedded in an Electron `<webview>` tag. The result preserves pixel-agents' visual quality and performance while bridging its VS Code postMessage API to Electron IPC.

## Decisions Made

| Question | Decision |
|----------|----------|
| How to source pixel-agents | Vendored dist — build once, commit `src/assets/pixel-agents-webview/`, update manually |
| Embed mechanism | Electron `<webview>` tag + `file://` + preload script |
| Communication direction | Bidirectional — push state in, handle `webviewReady`/`saveLayout`/`saveAgentSeats` back |

---

## Architecture

### Three Layers

```
React Renderer (VirtualOffice.jsx)
    ↕  webviewRef.current.send() / webview 'ipc-message' event
<webview> (pixel-agents dist/index.html)
    ↕  ipcRenderer.on() / ipcRenderer.sendToHost()
webview-preload.cjs  (vscodeApi mock + IPC bridge)
```

Real-time game-loop messages bypass the main process entirely via `sendToHost()`. Main process is only involved for file I/O (persisting layout/seats to disk).

### Outbound — App → pixel-agents

```
missionState changes
→ useAgentSync.js translates to pixel-agents message format
→ webviewRef.current.send('pa:in', message)
→ webview-preload.cjs: ipcRenderer.on('pa:in') → dispatchEvent(new MessageEvent('message', { data }))
→ pixel-agents engine handles
```

### Inbound — pixel-agents → App

```
pixel-agents calls vscodeApi.postMessage(data)
→ webview-preload.cjs mock → ipcRenderer.sendToHost('pa:out', data)
→ VirtualOffice.jsx: webview.addEventListener('ipc-message')
→ handle: webviewReady / saveLayout / saveAgentSeats
```

For `saveLayout` and `saveAgentSeats`, the renderer forwards to main process via `window.electronAPI` for disk persistence.

---

## File Structure

```
agent-teams-guide/
├── src/
│   ├── assets/
│   │   └── pixel-agents-webview/          # Vendored dist (git-committed)
│   │       ├── index.html
│   │       └── assets/
│   └── components/office/
│       ├── VirtualOffice.jsx              # REPLACE: renders <webview>, handles ipc-message events
│       ├── hooks/
│       │   └── useAgentSync.js            # MODIFY: translate missionState → pa protocol messages
│       └── bridge/
│           └── pixelAgentsProtocol.js     # NEW: pure functions, our state → pa message objects
├── electron/
│   ├── webview-preload.cjs               # NEW: vscodeApi mock + IPC bridge
│   ├── preload.cjs                       # MODIFY: expose getWebviewPreloadPath + pa:persist channels
│   └── ipc/
│       └── pixelAgents.cjs              # NEW: 'pa:save-layout' and 'pa:save-seats' handlers
└── scripts/
    └── build-pixel-agents.js            # NEW: clone + build + copy pixel-agents webview-ui
```

**Files removed** (CSS DOM rendering, no longer needed):
- `src/components/office/rendering/OfficeTileGrid.jsx`
- `src/components/office/rendering/AgentSprite.jsx`
- `src/components/office/rendering/SpeechBubble.jsx`

---

## Component Designs

### `webview-preload.cjs`

Runs in the webview's Node context before pixel-agents scripts. Provides the `vscodeApi` mock pixel-agents expects.

```js
const { ipcRenderer } = require('electron')

// pixel-agents calls acquireVsCodeApi() to get the API handle
window.acquireVsCodeApi = () => ({
  postMessage: (data) => ipcRenderer.sendToHost('pa:out', data),
  getState: () => ({}),
  setState: () => {}
})

// Forward messages from renderer into pixel-agents' message event system
ipcRenderer.on('pa:in', (_event, message) => {
  window.dispatchEvent(new MessageEvent('message', { data: message }))
})
```

### `VirtualOffice.jsx`

Stripped to webview orchestration only — no tile/sprite rendering logic.

```jsx
const webviewRef = useRef()

useEffect(() => {
  const wv = webviewRef.current
  const handleInbound = (e) => handlePixelAgentsMessage(e.channel, e.args[0])
  wv.addEventListener('ipc-message', handleInbound)
  wv.addEventListener('dom-ready', () => flushInitialState(wv))
  return () => wv.removeEventListener('ipc-message', handleInbound)
}, [])

return (
  <webview
    ref={webviewRef}
    src={`file://${pixelAgentsDistPath}/index.html`}
    preload={`file://${webviewPreloadPath}`}
    style={{ width: '100%', height: '100%' }}
  />
)
```

`pixelAgentsDistPath` and `webviewPreloadPath` are absolute paths resolved at startup via `window.electronAPI.getPaths()`.

### `pixelAgentsProtocol.js`

Pure translation functions. No side effects. No React.

```js
// Our state → pa message objects
export function makeLayoutLoaded(tiles, deskSlots) { ... }
export function makeCharacterSpritesLoaded(agents) { ... }
export function makeAgentCreated(agent) { ... }
export function makeAgentToolStart(agentId, tool) { ... }
export function makeAgentToolDone(agentId, tool, result) { ... }
export function makeAgentStatus(agentId, status) { ... }
```

### `useAgentSync.js` (modified)

Receives `webviewRef` as a parameter from `VirtualOffice.jsx`. Watches `missionState` and `logs`. On change, calls protocol translation functions and sends via `webviewRef.current.send('pa:in', message)`.

Queuing: messages that arrive before pixel-agents is ready are buffered. The flush sequence is:
1. `dom-ready` fires on the `<webview>` element → webview HTML is loaded, preload is active
2. pixel-agents sends `webviewReady` → pixel-agents JS is initialized and listening
3. Only after step 2: flush the queue in order (`layoutLoaded` → `characterSpritesLoaded` → `agentCreated` × N), then resume live streaming

### `electron/ipc/pixelAgents.cjs`

Two handlers only:

```js
ipcMain.handle('pa:save-layout', async (_event, layout) => {
  await fs.writeFile(path.join(app.getPath('userData'), 'office-layout.json'), JSON.stringify(layout))
})

ipcMain.handle('pa:save-seats', async (_event, seats) => {
  await fs.writeFile(path.join(app.getPath('userData'), 'office-seats.json'), JSON.stringify(seats))
})
```

---

## Message Translation Map

| Trigger | pixel-agents message sent |
|---------|--------------------------|
| `webviewReady` received | flush: `layoutLoaded` → `characterSpritesLoaded` → `agentCreated` × N |
| Agent added to mission | `agentCreated` |
| Agent starts tool | `agentToolStart` |
| Agent finishes tool | `agentToolDone` |
| Agent status changes | `agentStatus` |

| pixel-agents message received | Our action |
|-------------------------------|-----------|
| `webviewReady` | Trigger initial state flush |
| `saveLayout` | Forward to `pa:save-layout` IPC → write to userData |
| `saveAgentSeats` | Forward to `pa:save-seats` IPC → write to userData |

---

## Electron Configuration

### Enable `<webview>` tag (disabled by default)

```js
new BrowserWindow({
  webPreferences: {
    webviewTag: true,
    nodeIntegration: false,
    contextIsolation: true,
  }
})
```

### CSP — allow `file://` assets in webview

```js
session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
  callback({
    responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': [
        "default-src 'self' file:; script-src 'self' 'unsafe-inline' file:; style-src 'self' 'unsafe-inline' file:"
      ]
    }
  })
})
```

### Expose preload path to renderer

```js
// electron/preload.cjs — preload runs in renderer context, __dirname is the electron/ dir
contextBridge.exposeInMainWorld('electronAPI', {
  ...existing,
  getPaths: () => ({
    webviewPreload: path.join(__dirname, 'webview-preload.cjs'),
    pixelAgentsDist: path.join(__dirname, '../src/assets/pixel-agents-webview'),
  })
})
```

---

## Build Workflow

**One-time setup:**
```bash
node scripts/build-pixel-agents.js
```

The script:
1. Clones `https://github.com/pablodelucca/pixel-agents` to a temp dir
2. `cd webview-ui && npm install && npm run build`
3. Copies `dist/` → `src/assets/pixel-agents-webview/`
4. Removes temp dir

Output is committed to git. Re-run only when updating pixel-agents upstream.

---

## What Is NOT Changing

- `useOfficeLayout.js` — layout data management, unchanged
- `electron/ipc/system.cjs` — existing system IPC handlers, unchanged
- Mission state management — unchanged
- Agent log parsing — unchanged
- `src/lib/tauri-shim/` — unchanged
