import { useEffect, useRef, useMemo, memo, useState } from 'react'
import { Brain, Square, Wrench, Info, ChevronRight, Palette, ExternalLink } from 'lucide-react'

// ── Phase detection from recent log content ──
const PHASE_PATTERNS = [
  { re: /glob|grep|read.*file|list.*dir|codebase|struct/i, label: 'Đang đọc codebase...' },
  { re: /analyz|identif|understand|require|problem/i,       label: 'Đang phân tích yêu cầu...' },
  { re: /break.*down|task|agent|assign|plan/i,              label: 'Đang lên kế hoạch...' },
  { re: /detail|implement|spec|accept|criteri/i,            label: 'Đang soạn task chi tiết...' },
  { re: /MISSION PLAN|json|output|coordinat/i,              label: 'Đang hoàn thiện plan...' },
]

function detectPhase(logs) {
  const recent = logs.slice(-8).map(l => l.message || '').join(' ')
  for (const { re, label } of PHASE_PATTERNS) {
    if (re.test(recent)) return label
  }
  return logs.length > 0 ? 'Đang xử lý...' : 'Đang khởi động...'
}

// ── Single log line renderer ──
const LogLine = memo(function LogLine({ entry }) {
  if (entry.log_type === 'tool') {
    return (
      <div className="flex items-start gap-1.5 py-0.5 text-yellow-400/70">
        <Wrench size={10} className="shrink-0 mt-0.5 opacity-70" />
        <span className="break-all">{entry.message}</span>
      </div>
    )
  }
  if (entry.log_type === 'info' || entry.agent === 'System') {
    return (
      <div className="flex items-start gap-1.5 py-0.5 text-vs-muted/60">
        <Info size={10} className="shrink-0 mt-0.5 opacity-60" />
        <span className="break-all">{entry.message}</span>
      </div>
    )
  }
  // thinking — split by literal \n so each paragraph shows on its own line
  const lines = (entry.message || '').split(/\\n|\n/)
  return (
    <div className="py-0.5">
      {lines.map((line, i) =>
        line.trim() ? (
          <div key={i} className="flex items-start gap-1.5">
            <ChevronRight size={10} className="shrink-0 mt-0.5 text-vs-accent/50" />
            <span className="text-vs-text/90 break-all leading-relaxed">{line}</span>
          </div>
        ) : (
          <div key={i} className="h-2" />
        )
      )}
    </div>
  )
})

// ── Blinking cursor ──
function Cursor() {
  return <span className="inline-block w-1.5 h-3 bg-vs-green align-middle animate-pulse ml-0.5" />
}

// ── Mockup approval card ──
function MockupApprovalCard({ mockupInfo, onRespond }) {
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleApprove = async () => {
    setSubmitting(true)
    try { await onRespond('approve', '') } finally { setSubmitting(false) }
  }

  const handleFeedback = async () => {
    if (!feedback.trim() || submitting) return
    setSubmitting(true)
    try { await onRespond('revise', feedback.trim()) } finally { setSubmitting(false) }
  }

  return (
    <div className="mx-3 mb-3 rounded-lg border border-purple-500/40 bg-purple-950/20 p-3 text-[11px] font-mono">
      <div className="flex items-center gap-2 mb-2">
        <Palette size={12} className="text-purple-400 shrink-0" />
        <span className="text-purple-300 font-medium">
          Lead đã tạo mockup: &quot;{mockupInfo.title}&quot;
        </span>
      </div>

      <div className="flex items-center gap-2 mb-3 text-vs-muted/60">
        <span>Đã mở trong browser.</span>
        <button
          onClick={() => window.electronAPI?.invoke('open_url', { url: mockupInfo.url })}
          className="flex items-center gap-1 text-purple-400/80 hover:text-purple-300 transition-colors"
        >
          <ExternalLink size={10} />
          Mở lại
        </button>
      </div>

      <button
        onClick={handleApprove}
        disabled={submitting}
        className="w-full mb-2 px-3 py-1.5 rounded bg-purple-600/30 border border-purple-500/40 text-purple-200 hover:bg-purple-600/50 disabled:opacity-50 transition-colors"
      >
        ✅ Approve — tiếp tục planning
      </button>

      <div className="flex gap-1.5">
        <input
          type="text"
          value={feedback}
          onChange={e => setFeedback(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleFeedback() }}
          disabled={submitting}
          placeholder="Gửi feedback để Lead revise mockup..."
          className="flex-1 px-2 py-1.5 rounded bg-vs-panel border border-purple-500/30 text-vs-text placeholder-vs-muted/40 focus:outline-none focus:border-purple-400/60 disabled:opacity-50"
        />
        <button
          onClick={handleFeedback}
          disabled={submitting || !feedback.trim()}
          className="px-2 py-1.5 rounded bg-vs-panel border border-purple-500/30 text-purple-300 hover:border-purple-400/60 disabled:opacity-50 transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  )
}

function formatElapsed(s) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// ── Main component ──
export const PlanningStream = memo(function PlanningStream({ state, isRunning, onStop, mockupInfo, onMockupRespond }) {
  const scrollRef = useRef(null)
  const wasAtBottomRef = useRef(true)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!isRunning) { setElapsed(0); return }
    const interval = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(interval)
  }, [isRunning])

  const agents = state?.agents || []
  const logs   = state?.log    || []

  const lead = useMemo(() => agents.find(a => a.name === 'Lead'), [agents])

  // All Lead + System output, excluding errors
  const streamLogs = useMemo(() =>
    logs.filter(l =>
      l.log_type !== 'error' &&
      (l.agent === 'Lead' || (l.agent === 'System' && l.log_type === 'info'))
    ), [logs])

  const currentPhase = useMemo(() => detectPhase(streamLogs), [streamLogs])

  // Track whether user has scrolled up (to not force-scroll them back down)
  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    wasAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  // Auto-scroll when new content arrives
  useEffect(() => {
    if (!wasAtBottomRef.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [streamLogs.length])

  return (
    <div className="flex-1 p-4 min-h-0 overflow-hidden flex flex-col">
      <div className="flex-1 flex flex-col rounded-lg border border-vs-border overflow-hidden bg-vs-bg">

        {/* ── Top header bar ── */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-vs-border shrink-0 bg-vs-panel">
          <div className="flex items-center gap-2 min-w-0">
            <Brain size={14} className="text-vs-accent shrink-0 animate-pulse" />
            <span className="text-xs font-mono text-vs-heading font-medium">Lead đang phân tích & lên plan</span>
            <span className="text-xs font-mono text-vs-muted truncate hidden sm:inline">
              — {currentPhase}
            </span>
          </div>
          <span className="text-[10px] font-mono text-vs-muted/50 shrink-0">
            {formatElapsed(elapsed)}
          </span>
          {onStop && (
            <button
              onClick={onStop}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-vs-muted hover:text-red-400 hover:border-red-400/40 border border-vs-border rounded transition-colors shrink-0"
            >
              <Square size={9} />
              Stop
            </button>
          )}
        </div>

        {/* ── Lead status bar ── */}
        <div className="flex items-center gap-3 px-4 py-1.5 border-b border-vs-border shrink-0 bg-vs-panel/50 text-[10px] font-mono">
          {/* Pulsing Working badge — always Working in planning */}
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-vs-green opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-vs-green" />
            </span>
            <span className="text-vs-green">Working</span>
          </div>

          <span className="text-vs-muted">Lead Coordinator</span>

          {lead?.model && (
            <span className="text-vs-muted opacity-60">{lead.model}</span>
          )}

          {lead?.current_task && (
            <span className="text-vs-muted truncate max-w-xs opacity-80">
              {lead.current_task}
            </span>
          )}
        </div>

        {/* ── Terminal stream area ── */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-3 font-mono text-[11px] bg-[#0d1117] scrollbar-thin scrollbar-thumb-vs-border scrollbar-track-transparent"
        >
          {streamLogs.length === 0 ? (
            /* Empty state — connecting */
            <div className="flex flex-col items-start gap-1 text-vs-muted/60 py-2">
              <div className="flex items-center gap-2">
                <span className="animate-pulse">⠋</span>
                <span>Đang kết nối với Claude CLI...</span>
              </div>
            </div>
          ) : (
            streamLogs.map((entry, i) => <LogLine key={i} entry={entry} />)
          )}

          {/* Blinking cursor while running */}
          {isRunning && <Cursor />}
        </div>

        {/* Mockup approval card — shown when planning is paused for mockup review */}
        {mockupInfo && onMockupRespond && (
          <MockupApprovalCard mockupInfo={mockupInfo} onRespond={onMockupRespond} />
        )}

        {/* ── Bottom status bar ── */}
        <div className="flex items-center gap-3 px-3 py-1 border-t border-vs-border shrink-0 bg-vs-panel/30 text-[9px] font-mono text-vs-muted/50">
          <span>{streamLogs.length} dòng</span>
          <span>·</span>
          <span>{currentPhase}</span>
          <span className="ml-auto">Vui lòng chờ — plan sẽ hiện khi Lead hoàn thành</span>
        </div>
      </div>
    </div>
  )
})
