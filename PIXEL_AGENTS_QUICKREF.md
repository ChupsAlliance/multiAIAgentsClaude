# Pixel Agents Integration Quick Reference

## TL;DR

**Pixel Agents** is a MIT-licensed VS Code extension (v1.3.0) with a React 19 + Canvas 2D rendering engine. **Not published as npm package**, but highly integrable into Electron + React + Vite.

**Recommended approach**: Copy `/webview-ui/src/office/` source code, adapt IPC bridge, integrate. **2-4 hours effort**.

---

## Key Findings at a Glance

| Aspect | Finding |
|--------|---------|
| **License** | MIT ✅ |
| **Published to npm** | No ❌ |
| **Can use `npm install github:...`** | Yes, but requires build |
| **Pre-built VSIX** | Yes (GitHub Releases) |
| **Can embed in iframe** | Yes, with postmessage bridge |
| **Rendering library** | Canvas 2D (no external libs) |
| **React version** | 19.2.0 |
| **Min dependencies** | React + React-DOM only |
| **Build tool** | Vite for webview, esbuild for extension |
| **Sprites self-contained** | Yes (JSON encoded in bundle) |
| **Total LoC (engine)** | ~1500 lines |
| **VS Code coupling** | Only in vscodeApi.ts (mockable) |

---

## The Rendering Engine

**Location**: `webview-ui/src/office/engine/`

Five core files (6 including index):

1. **renderer.ts** (300 lines) — Renders frame with z-sorting, furniture, characters, bubbles, overlays
2. **gameLoop.ts** (30 lines) — requestAnimationFrame wrapper with delta-time capping
3. **characters.ts** (200 lines) — Character state machine (IDLE/TYPE/WALK), pathfinding, sprite selection
4. **officeState.ts** (400 lines) — Game state class, agent/furniture management, BFS pathfinding
5. **index.ts** (10 lines) — Barrel export

**Total rendering code: ~940 lines of TypeScript**

---

## Sprite System

**Location**: `webview-ui/src/office/sprites/`

- **spriteData.ts** — PNG loading, hue shifting, 7-frame animation per direction
- **spriteCache.ts** — WeakMap caching, outline generation, zoom support
- **bubble-permission.json** & **bubble-waiting.json** — Pre-rendered 11×13px bubbles
- **Sprites are base64/JSON encoded** in final bundle (not external file refs)

---

## React Components

**Location**: `webview-ui/src/office/components/`

1. **OfficeCanvas.tsx** (600 lines)
   - Canvas + ResizeObserver + game loop runner
   - Mouse/keyboard input handling
   - Camera system (follow + pan + zoom)
   - Edit mode tools (tile paint, wall paint, furniture placement, erasing)

2. **ToolOverlay.tsx** (150 lines)
   - Floating agent status panel
   - Shows activity, token gauge (team agents), permission indicator
   - Follows characters on screen

**Both require `OfficeState` instance + asset loading + message dispatch**

---

## Message Protocol (Extension <-> Webview)

### Extension sends (20+ message types):
- `layoutLoaded` — restore office state
- `characterSpritesLoaded`, `floorTilesLoaded`, etc. — asset data
- `agentCreated`, `agentClosed` — agent lifecycle
- `agentToolStart`, `agentToolDone`, `agentToolClear` — tool execution
- `agentToolPermission` — permission needed (shows bubble)
- `settingsLoaded` — user preferences

### Webview sends (16+ message types):
- `webviewReady` — signals ready for init
- `saveLayout`, `saveAgentSeats` — persistence
- `openClaude`, `focusAgent`, `closeAgent` — agent control
- `importLayout`, `exportLayout` — file operations
- `setHooksEnabled`, `setWatchAllSessions` — settings

**Example**: Agent types code → Extension parses JSONL → sends `agentToolStart` → character transitions to TYPE animation

---

## Activity Detection

**How it works** (no Claude Code API modification needed):
1. Extension watches `~/.claude/projects/<hash>/output.jsonl` (Claude Code's transcript)
2. Parses JSONL lines, extracts `tool_use` blocks
3. Maps tools to animations (Read/Grep/WebFetch → reading, others → typing)
4. Creates sub-agents for Task/Agent tools
5. Sends messages to webview to animate characters

**Special handling**:
- Read/Grep/Glob/WebFetch/WebSearch use "reading" 2-frame animation (not typing)
- Task/Agent tools spawn temporary sub-agents
- Permission states show bubble if hooks unavailable

---

## Integration Approaches (Ranked by Recommended Order)

### Approach 1: Copy Source Code (RECOMMENDED)
```bash
cp -r pixel-agents/webview-ui/src/office your-app/src/office
```
- Setup: 30 min
- Maintenance: High
- Control: Full
- Bundle: Small
- **Best for**: Custom control, minimal deps

### Approach 2: Iframe + Postmessage Bridge
```html
<iframe src="pixel-agents/webview-ui/dist/index.html"></iframe>
```
- Setup: 1 hour
- Maintenance: Low
- Control: Limited
- Bundle: Medium
- **Best for**: Quick integration, decoupled updates

### Approach 3: npm Workspace (Monorepo)
```json
{
  "workspaces": ["packages/pixel-agents", "packages/my-app"]
}
```
- Setup: 2 hours
- Maintenance: Low
- Control: Full
- Bundle: Large
- **Best for**: Shared dev, automatic updates

### Approach 4: VSIX Extract (NOT RECOMMENDED)
- Setup: 15 min
- Maintenance: Very High
- Control: None
- Bundle: Large
- Hard to debug, asset paths hardcoded, VS Code-specific

---

## VS Code API Abstraction

**File**: `webview-ui/src/vscodeApi.ts`

```typescript
export const vscode = 
  typeof acquireVsCodeApi !== 'undefined' 
    ? acquireVsCodeApi() 
    : { postMessage: (msg) => console.log('[vscode.postMessage]', msg) }
```

**For Electron**, replace with:
```typescript
export const vscode = {
  postMessage: (msg) => window.electron.ipcRenderer.send('agent-message', msg)
}
```

---

## Asset Loading

**Extension side** (assetLoader.ts):
- Loads PNG files from `/assets/characters/`, `/assets/floors/`, `/assets/walls/`, `/assets/furniture/`
- Parses manifests (furniture)
- Converts PNGs to sprite data (pixel arrays)
- Sends to webview via postMessage

**Webview side** (browserMock.ts):
- Falls back to fetching decoded JSON from Vite dev server
- Or decodes PNGs at runtime using canvas
- Stores in module state, dispatches simulated messages

**Result**: All sprites baked into webview bundle, no runtime file deps

---

## Electron Integration Boilerplate

```typescript
// preload.ts
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel, data) => ipcRenderer.send(channel, data),
    on: (channel, handler) => ipcRenderer.on(channel, handler)
  }
})

// Adapt vscodeApi.ts
export const vscode = {
  postMessage: (msg) => window.electron.ipcRenderer.send('webview-message', msg)
}

// main.ts
ipcMain.on('webview-message', (event, msg) => {
  if (msg.type === 'saveLayout') { /* ... */ }
  else if (msg.type === 'openClaude') { /* ... */ }
})

// Send agent updates
mainWindow.webContents.send('agent-update', {
  type: 'agentCreated',
  id: 'agent-1',
  pos: { x: 5, y: 3 },
  palette: 0,
  name: 'Claude'
})
```

---

## Files to Copy (Approach 1)

```
webview-ui/src/office/
├── components/
│   ├── OfficeCanvas.tsx
│   ├── ToolOverlay.tsx
│   └── index.ts
├── engine/
│   ├── characters.ts
│   ├── gameLoop.ts
│   ├── officeState.ts
│   ├── renderer.ts
│   └── index.ts
└── sprites/
    ├── bubble-permission.json
    ├── bubble-waiting.json
    ├── spriteCache.ts
    ├── spriteData.ts
    └── index.ts

Plus hooks:
webview-ui/src/hooks/
├── useEditorActions.ts
├── useEditorKeyboard.ts
├── useExtensionMessages.ts
└── (likely one more)

Plus core:
webview-ui/src/
├── App.tsx (root component, adapt for Electron)
├── vscodeApi.ts (MUST ADAPT for Electron IPC)
├── constants.ts (animation timings, colors, etc.)
├── runtime.ts (environment detection)
└── main.tsx (entry point, update for Electron)
```

---

## Known Limitations

1. **No pathfinding file fetched** — BFS likely simple, check code
2. **Matrix effect** (`matrixEffect.ts`) — Not fetched, check spawn/despawn animation
3. **Team coordination** — `teamName`, `leadAgentId` mentioned but protocol not fully clear
4. **Hook provider** — Custom tool status formatting, not fully documented
5. **External assets** — Custom directory format not crystal clear from code

---

## Unqualified YES Answers

- Can it be used in Electron? **YES**
- Can it run without VS Code? **YES**
- Are sprites self-contained? **YES**
- Is it MIT licensed? **YES**
- Can components be reused? **PARTIALLY** (depend on OfficeState + messages)
- Can rendering be extracted? **YES** (that's the engine/)

---

## Next Steps

1. Read full report: `RESEARCH_PIXEL_AGENTS.md` (736 lines)
2. Clone repo locally
3. Copy `webview-ui/src/office/` into your project
4. Update `vscodeApi.ts` to use Electron IPC
5. Define message types interface
6. Create simple agent lifecycle handler
7. Build & test with mock agent data

**Estimated time to working prototype: 2-4 hours**

