import { useRef, useEffect, useState, useMemo, memo } from 'react'
import { ChevronRight, ChevronDown, Copy, Check } from 'lucide-react'

const LogMessage = memo(function LogMessage({ message }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const PREVIEW_LEN = 200
  const isLong = message.length > PREVIEW_LEN

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (!isLong) {
    return <span className="break-all whitespace-pre-wrap">{message}</span>
  }

  return (
    <div className="min-w-0 w-full">
      <div className="flex items-start gap-1">
        <button
          onClick={() => setExpanded(!expanded)}
          className="shrink-0 mt-0.5 text-vs-muted hover:text-vs-text"
          title={expanded ? 'Thu gọn' : 'Xem toàn bộ'}
        >
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </button>
        {!expanded && (
          <span className="break-all whitespace-pre-wrap text-vs-muted">
            {message.slice(0, PREVIEW_LEN)}
            <button
              onClick={() => setExpanded(true)}
              className="inline ml-1 text-vs-accent hover:underline text-[10px]"
            >
              …xem thêm ({message.length} ký tự)
            </button>
          </span>
        )}
      </div>

      {expanded && (
        <div className="mt-1 ml-3 w-full">
          <div className="relative rounded border border-vs-border bg-black/30 overflow-hidden">
            <div className="overflow-y-auto overflow-x-auto max-h-72 p-2">
              <pre className="text-[11px] font-mono whitespace-pre-wrap break-all leading-relaxed">
                {message}
              </pre>
            </div>
            <div className="flex items-center justify-between px-2 py-1 bg-vs-panel border-t border-vs-border">
              <span className="text-[9px] text-vs-muted">{message.length} ký tự</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono
                             text-vs-muted hover:text-white hover:bg-white/10"
                >
                  {copied ? <Check size={8} /> : <Copy size={8} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <button
                  onClick={() => setExpanded(false)}
                  className="px-1.5 py-0.5 rounded text-[9px] font-mono text-vs-muted hover:text-white hover:bg-white/10"
                >
                  Thu gọn
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

const typeColor = {
  info:         'text-vs-text',
  spawn:        'text-vs-accent',
  error:        'text-vs-red',
  tool:         'text-vs-keyword',
  thinking:     'text-vs-text',
  result:       'text-vs-green',
  'plan-ready': 'text-vs-accent',
  message:      'text-cyan-400',
}

const typeIcon = {
  spawn:    '⚡',
  error:    '✖',
  tool:     '🔧',
  result:   '✔',
  'plan-ready': '📋',
  message:  '💬',
}

const LogEntry = memo(function LogEntry({ entry }) {
  return (
    <div className="flex gap-2 px-2 py-1 text-[11px] font-mono hover:bg-white/5 rounded overflow-hidden">
      <span className="text-vs-muted shrink-0 w-[52px] text-[10px]">
        {new Date(entry.timestamp).toLocaleTimeString('vi-VN', { hour12: false })}
      </span>
      <span className={`shrink-0 text-[10px] ${
        entry.agent === 'System' ? 'text-vs-muted' : 'text-vs-keyword font-semibold'
      }`} style={{ width: '70px' }}>
        {typeIcon[entry.log_type] || '›'} [{entry.agent}]
      </span>
      <div className={`flex-1 min-w-0 overflow-hidden ${typeColor[entry.log_type] || 'text-vs-text'}`}>
        <LogMessage message={entry.message || ''} />
      </div>
    </div>
  )
})

export const ActivityLog = memo(function ActivityLog({ log = [], title }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [log.length])

  // Memoize filter + dedup — only recompute when log array ref changes
  const deduped = useMemo(() => {
    const filtered = log.filter(entry => {
      const msg = entry.message || ''
      if (entry.agent === 'System' && msg.includes('"type":"system"') && msg.includes('"subtype":"init"')) {
        return false
      }
      return true
    })

    return filtered.reduce((acc, entry) => {
      const prev = acc[acc.length - 1]
      if (prev && prev.agent === entry.agent && prev.message === entry.message
          && Math.abs(entry.timestamp - prev.timestamp) < 2000) {
        return acc
      }
      acc.push(entry)
      return acc
    }, [])
  }, [log])

  const visible = useMemo(() => deduped.slice(-200), [deduped])

  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-widest text-vs-muted font-mono px-1">
        {title || `Activity (${deduped.length})`}
      </p>
      <div className="overflow-y-auto overflow-x-hidden space-y-0.5 scrollbar-thin" style={{ maxHeight: 'calc(100vh - 300px)' }}>
        {visible.length === 0 ? (
          <p className="text-xs text-vs-muted font-mono text-center py-4">
            Chờ output từ agents...
          </p>
        ) : (
          visible.map((entry) => (
            <LogEntry key={`${entry.timestamp}-${entry.agent}`} entry={entry} />
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
})
