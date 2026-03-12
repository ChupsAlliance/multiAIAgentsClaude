import { Clock, Square, CheckCircle2, PlusCircle, FlaskConical } from 'lucide-react'
import { StatusBadge } from './StatusBadge'

export function MissionHeader({ state, onStop, onNewMission, elapsed }) {
  if (!state) return null

  const isActive = ['Running', 'Launching', 'running', 'launching'].includes(state.status)
  const isDone = ['Completed', 'completed', 'completed_m'].includes(state.status)
  const isFailed = ['Failed', 'failed'].includes(state.status)
  const isStopped = ['Stopped', 'stopped'].includes(state.status)
  const isAgentTeams = state.execution_mode === 'agent_teams'

  return (
    <div className={`flex items-center justify-between px-4 py-3 border-b transition-colors gap-3 ${
      isActive ? 'border-vs-green/30 bg-vs-green/5' :
      isDone ? 'border-vs-comment/30 bg-vs-comment/5' :
      isFailed ? 'border-vs-red/30 bg-vs-red/5' :
      'border-vs-border bg-vs-panel'
    }`}>
      <div className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden">
        {isDone ? <CheckCircle2 size={16} className="text-vs-green shrink-0" /> :
         isActive ? <div className="w-2 h-2 rounded-full bg-vs-green animate-pulse shrink-0" /> : null}
        <h2 className="text-sm font-semibold text-white truncate">
          {state.description || 'Mission'}
        </h2>
        <StatusBadge status={state.status} size="xs" />
        {isAgentTeams && (
          <span className="flex items-center gap-1 shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 border border-yellow-500/20">
            <FlaskConical size={9} />
            Agent Teams
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {/* Timer */}
        <div className="flex items-center gap-1.5 text-vs-muted">
          <Clock size={12} />
          <span className="text-xs font-mono">{elapsed}</span>
        </div>

        {/* Stop button */}
        {isActive && (
          <button
            onClick={onStop}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-vs-red/15 text-vs-red rounded-md
                       text-xs font-mono hover:bg-vs-red/25 transition-colors"
          >
            <Square size={10} fill="currentColor" />
            Stop
          </button>
        )}

        {/* New Mission button — shown when done/stopped/failed */}
        {(isDone || isStopped || isFailed) && onNewMission && (
          <button
            onClick={onNewMission}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-vs-accent/15 text-vs-accent rounded-md
                       text-xs font-mono hover:bg-vs-accent/25 transition-colors"
          >
            <PlusCircle size={12} />
            New Mission
          </button>
        )}
      </div>
    </div>
  )
}
