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
  const { agents, clearExpiredBubbles } = useAgentSync(missionState, isRunning, logs, layout)

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
    clearExpiredBubbles() // active cleanup each frame
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
