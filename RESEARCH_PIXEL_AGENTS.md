# Pixel Agents: Comprehensive Integration Research

## Executive Summary

**Pixel Agents** is a VS Code extension (MIT license, v1.3.0) that renders animated pixel-art agents in a virtual office environment. It comprises two layers:
- **Extension layer** (TypeScript + esbuild) running in the extension host
- **Webview layer** (React 19 + Vite + Canvas 2D) running in an isolated webview

The rendering engine is **not yet published as an npm package**, but the code is fully open-source and can be integrated via source code copy, yarn/npm workspace, or built as a custom library.

---

## 1. PACKAGE STRUCTURE & EXPORTS

### Root package.json
- **Name**: `pixel-agents`
- **Version**: `1.3.0`
- **Type**: VS Code extension
- **Main entry**: `./dist/extension.js` (compiled TypeScript)
- **No `exports`, `main`, `module`, or `types` field**
- **License**: MIT
- **Published to**: VS Code Marketplace + Open VSX

### webview-ui/package.json
- **Name**: `webview-ui` (private: true)
- **Version**: `0.0.0`
- **Type**: `"module"` (ES modules)
- **Main entry**: None specified
- **Build tool**: Vite
- **Build command**: `tsc -b && vite build`

### Build Outputs
- Extension builds to `dist/extension.js` via esbuild
- Webview builds to `webview-ui/dist/` via Vite (assets + index.html + bundled JS)
- `.gitignore` prevents both `dist/` and `out/` from being tracked
- Pre-built VSIX files available on GitHub Releases (v1.0.2 through v1.3.0)

---

## 2. PUBLISHABILITY AS AN NPM LIBRARY

### Current Status: NOT PUBLISHED
The root `package.json` has:
- ❌ No `exports` field
- ❌ No `module` field
- ❌ No `types` field
- ❌ No secondary entry points

### Possible Approaches

**Option A: Use GitHub URL (Source)**
```json
{
  "dependencies": {
    "pixel-agents": "github:pablodelucca/pixel-agents"
  }
}
```
- Installs entire monorepo (extension + webview-ui)
- Requires building webview-ui yourself: `cd webview-ui && npm run build`
- No TypeScript types exported
- Viable but requires custom integration

**Option B: Not Recommended**
- Cannot use `npm install pixel-agents` (not on npm registry)
- Cannot use yarn workspace linking directly

---

## 3. WEBVIEW BUNDLE & IFRAME INTEGRATION

### Vite Build Output
The webview builds to a self-contained Vite bundle:
```
webview-ui/dist/
  ├── index.html (entry point with <div id="root">)
  ├── index-*.js (bundled React + game code, minified)
  ├── index-*.css (Tailwind)
  └── assets/
      ├── furniture-catalog.json (metadata)
      └── asset-index.json (decoded sprite data)
```

### Can It Load in an Iframe?
**Yes, with caveats:**

✅ **Works:**
- Static HTML file can be served and loaded via `<iframe src="dist/index.html">`
- React app loads and renders the canvas
- Asset loading works if served from the same origin

⚠️ **Requires:**
- **Postmessage bridge** between parent (Electron) and iframe for agent updates
- **Asset serving** must be accessible (needs HTTP server or bundling into app)
- **No VS Code API access** in iframe context (must mock or replace)

**How it currently works in VS Code:**
```typescript
// vscodeApi.ts: Checks typeof acquireVsCodeApi !== 'undefined'
// If true: uses real VS Code extension messaging
// If false: returns mock vscode object logging to console
```

For Electron, you'd replace the vscode mock with Electron IPC.

### Direct iframe embedding:
```html
<!-- In Electron renderer process -->
<iframe id="agents-frame" src="./pixel-agents/webview-ui/dist/index.html"></iframe>

<script>
  // Electron IPC bridge
  const frame = document.getElementById('agents-frame');
  const frameWindow = frame.contentWindow;
  
  window.electronAPI.onMessage((msg) => {
    frameWindow.postMessage(msg, '*');
  });
  
  frame.contentWindow.addEventListener('message', (e) => {
    window.electronAPI.send(e.data);
  });
</script>
```

---

## 4. RENDERING ENGINE DEEP DIVE

### Core Engine Files (webview-ui/src/office/engine/)

#### **renderer.ts** — Orchestrates frame rendering
- **Main function**: `renderFrame(canvas, state, editorState, zoom, pan)`
- **Renders in z-order**:
  1. Clear canvas
  2. Draw tile grid (floors)
  3. Draw furniture (with rotation/state)
  4. Draw characters (with sitting offset, mirrored sprites)
  5. Draw speech bubbles (permissions/waiting)
  6. Draw editor overlays (ghost previews, selection outlines, delete buttons)

- **Key technique**: Uses `ZDrawable` interface for generic z-sorting
- **Transform handling**: Canvas `save()` / `restore()` for mirrored sprites
- **Coordinate system**: 16×32 pixel sprites, 16px tiles, zoom-based scaling

#### **gameLoop.ts** — Animation timing & update cycle
- **Pattern**: `requestAnimationFrame` with delta-time capping
- **Signature**: 
  ```typescript
  startGameLoop(canvas, { update(dt), render() }) 
    -> returns stop() function
  ```
- **Delta calculation**: `Math.min((time - lastTime) / 1000, MAX_DELTA_TIME_SEC)`
- **Prevents frame jank** when tab becomes inactive

#### **characters.ts** — Character state machine & animation
- **Three states**: `TYPE` (typing), `WALK` (walking), `IDLE` (waiting)
- **Tool detection**: Treats Read/Grep/Glob/WebFetch/WebSearch as "reading" (different animation)
- **Movement**: Tile-based pathfinding with smooth pixel interpolation
- **Animation frames**:
  - Typing/Reading: 2-frame loops
  - Walking: 4-frame loops
  - Idle: variable pause (2–20 seconds), then wander
- **Sprite retrieval**: `getCharacterSprite(character, state, direction, frameIndex)`

#### **officeState.ts** — The game state class
Manages:
- **Agents**: `addAgent(id, pos, palette)` / `removeAgent(id)`
- **Sub-agents**: `addSubagent(parentId, id, pos)` / `removeSubagent(id)` (for Task/Agent tools)
- **Furniture**: `addFurniture(id, type, pos, rotation, state)`
- **Seats**: `reassignSeat(agentId, seatId)` / `sendToSeat(agentId)`
- **Pathfinding**: BFS to nearest walkable tile
- **UI state**: Selected/hovered agents, permission bubbles with dismissal
- **Main loop**: `update(dt)` advances character FSM and animations

**Key method signatures**:
```typescript
addAgent(id: string, pos: Vec2, palette: number)
walkToTile(agentId: string, tile: Vec2)
reassignSeat(agentId: string, seatId: string)
update(dt: number)
```

#### **index.ts** — Public exports
Exports from all submodules:
```typescript
export { createCharacter, getCharacterSprite, updateCharacter } from './characters'
export { startGameLoop, type GameLoopCallbacks } from './gameLoop'
export { OfficeState } from './officeState'
export { renderFrame, ... } from './renderer'
```

### Rendering Dependencies
- **Canvas 2D API** (no WebGL)
- **TypeScript types** (strict mode)
- **No external rendering libraries** (custom software rasterization)

---

## 5. SPRITE SYSTEM

### Sprite Files (webview-ui/src/office/sprites/)

1. **spriteData.ts** — Character sprite loading & storage
   - Loads PNG files via `setCharacterTemplates(pngDataArray)`
   - Supports 7 animation frames per direction (configurable)
   - Hue shifting: `hueShiftSprites(sprites, palette, hueShift)`
   - Fallback: 16×32px transparent placeholders if not loaded

2. **spriteCache.ts** — Rendering optimization
   - `getOutlineSprite()` — generates white border outlines (for UI)
   - `getCachedSprite()` — converts sprite data to HTML Canvas at zoom levels
   - Uses **WeakMap** for memory-efficient caching (allows GC)

3. **bubble-permission.json** & **bubble-waiting.json**
   - Pre-rendered 11×13px bubble sprites
   - Bitmask-defined directional tails
   - Stored as inline JSON with color data

4. **index.ts** — Barrel export
   ```typescript
   export { getCachedSprite, getOutlineSprite } from './spriteCache'
   export { CharacterSprites, getCharacterSprites } from './spriteData'
   ```

### Sprite Format
**Characters** (loaded from PNG files):
- Each PNG: `width × (height * 28)` pixels
  - 28 = 4 directions × 7 animation frames
- Decoded to: `Sprite` objects (array of pixel data)
- Storage: Cached Maps keyed by `(paletteIndex, hueShift)`

**Floors, Walls, Furniture** (loaded from PNG):
- Parsed by `assetLoader.ts` into `SpriteData` objects
- Stored in extension, sent to webview as JSON

### Sprite Self-Contained?
✅ **Yes, sprites are base64/JSON encoded** in the bundle:
- No external PNG file references after build
- `browserMock.ts` decodes PNGs to JSON during dev
- `vite.config.ts` includes custom `browserMockAssetsPlugin()` that pre-decodes during build
- **Result**: All sprite data baked into the webview bundle

---

## 6. REACT COMPONENTS

### Component Files (webview-ui/src/office/components/)

1. **OfficeCanvas.tsx** — Main rendering surface
   - Manages canvas element, ResizeObserver, device-pixel-ratio scaling
   - Runs game loop with `startGameLoop()` callback
   - Handles mouse/keyboard input for editing and interaction
   - Implements camera system (follow + pan + zoom)
   - Editor tools: tile painting, wall painting, furniture placement, erasing
   - Converts screen → world coordinates based on pan/zoom

2. **ToolOverlay.tsx** — Agent status indicator overlay
   - Renders floating panel above each agent
   - Shows: name, current activity (tool status or "Idle"), folder context
   - Token gauge (fuel-bar style) for team agents
   - Color-coded indicators: permission (amber), active (green)
   - Positioned via `requestAnimationFrame` for smooth following

3. **index.ts** — Barrel export
   ```typescript
   export { OfficeCanvas } from './OfficeCanvas'
   export { ToolOverlay } from './ToolOverlay'
   ```

### Are Components Standalone?
⚠️ **Partially**:
- **OfficeCanvas** requires:
  - `officeStateRef` (OfficeState instance)
  - `editorState` (edit mode + tools)
  - Canvas event handlers
  - Asset loading (sprite data, layout)
  - Game loop integration
- **ToolOverlay** requires:
  - Agent state object with `activeToolId`, `activeToolStatus`, etc.
  - Token counts
  - Positioned relative to canvas
  
Both are tightly coupled to the parent `<App>` component's state management.

---

## 7. COMMUNICATION PROTOCOL: VS Code <-> Webview

### Bidirectional Message API

#### **Extension -> Webview** (via `webview.postMessage()`)

| Message Type | Payload | Purpose |
|---|---|---|
| `layoutLoaded` | `{ layout: OfficeLayout }` | Restore saved office state |
| `characterSpritesLoaded` | `{ sprites: CharacterSprites[] }` | Load character sprite data |
| `floorTilesLoaded` | `{ tiles: TileData[] }` | Load floor textures |
| `wallTilesLoaded` | `{ walls: WallData[] }` | Load wall textures |
| `furnitureAssetsLoaded` | `{ furniture: FurnitureData[] }` | Load furniture catalog |
| `existingAgents` | `{ agents: AgentState[] }` | Restore agents on startup |
| `agentCreated` | `{ id, pos, palette, name, ... }` | New agent spawned |
| `agentClosed` | `{ id }` | Agent terminated |
| `agentSelected` | `{ id }` | User selected agent in another window |
| `agentToolStart` | `{ agentId, toolId, toolName, status }` | Agent started a tool |
| `agentToolDone` | `{ agentId, toolId }` | Tool completed |
| `agentToolClear` | `{ agentId }` | Clear all active tools (turn ended) |
| `subagentToolStart` | `{ parentId, subagentId, toolId, ... }` | Sub-agent (Task/Agent tool) started |
| `subagentToolDone` | `{ subagentId, toolId }` | Sub-agent tool completed |
| `subagentClear` | `{ subagentId }` | Clear sub-agent |
| `agentToolPermission` | `{ agentId, toolId, ... }` | Permission needed (shows bubble) |
| `agentStatus` | `{ agentId, isWaiting, hadToolsInTurn }` | Agent state changed |
| `agentTeamInfo` | `{ agentId, teamName, leadAgentId, ... }` | Team metadata |
| `agentTokenUsage` | `{ agentId, inputTokens, outputTokens }` | Context token tracking |
| `settingsLoaded` | `{ soundEnabled, alwaysShowLabels, ... }` | User preferences |
| `workspaceFolders` | `{ folders: WorkspaceFolder[] }` | Project paths |
| `externalAssetDirectoriesUpdated` | `{ directories: string[] }` | Custom asset paths |

#### **Webview -> Extension** (via `vscode.postMessage()`)

| Handler | Payload | Purpose |
|---|---|---|
| `webviewReady` | `{}` | Signals initialization complete, triggers full sync |
| `saveAgentSeats` | `{ agents: { [id]: { seatId, colorPalette } } }` | Persist seat assignments |
| `saveLayout` | `{ layout: OfficeLayout }` | Write layout file |
| `setSoundEnabled` | `{ enabled: boolean }` | Update audio preference |
| `setLastSeenVersion` | `{ version: string }` | Track extension version |
| `setAlwaysShowLabels` | `{ enabled: boolean }` | Toggle label visibility |
| `setHooksEnabled` | `{ enabled: boolean }` | Install/uninstall hooks |
| `setWatchAllSessions` | `{ enabled: boolean }` | Monitor all sessions globally |
| `openClaude` | `{}` | Launch new Claude terminal |
| `focusAgent` | `{ agentId }` | Show agent's terminal |
| `closeAgent` | `{ agentId }` | Terminate agent |
| `openSessionsFolder` | `{}` | Open sessions dir externally |
| `exportLayout` | `{}` | Save layout as JSON |
| `importLayout` | `{ layoutJson: string }` | Load layout from file |
| `addExternalAssetDirectory` | `{ directory: string }` | Add custom asset source |
| `removeExternalAssetDirectory` | `{ directory: string }` | Remove custom asset source |
| `requestDiagnostics` | `{}` | Generate diagnostics |

### Key Flow Example: Agent Tool Execution
```
1. Extension parses JSONL: { "tool_use": { "id": "xyz", "name": "Read" } }
2. Extension sends: postMessage({ type: 'agentToolStart', agentId, toolId: 'xyz', toolName: 'Read' })
3. Webview receives, updates character animation to "READING" state
4. Character walks to readable furniture, starts 2-frame animation
5. When tool completes in JSONL: postMessage({ type: 'agentToolDone', toolId: 'xyz' })
6. Character returns to IDLE
```

### Replicating in Electron
Replace `acquireVsCodeApi()` call with Electron IPC:
```typescript
// Instead of: const api = acquireVsCodeApi()
// Use:
const api = {
  postMessage: (msg) => window.electronAPI.send(msg)
};

// In Electron main process:
ipcHandle('vscode.postMessage', (channel, msg) => {
  // Route message to webview
  webview.send(msg);
});

// In webview preload:
window.addEventListener('message', (e) => {
  // Handle messages from extension
  handleMessage(e.data);
});
```

---

## 8. AGENT ACTIVITY DETECTION

### How Activity is Tracked (transcriptParser.ts)

The extension **does NOT modify** Claude Code or require API access. Instead:

1. **File Watching**: Monitors `~/.claude/projects/<hash>/output.jsonl` (Claude Code's transcript file)
2. **JSONL Parsing**: Processes each line as JSON
3. **Tool Detection**: Extracts `tool_use` blocks from assistant messages
4. **State Machine**: Transitions character from IDLE -> TYPE/READ -> WALK -> IDLE

### Tool Status Formatting
```typescript
// Detected from JSONL tool_use blocks:
"Running npm install" | "Editing config.js" | "Searching..." | "Reading file.ts"

// Special handling:
// - Read, Grep, Glob, WebFetch, WebSearch -> "reading" animation (not typing)
// - Task, Agent -> creates temporary sub-agent
// - Bash -> permission state if hooks unavailable
```

### Sub-agent Detection
When a tool opens a **Task** or **Agent** tool:
```typescript
// Create temporary sub-agent:
officeState.addSubagent(parentId, subagentId, nearParent)

// When sub-agent finishes:
officeState.removeSubagent(subagentId)
```

---

## 9. LICENSE & DEPENDENCIES

### License
**MIT** — Permissive, no usage restrictions for embedding or reuse.

### Production Dependencies (webview-ui/package.json)
```json
{
  "react": "^19.2.0",
  "react-dom": "^19.2.0"
}
```
✅ **Minimal deps** — only React for UI. Canvas 2D rendering is vanilla JS.

### Dev Dependencies
- **Vite** ^8.0.3 (build tool)
- **TypeScript** ~5.9.3
- **Tailwind CSS** ^4.2.2 (styling)
- **ESLint, tsx, pngjs** (tooling)

### Compatibility with Standalone Electron App
✅ **Yes, fully compatible**:
- React 19 works in Electron (via `react-dom/client`)
- Canvas 2D is native to Chromium (Electron's renderer)
- No VS Code-specific APIs needed in webview code (all handled via vscodeApi abstraction)
- Sprite loading can use Electron `fs` module
- Asset serving via `file://` or http server

---

## 10. VIABLE INTEGRATION APPROACHES FOR ELECTRON + REACT + VITE

### Approach 1: Copy Source Code (RECOMMENDED)
**Effort**: Medium | **Control**: High | **Coupling**: Loose

```bash
# Copy the webview-ui source into your Electron app:
cp -r pixel-agents/webview-ui/src/office your-app/src/office

# Install dependencies:
npm install react react-dom
```

**In your Electron app**:
```tsx
import { OfficeCanvas } from './office/components/OfficeCanvas'
import { OfficeState } from './office/engine/officeState'

export function AgentViewer() {
  const officeStateRef = useRef(new OfficeState())
  
  return <OfficeCanvas officeStateRef={officeStateRef} ... />
}
```

**Advantages**:
- Full control over code
- Can modify message protocol for your needs
- No VS Code dependency
- Small bundle size (only render engine used)

**Disadvantages**:
- Manual updates when pixel-agents evolves
- Need to maintain sprite data format compatibility

---

### Approach 2: Iframe + Postmessage Bridge (MEDIUM COUPLING)
**Effort**: Low | **Control**: Medium | **Coupling**: Moderate

Build pixel-agents webview as standalone bundle, serve in iframe:

```tsx
export function AgentViewer({ agents }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      // Agent requests focus, save layout, etc.
      console.log('Agent command:', e.data)
    }
    
    window.addEventListener('message', handleMessage)
    
    // Send agent updates to frame
    agents.forEach(agent => {
      frameRef.current?.contentWindow?.postMessage(
        { type: 'agentCreated', id: agent.id, ... },
        '*'
      )
    })
    
    return () => window.removeEventListener('message', handleMessage)
  }, [agents])
  
  return <iframe 
    ref={frameRef}
    src="path/to/pixel-agents/webview-ui/dist/index.html"
    style={{ border: 'none', width: '100%', height: '100%' }}
  />
}
```

**Advantages**:
- Pixel-agents code unchanged
- Easy to update (just rebuild webview)
- Isolated execution (no code conflicts)

**Disadvantages**:
- Message bridge overhead
- Asset serving complexity (CORS)
- Harder to debug
- Can't access Electron IPC directly from frame

---

### Approach 3: npm Workspace (MONOREPO)
**Effort**: High | **Control**: High | **Coupling**: Tight

```json
// package.json root
{
  "workspaces": ["packages/pixel-agents", "packages/my-app"]
}
```

```bash
cd pixel-agents
npm run build
```

Then in your app:
```json
{
  "dependencies": {
    "@pixel-agents/render": "workspace:*"
  }
}
```

**Advantages**:
- Automatic updates
- Shared TypeScript definitions
- Can customize pixel-agents locally
- Simplest dev workflow

**Disadvantages**:
- Requires pixel-agents to export properly (currently doesn't have `exports` field)
- Tightest coupling
- More complex build setup

---

### Approach 4: Pre-built VSIX Bundle (NOT RECOMMENDED)
**Effort**: Low | **Control**: None | **Coupling**: None

Download VSIX from GitHub Releases, extract assets:

```bash
unzip pixel-agents-1.3.0.vsix
# Extract webview-ui/dist/* and assets/
```

**Disadvantages**:
- Designed for VS Code, not portable
- Asset paths hardcoded
- Vite dev server config baked in
- Requires VS Code API mocking

---

## 11. COMPARISON MATRIX

| Approach | Setup Time | Maintenance | Control | Bundle Size | TypeScript Support |
|---|---|---|---|---|---|
| **Copy Source** | 30 min | High | Full | Small | Yes |
| **Iframe + Bridge** | 1 hour | Low | Limited | Medium | Partial |
| **npm Workspace** | 2 hours | Low | Full | Large | Yes |
| **VSIX Extract** | 15 min | High | None | Large | No |

---

## 12. DETAILED RECOMMENDATION

### Best Path for Your Use Case (Electron + React + Vite)

**Use Approach 1: Copy Source Code + Custom IPC Bridge**

1. **Copy `/webview-ui/src/office/` into your Electron app**
   - Keeps rendering logic modular
   - No monorepo complexity

2. **Adapt `vscodeApi.ts` to use Electron IPC**
   ```typescript
   // src/lib/electronApi.ts
   export const createAPI = () => ({
     postMessage: (msg: any) => {
       window.electron.ipcRenderer.send('agent-message', msg)
     }
   })
   ```

3. **Integrate into your agent management**
   ```tsx
   // In your Electron main process:
   ipcMain.on('agent-message', (event, msg) => {
     // Route to agent service, websocket, etc.
     agentService.processWebviewMessage(msg)
   })
   
   // Send updates back:
   mainWindow.webContents.send('agent-update', {
     type: 'agentCreated',
     id: 'new-agent',
     ...
   })
   ```

4. **Define Agent Types** once for webview + IPC:
   ```typescript
   export interface AgentMessage {
     type: 'saveLayout' | 'agentToolStart' | ...
     payload: unknown
   }
   ```

5. **Handle Asset Loading**
   - Option A: Embed sprite PNGs in asar archive
   - Option B: Load from `file://` protocol
   - Option C: Generate on startup (browserMock.ts approach)

### Why This Works Best
- Full TypeScript type safety
- Minimal dependencies (React + React-DOM)
- Easy to debug (same process, shared console)
- Fast updates (no bridge latency)
- Small final bundle (just engine code)
- Can customize rendering if needed later
- No VS Code coupling
- MIT license allows commercial use

---

## 13. UNRESOLVED QUESTIONS & GAPS

1. **Pathfinding algorithm specifics**: Code mentions BFS but the full `pathfinding.ts` implementation returned 404. Likely simple breadth-first search on `walkableTiles` map.

2. **Matrix effect implementation**: `matrixEffect.ts` referenced in engine but not fetched. Likely a visual spawn/despawn animation using green color trails.

3. **Furniture rotation mechanics**: How rotated furniture hitboxes are calculated. Likely handled in `renderer.ts` or `OfficeCanvas.tsx`.

4. **Team agent coordination**: The code mentions `teamName`, `leadAgentId`, `teamUsesTmux` but exact coordination protocol between team members isn't fully clear.

5. **Hook provider system**: `HookProvider` mentioned in `transcriptParser.ts` but not fully detailed. Likely allows custom formatting of tool statuses per extension.

6. **External asset directory format**: `assetLoader.ts` mentions custom asset directories but exact directory structure requirements aren't crystal clear.

---

## 14. FILES TO REVIEW NEXT

If you proceed with integration, read these in order:

1. `src/PixelAgentsViewProvider.ts` — Full extension lifecycle
2. `webview-ui/src/office/engine/renderer.ts` — Rendering primitives (already fetched)
3. `webview-ui/src/App.tsx` — Root component (already fetched)
4. `src/transcriptParser.ts` — Activity detection logic (already fetched)
5. `webview-ui/src/hooks/useExtensionMessages.ts` — Message routing (already fetched)

---

## 15. CODE SNIPPETS FOR IMMEDIATE USE

### Minimal Electron Integration

```typescript
// preload.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel: string, data: any) => {
      ipcRenderer.send(channel, data)
    },
    on: (channel: string, handler: (e: any, data: any) => void) => {
      ipcRenderer.on(channel, handler)
    }
  }
})

// In pixel-agents adapted vscodeApi.ts
export const createAPI = () => {
  const { electron } = window as any
  return {
    postMessage: (msg: any) => {
      electron?.ipcRenderer.send('webview-message', msg)
    }
  }
}

// main.ts (Electron main process)
ipcMain.on('webview-message', (event, msg) => {
  // Handle agent updates
  if (msg.type === 'saveLayout') {
    // persist layout
  } else if (msg.type === 'openClaude') {
    // launch terminal
  }
  // ...
})

// When agent state changes:
mainWindow.webContents.send('agent-update', {
  type: 'agentCreated',
  id: agent.id,
  pos: { x: 5, y: 3 },
  palette: 0,
  name: agent.name
})
```

---

## Conclusion

**Pixel Agents is highly integrable into Electron + React + Vite** despite not being published as a library. The rendering engine is self-contained, has minimal dependencies, uses vanilla Canvas 2D, and the entire codebase is MIT-licensed.

**Recommended path**: Copy `/webview-ui/src/office/` into your project, create a small Electron IPC bridge, and define a message protocol matching the VS Code <-> Webview interface. Total integration effort: **2-4 hours** for a working prototype.
