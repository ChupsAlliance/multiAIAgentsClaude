import { useState } from 'react'
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react'
import { buildFlowModel } from '../../utils/businessFlow'
import { BusinessFlowDiagram } from './BusinessFlowDiagram'

/**
 * Read-only "Nghiệp vụ" panel shown above the editable plan markdown.
 * Written for non-technical leads: what the plan does, what you get, how it works,
 * plus an Input→steps→Output flow diagram.
 *
 * @param {{ business: Object, agents: Array, onJumpToAgent?: (name:string)=>void }} props
 */
export function BusinessSummary({ business, agents = [], onJumpToAgent }) {
  const [collapsed, setCollapsed] = useState(false)
  const model = buildFlowModel(business, agents)

  if (!model.visible) return null

  const { summary, hasFlow, nodes, edges } = model

  const Row = ({ label, value }) =>
    value ? (
      <div className="flex gap-2 text-[11px]">
        <span className="shrink-0 font-semibold text-vs-accent">{label}:</span>
        <span className="text-vs-text/85 leading-snug">{value}</span>
      </div>
    ) : null

  return (
    <div className="shrink-0 border-b border-vs-border bg-[#1b2733]">
      {/* Header */}
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left hover:bg-vs-overlay/5 transition-colors"
      >
        {collapsed ? <ChevronRight size={12} className="text-vs-accent" /> : <ChevronDown size={12} className="text-vs-accent" />}
        <BookOpen size={12} className="text-vs-accent" />
        <span className="text-[11px] font-bold text-vs-heading">Nghiệp vụ</span>
        <span className="ml-2 text-[9px] text-vs-muted font-mono">(cho người review — không kỹ thuật)</span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 pt-0.5 space-y-2">
          <div className="space-y-1">
            <Row label="Làm gì" value={summary.whatItDoes} />
            <Row label="Nhận được" value={summary.whatYouGet} />
            <Row label="Cách hoạt động" value={summary.howItWorks} />
          </div>

          {hasFlow && (
            <div className="pt-1">
              <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-vs-muted">Luồng hoạt động</div>
              <BusinessFlowDiagram nodes={nodes} edges={edges} onJumpToAgent={onJumpToAgent} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
