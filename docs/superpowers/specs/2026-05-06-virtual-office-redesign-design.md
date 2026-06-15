# Virtual Office Redesign — Design Spec

**Date:** 2026-05-06  
**Status:** Approved

---

## Problem

The Virtual Office renders a blank canvas in Electron mode due to 4 compounding bugs:

1. **DEFAULT_LAYOUT has empty tiles** — committed code has `tiles: []` in both `OfficeLayoutStore.ts` and `electron/ipc/system.cjs`. When no saved layout file exists, the canvas renders blank.
2. **Canvas renders to 0×0 on first frame** — canvas `width`/`height` default to 300×150 before ResizeObserver fires; if layout loads first, tiles render at negative offsets (all outside viewport).
3. **React StrictMode double-mount cancels RAF** — `main.jsx` wraps `<StrictMode>`, which causes effect cleanup to cancel `requestAnimationFrame` before it can restart.
4. **Sprites fail to load in Electron** — `fetch(file://)` is blocked; sprites silently fall back to colored circles but the root RAF issues still cause blank output.

## Solution

Replace the Canvas 2D rendering approach with CSS DOM rendering. Tiles become `<div>` elements positioned absolutely; agents use CSS `background-image` with sprite sheet coordinates. This eliminates all canvas lifecycle issues while preserving the pixel-art aesthetic.

---

## Architecture

```
src/components/office/
├── VirtualOffice.jsx           NEW — replaces VirtualOfficeCanvas.jsx
├── types.ts                    KEEP unchanged
│
├── rendering/
│   ├── OfficeTileGrid.jsx      NEW — CSS tile grid + agent layer
│   ├── AgentSprite.jsx         NEW — CSS sprite sheet animation
│   └── SpeechBubble.jsx        NEW — CSS speech bubble overlay
│
├── hooks/
│   ├── useAnimationTick.js     NEW — StrictMode-safe RAF hook
│   ├── useOfficeLayout.js      NEW — IPC layout load/save
│   └── useAgentSync.js         NEW — mission state → office agents
│
├── agent-bridge/
│   ├── AgentStateMapper.ts     KEEP — add getFrameCoords() helper
│   └── DeskAssigner.ts         KEEP unchanged
│
├── persistence/
│   └── OfficeLayoutStore.ts    FIX — commit buildDefaultTiles(), add empty-tiles guard
│
├── editor/
│   └── TileEditor.jsx          KEEP — minor interface update only
│
└── canvas-engine/              DELETE all 3 files after migration
    ├── Renderer.ts             DELETE
    ├── SpriteAnimator.ts       DELETE
    └── TileMap.ts              DELETE
```

---

## Sprite Sheet Layout

Each `char_N.png` is 64×224px (4 columns × 7 rows, each frame 16×32px):

| Row | Animation | Frames |
|-----|-----------|--------|
| 0 | Walk down | 3 |
| 1 | Walk up | 3 |
| 2 | Walk right | 3 |
| 3 | Typing down | 2 |
| 4 | Typing right | 2 |
| 5 | Reading down | 2 |
| 6 | Reading right | 2 |

LEFT direction = RIGHT flipped via CSS `transform: scaleX(-1)`.

CSS background-position formula at zoom `tileSize`:
```
background-size: `${4 * tileSize}px ${14 * tileSize}px`
background-position: `-${col * tileSize}px -${row * 2 * tileSize}px`
```

---

## Key Design Decisions

### Tile rendering
- Container `background-color = floor color` (no div needed for floor)
- Only render ~130 non-floor tiles as `<div>` elements
- Each tile: `position: absolute; left: x*ts; top: y*ts; width: ts; height: ts`

### Sprite loading
- Import PNGs via Vite: `import char0Url from '../assets/sprites/char_0.png'`
- Vite bundles these as proper `file://` or `http://` URLs in all modes
- No `fetch()` needed, no OffscreenCanvas pixel parsing

### Animation
- `useAnimationTick(callback)` — empty deps RAF, saves callback in ref
- Each agent has `{ frame: 0, frameTimer: 0, dir: 0 }` in a ref map
- Tick updates frame counters → React state triggers re-render of AgentSprite

### IPC fix
- `OfficeLayoutStore.ts`: add guard `if (!layout.tiles?.length) return DEFAULT_LAYOUT`
- `system.cjs`: same guard on load
- Both committed with `buildDefaultTiles()`

### tileSize computation
- `VirtualOffice.jsx` uses `ResizeObserver` on container div
- Computes `tileSize = Math.max(4, Math.min(floor(w/cols), floor(h/rows)))`
- No canvas sizing involved — just CSS layout

---

## Parallel Agent Boundaries

| Agent | Phase | Files (no overlap) |
|-------|-------|---------------------|
| A | 1 | `OfficeLayoutStore.ts`, `system.cjs` |
| B | 1 | `rendering/OfficeTileGrid.jsx`, `rendering/AgentSprite.jsx`, `rendering/SpeechBubble.jsx` |
| C | 1 | `VirtualOffice.jsx`, `hooks/useAnimationTick.js`, `hooks/useOfficeLayout.js`, `hooks/useAgentSync.js`, update `AgentStateMapper.ts` |
| D | 2 | `editor/TileEditor.jsx`, delete `canvas-engine/`, update `MissionDashboard.jsx` import |

Phase 1 agents (A, B, C) have zero file overlap and can run fully in parallel.
Phase 2 (D) depends on Phase 1 being complete.
