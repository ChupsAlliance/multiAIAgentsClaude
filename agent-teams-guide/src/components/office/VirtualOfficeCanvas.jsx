import { useEffect, useRef, useState, useCallback } from 'react'
import { Renderer } from './canvas-engine/Renderer'
import { DeskAssigner } from './agent-bridge/DeskAssigner'
import { mapLogEntryToState, formatSpeechBubble } from './agent-bridge/AgentStateMapper'
import { loadLayout, saveLayout } from './persistence/OfficeLayoutStore'

export function VirtualOfficeCanvas({ missionState, isRunning, logs }) {
  const canvasRef = useRef(null)
  const rendererRef = useRef(null)
  const assignerRef = useRef(new DeskAssigner([]))
  const agentsRef = useRef({})
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

      {/* TileEditor — Task 9 will implement this; placeholder for now */}
      {editorOpen && layout && (
        <div className="absolute inset-0 bg-slate-950/90 flex items-center justify-center">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 text-slate-400 text-sm">
            <p>Tile Editor — coming in Task 9</p>
            <button
              onClick={() => setEditorOpen(false)}
              className="mt-4 px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
