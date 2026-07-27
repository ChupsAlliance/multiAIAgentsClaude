import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, CheckCircle2, FileEdit, MessageSquare, Sparkles, Wrench, AlertTriangle, Rocket, HelpCircle, LayoutTemplate } from 'lucide-react'
import { TypewriterText } from './TypewriterText'

// ── Event → visual config (icon, color) ──
const EVENT_CONFIG = {
  'agent-spawned': { icon: Rocket,        color: 'text-cyan-300',    ring: 'ring-cyan-400/30',    bg: 'bg-cyan-500/10' },
  'task-done':     { icon: CheckCircle2,  color: 'text-emerald-300', ring: 'ring-emerald-400/30', bg: 'bg-emerald-500/10' },
  'file-change':   { icon: FileEdit,      color: 'text-amber-300',   ring: 'ring-amber-400/30',   bg: 'bg-amber-500/10' },
  'message':       { icon: MessageSquare, color: 'text-fuchsia-300', ring: 'ring-fuchsia-400/30', bg: 'bg-fuchsia-500/10' },
  'tool':          { icon: Wrench,        color: 'text-yellow-300',  ring: 'ring-yellow-400/30',  bg: 'bg-yellow-500/10' },
  'error':         { icon: AlertTriangle, color: 'text-red-300',     ring: 'ring-red-400/30',     bg: 'bg-red-500/10' },
  'thinking':      { icon: Sparkles,      color: 'text-indigo-300',  ring: 'ring-indigo-400/30',  bg: 'bg-indigo-500/10' },
  'qa':            { icon: HelpCircle,    color: 'text-violet-300',  ring: 'ring-violet-400/30',  bg: 'bg-violet-500/10' },
  'mockup':        { icon: LayoutTemplate, color: 'text-rose-300',   ring: 'ring-rose-400/30',    bg: 'bg-rose-500/10' },
  default:         { icon: Bot,           color: 'text-slate-300',   ring: 'ring-slate-400/30',   bg: 'bg-slate-500/10' },
}

function classifyEvent(entry) {
  if (entry.__kind === 'qa') return 'qa'
  if (entry.__kind === 'mockup') return 'mockup'
  if (entry.__kind === 'agent-spawned') return 'agent-spawned'
  if (entry.__kind === 'file-change') return 'file-change'
  if (entry.__kind === 'task-done') return 'task-done'
  if (entry.log_type === 'error') return 'error'
  if (entry.log_type === 'tool') return 'tool'
  if (entry.log_type === 'message') return 'message'
  if (entry.log_type === 'thinking') return 'thinking'
  return 'default'
}

function formatQaMessage(entry) {
  const questions = entry.questions || []
  const answers = entry.answers || []
  if (questions.length === 0) {
    return answers.map(a => `→ User trả lời: ${a.answer}`).join('\n\n')
  }
  return questions.map((q, i) => {
    const a = answers.find(ans => ans.question_index === i) || answers[i]
    const answerText = a ? a.answer : ''
    return `Lead hỏi: ${q.question}\n→ User trả lời: ${answerText}`
  }).join('\n\n')
}

/**
 * Xây dựng danh sách timeline events từ replayMissionState.
 * Kết hợp: agent spawns, log entries, file changes, task completions —
 * sắp theo thời gian (timestamp).
 */
function buildTimelineEvents(state) {
  if (!state) return []
  const events = []

  for (const a of state.agents || []) {
    if (a.spawned_at) {
      events.push({
        __kind: 'agent-spawned',
        timestamp: a.spawned_at,
        agent: a.name,
        message: `${a.name} (${a.role || 'Agent'}) bắt đầu tham gia mission`,
      })
    }
  }

  for (const l of state.log || []) {
    if (l.agent === 'System' && l.log_type === 'info') continue // skip noisy system chatter
    events.push({ ...l, __kind: 'log' })
  }

  for (const fc of state.file_changes || []) {
    events.push({
      __kind: 'file-change',
      timestamp: fc.timestamp,
      agent: fc.agent,
      message: `${fc.agent || 'Agent'} đã ${fc.action === 'create' ? 'tạo' : fc.action === 'delete' ? 'xoá' : 'chỉnh sửa'} file ${fc.path}`,
    })
  }

  for (const t of state.tasks || []) {
    if (t.status === 'completed' && t.completed_at) {
      events.push({
        __kind: 'task-done',
        timestamp: t.completed_at,
        agent: t.assigned_agent,
        message: `Hoàn thành task: ${t.title}`,
      })
    }
  }

  for (const qa of state.qa_events || []) {
    events.push({
      __kind: 'qa',
      timestamp: qa.timestamp,
      agent: 'Lead',
      message: formatQaMessage(qa),
    })
  }

  for (const m of state.mockup_events || []) {
    events.push({
      __kind: 'mockup',
      timestamp: m.timestamp,
      agent: 'Lead',
      message: `Lead đã tạo mockup: ${m.title}`,
    })
  }

  return events
    .filter(e => e.timestamp)
    .sort((a, b) => a.timestamp - b.timestamp)
}

function formatTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('vi-VN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/**
 * Timeline dạng chat/step-by-step cho Presentation Mode.
 * Mỗi business event render thành 1 khối card xuất hiện tuần tự với hiệu ứng
 * typewriter cho phần text, tự động scroll xuống event mới nhất.
 *
 * props: { state (replayMissionState), currentMs, charsPerSecond, instant }
 */
export function PresentationTimeline({ state, currentMs, charsPerSecond = 45, instant = false }) {
  const allEvents = useMemo(() => buildTimelineEvents(state), [state])
  const scrollRef = useRef(null)
  const [revealedCount, setRevealedCount] = useState(0)

  // Chỉ hiện các event đã "xảy ra" tính theo mốc thời gian tương đối của mission
  // (timestamp đầu tiên = 0ms trong track phát lại).
  const baseTs = allEvents.length > 0 ? allEvents[0].timestamp : 0
  const visibleEvents = useMemo(() => {
    if (!allEvents.length) return []
    return allEvents.filter(e => (e.timestamp - baseTs) <= currentMs)
  }, [allEvents, baseTs, currentMs])

  useEffect(() => {
    setRevealedCount(visibleEvents.length)
  }, [visibleEvents.length])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [revealedCount])

  if (allEvents.length === 0) {
    return (
      <div data-testid="presentation-timeline" className="flex-1 flex items-center justify-center text-[#ffffff66] text-sm font-mono">
        Đang chờ dữ liệu bản ghi...
      </div>
    )
  }

  return (
    <div ref={scrollRef} data-testid="presentation-timeline" className="flex-1 overflow-y-auto px-6 md:px-16 lg:px-32 py-8 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
      <div className="max-w-3xl mx-auto space-y-4">
        {visibleEvents.map((entry, i) => {
          const type = classifyEvent(entry)
          const cfg = EVENT_CONFIG[type] || EVENT_CONFIG.default
          const Icon = cfg.icon
          const isLast = i === visibleEvents.length - 1
          return (
            <div
              key={`${entry.timestamp}-${i}`}
              className="flex items-start gap-3 animate-fade-in"
            >
              <div className={`flex items-center justify-center w-8 h-8 rounded-full shrink-0 ring-2 ${cfg.ring} ${cfg.bg}`}>
                <Icon size={14} className={cfg.color} />
              </div>
              <div className="flex-1 min-w-0 rounded-xl border border-[#ffffff1a] bg-[#ffffff0a] px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  {entry.agent && (
                    <span className="text-[11px] font-mono font-semibold text-[#ffffffcc]">{entry.agent}</span>
                  )}
                  <span className="text-[10px] font-mono text-[#ffffff4d]">{formatTime(entry.timestamp)}</span>
                </div>
                <div className="text-sm text-[#ffffffe6] leading-relaxed break-words whitespace-pre-wrap">
                  {isLast ? (
                    <TypewriterText
                      text={entry.message || ''}
                      charsPerSecond={charsPerSecond}
                      instant={instant}
                    />
                  ) : (
                    entry.message || ''
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
