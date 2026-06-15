import { useCallback, useEffect, useRef, useState } from 'react'

// Tile display size in pixels
const TILE_PX = 16

// Tile colors for canvas rendering
const TILE_COLORS = {
  floor:  '#2d2d4e',
  wall:   '#4b3a2a',
  desk:   '#1e3a5f',
  plant:  '#14532d',
  box:    '#3b2f1a',
  door:   '#1a1a2e',
  empty:  '#111111',
}

const WALL_BORDER  = '#6b5a4a'
const DESK_BORDER  = '#3b82f6'
const GRID_LINE    = 'rgba(255,255,255,0.05)'

// Valid tile types for import validation
const VALID_TYPES = new Set(['floor', 'wall', 'desk', 'plant', 'box', 'door', 'empty'])

// Palette definition
const PALETTE_TOOLS = [
  { type: 'floor',  label: 'Floor',  emoji: '🟫' },
  { type: 'wall',   label: 'Wall',   emoji: '🧱' },
  { type: 'desk',   label: 'Desk',   emoji: '🪑' },
  { type: 'plant',  label: 'Plant',  emoji: '🌿' },
  { type: 'box',    label: 'Box',    emoji: '📦' },
  { type: 'door',   label: 'Door',   emoji: '🚪' },
]

// Render all tiles to the canvas context
function drawCanvas(ctx, tiles, gridW, gridH, canvasW, canvasH) {
  // Background
  ctx.fillStyle = TILE_COLORS.floor
  ctx.fillRect(0, 0, canvasW, canvasH)

  // Build lookup map for O(1) tile access
  const map = {}
  for (const t of tiles) {
    map[`${t.x},${t.y}`] = t.type
  }

  // Draw each cell
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const type = map[`${x},${y}`] || 'floor'
      const px = x * TILE_PX
      const py = y * TILE_PX

      ctx.fillStyle = TILE_COLORS[type] ?? TILE_COLORS.floor
      ctx.fillRect(px, py, TILE_PX, TILE_PX)

      // Special top borders
      if (type === 'wall') {
        ctx.fillStyle = WALL_BORDER
        ctx.fillRect(px, py, TILE_PX, 2)
      } else if (type === 'desk') {
        ctx.fillStyle = DESK_BORDER
        ctx.fillRect(px, py, TILE_PX, 2)
      } else if (type === 'door') {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'
        ctx.lineWidth = 0.5
        ctx.strokeRect(px + 0.5, py + 0.5, TILE_PX - 1, TILE_PX - 1)
      }
    }
  }

  // Grid lines
  ctx.strokeStyle = GRID_LINE
  ctx.lineWidth = 1
  for (let x = 0; x <= gridW; x++) {
    ctx.beginPath()
    ctx.moveTo(x * TILE_PX, 0)
    ctx.lineTo(x * TILE_PX, canvasH)
    ctx.stroke()
  }
  for (let y = 0; y <= gridH; y++) {
    ctx.beginPath()
    ctx.moveTo(0, y * TILE_PX)
    ctx.lineTo(canvasW, y * TILE_PX)
    ctx.stroke()
  }
}

// Convert a mouse event position to grid (x, y) relative to canvas element
function eventToGrid(e, canvas, gridW, gridH, canvasW, canvasH) {
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvasW / rect.width
  const scaleY = canvasH / rect.height
  const cx = (e.clientX - rect.left) * scaleX
  const cy = (e.clientY - rect.top)  * scaleY
  const gx = Math.floor(cx / TILE_PX)
  const gy = Math.floor(cy / TILE_PX)
  if (gx < 0 || gx >= gridW || gy < 0 || gy >= gridH) return null
  return { x: gx, y: gy }
}

export function TileEditor({ layout, isRunning, onSave, onClose }) {
  const canvasRef = useRef(null)

  const [workingLayout, setWorkingLayout] = useState(() => ({
    ...layout,
    tiles: [...layout.tiles],
  }))
  const [selectedTool, setSelectedTool] = useState('floor')
  const [undoStack, setUndoStack] = useState([])
  const [isPainting, setIsPainting] = useState(false)

  // Stroke snapshot ref — holds tiles state at stroke start for undo
  const strokeStartRef = useRef(null)

  // Keep a ref to workingLayout for use inside event handlers
  const workingLayoutRef = useRef(workingLayout)
  useEffect(() => { workingLayoutRef.current = workingLayout }, [workingLayout])

  // Derive grid dimensions from workingLayout so imports with different sizes work correctly
  const GRID_W = Math.min(workingLayout.width || 32, 64)
  const GRID_H = Math.min(workingLayout.height || 24, 48)
  const CANVAS_W = GRID_W * TILE_PX
  const CANVAS_H = GRID_H * TILE_PX

  // Redraw canvas whenever tiles change
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    drawCanvas(ctx, workingLayout.tiles, GRID_W, GRID_H, CANVAS_W, CANVAS_H)
  }, [workingLayout, GRID_W, GRID_H, CANVAS_W, CANVAS_H])

  // Tile placement — no undo push here; snapshots are taken at stroke start
  const placeTile = useCallback((x, y) => {
    if (isRunning) return
    if (selectedTool === 'undo') return

    if (selectedTool === 'eraser') {
      setWorkingLayout(prev => ({
        ...prev,
        tiles: prev.tiles.filter(t => !(t.x === x && t.y === y)),
      }))
      return
    }

    setWorkingLayout(prev => {
      const filtered = prev.tiles.filter(t => !(t.x === x && t.y === y))
      return {
        ...prev,
        tiles: [...filtered, { x, y, type: selectedTool }],
      }
    })
  }, [isRunning, selectedTool])

  // Mouse events on canvas
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return
    if (isRunning) return
    const pos = eventToGrid(e, canvasRef.current, GRID_W, GRID_H, CANVAS_W, CANVAS_H)
    if (!pos) return
    setIsPainting(true)
    // Snapshot tiles ONCE at the start of the stroke
    strokeStartRef.current = [...workingLayoutRef.current.tiles]
    placeTile(pos.x, pos.y)
  }, [isRunning, placeTile, GRID_W, GRID_H, CANVAS_W, CANVAS_H])

  const handleMouseMove = useCallback((e) => {
    if (!isPainting) return
    const pos = eventToGrid(e, canvasRef.current, GRID_W, GRID_H, CANVAS_W, CANVAS_H)
    if (!pos) return
    placeTile(pos.x, pos.y)
  }, [isPainting, placeTile, GRID_W, GRID_H, CANVAS_W, CANVAS_H])

  const handleMouseUp = useCallback(() => {
    if (strokeStartRef.current !== null) {
      // Push the snapshot taken at stroke start
      setUndoStack(prev => [...prev.slice(-49), strokeStartRef.current])
      strokeStartRef.current = null
    }
    setIsPainting(false)
  }, [])

  // Stop painting if mouse leaves canvas — also commit the stroke
  const handleMouseLeave = useCallback(() => {
    if (isPainting && strokeStartRef.current !== null) {
      setUndoStack(prev => [...prev.slice(-49), strokeStartRef.current])
      strokeStartRef.current = null
    }
    setIsPainting(false)
  }, [isPainting])

  // Palette undo button click
  const handleUndoClick = useCallback(() => {
    if (undoStack.length === 0) return
    const prev = undoStack[undoStack.length - 1]
    setUndoStack(s => s.slice(0, -1))
    setWorkingLayout(l => ({ ...l, tiles: prev }))
  }, [undoStack])

  // Keyboard undo (Ctrl+Z / Cmd+Z)
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        // Only handle if focus is NOT in a text input
        const tag = document.activeElement?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return
        if (isRunning) return  // read-only mode
        e.preventDefault()
        handleUndoClick()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isRunning, undoStack, handleUndoClick])

  // Save
  const handleSave = useCallback(() => {
    if (isRunning) return
    onSave(workingLayout)
  }, [isRunning, onSave, workingLayout])

  // Export
  const handleExport = useCallback(() => {
    const json = JSON.stringify(workingLayout, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'office-layout.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [workingLayout])

  // Import with validation
  const handleImport = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = (e) => {
      const file = e.target.files[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target.result)
          if (
            typeof parsed !== 'object' || parsed === null ||
            !Array.isArray(parsed.tiles) ||
            parsed.version !== 1
          ) {
            console.warn('[TileEditor] Import rejected: invalid layout structure')
            return
          }
          const maxW = Math.min(parsed.width || 32, 64)
          const maxH = Math.min(parsed.height || 24, 48)
          // Filter out-of-range or invalid tiles
          const validTiles = parsed.tiles.filter(t =>
            Number.isInteger(t.x) && Number.isInteger(t.y) &&
            t.x >= 0 && t.x < maxW &&
            t.y >= 0 && t.y < maxH &&
            VALID_TYPES.has(t.type)
          )
          setWorkingLayout({ ...parsed, tiles: validTiles })
        } catch {
          console.warn('[TileEditor] Import failed: invalid JSON')
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }, [])

  return (
    <div className="absolute inset-0 bg-slate-950/95 flex items-center justify-center z-50">
      <div className="flex flex-col bg-slate-900 border border-slate-700 rounded-lg overflow-hidden shadow-2xl max-h-full">

        {/* Read-only banner */}
        {isRunning && (
          <div className="bg-amber-900/60 border-b border-amber-700 px-4 py-2 text-amber-300 text-xs text-center">
            Mission in progress — layout is read-only
          </div>
        )}

        {/* Main body: canvas + palette */}
        <div className="flex flex-1 overflow-hidden">

          {/* Canvas area */}
          <div className="flex items-center justify-center p-3 bg-slate-950">
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              style={{ cursor: isRunning ? 'default' : 'crosshair', imageRendering: 'pixelated' }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
              className="block border border-slate-700"
            />
          </div>

          {/* Palette sidebar */}
          <div className="flex flex-col w-36 border-l border-slate-700 bg-slate-900 py-3 px-2 gap-1">
            <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1 px-1">Tiles</p>

            {PALETTE_TOOLS.map(tool => (
              <button
                key={tool.type}
                onClick={() => setSelectedTool(tool.type)}
                className={[
                  'flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors',
                  selectedTool === tool.type
                    ? 'bg-indigo-600/30 border border-indigo-500 text-slate-100'
                    : 'hover:bg-slate-800 border border-transparent text-slate-300',
                ].join(' ')}
              >
                <span>{tool.emoji}</span>
                <span>{tool.label}</span>
                {tool.type === 'desk' && (
                  <span className="ml-auto text-indigo-400 text-xs">*</span>
                )}
              </button>
            ))}

            <div className="border-t border-slate-700 my-1" />

            {/* Eraser */}
            <button
              onClick={() => setSelectedTool('eraser')}
              className={[
                'flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors',
                selectedTool === 'eraser'
                  ? 'bg-indigo-600/30 border border-indigo-500 text-slate-100'
                  : 'hover:bg-slate-800 border border-transparent text-slate-300',
              ].join(' ')}
            >
              <span>🗑</span>
              <span>Eraser</span>
            </button>

            {/* Undo button */}
            <button
              onClick={handleUndoClick}
              disabled={undoStack.length === 0 || isRunning}
              title="Undo (Ctrl+Z)"
              className="flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors hover:bg-slate-800 border border-transparent text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span>↩</span>
              <span>Undo</span>
            </button>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700 bg-slate-900/80 gap-2">
          <div className="flex gap-2">
            <button
              onClick={handleExport}
              className="px-3 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
            >
              Export
            </button>
            <button
              onClick={handleImport}
              disabled={isRunning}
              className="px-3 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Import
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isRunning}
              className="px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save Layout
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
