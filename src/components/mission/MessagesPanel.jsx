import { useEffect, useRef } from 'react'

const typeStyle = {
  message:          { color: 'text-cyan-400',   badge: 'bg-cyan-500/20 text-cyan-300',   label: 'DM' },
  broadcast:        { color: 'text-yellow-400', badge: 'bg-yellow-500/20 text-yellow-300', label: 'Broadcast' },
  shutdown_request: { color: 'text-red-400',    badge: 'bg-red-500/20 text-red-300',     label: 'Shutdown' },
  shutdown_response:{ color: 'text-red-400',    badge: 'bg-red-500/20 text-red-300',     label: 'Shutdown Reply' },
}

function formatTime(ts) {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function MessagesPanel({ messages = [] }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  if (messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-vs-muted text-xs font-mono">
        No inter-agent messages yet
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] uppercase tracking-widest text-vs-muted font-mono px-1">
        Messages ({messages.length})
      </p>
      {messages.map((msg, i) => {
        const style = typeStyle[msg.msg_type] || typeStyle.message
        return (
          <div key={i} className="flex gap-2 px-2 py-1.5 rounded hover:bg-white/5 font-mono text-xs">
            <span className="text-vs-muted shrink-0 w-16">{formatTime(msg.timestamp)}</span>
            <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${style.badge}`}>
              {style.label}
            </span>
            <span className="shrink-0">
              <span className="text-vs-accent">{msg.from}</span>
              <span className="text-vs-muted mx-1">&rarr;</span>
              <span className="text-vs-keyword">{msg.to}</span>
            </span>
            <span className={`${style.color} break-words min-w-0`}>{msg.content}</span>
          </div>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
