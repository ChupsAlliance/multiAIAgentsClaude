// src/components/mission/PlanDependencyGraph.jsx
import { useMemo, useRef, useEffect, useState } from 'react'
import dagre from '@dagrejs/dagre'
import { CheckCircle } from 'lucide-react'

const NODE_WIDTH = 180
const NODE_HEIGHT_BASE = 60  // min height
const NODE_HEIGHT_LIVE = 76  // taller khi có agent name

function estimateHeight(task, mode) {
  return mode === 'live' ? NODE_HEIGHT_LIVE : NODE_HEIGHT_BASE
}

function computeLayout(tasks, mode) {
  if (!tasks?.length) return { nodes: [], edges: [], width: 0, height: 0 }

  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 60, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))

  // Set nodes
  tasks.forEach(task => {
    g.setNode(task.id, { width: NODE_WIDTH, height: estimateHeight(task, mode) })
  })

  // Build title→id map để resolve depends_on (strings)
  const titleToId = {}
  tasks.forEach(task => { titleToId[task.title] = task.id })

  // Set edges
  tasks.forEach(task => {
    (task.depends_on || []).forEach(depTitle => {
      const depId = titleToId[depTitle]
      if (depId && depId !== task.id) {
        g.setEdge(depId, task.id)
      }
    })
  })

  dagre.layout(g)

  const nodes = tasks.map(task => {
    const n = g.node(task.id)
    return { task, x: n.x - NODE_WIDTH / 2, y: n.y - estimateHeight(task, mode) / 2, width: NODE_WIDTH, height: estimateHeight(task, mode) }
  })

  const edges = g.edges().map(e => {
    const points = g.edge(e).points
    return { from: e.v, to: e.w, points }
  })

  const graphSize = g.graph()
  return {
    nodes,
    edges,
    width: graphSize.width + 40,
    height: graphSize.height + 40,
  }
}

function nodeClasses(task, mode) {
  if (mode === 'plan') {
    switch (task.priority) {
      case 'high': return 'border-red-500/60 bg-red-500/5'
      case 'medium': return 'border-yellow-500/60 bg-yellow-500/5'
      case 'low': return 'border-green-500/40 bg-green-500/5'
      default: return 'border-vs-border bg-vs-surface'
    }
  }
  // mode === 'live'
  switch (task.status) {
    case 'in_progress': return 'border-vs-accent/60 bg-vs-accent/5 animate-pulse-subtle'
    case 'completed': return 'border-green-500/60 bg-green-500/10'
    default: return 'border-vs-border bg-vs-surface'
  }
}

function makeBezierPath(points) {
  if (!points || points.length < 2) return ''
  const [start, ...rest] = points
  const end = rest[rest.length - 1]
  const mid = rest.length > 1 ? rest[Math.floor(rest.length / 2)] : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  return `M ${start.x} ${start.y} C ${mid.x} ${start.y}, ${mid.x} ${end.y}, ${end.x} ${end.y}`
}

export function PlanDependencyGraph({ tasks = [], mode = 'plan', onNodeClick }) {
  const containerRef = useRef(null)
  const [containerWidth, setContainerWidth] = useState(800)

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width)
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  const { nodes, edges, width, height } = useMemo(
    () => computeLayout(tasks, mode),
    [tasks, mode]
  )

  const hasNoDeps = tasks.length > 0 && tasks.every(t => !t.depends_on?.length)

  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-vs-muted text-sm font-mono">Chưa có tasks</p>
      </div>
    )
  }

  const svgWidth = Math.max(width, containerWidth)

  return (
    <div ref={containerRef} className="w-full h-full overflow-auto relative">
      {hasNoDeps && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10">
          <span className="text-[10px] font-mono text-vs-muted bg-vs-surface border border-vs-border rounded px-2 py-1">
            Không có dependencies giữa các tasks
          </span>
        </div>
      )}

      <svg
        width={svgWidth}
        height={height}
        viewBox={`0 0 ${svgWidth} ${height}`}
        className="overflow-visible"
      >
        {/* Arrowhead marker */}
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#4b5563" />
          </marker>
        </defs>

        {/* Edges */}
        {edges.map((edge, i) => (
          <path
            key={i}
            d={makeBezierPath(edge.points)}
            stroke="#4b5563"
            strokeWidth="1.5"
            fill="none"
            markerEnd="url(#arrowhead)"
          />
        ))}

        {/* Nodes via foreignObject */}
        {nodes.map(({ task, x, y, width: nw, height: nh }) => (
          <foreignObject key={task.id} x={x} y={y} width={nw} height={nh}>
            <div
              xmlns="http://www.w3.org/1999/xhtml"
              onClick={() => onNodeClick?.(task)}
              className={`
                w-full h-full border rounded-md px-2 py-1.5
                transition-colors hover:border-vs-accent/60
                ${nodeClasses(task, mode)}
                ${onNodeClick ? 'cursor-pointer' : 'cursor-default'}
              `}
            >
              <div className="flex items-start gap-1">
                {mode === 'live' && task.status === 'completed' && (
                  <CheckCircle size={10} className="text-green-400 shrink-0 mt-0.5" />
                )}
                <span className="text-[11px] font-mono text-vs-text leading-tight line-clamp-2">
                  {task.title}
                </span>
              </div>

              {mode === 'live' && task.assigned_agent && (
                <div className="text-[10px] font-mono text-vs-muted mt-0.5 truncate">
                  {task.assigned_agent}
                </div>
              )}

              <div className="mt-1">
                {mode === 'plan' ? (
                  task.priority && (
                    <span className={`text-[9px] font-mono font-semibold uppercase ${
                      task.priority === 'high' ? 'text-red-400' :
                      task.priority === 'medium' ? 'text-yellow-400' : 'text-green-400'
                    }`}>
                      {task.priority}
                    </span>
                  )
                ) : (
                  <span className={`text-[9px] font-mono ${
                    task.status === 'completed' ? 'text-green-400' :
                    task.status === 'in_progress' ? 'text-vs-accent' : 'text-vs-muted'
                  }`}>
                    {task.status === 'in_progress' ? 'Đang thực hiện...' :
                     task.status === 'completed' ? 'Hoàn thành' : 'Chờ'}
                  </span>
                )}
              </div>
            </div>
          </foreignObject>
        ))}
      </svg>
    </div>
  )
}
