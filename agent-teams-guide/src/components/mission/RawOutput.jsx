import { useState, useRef, useEffect, useMemo, memo } from 'react'
import { ChevronDown, ChevronRight, Terminal } from 'lucide-react'

export const RawOutput = memo(function RawOutput({ lines = [] }) {
  const [expanded, setExpanded] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    if (expanded && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [lines.length, expanded])

  const visibleText = useMemo(
    () => lines.slice(-500).join('\n') || 'Chờ output...',
    [lines]
  )

  return (
    <div className="border-t border-vs-border shrink-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2 text-xs font-mono text-vs-muted hover:text-vs-text hover:bg-white/5"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Terminal size={12} />
        <span>Raw Output ({lines.length} lines)</span>
      </button>

      {expanded && (
        <div
          ref={containerRef}
          className="max-h-[300px] overflow-auto bg-black/40 border-t border-vs-border scrollbar-thin"
        >
          <pre className="p-3 text-[11px] font-mono text-vs-text leading-relaxed whitespace-pre-wrap break-all overflow-hidden">
            {visibleText}
          </pre>
        </div>
      )}
    </div>
  )
})
