# Virtual Office — Design Spec
**Date:** 2026-05-04  
**Status:** Approved

## Overview

Add a "Virtual Office" panel to the Mission Dashboard that visualizes active AI agents as animated pixel art characters in a tile-based office environment. Ported from the open-source [pixel-agents](https://github.com/pablodelucca/pixel-agents) VS Code extension, adapted for Electron + React.

## Goals

- Make agent activity tangible and fun to watch during mission execution
- Complement (not replace) the existing Activity Log / Agents / Files tabs
- Provide a persistent, customizable office layout that users design once and reuse across all missions

## Non-Goals

- Replacing the existing dashboard panels
- Per-mission office layouts
- Sound effects (not in scope for this iteration)
- Mobile/responsive support (desktop Electron app only)

---

## Architecture

### Placement: Split View

`MissionDashboard` becomes a resizable split layout:

```
MissionDashboard
└── div.flex
    ├── div.left-panel   (existing: Activity Log / Agents / Files tabs)
    │   min-width: 400px, default: 60% width
    ├── ResizeDivider    (draggable, saves ratio to localStorage)
    └── VirtualOfficeCanvas
        min-width: 300px, default: 40% width
```

Panel ratio persists in `localStorage` key `office-panel-ratio`.

### Module Structure

```
agent-teams-guide/src/components/office/
├── VirtualOfficeCanvas.jsx       ← top-level React component, owns canvas ref
├── canvas-engine/                ← ported from pixel-agents/webview-ui/src/office/engine
│   ├── Renderer.ts               (requestAnimationFrame draw loop)
│   ├── TileMap.ts                (floor, wall, furniture tile rendering)
│   └── SpriteAnimator.ts        (character sprite sheet + animation states)
├── editor/                       ← ported from pixel-agents/webview-ui/src/office/editor
│   └── TileEditor.jsx            (tile palette, click/drag to place, undo)
├── agent-bridge/                 ← built new — connects mission data to canvas
│   ├── AgentStateMapper.ts       (mission IPC events → sprite animation state)
│   └── DeskAssigner.ts          (tracks desk slots, assigns/releases agents)
└── persistence/
    └── OfficeLayoutStore.ts      (load/save layout JSON via Electron IPC)
```

### Data Flow

```
mission.cjs (IPC stream)
  → useMission hook (existing)
    → AgentStateMapper
      → SpriteAnimator
        → Canvas 2D draw loop
```

Layout is loaded once on app start from `userData/office-layout.json` and written on Save in the editor.

---

## Agent State Mapping

Each agent's current tool call maps to a canvas animation state:

| Mission Event | Agent State | Animation |
|---|---|---|
| Agent spawned | `spawning` | Character walks in from canvas edge, sits at desk |
| Tool: `Write`, `Edit`, `MultiEdit` | `coding` | Typing animation |
| Tool: `Read`, `Glob`, `Grep` | `reading` | Looking at screen, scroll animation |
| Tool: `Bash`, `WebFetch`, `WebSearch` | `working` | Facing forward, thinking |
| Agent waiting for input | `waiting` | Speech bubble "?" + looking around |
| Tool: `Agent` (sub-agent spawn) | `managing` | Raise hand, new character walks in |
| Agent done / task complete | `celebrating` | Brief celebration, then fade out |
| Between tool calls | `idle` | Subtle look-around loop |

**Speech bubbles:** Display abbreviated tool + filename (e.g. `write: auth.ts`, `bash: npm test`). Auto-dismiss after 3 seconds.

**Character assignment:** On agent spawn, randomly assign one of 6 character sprites from pixel-agents assets. Character is fixed for the duration of the mission.

---

## Office Tile Editor

Accessible via **"Edit Office"** button in the Virtual Office panel header. Button is always visible; canvas is read-only while a mission is running (editor opens but shows a "Mission in progress" overlay).

### Grid
- Fixed **32×24 tiles** (optimized for the split panel at typical desktop resolutions)
- Tile size: 16×16px rendered at 2× (32×32 display pixels)

### UI Layout

```
┌─────────────────────────────┬──────────────┐
│   Office Canvas (live preview)  │  Palette     │
│                             │  ──────────  │
│   [click / drag to place]   │  🟫 Floor    │
│                             │  🧱 Wall     │
│                             │  🪑 Desk *   │
│                             │  🌿 Plant    │
│                             │  📦 Box      │
│                             │  🚪 Door     │
│                             │  ──────────  │
│                             │  🗑 Eraser   │
│                             │  ↩ Undo      │
└─────────────────────────────┴──────────────┘
             [ Export ]  [ Import ]  [ Save Layout ]  [ Cancel ]
```

`* Desk tiles` are special — they are the "workstation slots" that `DeskAssigner` uses for agent placement.

### Interactions
- **Click** to place selected tile
- **Click + drag** to paint tiles quickly
- **Eraser** removes tile, restores default floor
- **Undo** (Ctrl+Z) steps back one tile operation (stack of last 50 operations)
- **Save Layout** writes to `userData/office-layout.json` via `window.electronAPI.saveOfficeLayout(json)`
- **Import/Export** reads/writes `.json` files via native file dialog for sharing layouts

---

## Desk Assignment

`DeskAssigner` maintains a list of all `Desk` tiles in the current layout.

On agent spawn:
1. Find first unoccupied desk slot
2. Assign agent to that slot, mark as occupied
3. Trigger `spawning` animation — character walks from nearest canvas edge to desk

On agent done:
1. Trigger `celebrating` animation
2. After animation completes, mark desk as unoccupied
3. Character fades out

If no desk is available when an agent spawns: character stands at a designated "overflow" corner with a small indicator badge showing they have no desk.

---

## Persistence

| Data | Storage | Key / Path |
|---|---|---|
| Office layout | `userData/office-layout.json` | Electron `app.getPath('userData')` |
| Panel split ratio | `localStorage` | `office-panel-ratio` |
| Character assignment | In-memory only | Resets each mission |

**IPC handlers to add in `system.cjs`:**
- `load-office-layout` → reads and returns JSON file (returns empty default if not found)
- `save-office-layout` → writes JSON to file

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Canvas fails to initialize | Fallback: hide canvas panel, show text "Office unavailable". Dashboard unaffected. |
| Layout file corrupt or missing | Reset to default empty layout (floor tiles only), show one-time toast notification |
| No desk available for spawning agent | Agent stands in overflow corner with "no desk" badge |
| Mission stops unexpectedly | All agents trigger fade-out animation immediately |

---

## Porting from pixel-agents

**License:** Verify MIT license in pixel-agents repo before porting. If confirmed, include attribution in `CREDITS.md`.

**Files to port from `webview-ui/src/office/`:**
- `engine/` — Canvas 2D renderer, draw loop, tile rendering
- `editor/` — Tile editor logic
- `sprites/` — Character sprite definitions and assets
- `floorTiles.ts`, `wallTiles.ts` — Tile type definitions

**Files to replace/remove:**
- `vscodeApi.ts` → replace all VS Code API calls with `window.electronAPI` IPC
- `transcriptParser.ts` → replace with `AgentStateMapper` reading from `useMission` hook
- `fileWatcher.ts` → not needed (mission.cjs already handles this)

**Adaptation notes:**
- Replace `vscode.postMessage` with `window.electronAPI` calls
- Replace `acquireVsCodeApi()` with Electron preload bridge
- Grid size: change from 64×64 to 32×24
- Asset paths: copy sprite sheets to `src/components/office/assets/`

---

## Success Criteria

- Virtual Office panel renders alongside existing dashboard without layout regression
- Agents appear and animate correctly in response to mission events
- Tile editor saves and loads layouts correctly across app restarts
- Canvas failure does not affect existing dashboard functionality
- Split panel is resizable and ratio persists across sessions
