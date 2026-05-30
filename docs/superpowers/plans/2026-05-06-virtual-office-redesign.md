# Virtual Office Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Canvas 2D rendering with CSS DOM rendering so the Virtual Office displays correctly in Electron without blank canvas, StrictMode, or sprite-loading bugs.

**Architecture:** Tiles become absolutely-positioned `<div>` elements (floor = background color, ~130 wall/furniture divs). Agents use CSS `background-image` with sprite sheet coordinates for animation. A StrictMode-safe RAF hook drives frame counters. All 4 root-cause bugs are fixed.

**Tech Stack:** React 18, Tailwind CSS, Vite (Electron build with `vite.config.electron.mjs`), existing sprite PNGs in `src/components/office/assets/sprites/`

**Spec:** `docs/superpowers/specs/2026-05-06-virtual-office-redesign-design.md`

**Execution order:** Tasks 1–3 run in parallel. Task 4 runs after Tasks 1–3 complete.

---

## Phase 1 — Parallel Tasks (Agent A + B + C)

---

### Task 1 [Agent A]: Fix IPC + DEFAULT_LAYOUT

**Files:**
- Modify: `agent-teams-guide/src/components/office/persistence/OfficeLayoutStore.ts`
- Modify: `agent-teams-guide/electron/ipc/system.cjs`

- [ ] **Step 1.1: Verify working tree has the buildDefaultTiles fix**

```bash
cd agent-teams-guide
git diff HEAD -- src/components/office/persistence/OfficeLayoutStore.ts | head -30
```

Expected: diff shows `buildDefaultTiles()` function added and used in `DEFAULT_LAYOUT`.

- [ ] **Step 1.2: Add empty-tiles guard to OfficeLayoutStore.ts**

Open `src/components/office/persistence/OfficeLayoutStore.ts`. Replace the `loadLayout` function with:

```ts
export async function loadLayout(): Promise<OfficeLayout> {
  try {
    const json = await (window as any).electronAPI.invoke('load_office_layout')
    const layout = JSON.parse(json) as OfficeLayout
    if (!Array.isArray(layout.tiles) || layout.tiles.length === 0) {
      return structuredClone(DEFAULT_LAYOUT) as OfficeLayout
    }
    return layout
  } catch {
    return structuredClone(DEFAULT_LAYOUT) as OfficeLayout
  }
}
```

- [ ] **Step 1.3: Add empty-tiles guard to system.cjs IPC handler**

Open `electron/ipc/system.cjs`. Replace the `load_office_layout` handler with:

```js
ipcMain.handle('load_office_layout', async () => {
  try {
    const raw = fs.readFileSync(LAYOUT_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    // Guard: reject saved layouts with no tiles (from old buggy default)
    if (!Array.isArray(parsed.tiles) || parsed.tiles.length === 0) {
      return DEFAULT_LAYOUT;
    }
    return raw;
  } catch {
    return DEFAULT_LAYOUT;
  }
});
```

- [ ] **Step 1.4: Run existing OfficeLayoutStore tests**

```bash
cd agent-teams-guide
npx vitest run src/__tests__/office/OfficeLayoutStore.test.ts
```

Expected: all tests pass. If any fail, inspect the test — the mock for `window.electronAPI` must return a non-empty `tiles` array to pass the new guard.

- [ ] **Step 1.5: Commit**

```bash
cd agent-teams-guide
git add src/components/office/persistence/OfficeLayoutStore.ts electron/ipc/system.cjs
git commit -m "fix(office): commit DEFAULT_LAYOUT tiles and guard against empty saved layouts"
```

---

### Task 2 [Agent B]: CSS Rendering Components

**Files:**
- Create: `agent-teams-guide/src/components/office/rendering/OfficeTileGrid.jsx`
- Create: `agent-teams-guide/src/components/office/rendering/AgentSprite.jsx`
- Create: `agent-teams-guide/src/components/office/rendering/SpeechBubble.jsx`

**Context:** Sprite sheets are at `src/components/office/assets/sprites/char_0.png` through `char_5.png`. Each is 64×224px: 4 columns × 7 rows, each frame 16×32px. Row layout: 0=walk-down, 1=walk-up, 2=walk-right, 3=typing-down, 4=typing-right, 5=reading-down, 6=reading-right. LEFT = RIGHT + `scaleX(-1)`.

Agent animation states: `'spawning' | 'coding' | 'reading' | 'working' | 'waiting' | 'managing' | 'celebrating' | 'idle'`

- [ ] **Step 2.1: Create SpeechBubble.jsx**

```bash
mkdir -p agent-teams-guide/src/components/office/rendering
```

Create `agent-teams-guide/src/components/office/rendering/SpeechBubble.jsx`:

```jsx
// SpeechBubble.jsx — CSS speech bubble shown above an agent tile
export function SpeechBubble({ text }) {
  if (!text) return null
  const MAX_CHARS = 24
  const label = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS - 1) + '…' : text

  return (
    <div style={{
      position: 'absolute',
      bottom: '100%',
      left: '50%',
      transform: 'translateX(-50%)',
      marginBottom: 4,
      whiteSpace: 'nowrap',
      zIndex: 20,
      pointerEvents: 'none',
    }}>
      <div style={{
        background: 'rgba(255,255,255,0.92)',
        border: '1px solid rgba(0,0,0,0.15)',
        borderRadius: 4,
        padding: '2px 5px',
        fontSize: 9,
        fontFamily: 'monospace',
        color: '#222',
        lineHeight: 1.4,
      }}>
        {label}
      </div>
      {/* Tail */}
      <div style={{
        width: 0, height: 0,
        borderLeft: '4px solid transparent',
        borderRight: '4px solid transparent',
        borderTop: '4px solid rgba(255,255,255,0.92)',
        margin: '0 auto',
      }} />
    </div>
  )
}
```

- [ ] **Step 2.2: Create AgentSprite.jsx**

Create `agent-teams-guide/src/components/office/rendering/AgentSprite.jsx`:

```jsx
import { SpeechBubble } from './SpeechBubble'

// Import all 6 character sprite sheets — Vite bundles these as valid URLs
import char0 from '../assets/sprites/char_0.png'
import char1 from '../assets/sprites/char_1.png'
import char2 from '../assets/sprites/char_2.png'
import char3 from '../assets/sprites/char_3.png'
import char4 from '../assets/sprites/char_4.png'
import char5 from '../assets/sprites/char_5.png'

const SPRITE_URLS = [char0, char1, char2, char3, char4, char5]

// Sprite sheet: 4 cols × 7 rows, each frame 16×32px
// Row mapping:
const ROW = {
  walkDown: 0, walkUp: 1, walkRight: 2,
  typingDown: 3, typingRight: 4,
  readingDown: 5, readingRight: 6,
}

// Direction constants matching AgentStateMapper
const DIR = { DOWN: 0, LEFT: 1, RIGHT: 2, UP: 3 }

/**
 * Returns { row, col, flip } for the current agent state + animation frame.
 * flip=true means apply scaleX(-1) (LEFT direction reuses RIGHT frames).
 */
function getFrameCoords(agentState, animFrame, dir) {
  const frame = animFrame ?? 0

  if (agentState === 'spawning') {
    const col = frame % 3
    if (dir === DIR.UP) return { row: ROW.walkUp, col, flip: false }
    if (dir === DIR.RIGHT) return { row: ROW.walkRight, col, flip: false }
    if (dir === DIR.LEFT) return { row: ROW.walkRight, col, flip: true }
    return { row: ROW.walkDown, col, flip: false }
  }

  if (agentState === 'reading') {
    const col = frame % 2
    if (dir === DIR.RIGHT) return { row: ROW.readingRight, col, flip: false }
    if (dir === DIR.LEFT) return { row: ROW.readingRight, col, flip: true }
    return { row: ROW.readingDown, col, flip: false }
  }

  // coding, working, waiting, managing, celebrating, idle → typing animation
  const col = frame % 2
  if (dir === DIR.RIGHT) return { row: ROW.typingRight, col, flip: false }
  if (dir === DIR.LEFT) return { row: ROW.typingRight, col, flip: true }
  return { row: ROW.typingDown, col, flip: false }
}

/**
 * AgentSprite — renders one agent as a positioned CSS sprite.
 *
 * Props:
 *   agent     — { name, characterIndex, state, deskSlot, speechBubble, speechBubbleExpiry }
 *   tileSize  — display pixels per tile
 *   animFrame — current animation frame index (0-3, driven by parent)
 *   animDir   — Direction constant (0=DOWN,1=LEFT,2=RIGHT,3=UP)
 */
export function AgentSprite({ agent, tileSize, animFrame, animDir }) {
  const ts = tileSize

  // Position — use desk tile or fallback to top-left area
  const tileX = agent.deskSlot?.tile?.x ?? 2
  const tileY = agent.deskSlot?.tile?.y ?? 2

  const spriteUrl = SPRITE_URLS[agent.characterIndex % 6]
  const { row, col, flip } = getFrameCoords(agent.state, animFrame, animDir ?? 0)

  // Sprite is 2 tiles tall (16×32 native)
  const spriteW = ts
  const spriteH = ts * 2

  // Center horizontally on tile, anchor bottom to tile top
  const left = tileX * ts + (ts - spriteW) / 2
  const top = tileY * ts - spriteH + ts

  // speech bubble visible?
  const now = Date.now()
  const bubbleText = agent.speechBubble &&
    (!agent.speechBubbleExpiry || now < agent.speechBubbleExpiry)
    ? agent.speechBubble : null

  const SHORT_NAME_MAX = 10
  const shortName = agent.name.length > SHORT_NAME_MAX
    ? agent.name.slice(0, SHORT_NAME_MAX - 1) + '…'
    : agent.name

  return (
    <div style={{
      position: 'absolute',
      left,
      top,
      width: spriteW,
      height: spriteH,
      zIndex: 10 + tileY, // z-sort by tile row
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
    }}>
      {/* Speech bubble (above sprite) */}
      <SpeechBubble text={bubbleText} />

      {/* Sprite frame */}
      <div style={{
        width: spriteW,
        height: spriteH,
        backgroundImage: `url(${spriteUrl})`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: `-${col * ts}px -${row * ts * 2}px`,
        backgroundSize: `${4 * ts}px ${14 * ts}px`,
        imageRendering: 'pixelated',
        transform: flip ? 'scaleX(-1)' : 'none',
        flexShrink: 0,
      }} />

      {/* Name label */}
      <div style={{
        position: 'absolute',
        top: spriteH + 1,
        left: '50%',
        transform: 'translateX(-50%)',
        fontSize: 8,
        fontFamily: 'monospace',
        color: 'rgba(255,255,255,0.8)',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
      }}>
        {shortName}
      </div>
    </div>
  )
}
```

- [ ] **Step 2.3: Create OfficeTileGrid.jsx**

Create `agent-teams-guide/src/components/office/rendering/OfficeTileGrid.jsx`:

```jsx
import { AgentSprite } from './AgentSprite'

// Tile fill colors — matches existing TileMap.ts palette
const TILE_COLORS = {
  floor: '#c8b89a',
  wall: '#5a4a3a',
  desk: '#8b6914',
  plant: '#2d7a2d',
  box: '#b8860b',
  door: '#7a5c3a',
}

// Accent overlays drawn on top of tile base color
function TileAccent({ tile, ts }) {
  const { type, x, y } = tile
  const base = {
    position: 'absolute',
    left: x * ts,
    top: y * ts,
    width: ts,
    height: ts,
    pointerEvents: 'none',
  }

  if (type === 'wall') {
    return (
      <div style={{ ...base, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.3)' }} />
    )
  }
  if (type === 'desk') {
    return (
      <div style={{
        position: 'absolute',
        left: x * ts + 2,
        top: y * ts + 2,
        width: ts - 4,
        height: Math.max(1, ts / 2 - 2),
        background: 'rgba(255,255,255,0.15)',
        pointerEvents: 'none',
      }} />
    )
  }
  if (type === 'plant') {
    return (
      <div style={{
        position: 'absolute',
        left: x * ts + ts / 2 - 1,
        top: y * ts + ts / 2,
        width: 2,
        height: Math.max(1, ts / 2 - 2),
        background: '#1a5c1a',
        pointerEvents: 'none',
      }} />
    )
  }
  if (type === 'door') {
    return (
      <div style={{
        position: 'absolute',
        left: x * ts + ts * 0.2,
        top: y * ts + ts * 0.1,
        width: ts * 0.6,
        height: ts * 0.8,
        background: 'rgba(0,0,0,0.2)',
        pointerEvents: 'none',
      }} />
    )
  }
  return null
}

/**
 * OfficeTileGrid — renders the office as CSS positioned divs.
 *
 * Props:
 *   tiles      — Tile[] from OfficeLayout
 *   tileSize   — display pixels per tile
 *   cols       — grid width in tiles (layout.width, default 32)
 *   rows       — grid height in tiles (layout.height, default 24)
 *   agents     — OfficeAgent[] with animFrame + animDir added
 */
export function OfficeTileGrid({ tiles, tileSize, cols = 32, rows = 24, agents = [] }) {
  const ts = tileSize
  const nonFloorTiles = tiles.filter(t => t.type !== 'floor')

  return (
    <div style={{
      position: 'relative',
      width: cols * ts,
      height: rows * ts,
      backgroundColor: TILE_COLORS.floor,
      // Outer void / background
      outline: '2px solid #1e1e2e',
      flexShrink: 0,
    }}>
      {/* Non-floor tiles */}
      {nonFloorTiles.map(tile => (
        <div key={`${tile.x},${tile.y}`} style={{
          position: 'absolute',
          left: tile.x * ts,
          top: tile.y * ts,
          width: ts,
          height: ts,
          backgroundColor: TILE_COLORS[tile.type] ?? TILE_COLORS.floor,
        }} />
      ))}

      {/* Tile accents (shadows, highlights) */}
      {nonFloorTiles.map(tile => (
        <TileAccent key={`acc-${tile.x},${tile.y}`} tile={tile} ts={ts} />
      ))}

      {/* Agent sprites */}
      {agents.map(agent => (
        <AgentSprite
          key={agent.name}
          agent={agent}
          tileSize={ts}
          animFrame={agent.animFrame ?? 0}
          animDir={agent.animDir ?? 0}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 2.4: Run existing tests to verify no regressions**

```bash
cd agent-teams-guide
npx vitest run
```

Expected: all existing tests pass (new files have no tests yet — that's fine, they're pure rendering).

- [ ] **Step 2.5: Commit**

```bash
cd agent-teams-guide
git add src/components/office/rendering/
git commit -m "feat(office): add CSS-based OfficeTileGrid, AgentSprite, SpeechBubble rendering components"
```

---

### Task 3 [Agent C]: Main Component + Hooks

**Files:**
- Create: `agent-teams-guide/src/components/office/hooks/useAnimationTick.js`
- Create: `agent-teams-guide/src/components/office/hooks/useOfficeLayout.js`
- Create: `agent-teams-guide/src/components/office/hooks/useAgentSync.js`
- Create: `agent-teams-guide/src/components/office/VirtualOffice.jsx`
- Modify: `agent-teams-guide/src/components/office/agent-bridge/AgentStateMapper.ts` — add `getFrameCoords` export

**Context:** `AgentStateMapper.ts` currently exports `mapLogEntryToState(entry)` and `formatSpeechBubble(entry)`. `DeskAssigner.ts` exports class `DeskAssigner` with `assign(name)`, `release(name)`, `reset()`, `updateLayout(deskTiles)`. `OfficeLayout` type is in `types.ts`: `{ version, width, height, tiles: Tile[] }`.

- [ ] **Step 3.1: Create useAnimationTick.js**

```bash
mkdir -p agent-teams-guide/src/components/office/hooks
```

Create `agent-teams-guide/src/components/office/hooks/useAnimationTick.js`:

```js
import { useEffect, useRef } from 'react'

/**
 * useAnimationTick — StrictMode-safe requestAnimationFrame hook.
 *
 * Calls `callback(dt)` every frame where dt is time-delta in seconds.
 * Uses a ref for the callback so it never needs to restart the RAF loop
 * when the callback changes (avoids StrictMode double-cancel issues).
 *
 * @param {function(dt: number): void} callback
 */
export function useAnimationTick(callback) {
  const savedCallback = useRef(callback)

  useEffect(() => {
    savedCallback.current = callback
  })

  useEffect(() => {
    let rafId
    let lastTime = 0

    function tick(time) {
      const dt = lastTime === 0 ? 0 : Math.min((time - lastTime) / 1000, 0.1)
      lastTime = time
      savedCallback.current(dt)
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, []) // stable — never restarts
}
```

- [ ] **Step 3.2: Create useOfficeLayout.js**

Create `agent-teams-guide/src/components/office/hooks/useOfficeLayout.js`:

```js
import { useState, useEffect, useCallback } from 'react'
import { loadLayout, saveLayout } from '../persistence/OfficeLayoutStore'

/**
 * useOfficeLayout — loads and saves the office layout via Electron IPC.
 * Returns { layout, isLoading, saveLayout }
 */
export function useOfficeLayout() {
  const [layout, setLayout] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    loadLayout().then(l => {
      if (!cancelled) {
        setLayout(l)
        setIsLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [])

  const handleSave = useCallback(async (newLayout) => {
    setLayout(newLayout)
    await saveLayout(newLayout)
  }, [])

  return { layout, isLoading, saveLayout: handleSave }
}
```

- [ ] **Step 3.3: Create useAgentSync.js**

Create `agent-teams-guide/src/components/office/hooks/useAgentSync.js`:

```js
import { useState, useRef, useEffect } from 'react'
import { DeskAssigner } from '../agent-bridge/DeskAssigner'
import { mapLogEntryToState, formatSpeechBubble } from '../agent-bridge/AgentStateMapper'

/**
 * useAgentSync — syncs mission agents to office render state.
 *
 * Reads missionState.agents and logs to produce an array of
 * office agent objects ready for rendering.
 *
 * Returns { agents } where each agent has:
 *   name, characterIndex, state, deskSlot,
 *   speechBubble, speechBubbleExpiry,
 *   animFrame (set by animation tick), animDir
 */
export function useAgentSync(missionState, isRunning, logs, layout) {
  const [agents, setAgents] = useState([])
  const agentsRef = useRef({})
  const assignerRef = useRef(new DeskAssigner([]))

  // Update desk layout when layout changes
  useEffect(() => {
    if (!layout) return
    const deskTiles = layout.tiles.filter(t => t.type === 'desk')
    assignerRef.current.updateLayout(deskTiles)
  }, [layout])

  // Sync agents from missionState
  useEffect(() => {
    if (!missionState?.agents) return
    const currentNames = new Set(missionState.agents.map(a => a.name))

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
          animFrame: 0,
          animDir: 0,
        }
      }
    }
    for (const name of Object.keys(agentsRef.current)) {
      if (!currentNames.has(name)) {
        assignerRef.current.release(name)
        delete agentsRef.current[name]
      }
    }
    setAgents(Object.values(agentsRef.current))
  }, [missionState?.agents])

  // Process logs → update agent state + speech bubble
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
    } else {
      agent.speechBubble = null
      agent.speechBubbleExpiry = null
    }
    setAgents(Object.values(agentsRef.current))
  }, [logs])

  // Reset when mission stops
  useEffect(() => {
    if (!isRunning) {
      assignerRef.current.reset()
      agentsRef.current = {}
      setAgents([])
    }
  }, [isRunning])

  return { agents, agentsRef }
}
```

- [ ] **Step 3.4: Create VirtualOffice.jsx**

Create `agent-teams-guide/src/components/office/VirtualOffice.jsx`:

```jsx
import { useRef, useState, useEffect, useCallback } from 'react'
import { OfficeTileGrid } from './rendering/OfficeTileGrid'
import { TileEditor } from './editor/TileEditor'
import { useAnimationTick } from './hooks/useAnimationTick'
import { useOfficeLayout } from './hooks/useOfficeLayout'
import { useAgentSync } from './hooks/useAgentSync'

const WALK_FRAME_SEC = 0.15
const TYPE_FRAME_SEC = 0.4

export function VirtualOffice({ missionState, isRunning, logs }) {
  const containerRef = useRef(null)
  const [tileSize, setTileSize] = useState(16)
  const [editorOpen, setEditorOpen] = useState(false)

  const { layout, isLoading, saveLayout } = useOfficeLayout()
  const { agents } = useAgentSync(missionState, isRunning, logs, layout)

  // animStates: name → { frame, frameTimer }
  // Kept in React state so updates trigger re-renders of OfficeTileGrid
  const [animStates, setAnimStates] = useState({})
  const animRef = useRef({}) // same data in ref for mutation in tick

  // Compute tileSize to fit the container
  useEffect(() => {
    const container = containerRef.current
    if (!container || !layout) return
    const compute = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      if (w > 0 && h > 0) {
        const ts = Math.max(4, Math.min(
          Math.floor(w / layout.width),
          Math.floor(h / layout.height),
        ))
        setTileSize(ts)
      }
    }
    compute()
    const observer = new ResizeObserver(compute)
    observer.observe(container)
    return () => observer.disconnect()
  }, [layout])

  // Animation tick — advances frame counters, triggers re-render only on frame change
  useAnimationTick((dt) => {
    if (!agents.length) return
    let changed = false

    for (const agent of agents) {
      let s = animRef.current[agent.name]
      if (!s) {
        s = { frame: 0, frameTimer: 0 }
        animRef.current[agent.name] = s
      }

      const isWalking = agent.state === 'spawning'
      const duration = isWalking ? WALK_FRAME_SEC : TYPE_FRAME_SEC
      const maxFrame = isWalking ? 4 : 2

      s.frameTimer += dt
      if (s.frameTimer >= duration) {
        s.frameTimer -= duration
        s.frame = (s.frame + 1) % maxFrame
        changed = true
      }
    }

    // Clean up timers for removed agents
    for (const name of Object.keys(animRef.current)) {
      if (!agents.find(a => a.name === name)) delete animRef.current[name]
    }

    if (changed) {
      // Copy to state to trigger re-render (shallow copy of current frame values)
      setAnimStates(Object.fromEntries(
        Object.entries(animRef.current).map(([n, s]) => [n, { frame: s.frame }])
      ))
    }
  })

  // Merge agents with their current animFrame for rendering
  const agentsWithAnim = agents.map(a => ({
    ...a,
    animFrame: animStates[a.name]?.frame ?? 0,
    animDir: 0, // always DOWN (direction logic can be added later)
  }))

  const handleSaveLayout = useCallback(async (newLayout) => {
    await saveLayout(newLayout)
    setEditorOpen(false)
  }, [saveLayout])

  const gridW = layout ? layout.width * tileSize : 0
  const gridH = layout ? layout.height * tileSize : 0

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

      {/* Office grid area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden flex items-center justify-center"
        style={{ background: '#1e1e2e' }}
      >
        {isLoading && (
          <div className="text-slate-500 text-xs">Loading office...</div>
        )}
        {!isLoading && layout && (
          <div style={{ width: gridW, height: gridH, flexShrink: 0 }}>
            <OfficeTileGrid
              tiles={layout.tiles}
              tileSize={tileSize}
              cols={layout.width}
              rows={layout.height}
              agents={agentsWithAnim}
            />
          </div>
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

- [ ] **Step 3.5: Run existing tests**

```bash
cd agent-teams-guide
npx vitest run
```

Expected: all existing tests pass. The new hooks and component have no tests yet — that is acceptable (they are rendering/animation code that requires browser APIs).

- [ ] **Step 3.6: Commit**

```bash
cd agent-teams-guide
git add src/components/office/hooks/ src/components/office/VirtualOffice.jsx
git commit -m "feat(office): add StrictMode-safe animation hooks and CSS-based VirtualOffice component"
```

---

## Phase 2 — Sequential Task

### Task 4 [Agent D]: Wire Up + Cleanup

**Files:**
- Modify: `agent-teams-guide/src/components/mission/MissionDashboard.jsx`
- Keep: `agent-teams-guide/src/components/office/editor/TileEditor.jsx` (no changes needed)
- Delete: `agent-teams-guide/src/components/office/canvas-engine/Renderer.ts`
- Delete: `agent-teams-guide/src/components/office/canvas-engine/SpriteAnimator.ts`
- Delete: `agent-teams-guide/src/components/office/canvas-engine/TileMap.ts`
- Delete: `agent-teams-guide/src/components/office/VirtualOfficeCanvas.jsx`

**Prerequisites:** Tasks 1, 2, 3 must be merged/committed before starting this task.

- [ ] **Step 4.1: Update MissionDashboard.jsx import**

Open `src/components/mission/MissionDashboard.jsx`.

Find line:
```js
import { VirtualOfficeCanvas } from '../office/VirtualOfficeCanvas'
```

Replace with:
```js
import { VirtualOffice } from '../office/VirtualOffice'
```

Find all occurrences of `<VirtualOfficeCanvas` and replace with `<VirtualOffice`:

```jsx
{/* Right: Virtual Office */}
<div
  className="shrink-0 overflow-hidden"
  style={{ width: officePanelWidth }}
>
  <VirtualOffice
    missionState={state}
    isRunning={isRunning}
    logs={logs}
  />
</div>
```

(The props interface is identical — `missionState`, `isRunning`, `logs`.)

- [ ] **Step 4.2: Verify TileEditor still works**

TileEditor receives `{ layout, isRunning, onSave, onClose }` — this interface is unchanged. Confirm `TileEditor.jsx` has no import from `canvas-engine/` files. Run:

```bash
grep -n "canvas-engine\|Renderer\|SpriteAnimator\|TileMap" agent-teams-guide/src/components/office/editor/TileEditor.jsx
```

Expected: no matches. If any match found, read that line and replace with equivalent CSS logic (the TileEditor has its own Canvas preview — this is acceptable, it does NOT use Renderer.ts or SpriteAnimator.ts).

- [ ] **Step 4.3: Verify VirtualOfficeCanvas.jsx has no other consumers**

```bash
grep -rn "VirtualOfficeCanvas" agent-teams-guide/src/ --include="*.jsx" --include="*.tsx" --include="*.ts"
```

Expected: zero matches (after Step 4.1 updated the import in MissionDashboard).

- [ ] **Step 4.4: Delete old canvas-engine files**

```bash
cd agent-teams-guide
git rm src/components/office/canvas-engine/Renderer.ts
git rm src/components/office/canvas-engine/SpriteAnimator.ts
git rm src/components/office/canvas-engine/TileMap.ts
git rm src/components/office/VirtualOfficeCanvas.jsx
```

- [ ] **Step 4.5: Run full test suite**

```bash
cd agent-teams-guide
npx vitest run
```

Expected: all tests pass. If `OfficeLayoutStore.test.ts` fails, check it mocks `window.electronAPI.invoke` to return a layout with non-empty `tiles` array (required by the new guard from Task 1).

If test fails with `Cannot find module '../canvas-engine/...'` — that import was in a test file. Remove the import.

- [ ] **Step 4.6: Build the Electron app to verify no broken imports**

```bash
cd agent-teams-guide
npm run build -- --config vite.config.electron.mjs
```

Expected: build completes with 0 errors. Warnings about circular deps or unused exports are acceptable.

If build fails with `Cannot find module` for deleted canvas-engine files, check if `SpriteAnimator.ts` or `TileMap.ts` are imported anywhere besides the old canvas components:
```bash
grep -rn "SpriteAnimator\|TileMap\|Renderer" agent-teams-guide/src/ --include="*.ts" --include="*.tsx" --include="*.jsx"
```

Remove any stale imports found.

- [ ] **Step 4.7: Commit**

```bash
cd agent-teams-guide
git add src/components/mission/MissionDashboard.jsx
git commit -m "feat(office): wire VirtualOffice into MissionDashboard, remove old canvas-engine files"
```

---

## Verification

After all tasks complete, run the Electron app and confirm:

```bash
cd agent-teams-guide
npm run electron:dev
```

Navigate to Mission Control. The right panel should show:
1. ✅ Office renders immediately with walls, floor, desks visible (not blank)
2. ✅ "Edit Office" button opens TileEditor modal
3. ✅ When a mission runs, agent sprites appear at desk positions
4. ✅ Agent sprites animate (typing/walking frames cycle)
5. ✅ Speech bubbles appear when agents use tools
6. ✅ Resizing the panel resizes the office grid proportionally
7. ✅ `npx vitest run` — all tests green

---

## Notes for Agents

- **File ownership is strict** — Agent A touches only persistence files, Agent B only rendering/, Agent C only hooks/ and the main component. No agent should touch files owned by another.
- **Do not modify** `TileEditor.jsx` unless Step 4.2 finds a canvas-engine import inside it.
- **Sprite URLs**: the `import char0 from '../assets/sprites/char_0.png'` syntax requires Vite's static asset handling. The path is relative to `AgentSprite.jsx` in `rendering/`. Verify the path resolves: `src/components/office/rendering/../assets/sprites/char_0.png` = `src/components/office/assets/sprites/char_0.png` ✓
- **AgentSprite animFrame**: VirtualOffice sets `agent.animFrame` in the animation tick callback mutating `agentsRef.current`. The `agents` state array is re-set from agentsRef in `useAgentSync` when missionState changes. The tick loop mutates animFrame in-place but does NOT trigger setAgents — this means animFrame updates won't re-render unless missionState changes. **Fix this in Task 3**: add a `setAgents` call in the animation tick when any frame changes. See the `changed` flag in the tick callback — add `if (changed) setAgents(Object.values(current))` at the end of the tick.
