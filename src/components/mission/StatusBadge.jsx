export function StatusBadge({ status, size = 'sm' }) {
  const config = {
    Spawning:    { color: 'text-vs-accent', bg: 'bg-vs-accent/15', dot: 'bg-vs-accent animate-pulse' },
    Working:     { color: 'text-vs-green',  bg: 'bg-vs-green/15',  dot: 'bg-vs-green animate-pulse' },
    Idle:        { color: 'text-vs-muted',  bg: 'bg-vs-panel',     dot: 'bg-vs-muted' },
    Done:        { color: 'text-vs-comment',bg: 'bg-vs-comment/15',dot: 'bg-vs-comment' },
    Error:       { color: 'text-vs-red',    bg: 'bg-vs-red/15',    dot: 'bg-vs-red' },
    // Task statuses
    pending:     { color: 'text-vs-muted',  bg: 'bg-vs-panel',     dot: 'bg-vs-muted' },
    in_progress: { color: 'text-vs-accent', bg: 'bg-vs-accent/15', dot: 'bg-vs-accent animate-pulse' },
    completed:   { color: 'text-vs-green',  bg: 'bg-vs-green/15',  dot: 'bg-vs-green' },
    blocked:     { color: 'text-yellow-400',bg: 'bg-yellow-400/15',dot: 'bg-yellow-400' },
    // Mission statuses
    launching:   { color: 'text-vs-accent', bg: 'bg-vs-accent/15', dot: 'bg-vs-accent animate-pulse' },
    running:     { color: 'text-vs-green',  bg: 'bg-vs-green/15',  dot: 'bg-vs-green animate-pulse' },
    completed_m: { color: 'text-vs-green',  bg: 'bg-vs-green/15',  dot: 'bg-vs-green' },
    failed:      { color: 'text-vs-red',    bg: 'bg-vs-red/15',    dot: 'bg-vs-red' },
    stopped:     { color: 'text-yellow-400',bg: 'bg-yellow-400/15',dot: 'bg-yellow-400' },
  }

  const key = String(status || 'pending').toLowerCase().replace('completed', status === 'Completed' ? 'completed_m' : 'completed')
  const c = config[status] || config[key] || config.pending

  const sizeClass = size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5'

  return (
    <span className={`inline-flex items-center gap-1.5 rounded font-mono ${sizeClass} ${c.bg} ${c.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {status}
    </span>
  )
}
