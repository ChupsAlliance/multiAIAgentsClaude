import { Bot, ArrowRight, LogIn, Flag } from 'lucide-react'

/**
 * Read-only business flow: Input → steps → Output.
 * Each step box may carry a clickable agent tag that calls onJumpToAgent.
 *
 * @param {{ nodes: Array, edges: Array, onJumpToAgent?: (name:string)=>void }} props
 */
export function BusinessFlowDiagram({ nodes = [], edges = [], onJumpToAgent }) {
  if (!nodes.length) return null

  const kindIcon = (kind) => {
    if (kind === 'input') return <LogIn size={11} className="shrink-0" />
    if (kind === 'output') return <Flag size={11} className="shrink-0" />
    return null
  }

  const kindLabel = (kind) => {
    if (kind === 'input') return 'Đầu vào'
    if (kind === 'output') return 'Đầu ra'
    return null
  }

  return (
    <div className="flex flex-wrap items-stretch gap-1.5">
      {nodes.map((node, i) => (
        <div key={i} className="flex items-stretch gap-1.5">
          {/* Node box */}
          <div
            className="flex flex-col justify-between rounded-md border bg-[#252526] px-2.5 py-1.5 min-w-[120px] max-w-[190px]"
            style={{ borderColor: node.color }}
          >
            <div className="flex items-center gap-1 mb-0.5">
              <span style={{ color: node.color }}>{kindIcon(node.kind)}</span>
              {kindLabel(node.kind) && (
                <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: node.color }}>
                  {kindLabel(node.kind)}
                </span>
              )}
            </div>
            <p className="text-[10px] leading-snug text-vs-text/90 break-words">{node.label}</p>
            {node.agentName && (
              <button
                type="button"
                onClick={() => onJumpToAgent?.(node.agentName)}
                className="mt-1 flex items-center gap-1 self-start rounded px-1 py-0.5
                           text-[8px] font-mono text-vs-muted hover:text-white hover:bg-white/10 transition-colors"
                title={`Xem agent: ${node.agentName}`}
                style={{ borderLeft: `2px solid ${node.color}` }}
              >
                <Bot size={8} className="shrink-0" />
                {node.agentName}
              </button>
            )}
          </div>

          {/* Arrow to next node (skip after the last node) */}
          {edges.some(e => e.from === i) && (
            <div className="flex items-center text-vs-muted">
              <ArrowRight size={12} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
