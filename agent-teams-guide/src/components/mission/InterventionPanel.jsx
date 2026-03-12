import { useState, useRef, useEffect } from 'react'
import { Send, MessageSquare, ChevronUp, ChevronDown, Info, Plus, X, Users, Zap, Brain, Coins } from 'lucide-react'

const MODEL_OPTIONS = [
  { id: 'sonnet', label: 'Sonnet', icon: Zap, cls: 'text-blue-400' },
  { id: 'opus',   label: 'Opus',   icon: Brain, cls: 'text-purple-400' },
  { id: 'haiku',  label: 'Haiku',  icon: Coins, cls: 'text-green-400' },
]

function AgentRow({ agent, onChange, onRemove }) {
  return (
    <div className="flex items-center gap-2 bg-vs-bg/60 border border-vs-border/50 rounded-md px-2 py-1.5">
      <input
        value={agent.name}
        onChange={e => onChange({ ...agent, name: e.target.value })}
        placeholder="Tên agent"
        className="w-24 bg-transparent text-xs text-vs-text font-mono border-b border-vs-border/40
                   focus:outline-none focus:border-vs-accent/50 placeholder-vs-muted/40"
      />
      <input
        value={agent.task}
        onChange={e => onChange({ ...agent, task: e.target.value })}
        placeholder="Nhiệm vụ..."
        className="flex-1 bg-transparent text-xs text-vs-text font-mono border-b border-vs-border/40
                   focus:outline-none focus:border-vs-accent/50 placeholder-vs-muted/40"
      />
      <div className="flex items-center gap-0.5">
        {MODEL_OPTIONS.map(m => {
          const Icon = m.icon
          return (
            <button
              key={m.id}
              onClick={() => onChange({ ...agent, model: m.id })}
              title={m.label}
              className={`p-1 rounded transition-colors ${
                agent.model === m.id
                  ? `${m.cls} bg-white/10`
                  : 'text-vs-muted hover:text-vs-text hover:bg-white/5'
              }`}
            >
              <Icon size={11} />
            </button>
          )
        })}
      </div>
      <button onClick={onRemove} className="p-0.5 text-vs-muted hover:text-vs-red transition-colors" title="Xóa agent">
        <X size={12} />
      </button>
    </div>
  )
}

export function InterventionPanel({ onSend, isRunning, disabled }) {
  const [message, setMessage] = useState('')
  const [history, setHistory] = useState([])
  const [collapsed, setCollapsed] = useState(false)
  const [showAgentConfig, setShowAgentConfig] = useState(false)
  const [customAgents, setCustomAgents] = useState([])
  const inputRef = useRef(null)

  const handleSend = () => {
    const trimmed = message.trim()
    if (!trimmed || disabled) return

    // Build agents list to pass
    const validAgents = customAgents.filter(a => a.name.trim() && a.task.trim())

    const entry = {
      text: trimmed,
      agents: validAgents.length > 0 ? validAgents : null,
      timestamp: Date.now(),
      status: isRunning ? 'queued' : 'sent',
    }

    setHistory(prev => [...prev, entry])
    setMessage('')
    onSend(trimmed, validAgents.length > 0 ? validAgents : null)

    // Reset agent config after send
    setCustomAgents([])
    setShowAgentConfig(false)

    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const addAgent = () => {
    setCustomAgents(prev => [...prev, {
      id: Date.now(),
      name: '',
      task: '',
      model: 'sonnet',
    }])
  }

  const updateAgent = (id, updated) => {
    setCustomAgents(prev => prev.map(a => a.id === id ? { ...a, ...updated } : a))
  }

  const removeAgent = (id) => {
    setCustomAgents(prev => prev.filter(a => a.id !== id))
    if (customAgents.length <= 1) setShowAgentConfig(false)
  }

  // Update queued→sent when mission stops running
  useEffect(() => {
    if (!isRunning) {
      setHistory(prev => prev.map(h =>
        h.status === 'queued' ? { ...h, status: 'sent' } : h
      ))
    }
  }, [isRunning])

  const formatTime = (ts) => {
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  const modeDescription = isRunning
    ? 'Mission đang chạy — message sẽ được queue, chạy khi phase hiện tại xong'
    : 'Lead sẽ nhận context từ mission trước (tasks, files, logs) và thực thi yêu cầu mới.'

  const validAgentCount = customAgents.filter(a => a.name.trim() && a.task.trim()).length

  return (
    <div className="border-t border-vs-border bg-vs-panel/30">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-1.5 hover:bg-white/5 transition-colors"
      >
        <span className="flex items-center gap-1.5 text-[10px] font-mono text-vs-muted uppercase tracking-wider">
          <MessageSquare size={10} />
          Intervention {history.length > 0 && `(${history.length})`}
        </span>
        {collapsed ? <ChevronUp size={12} className="text-vs-muted" /> : <ChevronDown size={12} className="text-vs-muted" />}
      </button>

      {!collapsed && (
        <div className="px-4 pb-3 space-y-2">
          {/* Info banner */}
          <div className="flex items-start gap-1.5 text-[10px] text-vs-muted font-mono bg-vs-bg/50 border border-vs-border/50 rounded px-2 py-1.5 leading-relaxed">
            <Info size={10} className="shrink-0 mt-0.5 text-vs-accent/60" />
            <span>{modeDescription}</span>
          </div>

          {/* History */}
          {history.length > 0 && (
            <div className="max-h-32 overflow-y-auto space-y-1 scrollbar-thin">
              {history.map((h, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px]">
                  <span className="text-vs-muted font-mono shrink-0">{formatTime(h.timestamp)}</span>
                  <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-mono ${
                    h.status === 'queued' ? 'bg-yellow-500/20 text-yellow-400' :
                    h.status === 'running' ? 'bg-blue-500/20 text-blue-400' :
                    'bg-green-500/20 text-green-400'
                  }`}>
                    {h.status === 'queued' ? 'QUEUED' : h.status === 'running' ? 'RUNNING' : 'SENT'}
                  </span>
                  <span className="text-vs-text break-words">
                    {h.text}
                    {h.agents && (
                      <span className="text-vs-muted ml-1">
                        (+{h.agents.length} agent{h.agents.length > 1 ? 's' : ''})
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Agent configuration — collapsible */}
          {!isRunning && (
            <div>
              <button
                onClick={() => {
                  setShowAgentConfig(!showAgentConfig)
                  if (!showAgentConfig && customAgents.length === 0) addAgent()
                }}
                className={`flex items-center gap-1.5 text-[10px] font-mono transition-colors ${
                  showAgentConfig ? 'text-vs-accent' : 'text-vs-muted hover:text-vs-text'
                }`}
              >
                <Users size={10} />
                {showAgentConfig ? 'Ẩn cấu hình agents' : 'Tùy chỉnh agents'}
                {validAgentCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-vs-accent/20 text-vs-accent text-[9px]">
                    {validAgentCount}
                  </span>
                )}
              </button>

              {showAgentConfig && (
                <div className="mt-1.5 space-y-1.5">
                  <p className="text-[9px] text-vs-muted font-mono">
                    Thêm agents để Lead spawn. Để trống nếu muốn Lead tự quyết định.
                  </p>
                  {customAgents.map(agent => (
                    <AgentRow
                      key={agent.id}
                      agent={agent}
                      onChange={(updated) => updateAgent(agent.id, updated)}
                      onRemove={() => removeAgent(agent.id)}
                    />
                  ))}
                  <button
                    onClick={addAgent}
                    className="flex items-center gap-1 text-[10px] font-mono text-vs-muted hover:text-vs-accent transition-colors py-1"
                  >
                    <Plus size={10} />
                    Thêm agent
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Input + Send */}
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              disabled={disabled}
              placeholder={
                disabled
                  ? "Mission chưa bắt đầu..."
                  : isRunning
                    ? "Gửi chỉ dẫn bổ sung (queue)..."
                    : "Nhập yêu cầu để tiếp tục mission..."
              }
              className="flex-1 bg-vs-bg border border-vs-border rounded-md px-3 py-2 text-xs text-vs-text font-mono
                         placeholder-vs-muted/40 focus:outline-none focus:border-vs-accent/50 focus:ring-1 focus:ring-vs-accent/30
                         disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            />
            <button
              onClick={handleSend}
              disabled={!message.trim() || disabled}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold transition-colors ${
                message.trim() && !disabled
                  ? 'bg-vs-accent hover:bg-vs-accent/80 text-white'
                  : 'bg-vs-panel text-vs-muted cursor-not-allowed'
              }`}
            >
              <Send size={12} />
              {validAgentCount > 0 ? `Send (+${validAgentCount})` : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
