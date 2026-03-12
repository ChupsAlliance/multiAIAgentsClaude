import { useMemo, memo } from 'react'
import { CheckCircle2, Circle, Loader2, AlertCircle, Clock, AlertTriangle } from 'lucide-react'

const statusIcon = {
  pending:     <Circle size={14} className="text-vs-muted" />,
  in_progress: <Loader2 size={14} className="text-vs-accent animate-spin" />,
  completed:   <CheckCircle2 size={14} className="text-vs-green" />,
  blocked:     <AlertCircle size={14} className="text-yellow-400" />,
  error:       <AlertCircle size={14} className="text-vs-red" />,
}

const PHASE_DEFS = [
  { id: 'investigating', label: 'Analyzing', color: 'bg-blue-400', weight: 15 },
  { id: 'coding',        label: 'Coding',    color: 'bg-vs-accent', weight: 55 },
  { id: 'building',      label: 'Building',  color: 'bg-yellow-400', weight: 20 },
  { id: 'complete',      label: 'Done',      color: 'bg-vs-green', weight: 10 },
]

function inferPhase(task, agentLogs) {
  if (task.status === 'completed') return 'complete'
  if (task.status !== 'in_progress') return null

  if (!task.assigned_agent) return 'investigating'
  if (agentLogs.length === 0) return 'investigating'

  const lastWithHint = [...agentLogs].reverse().find(l => l.phase_hint)
  if (lastWithHint) return lastWithHint.phase_hint

  const lastMsg = agentLogs[agentLogs.length - 1]?.message?.toLowerCase() || ''

  if (lastMsg.includes('npm run build') || lastMsg.includes('npm install') ||
      lastMsg.includes('cargo build') || lastMsg.includes('npm test') ||
      lastMsg.includes('npm run') || lastMsg.includes('python') ||
      lastMsg.includes('node ')) return 'building'

  if (lastMsg.includes('write:') || lastMsg.includes('edit:') ||
      lastMsg.includes('creating') || lastMsg.includes('writing')) return 'coding'

  if (lastMsg.includes('read:') || lastMsg.includes('glob:') ||
      lastMsg.includes('grep:') || lastMsg.includes('analyzing') ||
      lastMsg.includes('reading') || lastMsg.includes('searching')) return 'investigating'

  const lastType = agentLogs[agentLogs.length - 1]?.log_type || ''
  if (lastType === 'tool') {
    const toolName = agentLogs[agentLogs.length - 1]?.tool_name?.toLowerCase() || ''
    if (toolName === 'bash') return 'building'
    if (toolName === 'write' || toolName === 'edit') return 'coding'
    if (toolName === 'read' || toolName === 'glob' || toolName === 'grep') return 'investigating'
    return 'coding'
  }

  return 'coding'
}

const PhaseBar = memo(function PhaseBar({ phase }) {
  if (!phase) return null
  const phaseIdx = PHASE_DEFS.findIndex(p => p.id === phase)
  if (phaseIdx < 0) return null

  return (
    <div className="flex items-center gap-1 mt-1.5">
      <div className="flex-1 flex h-1 rounded-full overflow-hidden bg-vs-border/40">
        {PHASE_DEFS.map((p, i) => (
          <div
            key={p.id}
            className={`h-full ${
              i < phaseIdx ? p.color + ' opacity-80'
                : i === phaseIdx ? p.color + ' opacity-90'
                : 'bg-transparent'
            }`}
            style={{ width: `${p.weight}%` }}
          />
        ))}
      </div>
      <span className="text-[9px] font-mono text-vs-muted shrink-0">
        {PHASE_DEFS[phaseIdx]?.label}
      </span>
    </div>
  )
})

function StuckBadge({ task, lastActivityAt }) {
  if (task.status !== 'in_progress' || !lastActivityAt) return null
  const elapsed = Date.now() - lastActivityAt
  if (elapsed < 60000) return null
  const minutes = Math.floor(elapsed / 60000)
  return (
    <span className="inline-flex items-center gap-0.5 text-[9px] font-mono text-yellow-400 bg-yellow-500/10 px-1.5 py-0.5 rounded ml-1">
      <AlertTriangle size={8} />
      {minutes}m no activity
    </span>
  )
}

function formatDuration(ms) {
  if (!ms || ms < 0) return null
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const remSec = sec % 60
  return `${min}m${remSec > 0 ? `${remSec}s` : ''}`
}

// Build index: agent name → logs array — O(n) once instead of O(n) per task
function buildAgentLogIndex(logs) {
  const index = {}
  for (const l of logs) {
    const name = l.agent
    if (!name) continue
    if (!index[name]) index[name] = []
    index[name].push(l)
  }
  return index
}

const TaskItem = memo(function TaskItem({ task, agentLogs }) {
  const phase = inferPhase(task, agentLogs)
  const lastActivityAt = agentLogs.length > 0
    ? agentLogs[agentLogs.length - 1]?.timestamp
    : task.started_at

  let currentAction = null
  if (task.status === 'in_progress' && task.assigned_agent && agentLogs.length > 0) {
    const recent = agentLogs.slice(-3).reverse()
    const action = recent.find(l => l.log_type === 'tool' || l.log_type === 'thinking')
    if (action) {
      const msg = action.message || ''
      currentAction = msg.length > 60 ? msg.slice(0, 57) + '...' : msg
    }
  }

  return (
    <div
      className={`px-3 py-2 rounded-md text-xs ${
        task.status === 'completed'
          ? 'bg-vs-green/5 text-vs-muted'
          : task.status === 'in_progress'
            ? 'bg-vs-accent/5 border border-vs-accent/20 text-white'
            : task.status === 'error'
              ? 'bg-vs-red/5 border border-vs-red/20 text-vs-red'
              : 'text-vs-text'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0">{statusIcon[task.status] || statusIcon.pending}</span>
        <div className="flex-1 min-w-0">
          <p className={`font-mono leading-tight ${task.status === 'completed' ? 'line-through opacity-60' : ''}`}>
            {task.title}
          </p>
          <div className="flex items-center flex-wrap gap-x-2 mt-0.5">
            {task.assigned_agent && (
              <span className="text-[10px] text-vs-muted">→ {task.assigned_agent}</span>
            )}
            {task.priority && (
              <span className={`text-[9px] font-mono px-1 py-0.5 rounded ${
                task.priority === 'high' ? 'bg-vs-red/10 text-vs-red' :
                task.priority === 'medium' ? 'bg-yellow-500/10 text-yellow-400' :
                'bg-vs-muted/10 text-vs-muted'
              }`}>
                {task.priority}
              </span>
            )}
            {task.completed_at && task.started_at && (
              <span className="text-[10px] text-vs-muted flex items-center gap-0.5">
                <Clock size={9} />
                {formatDuration(task.completed_at - task.started_at)}
              </span>
            )}
            <StuckBadge task={task} lastActivityAt={lastActivityAt} />
          </div>
        </div>
      </div>
      {phase && phase !== 'complete' && task.status === 'in_progress' && (
        <PhaseBar phase={phase} />
      )}
      {currentAction && (
        <p className="text-[9px] font-mono text-vs-function/70 mt-1 truncate" title={currentAction}>
          ↳ {currentAction}
        </p>
      )}
    </div>
  )
})

export const TaskList = memo(function TaskList({ tasks = [], logs = [] }) {
  const completed = useMemo(() => tasks.filter(t => t.status === 'completed').length, [tasks])
  const inProgress = useMemo(() => tasks.filter(t => t.status === 'in_progress').length, [tasks])
  const total = tasks.length

  // Build agent log index once — O(n) instead of O(n×tasks)
  const agentLogIndex = useMemo(() => buildAgentLogIndex(logs), [logs])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-[10px] uppercase tracking-widest text-vs-muted font-mono">
          Tasks ({completed}/{total})
          {inProgress > 0 && (
            <span className="text-vs-accent ml-1">• {inProgress} active</span>
          )}
        </p>
        {total > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-24 h-1.5 bg-vs-border rounded-full overflow-hidden">
              <div
                className="h-full bg-vs-green rounded-full"
                style={{ width: `${(completed / total) * 100}%` }}
              />
            </div>
            <span className="text-[10px] text-vs-muted font-mono">
              {Math.round((completed / total) * 100)}%
            </span>
          </div>
        )}
      </div>

      {tasks.length === 0 ? (
        <p className="text-xs text-vs-muted font-mono text-center py-4">
          Chưa có tasks. Đang chờ Lead phân công...
        </p>
      ) : (
        <div className="space-y-1">
          {tasks.map((task, i) => {
            const agentLogs = task.assigned_agent
              ? (agentLogIndex[task.assigned_agent] || []).slice(-10)
              : []
            return <TaskItem key={task.id || i} task={task} agentLogs={agentLogs} />
          })}
        </div>
      )}
    </div>
  )
})
