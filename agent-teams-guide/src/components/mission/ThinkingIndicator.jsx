import { useState, useEffect } from 'react'
import { Brain } from 'lucide-react'

const THINKING_PHASES = [
  'Đang kết nối với Claude...',
  'Đang phân tích yêu cầu...',
  'Đang lên kế hoạch tổng thể...',
  'Đang xác định cấu trúc team...',
  'Đang chuẩn bị task list...',
]

export function ThinkingIndicator({ log = [], isRunning }) {
  const [phaseIndex, setPhaseIndex] = useState(0)
  const [dots, setDots] = useState('')

  // Cycle through phases every 8 seconds
  useEffect(() => {
    if (!isRunning) return
    const interval = setInterval(() => {
      setPhaseIndex(prev => (prev + 1) % THINKING_PHASES.length)
    }, 8000)
    return () => clearInterval(interval)
  }, [isRunning])

  // Animate dots
  useEffect(() => {
    if (!isRunning) return
    const interval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.')
    }, 500)
    return () => clearInterval(interval)
  }, [isRunning])

  // Don't show if there are already meaningful log entries
  const meaningfulLogs = log.filter(l =>
    l.log_type !== 'error' && l.agent !== 'System'
  )
  if (meaningfulLogs.length > 2 || !isRunning) return null

  // Show last few logs if any exist
  const recentLogs = log.slice(-3)

  return (
    <div className="flex flex-col items-center justify-center py-12 gap-4 animate-fade-in">
      {/* Pulsing brain */}
      <div className="relative">
        <div className="w-16 h-16 rounded-2xl bg-vs-accent/10 border border-vs-accent/30 flex items-center justify-center animate-pulse">
          <Brain size={28} className="text-vs-accent" />
        </div>
        <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-yellow-500 border-2 border-vs-bg animate-ping" />
        <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-yellow-500 border-2 border-vs-bg" />
      </div>

      {/* Phase text */}
      <div className="text-center space-y-1">
        <p className="text-sm text-white font-medium">
          {THINKING_PHASES[phaseIndex]}{dots}
        </p>
        <p className="text-[10px] text-vs-muted font-mono">
          Lead agent đang xử lý — vui lòng chờ
        </p>
      </div>

      {/* Recent activity feed */}
      {recentLogs.length > 0 && (
        <div className="w-full max-w-md mt-4 space-y-1">
          <p className="text-[10px] text-vs-muted font-mono uppercase tracking-wider px-1">
            Activity
          </p>
          {recentLogs.map((entry, i) => (
            <div
              key={i}
              className="flex items-start gap-2 px-3 py-1.5 rounded bg-vs-panel/50 border border-vs-border/50"
            >
              <span className={`shrink-0 w-1.5 h-1.5 rounded-full mt-1.5 ${
                entry.log_type === 'error' ? 'bg-red-400' :
                entry.log_type === 'tool' ? 'bg-yellow-400' :
                'bg-vs-accent'
              }`} />
              <div className="min-w-0">
                <span className="text-[10px] text-vs-muted font-mono">[{entry.agent}] </span>
                <span className="text-xs text-vs-text break-all">
                  {entry.message?.length > 120 ? entry.message.slice(0, 120) + '...' : entry.message}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Progress bar */}
      <div className="w-48 h-0.5 bg-vs-border rounded-full overflow-hidden mt-2">
        <div className="h-full bg-vs-accent rounded-full animate-progress-slide" />
      </div>
    </div>
  )
}
