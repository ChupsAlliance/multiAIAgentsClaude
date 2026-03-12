const variants = {
  tip:     { border: 'border-vs-comment',  bg: 'bg-vs-comment/10',  icon: '💡', label: 'Tip' },
  warning: { border: 'border-yellow-500',   bg: 'bg-yellow-500/10',  icon: '⚠️', label: 'Lưu ý' },
  info:    { border: 'border-vs-accent',    bg: 'bg-vs-accent/10',   icon: 'ℹ️', label: 'Info' },
  danger:  { border: 'border-vs-red',       bg: 'bg-vs-red/10',      icon: '🚫', label: 'Quan trọng' },
}

export function InfoBox({ type = 'tip', children }) {
  const v = variants[type] || variants.tip
  return (
    <div className={`border-l-4 ${v.border} ${v.bg} rounded-r-lg px-4 py-3 my-4`}>
      <span className="text-xs font-bold uppercase tracking-wider text-vs-muted">
        {v.icon} {v.label}
      </span>
      <div className="mt-1.5 text-sm text-vs-text leading-relaxed">{children}</div>
    </div>
  )
}
