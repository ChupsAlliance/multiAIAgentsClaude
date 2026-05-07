# Virtual Office Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a resizable split panel to MissionDashboard that renders a pixel-art "Virtual Office" using Canvas 2D, with agents appearing as animated characters that reflect real-time mission activity, plus a persistent tile editor for customizing the office layout.

**Architecture:** Port the Canvas engine, tile editor, and sprite assets from the open-source pixel-agents VS Code extension into a new `src/components/office/` module. Connect it to the existing `useMission` hook via a new `AgentStateMapper` that translates tool call log entries into sprite animation states. Add two IPC handlers (`load-office-layout`, `save-office-layout`) to persist the office layout as JSON in Electron's userData directory.

**Tech Stack:** React 19, Canvas 2D API, TypeScript (logic modules), Vitest + @testing-library/react (tests), Electron IPC (persistence)

**Spec:** `docs/superpowers/specs/2026-05-04-virtual-office-design.md`

---

## File Map

### New files
```
agent-teams-guide/
├── src/components/office/
│   ├── VirtualOfficeCanvas.jsx          # Top-level React component, owns <canvas> ref
│   ├── assets/                          # Sprite sheets copied from pixel-agents
│   │   └── sprites/                     # Character sprite sheets (.png)
│   ├── canvas-engine/
│   │   ├── Renderer.ts                  # requestAnimationFrame draw loop
│   │   ├── TileMap.ts                   # Floor/wall/furniture tile rendering
│   │   └── SpriteAnimator.ts           # Character sprite animation state machine
│   ├── editor/
│   │   └── TileEditor.jsx               # Tile palette + click/drag placement UI
│   ├── agent-bridge/
│   │   ├── AgentStateMapper.ts          # mission log entries → AgentAnimationState
│   │   └── DeskAssigner.ts             # Tracks desk slots, assigns/releases agents
│   ├── persistence/
│   │   └── OfficeLayoutStore.ts         # load/save layout JSON via Electron IPC
│   └── types.ts                         # Shared types (TileType, AgentAnimationState, etc.)
├── src/__tests__/office/
│   ├── AgentStateMapper.test.ts
│   ├── DeskAssigner.test.ts
│   └── OfficeLayoutStore.test.ts
└── vitest.config.ts                     # New — test runner config
```

### Modified files
```
agent-teams-guide/
├── electron/ipc/system.cjs              # Add load-office-layout, save-office-layout handlers
├── electron/preload.cjs                 # Add new commands to ALLOWED_COMMANDS
├── electron/main.cjs                    # No change needed (system.cjs already registered)
├── src/components/mission/
│   └── MissionDashboard.jsx             # Add ResizeDivider + VirtualOfficeCanvas panel
└── package.json                         # Add vitest + @testing-library/react devDeps
```

---

## Task 1: Verify pixel-agents license and set up Vitest

**Files:**
- Create: `agent-teams-guide/vitest.config.ts`
- Modify: `agent-teams-guide/package.json`

- [ ] **Step 1.1: Verify license**

Open https://github.com/pablodelucca/pixel-agents/blob/main/LICENSE in a browser. Confirm it is MIT. If it is NOT MIT or another permissive license, stop and consult the user — the porting approach must change.

If MIT, create `agent-teams-guide/CREDITS.md`:
```markdown
# Credits

## pixel-agents
Canvas engine, tile editor, and sprite assets in `src/components/office/` are
adapted from [pixel-agents](https://github.com/pablodelucca/pixel-agents) by
Pablo De Lucca, licensed under the MIT License.
```

- [ ] **Step 1.2: Install Vitest**

```bash
cd agent-teams-guide
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

Expected: packages added to `node_modules`, no errors.

- [ ] **Step 1.3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
  },
})
```

- [ ] **Step 1.4: Create test setup file**

Create `agent-teams-guide/src/__tests__/setup.ts`:
```typescript
import '@testing-library/jest-dom'
```

- [ ] **Step 1.5: Add test script to package.json**

In `agent-teams-guide/package.json`, inside `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 1.6: Verify Vitest works**

Create `agent-teams-guide/src/__tests__/smoke.test.ts`:
```typescript
test('vitest is configured', () => {
  expect(1 + 1).toBe(2)
})
```

Run:
```bash
npm test
```
Expected: `1 passed`.

Delete `src/__tests__/smoke.test.ts` after confirming.

- [ ] **Step 1.7: Commit**

```bash
git add vitest.config.ts package.json package-lock.json src/__tests__/setup.ts CREDITS.md
git commit -m "chore: add vitest test runner and pixel-agents attribution"
```

---

## Task 2: Add IPC handlers for layout persistence

**Files:**
- Modify: `agent-teams-guide/electron/ipc/system.cjs` (add ~30 lines after existing handlers)
- Modify: `agent-teams-guide/electron/preload.cjs` (add 2 entries to ALLOWED_COMMANDS)

- [ ] **Step 2.1: Add handlers to system.cjs**

In `agent-teams-guide/electron/ipc/system.cjs`, after the last `ipcMain.handle(...)` block and before `console.log('[IPC] system OK')`, add:

```javascript
const path = require('path')
const fs = require('fs')
const { app } = require('electron')

const LAYOUT_FILE = path.join(app.getPath('userData'), 'office-layout.json')

const DEFAULT_LAYOUT = JSON.stringify({
  version: 1,
  width: 32,
  height: 24,
  tiles: []
})

ipcMain.handle('load_office_layout', async () => {
  try {
    if (!fs.existsSync(LAYOUT_FILE)) return DEFAULT_LAYOUT
    return fs.readFileSync(LAYOUT_FILE, 'utf8')
  } catch {
    return DEFAULT_LAYOUT
  }
})

ipcMain.handle('save_office_layout', async (_event, { json }) => {
  fs.writeFileSync(LAYOUT_FILE, json, 'utf8')
})
```

Note: `path`, `fs`, and `app` are already available in the Node.js main process — no new imports needed beyond what Electron provides. However, `app` requires importing from `electron`. Check whether `require('electron')` is already at the top of `system.cjs`. If not, add:
```javascript
const { ipcMain, app } = require('electron')
```
(Replace the existing `const { ipcMain } = require('electron')` line.)

- [ ] **Step 2.2: Add commands to preload.cjs allowlist**

In `agent-teams-guide/electron/preload.cjs`, find `const ALLOWED_COMMANDS = [` and add:
```javascript
'load_office_layout',
'save_office_layout',
```

- [ ] **Step 2.3: Verify app still starts**

```bash
npm run electron:dev
```
Expected: app opens without errors. Check DevTools console for `[IPC] system OK`.

- [ ] **Step 2.4: Commit**

```bash
git add electron/ipc/system.cjs electron/preload.cjs
git commit -m "feat(office): add IPC handlers for office layout persistence"
```

---

## Task 3: Define shared types

**Files:**
- Create: `agent-teams-guide/src/components/office/types.ts`

- [ ] **Step 3.1: Create types.ts**

```typescript
// Tile types that can appear in the office grid
export type TileType =
  | 'floor'
  | 'wall'
  | 'desk'      // special: workstation slot for agents
  | 'plant'
  | 'box'
  | 'door'
  | 'empty'     // transparent / no tile

// A single tile placed in the grid
export interface Tile {
  x: number   // column (0-indexed)
  y: number   // row (0-indexed)
  type: TileType
}

// The full office layout stored to disk
export interface OfficeLayout {
  version: 1
  width: number   // default 32
  height: number  // default 24
  tiles: Tile[]
}

// Animation state for a character in the office
export type AgentAnimationState =
  | 'spawning'
  | 'coding'       // Write, Edit, MultiEdit
  | 'reading'      // Read, Glob, Grep
  | 'working'      // Bash, WebFetch, WebSearch
  | 'waiting'      // agent waiting for user input
  | 'managing'     // Agent tool (spawning sub-agent)
  | 'celebrating'  // task/mission complete
  | 'idle'

// A desk slot in the office with optional occupant
export interface DeskSlot {
  tile: Tile
  agentName: string | null
}

// Runtime representation of an agent in the office
export interface OfficeAgent {
  name: string
  characterIndex: number   // 0-5, which of the 6 sprites
  state: AgentAnimationState
  deskSlot: DeskSlot | null
  speechBubble: string | null
  speechBubbleExpiry: number | null  // Date.now() + 3000
}

// A log entry from useMission that drives animation
export interface MissionLogEntry {
  agent: string
  message: string
  log_type: 'tool' | 'result' | 'error' | 'message' | string
  tool_name?: string
  timestamp?: number
}
```

- [ ] **Step 3.2: Commit**

```bash
git add src/components/office/types.ts
git commit -m "feat(office): add shared TypeScript types for Virtual Office"
```

---

## Task 4: Build AgentStateMapper (TDD)

**Files:**
- Create: `agent-teams-guide/src/components/office/agent-bridge/AgentStateMapper.ts`
- Create: `agent-teams-guide/src/__tests__/office/AgentStateMapper.test.ts`

- [ ] **Step 4.1: Write failing tests**

Create `agent-teams-guide/src/__tests__/office/AgentStateMapper.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { mapLogEntryToState, TOOL_TO_STATE } from '../../../components/office/agent-bridge/AgentStateMapper'
import type { MissionLogEntry } from '../../../components/office/types'

describe('mapLogEntryToState', () => {
  it('returns coding for Write tool', () => {
    const entry: MissionLogEntry = { agent: 'A', message: '', log_type: 'tool', tool_name: 'Write' }
    expect(mapLogEntryToState(entry)).toBe('coding')
  })

  it('returns coding for Edit tool', () => {
    const entry: MissionLogEntry = { agent: 'A', message: '', log_type: 'tool', tool_name: 'Edit' }
    expect(mapLogEntryToState(entry)).toBe('coding')
  })

  it('returns coding for MultiEdit tool', () => {
    const entry: MissionLogEntry = { agent: 'A', message: '', log_type: 'tool', tool_name: 'MultiEdit' }
    expect(mapLogEntryToState(entry)).toBe('coding')
  })

  it('returns reading for Read tool', () => {
    const entry: MissionLogEntry = { agent: 'A', message: '', log_type: 'tool', tool_name: 'Read' }
    expect(mapLogEntryToState(entry)).toBe('reading')
  })

  it('returns reading for Glob tool', () => {
    const entry: MissionLogEntry = { agent: 'A', message: '', log_type: 'tool', tool_name: 'Glob' }
    expect(mapLogEntryToState(entry)).toBe('reading')
  })

  it('returns reading for Grep tool', () => {
    const entry: MissionLogEntry = { agent: 'A', message: '', log_type: 'tool', tool_name: 'Grep' }
    expect(mapLogEntryToState(entry)).toBe('reading')
  })

  it('returns working for Bash tool', () => {
    const entry: MissionLogEntry = { agent: 'A', message: '', log_type: 'tool', tool_name: 'Bash' }
    expect(mapLogEntryToState(entry)).toBe('working')
  })

  it('returns working for WebFetch tool', () => {
    const entry: MissionLogEntry = { agent: 'A', message: '', log_type: 'tool', tool_name: 'WebFetch' }
    expect(mapLogEntryToState(entry)).toBe('working')
  })

  it('returns working for WebSearch tool', () => {
    const entry: MissionLogEntry = { agent: 'A', message: '', log_type: 'tool', tool_name: 'WebSearch' }
    expect(mapLogEntryToState(entry)).toBe('working')
  })

  it('returns managing for Agent tool', () => {
    const entry: MissionLogEntry = { agent: 'A', message: '', log_type: 'tool', tool_name: 'Agent' }
    expect(mapLogEntryToState(entry)).toBe('managing')
  })

  it('returns idle for unknown tool', () => {
    const entry: MissionLogEntry = { agent: 'A', message: '', log_type: 'tool', tool_name: 'UnknownTool' }
    expect(mapLogEntryToState(entry)).toBe('idle')
  })

  it('returns idle for non-tool log entry', () => {
    const entry: MissionLogEntry = { agent: 'A', message: 'hello', log_type: 'message' }
    expect(mapLogEntryToState(entry)).toBe('idle')
  })

  it('returns idle when tool_name is undefined', () => {
    const entry: MissionLogEntry = { agent: 'A', message: '', log_type: 'tool' }
    expect(mapLogEntryToState(entry)).toBe('idle')
  })
})

describe('formatSpeechBubble', () => {
  it('abbreviates long tool messages', async () => {
    const { formatSpeechBubble } = await import('../../../components/office/agent-bridge/AgentStateMapper')
    const entry: MissionLogEntry = {
      agent: 'A',
      message: 'src/components/very/long/path/to/SomeComponent.jsx',
      log_type: 'tool',
      tool_name: 'Write',
    }
    const bubble = formatSpeechBubble(entry)
    expect(bubble.length).toBeLessThanOrEqual(30)
    expect(bubble).toContain('write:')
  })

  it('returns null for non-tool entries', async () => {
    const { formatSpeechBubble } = await import('../../../components/office/agent-bridge/AgentStateMapper')
    const entry: MissionLogEntry = { agent: 'A', message: 'hello', log_type: 'message' }
    expect(formatSpeechBubble(entry)).toBeNull()
  })
})
```

- [ ] **Step 4.2: Run tests to confirm they fail**

```bash
npm test
```
Expected: multiple failures with `Cannot find module`.

- [ ] **Step 4.3: Implement AgentStateMapper.ts**

Create `agent-teams-guide/src/components/office/agent-bridge/AgentStateMapper.ts`:

```typescript
import type { AgentAnimationState, MissionLogEntry } from '../types'

export const TOOL_TO_STATE: Record<string, AgentAnimationState> = {
  Write: 'coding',
  Edit: 'coding',
  MultiEdit: 'coding',
  Read: 'reading',
  Glob: 'reading',
  Grep: 'reading',
  Bash: 'working',
  WebFetch: 'working',
  WebSearch: 'working',
  Agent: 'managing',
}

export function mapLogEntryToState(entry: MissionLogEntry): AgentAnimationState {
  if (entry.log_type !== 'tool' || !entry.tool_name) return 'idle'
  return TOOL_TO_STATE[entry.tool_name] ?? 'idle'
}

export function formatSpeechBubble(entry: MissionLogEntry): string | null {
  if (entry.log_type !== 'tool' || !entry.tool_name) return null
  const tool = entry.tool_name.toLowerCase()
  const msg = entry.message || ''
  const filename = msg.split('/').pop() || msg
  const short = filename.length > 20 ? filename.slice(0, 20) + '…' : filename
  return `${tool}: ${short}`
}
```

- [ ] **Step 4.4: Run tests to confirm they pass**

```bash
npm test
```
Expected: all `AgentStateMapper` tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add src/components/office/agent-bridge/AgentStateMapper.ts src/__tests__/office/AgentStateMapper.test.ts
git commit -m "feat(office): add AgentStateMapper with tests"
```

---

## Task 5: Build DeskAssigner (TDD)

**Files:**
- Create: `agent-teams-guide/src/components/office/agent-bridge/DeskAssigner.ts`
- Create: `agent-teams-guide/src/__tests__/office/DeskAssigner.test.ts`

- [ ] **Step 5.1: Write failing tests**

Create `agent-teams-guide/src/__tests__/office/DeskAssigner.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { DeskAssigner } from '../../../components/office/agent-bridge/DeskAssigner'
import type { Tile } from '../../../components/office/types'

const desk = (x: number, y: number): Tile => ({ x, y, type: 'desk' })

describe('DeskAssigner', () => {
  let assigner: DeskAssigner

  beforeEach(() => {
    assigner = new DeskAssigner([desk(0, 0), desk(1, 0), desk(2, 0)])
  })

  it('assigns first available desk on spawn', () => {
    const slot = assigner.assign('agent-1')
    expect(slot).not.toBeNull()
    expect(slot!.tile).toEqual(desk(0, 0))
    expect(slot!.agentName).toBe('agent-1')
  })

  it('assigns second desk to second agent', () => {
    assigner.assign('agent-1')
    const slot = assigner.assign('agent-2')
    expect(slot!.tile).toEqual(desk(1, 0))
  })

  it('returns null when all desks are occupied', () => {
    assigner.assign('agent-1')
    assigner.assign('agent-2')
    assigner.assign('agent-3')
    expect(assigner.assign('agent-4')).toBeNull()
  })

  it('releases desk and makes it available again', () => {
    assigner.assign('agent-1')
    assigner.release('agent-1')
    const slot = assigner.assign('agent-2')
    expect(slot!.tile).toEqual(desk(0, 0))
  })

  it('getSlot returns assigned slot for agent', () => {
    assigner.assign('agent-1')
    const slot = assigner.getSlot('agent-1')
    expect(slot).not.toBeNull()
    expect(slot!.agentName).toBe('agent-1')
  })

  it('getSlot returns null for unassigned agent', () => {
    expect(assigner.getSlot('ghost')).toBeNull()
  })

  it('reset clears all assignments', () => {
    assigner.assign('agent-1')
    assigner.assign('agent-2')
    assigner.reset()
    const slot = assigner.assign('agent-3')
    expect(slot!.tile).toEqual(desk(0, 0))
  })

  it('updateLayout replaces desk slots', () => {
    assigner.assign('agent-1')
    assigner.updateLayout([desk(9, 9)])
    assigner.reset()
    const slot = assigner.assign('agent-2')
    expect(slot!.tile).toEqual(desk(9, 9))
  })
})
```

- [ ] **Step 5.2: Run tests to confirm they fail**

```bash
npm test
```
Expected: failures with `Cannot find module`.

- [ ] **Step 5.3: Implement DeskAssigner.ts**

Create `agent-teams-guide/src/components/office/agent-bridge/DeskAssigner.ts`:

```typescript
import type { Tile, DeskSlot } from '../types'

export class DeskAssigner {
  private slots: DeskSlot[]

  constructor(deskTiles: Tile[]) {
    this.slots = deskTiles.map(tile => ({ tile, agentName: null }))
  }

  assign(agentName: string): DeskSlot | null {
    const free = this.slots.find(s => s.agentName === null)
    if (!free) return null
    free.agentName = agentName
    return free
  }

  release(agentName: string): void {
    const slot = this.slots.find(s => s.agentName === agentName)
    if (slot) slot.agentName = null
  }

  getSlot(agentName: string): DeskSlot | null {
    return this.slots.find(s => s.agentName === agentName) ?? null
  }

  reset(): void {
    this.slots.forEach(s => { s.agentName = null })
  }

  updateLayout(deskTiles: Tile[]): void {
    this.slots = deskTiles.map(tile => ({ tile, agentName: null }))
  }
}
```

- [ ] **Step 5.4: Run tests to confirm they pass**

```bash
npm test
```
Expected: all `DeskAssigner` tests pass.

- [ ] **Step 5.5: Commit**

```bash
git add src/components/office/agent-bridge/DeskAssigner.ts src/__tests__/office/DeskAssigner.test.ts
git commit -m "feat(office): add DeskAssigner with tests"
```

---

## Task 6: Build OfficeLayoutStore (TDD)

**Files:**
- Create: `agent-teams-guide/src/components/office/persistence/OfficeLayoutStore.ts`
- Create: `agent-teams-guide/src/__tests__/office/OfficeLayoutStore.test.ts`

- [ ] **Step 6.1: Write failing tests**

Create `agent-teams-guide/src/__tests__/office/OfficeLayoutStore.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadLayout, saveLayout, DEFAULT_LAYOUT } from '../../../components/office/persistence/OfficeLayoutStore'
import type { OfficeLayout } from '../../../components/office/types'

// Mock window.electronAPI
const mockInvoke = vi.fn()
beforeEach(() => {
  vi.stubGlobal('window', { electronAPI: { invoke: mockInvoke } })
  mockInvoke.mockReset()
})

describe('loadLayout', () => {
  it('returns parsed layout from IPC', async () => {
    const layout: OfficeLayout = { version: 1, width: 32, height: 24, tiles: [{ x: 1, y: 1, type: 'desk' }] }
    mockInvoke.mockResolvedValue(JSON.stringify(layout))
    const result = await loadLayout()
    expect(result).toEqual(layout)
    expect(mockInvoke).toHaveBeenCalledWith('load_office_layout', {})
  })

  it('returns DEFAULT_LAYOUT when IPC returns invalid JSON', async () => {
    mockInvoke.mockResolvedValue('not-json')
    const result = await loadLayout()
    expect(result).toEqual(DEFAULT_LAYOUT)
  })

  it('returns DEFAULT_LAYOUT when IPC throws', async () => {
    mockInvoke.mockRejectedValue(new Error('IPC error'))
    const result = await loadLayout()
    expect(result).toEqual(DEFAULT_LAYOUT)
  })
})

describe('saveLayout', () => {
  it('calls IPC with serialized layout', async () => {
    mockInvoke.mockResolvedValue(undefined)
    const layout: OfficeLayout = { version: 1, width: 32, height: 24, tiles: [] }
    await saveLayout(layout)
    expect(mockInvoke).toHaveBeenCalledWith('save_office_layout', { json: JSON.stringify(layout) })
  })
})

describe('DEFAULT_LAYOUT', () => {
  it('has correct structure', () => {
    expect(DEFAULT_LAYOUT.version).toBe(1)
    expect(DEFAULT_LAYOUT.width).toBe(32)
    expect(DEFAULT_LAYOUT.height).toBe(24)
    expect(DEFAULT_LAYOUT.tiles).toEqual([])
  })
})
```

- [ ] **Step 6.2: Run tests to confirm they fail**

```bash
npm test
```
Expected: failures with `Cannot find module`.

- [ ] **Step 6.3: Implement OfficeLayoutStore.ts**

Create `agent-teams-guide/src/components/office/persistence/OfficeLayoutStore.ts`:

```typescript
import type { OfficeLayout } from '../types'

export const DEFAULT_LAYOUT: OfficeLayout = {
  version: 1,
  width: 32,
  height: 24,
  tiles: [],
}

export async function loadLayout(): Promise<OfficeLayout> {
  try {
    const json = await window.electronAPI.invoke('load_office_layout', {})
    return JSON.parse(json) as OfficeLayout
  } catch {
    return DEFAULT_LAYOUT
  }
}

export async function saveLayout(layout: OfficeLayout): Promise<void> {
  await window.electronAPI.invoke('save_office_layout', { json: JSON.stringify(layout) })
}
```

- [ ] **Step 6.4: Run tests to confirm they pass**

```bash
npm test
```
Expected: all `OfficeLayoutStore` tests pass.

- [ ] **Step 6.5: Commit**

```bash
git add src/components/office/persistence/OfficeLayoutStore.ts src/__tests__/office/OfficeLayoutStore.test.ts
git commit -m "feat(office): add OfficeLayoutStore with tests"
```

---

## Task 7: Copy pixel-agents assets and port canvas engine

**Files:**
- Create: `agent-teams-guide/src/components/office/assets/sprites/` (sprite sheet PNGs)
- Create: `agent-teams-guide/src/components/office/canvas-engine/Renderer.ts`
- Create: `agent-teams-guide/src/components/office/canvas-engine/TileMap.ts`
- Create: `agent-teams-guide/src/components/office/canvas-engine/SpriteAnimator.ts`

> **Note:** Canvas rendering is hard to unit test. These files are verified manually by running the app. Focus on clean interfaces.

- [ ] **Step 7.1: Clone pixel-agents and copy assets**

```bash
# In a temp directory outside this repo
git clone https://github.com/pablodelucca/pixel-agents.git /tmp/pixel-agents

# Copy sprite assets
cp -r /tmp/pixel-agents/webview-ui/src/office/sprites \
      agent-teams-guide/src/components/office/assets/

# Also copy any sprite sheet PNGs from the webview-ui public or assets folder
# (check /tmp/pixel-agents/webview-ui/public/ and /tmp/pixel-agents/webview-ui/src/assets/)
ls /tmp/pixel-agents/webview-ui/public/
ls /tmp/pixel-agents/webview-ui/src/assets/ 2>/dev/null || true
```

Copy any `.png` sprite files found into `agent-teams-guide/src/components/office/assets/sprites/`.

- [ ] **Step 7.2: Copy and adapt engine files**

```bash
cp /tmp/pixel-agents/webview-ui/src/office/engine/* \
   agent-teams-guide/src/components/office/canvas-engine/
```

Open each file and make the following adaptations:

**VS Code API replacements (search for these patterns):**
- `vscode.postMessage(...)` → `window.electronAPI.invoke(...)` (or remove if not needed)
- `acquireVsCodeApi()` → delete entirely
- `import type { WebviewApi }` → delete
- Any `window.addEventListener('message', ...)` for VS Code messages → remove

**Asset path replacements:**
- `webview.asWebviewUri(...)` → use Vite's `new URL('../assets/sprites/name.png', import.meta.url).href`

**Grid size:** If the engine has a hardcoded grid size constant (e.g. `GRID_WIDTH = 64`, `GRID_HEIGHT = 64`), change to `GRID_WIDTH = 32`, `GRID_HEIGHT = 24`.

- [ ] **Step 7.3: Copy and adapt tile definitions**

```bash
cp /tmp/pixel-agents/webview-ui/src/office/floorTiles.ts \
   agent-teams-guide/src/components/office/canvas-engine/
cp /tmp/pixel-agents/webview-ui/src/office/wallTiles.ts \
   agent-teams-guide/src/components/office/canvas-engine/
```

Check these files for any VS Code API imports and remove them.

- [ ] **Step 7.4: Expose a clean Renderer interface**

The `Renderer.ts` should export:

```typescript
export interface RendererConfig {
  canvas: HTMLCanvasElement
  width: number    // in tiles, default 32
  height: number   // in tiles, default 24
  tileSize: number // display px per tile, default 32
}

export class Renderer {
  constructor(config: RendererConfig)
  start(): void                                   // begin requestAnimationFrame loop
  stop(): void                                    // cancel animation frame
  setTileMap(tiles: import('../types').Tile[]): void
  setAgents(agents: import('../types').OfficeAgent[]): void
}
```

If the ported engine has a different interface, wrap it in a thin adapter class that exposes this interface. Do not modify the ported engine internals unless required.

- [ ] **Step 7.5: Commit**

```bash
git add src/components/office/canvas-engine/ src/components/office/assets/
git commit -m "feat(office): port pixel-agents canvas engine and sprite assets"
```

---

## Task 8: Build VirtualOfficeCanvas React component

**Files:**
- Create: `agent-teams-guide/src/components/office/VirtualOfficeCanvas.jsx`

This is the top-level React component. It owns the `<canvas>` ref, initializes the `Renderer`, loads the layout, wires mission state to the `DeskAssigner` and `AgentStateMapper`, and renders the "Edit Office" button + `TileEditor` modal.

- [ ] **Step 8.1: Create VirtualOfficeCanvas.jsx**

```jsx
import { useEffect, useRef, useState, useCallback } from 'react'
import { Renderer } from './canvas-engine/Renderer'
import { DeskAssigner } from './agent-bridge/DeskAssigner'
import { mapLogEntryToState, formatSpeechBubble } from './agent-bridge/AgentStateMapper'
import { loadLayout, saveLayout } from './persistence/OfficeLayoutStore'
import { TileEditor } from './editor/TileEditor'

export function VirtualOfficeCanvas({ missionState, isRunning, logs }) {
  const canvasRef = useRef(null)
  const rendererRef = useRef(null)
  const assignerRef = useRef(new DeskAssigner([]))
  const agentsRef = useRef({})           // agentName → OfficeAgent
  const [layout, setLayout] = useState(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [canvasError, setCanvasError] = useState(false)

  // Load layout on mount
  useEffect(() => {
    loadLayout().then(l => {
      setLayout(l)
      const deskTiles = l.tiles.filter(t => t.type === 'desk')
      assignerRef.current.updateLayout(deskTiles)
    })
  }, [])

  // Initialize renderer when canvas and layout are ready
  useEffect(() => {
    if (!canvasRef.current || !layout) return
    try {
      rendererRef.current = new Renderer({
        canvas: canvasRef.current,
        width: layout.width,
        height: layout.height,
        tileSize: 32,
      })
      rendererRef.current.setTileMap(layout.tiles)
      rendererRef.current.start()
    } catch (err) {
      console.error('[VirtualOffice] Canvas init failed:', err)
      setCanvasError(true)
    }
    return () => rendererRef.current?.stop()
  }, [layout])

  // Sync agent list from missionState
  useEffect(() => {
    if (!missionState?.agents) return
    const currentNames = new Set(missionState.agents.map(a => a.name))

    // Add new agents
    for (const agent of missionState.agents) {
      if (!agentsRef.current[agent.name]) {
        const slot = assignerRef.current.assign(agent.name)
        agentsRef.current[agent.name] = {
          name: agent.name,
          characterIndex: Math.floor(Math.random() * 6),
          state: 'spawning',
          deskSlot: slot,
          speechBubble: null,
          speechBubbleExpiry: null,
        }
      }
    }

    // Remove finished agents
    for (const name of Object.keys(agentsRef.current)) {
      if (!currentNames.has(name)) {
        assignerRef.current.release(name)
        delete agentsRef.current[name]
      }
    }

    rendererRef.current?.setAgents(Object.values(agentsRef.current))
  }, [missionState?.agents])

  // Process incoming log entries to update agent animation states
  useEffect(() => {
    if (!logs?.length) return
    const latest = logs[logs.length - 1]
    if (!latest?.agent || !agentsRef.current[latest.agent]) return

    const agent = agentsRef.current[latest.agent]
    agent.state = mapLogEntryToState(latest)
    const bubble = formatSpeechBubble(latest)
    if (bubble) {
      agent.speechBubble = bubble
      agent.speechBubbleExpiry = Date.now() + 3000
    }

    rendererRef.current?.setAgents(Object.values(agentsRef.current))
  }, [logs])

  // Reset office when mission stops
  useEffect(() => {
    if (!isRunning) {
      assignerRef.current.reset()
      agentsRef.current = {}
      rendererRef.current?.setAgents([])
    }
  }, [isRunning])

  const handleSaveLayout = useCallback(async (newLayout) => {
    setLayout(newLayout)
    await saveLayout(newLayout)
    const deskTiles = newLayout.tiles.filter(t => t.type === 'desk')
    assignerRef.current.updateLayout(deskTiles)
    rendererRef.current?.setTileMap(newLayout.tiles)
    setEditorOpen(false)
  }, [])

  if (canvasError) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-sm">
        Office unavailable
      </div>
    )
  }

  return (
    <div className="relative flex flex-col h-full bg-slate-950">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800">
        <span className="text-xs text-slate-400 font-medium">Virtual Office</span>
        <button
          onClick={() => setEditorOpen(true)}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          Edit Office
        </button>
      </div>

      {/* Canvas */}
      <div className="flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="w-full h-full"
          style={{ imageRendering: 'pixelated' }}
        />
      </div>

      {/* Tile editor modal */}
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

- [ ] **Step 8.2: Commit**

```bash
git add src/components/office/VirtualOfficeCanvas.jsx
git commit -m "feat(office): add VirtualOfficeCanvas React component"
```

---

## Task 9: Port TileEditor from pixel-agents

**Files:**
- Create: `agent-teams-guide/src/components/office/editor/TileEditor.jsx`

- [ ] **Step 9.1: Copy editor files from pixel-agents**

```bash
cp -r /tmp/pixel-agents/webview-ui/src/office/editor/* \
      agent-teams-guide/src/components/office/editor/
```

Apply the same VS Code API adaptations as Task 7 Step 7.2.

- [ ] **Step 9.2: Create TileEditor.jsx wrapper**

If the ported editor is a React component, adapt its props interface to match what `VirtualOfficeCanvas` passes:

```jsx
// Props expected by VirtualOfficeCanvas:
// - layout: OfficeLayout
// - isRunning: boolean
// - onSave: (newLayout: OfficeLayout) => void
// - onClose: () => void
```

If the ported editor uses VS Code webview message passing for its own internal state, replace those calls with React `useState`.

The editor must render a "Mission in progress — layout is read-only" overlay banner when `isRunning === true` and disable the Save button.

- [ ] **Step 9.3: Manual test**

Start the app, open Mission Control page, look for "Edit Office" button in the right panel. Click it — the tile editor should open. Place a desk tile, click Save. Restart the app — the desk tile should still be there.

```bash
npm run electron:dev
```

- [ ] **Step 9.4: Commit**

```bash
git add src/components/office/editor/
git commit -m "feat(office): port tile editor from pixel-agents"
```

---

## Task 10: Add split panel to MissionDashboard

**Files:**
- Modify: `agent-teams-guide/src/components/mission/MissionDashboard.jsx`

- [ ] **Step 10.1: Add VirtualOfficeCanvas import**

At the top of `MissionDashboard.jsx`, add:
```javascript
import { VirtualOfficeCanvas } from '../office/VirtualOfficeCanvas'
```

- [ ] **Step 10.2: Add ResizeDivider component**

Add this small component at the bottom of `MissionDashboard.jsx` (before the export):

```jsx
function ResizeDivider({ onResize }) {
  const dragging = useRef(false)
  const startX = useRef(0)

  const onMouseDown = (e) => {
    dragging.current = true
    startX.current = e.clientX
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  const onMouseMove = (e) => {
    if (!dragging.current) return
    onResize(e.clientX - startX.current)
    startX.current = e.clientX
  }

  const onMouseUp = () => {
    dragging.current = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  return (
    <div
      onMouseDown={onMouseDown}
      className="w-1 cursor-col-resize bg-slate-800 hover:bg-indigo-500 transition-colors flex-shrink-0"
    />
  )
}
```

- [ ] **Step 10.3: Add office panel width state**

Inside `MissionDashboard`, add after the existing `useState` calls:

```javascript
const [officePanelWidth, setOfficePanelWidth] = useState(() => {
  const saved = localStorage.getItem('office-panel-ratio')
  return saved ? parseInt(saved, 10) : 420
})

const handleOfficeResize = useCallback((delta) => {
  setOfficePanelWidth(prev => {
    const next = Math.max(300, Math.min(prev - delta, window.innerWidth - 400))
    localStorage.setItem('office-panel-ratio', String(next))
    return next
  })
}, [])
```

- [ ] **Step 10.4: Wrap existing content and add office panel**

Find the outermost `return (` div in `MissionDashboard.jsx`. Wrap the entire existing content in a left panel div, then add the divider and office panel. The structure should look like:

```jsx
return (
  <div className="flex h-full w-full overflow-hidden">
    {/* Left: existing dashboard content */}
    <div className="flex flex-col flex-1 min-w-[400px] overflow-hidden">
      {/* === ALL EXISTING JSX GOES HERE — do not change anything inside === */}
    </div>

    {/* Resize handle */}
    <ResizeDivider onResize={handleOfficeResize} />

    {/* Right: Virtual Office */}
    <div
      className="flex-shrink-0 overflow-hidden"
      style={{ width: officePanelWidth }}
    >
      <VirtualOfficeCanvas
        missionState={state}
        isRunning={isRunning}
        logs={logs}
      />
    </div>
  </div>
)
```

- [ ] **Step 10.5: Manual test — layout**

```bash
npm run electron:dev
```

Open a mission. The dashboard should show the existing left panel with tabs, a thin drag handle, and the Virtual Office canvas on the right. Drag the handle to resize. Restart the app — the ratio should persist.

Verify no layout regressions: Activity Log, Agents, Files tabs should all work as before.

- [ ] **Step 10.6: Manual test — agents animate**

Start a real mission. Agents should appear in the office as they spawn. When they run tool calls (Write, Read, Bash, etc.), their animation state should change. Speech bubbles should appear and disappear after 3 seconds.

- [ ] **Step 10.7: Commit**

```bash
git add src/components/mission/MissionDashboard.jsx
git commit -m "feat(office): add Virtual Office split panel to MissionDashboard"
```

---

## Task 11: End-to-end smoke test and error handling verification

**Files:** No new files — verification only.

- [ ] **Step 11.1: Test canvas failure fallback**

Temporarily force the canvas to throw by adding `throw new Error('test')` as the first line inside the `try` block in `VirtualOfficeCanvas.jsx` at the Renderer init. Start the app — the right panel should show "Office unavailable" and the left panel should work normally. Revert the change.

- [ ] **Step 11.2: Test corrupt layout fallback**

Write invalid JSON to `%APPDATA%\agent-teams-guide\office-layout.json` (find the path via `app.getPath('userData')` in DevTools). Restart the app — it should silently fall back to an empty layout without crashing.

```javascript
// In DevTools console (Electron renderer):
console.log(await window.electronAPI.invoke('load_office_layout', {}))
```

- [ ] **Step 11.3: Test no-desk overflow**

In the tile editor, delete all desk tiles and save. Start a mission. Spawned agents should appear in the overflow corner with a "no desk" badge instead of crashing.

- [ ] **Step 11.4: Run full test suite**

```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 11.5: Final commit**

```bash
git add -A
git commit -m "feat(office): Virtual Office integration complete

- Canvas 2D rendering ported from pixel-agents (MIT)
- Tile editor with persistent global layout
- Agent state animations driven by mission log events
- Resizable split panel in MissionDashboard
- Graceful fallbacks for canvas/layout errors"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Split view alongside existing dashboard → Task 10
- [x] Pixel art Canvas 2D → Task 7
- [x] Full tile editor → Task 9
- [x] Global persistent layout → Tasks 2, 6, 9
- [x] Auto-assign agents to desks → Task 5
- [x] Agent state animations → Tasks 3, 4, 8
- [x] Speech bubbles → Task 4 (formatSpeechBubble), Task 8
- [x] 6 character sprites → Task 7 (copy assets), Task 8 (characterIndex 0-5)
- [x] Overflow corner for no-desk agents → Task 8 (VirtualOfficeCanvas), Task 11
- [x] Resizable panel, ratio persists → Task 10
- [x] Canvas error fallback → Task 8, Task 11
- [x] Layout corrupt fallback → Task 6 (OfficeLayoutStore), Task 11
- [x] Mission stop → agents fade out → Task 8 (isRunning effect)
- [x] IPC handlers load/save → Task 2
- [x] License verification + attribution → Task 1

**No placeholders found.**

**Type consistency:**
- `OfficeAgent` defined in `types.ts` Task 3, used in Task 8
- `DeskSlot` defined in `types.ts` Task 3, returned by `DeskAssigner.assign()` Task 5
- `OfficeLayout` defined in `types.ts` Task 3, used in Tasks 6, 9, 10
- `MissionLogEntry` defined in `types.ts` Task 3, used in Tasks 4, 8
- `mapLogEntryToState` exported from `AgentStateMapper.ts` Task 4, imported in Task 8 ✓
- `formatSpeechBubble` exported from `AgentStateMapper.ts` Task 4, imported in Task 8 ✓
- `DeskAssigner` exported as class Task 5, instantiated in Task 8 ✓
- `loadLayout`, `saveLayout` exported from `OfficeLayoutStore.ts` Task 6, imported in Task 8 ✓
- `Renderer` exported as class from Task 7, used in Task 8 ✓
- `TileEditor` exported from Task 9, used in Task 8 ✓
