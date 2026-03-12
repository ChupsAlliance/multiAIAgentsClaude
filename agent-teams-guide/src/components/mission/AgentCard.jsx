import { useState, useMemo, memo } from 'react'
import { StatusBadge } from './StatusBadge'
import { Zap, Brain, Coins, ChevronDown, ChevronRight, Eye } from 'lucide-react'

const MODEL_META = {
  sonnet: { icon: Zap,   label: 'Sonnet', cls: 'text-blue-400 bg-blue-400/10' },
  opus:   { icon: Brain,  label: 'Opus',   cls: 'text-purple-400 bg-purple-400/10' },
  haiku:  { icon: Coins,  label: 'Haiku',  cls: 'text-green-400 bg-green-400/10' },
}

const LogLine = memo(function LogLine({ log }) {
  const [showFull, setShowFull] = useState(false)
  const isLong = log.message?.length > 120
  const colorCls = log.log_type === 'tool' ? 'text-vs-function' :
    log.log_type === 'result' ? 'text-vs-green' :
    log.log_type === 'error' ? 'text-vs-red' :
    'text-vs-text'
  return (
    <div className="flex gap-2 text-[10px] font-mono py-0.5">
      <span className="text-vs-muted shrink-0 w-[45px]">
        {new Date(log.timestamp).toLocaleTimeString('vi-VN', { hour12: false })}
      </span>
      <span
        className={`${colorCls} break-all overflow-hidden ${isLong ? 'cursor-pointer hover:opacity-80' : ''}`}
        onClick={isLong ? () => setShowFull(!showFull) : undefined}
      >
        {isLong && !showFull ? `${log.message.slice(0, 120)}…` : log.message}
        {isLong && <span className="text-vs-muted ml-1 text-[8px]">{showFull ? '(thu gọn)' : '(xem thêm)'}</span>}
      </span>
    </div>
  )
})

export const AgentCard = memo(function AgentCard({ agent, logs = [], isSelected, onSelect }) {
  const [expanded, setExpanded] = useState(false)
  const { name, role, status, current_task, model } = agent
  const modelInfo = model ? MODEL_META[model] : null

  // Memoize agent log filter — only recalc when logs ref or agent name changes
  const agentLogs = useMemo(
    () => logs.filter(l => l.agent === name).slice(-30),
    [logs, name]
  )

  return (
    <div className={`rounded-lg border transition-colors overflow-hidden ${
      isSelected
        ? 'border-vs-accent ring-1 ring-vs-accent/40 bg-vs-accent/10'
        : status === 'Working'
          ? 'border-vs-green/40 bg-vs-green/5'
          : status === 'Error'
            ? 'border-vs-red/40 bg-vs-red/5'
            : status === 'Done'
              ? 'border-vs-comment/30 bg-vs-comment/5'
              : 'border-vs-border bg-vs-panel'
    }`}>
      <div className="w-full p-2.5 text-left overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between mb-1 gap-1">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <div className={`w-6 h-6 shrink-0 rounded-md flex items-center justify-center font-mono text-[10px] font-bold ${
              isSelected ? 'bg-vs-accent/30 text-vs-accent' :
              status === 'Working' ? 'bg-vs-green/20 text-vs-green'
                : status === 'Done' ? 'bg-vs-comment/20 text-vs-comment'
                  : status === 'Error' ? 'bg-vs-red/20 text-vs-red'
                    : 'bg-vs-accent/20 text-vs-accent'
            }`}>
              {name.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-white truncate">{name}</p>
              <p className="text-[9px] text-vs-muted font-mono truncate">{role}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <StatusBadge status={status} size="xs" />
            {/* View button — click to open this agent's logs in the Activity tab */}
            <button
              onClick={onSelect}
              title={isSelected ? 'Đang xem logs' : `Xem logs của ${name}`}
              className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono transition-colors ${
                isSelected
                  ? 'bg-vs-accent/30 text-vs-accent'
                  : 'bg-white/5 text-vs-muted hover:bg-vs-accent/20 hover:text-vs-accent'
              }`}
            >
              <Eye size={9} />
              <span>Log</span>
            </button>
            {agentLogs.length > 0 && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="p-0.5 hover:bg-white/10 rounded"
                title={expanded ? 'Thu gọn' : 'Xem nhanh'}
              >
                {expanded
                  ? <ChevronDown size={10} className="text-vs-muted" />
                  : <ChevronRight size={10} className="text-vs-muted" />
                }
              </button>
            )}
          </div>
        </div>

        {/* Model badge */}
        {modelInfo && (
          <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-mono mb-1 ${modelInfo.cls}`}>
            <modelInfo.icon size={7} />
            {modelInfo.label}
          </div>
        )}

        {/* Current task */}
        {current_task && (
          <div className="mt-1 px-2 py-1 bg-black/20 rounded text-[10px] text-vs-text font-mono leading-relaxed truncate overflow-hidden">
            {current_task}
          </div>
        )}
      </div>

      {/* Expanded: Agent activity detail */}
      {expanded && agentLogs.length > 0 && (
        <div className="border-t border-vs-border px-3 py-2 max-h-48 overflow-y-auto scrollbar-thin">
          <p className="text-[9px] uppercase tracking-widest text-vs-muted font-mono mb-1">
            Activity ({agentLogs.length})
          </p>
          <div className="space-y-0.5">
            {agentLogs.map((log) => (
              <LogLine key={`${log.timestamp}-${log.log_type}`} log={log} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
})