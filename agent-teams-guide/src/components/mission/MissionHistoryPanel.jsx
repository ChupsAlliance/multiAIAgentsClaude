import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Clock, ChevronDown, ChevronRight, CheckCircle2, XCircle, StopCircle, Folder, Users, ListTodo, RefreshCw, Eye } from 'lucide-react'

function timeAgo(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60000)  return 'vừa xong'
  if (diff < 3600000) return `${Math.floor(diff/60000)}p trước`
  if (diff < 86400000) return `${Math.floor(diff/3600000)}h trước`
  return new Date(ts).toLocaleDateString('vi-VN')
}

function formatDuration(startMs, endMs) {
  if (!startMs || !endMs) return ''
  const secs = Math.floor((endMs - startMs) / 1000)
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function StatusIcon({ status }) {
  if (status === 'completed') return <CheckCircle2 size={12} className="text-vs-green shrink-0" />
  if (status === 'failed')    return <XCircle size={12} className="text-vs-red shrink-0" />
  if (status === 'stopped')   return <StopCircle size={12} className="text-yellow-400 shrink-0" />
  return <Clock size={12} className="text-vs-muted shrink-0" />
}

function HistoryItem({ item, onViewDetail, onReplay }) {
  const [expanded, setExpanded] = useState(false)
  const isMission = !!item.description

  return (
    <div className="border border-vs-border rounded-md overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors text-left"
      >
        <StatusIcon status={item.status} />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-vs-text truncate font-medium">
            {item.description || item.template || 'Mission'}
          </p>
          <p className="text-[10px] text-vs-muted font-mono truncate">
            {(item.project_path || '').split(/[/\\]/).pop() || item.project_path}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {item.ended_at && item.started_at && (
            <span className="text-[10px] font-mono text-vs-muted">
              {formatDuration(item.started_at, item.ended_at)}
            </span>
          )}
          <span className="text-[10px] text-vs-muted">{timeAgo(item.ended_at || item.ts)}</span>
          {expanded ? <ChevronDown size={10} className="text-vs-muted" /> : <ChevronRight size={10} className="text-vs-muted" />}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-vs-border bg-black/20 space-y-2">
          {/* Project path */}
          {item.project_path && (
            <div className="flex items-center gap-1.5 pt-2">
              <Folder size={10} className="text-vs-muted" />
              <span className="text-[10px] font-mono text-vs-muted truncate">{item.project_path}</span>
            </div>
          )}

          {/* Mission stats */}
          {isMission && (
            <div className="flex items-center gap-3">
              {item.agent_count > 0 && (
                <span className="flex items-center gap-1 text-[10px] text-vs-muted">
                  <Users size={9} />
                  {item.agent_count} agents
                </span>
              )}
              {item.log_count > 0 && (
                <span className="text-[10px] text-vs-muted">{item.log_count} log entries</span>
              )}
            </div>
          )}

          {/* Task summary */}
          {item.task_summary?.length > 0 && (
            <div className="space-y-0.5">
              <p className="text-[9px] font-mono text-vs-muted uppercase tracking-wider flex items-center gap-1">
                <ListTodo size={9} />Tasks
              </p>
              <div className="max-h-24 overflow-y-auto space-y-0.5 scrollbar-thin">
                {item.task_summary.slice(0, 10).map((t, i) => (
                  <p key={i} className="text-[10px] font-mono text-vs-muted truncate">{t}</p>
                ))}
                {item.task_summary.length > 10 && (
                  <p className="text-[10px] text-vs-muted">+{item.task_summary.length - 10} more...</p>
                )}
              </div>
            </div>
          )}

          {/* File changes */}
          {item.file_changes?.length > 0 && (
            <div className="space-y-0.5">
              <p className="text-[9px] font-mono text-vs-muted uppercase tracking-wider">Files changed</p>
              <div className="max-h-20 overflow-y-auto space-y-0.5 scrollbar-thin">
                {item.file_changes.slice(0, 8).map((f, i) => (
                  <p key={i} className="text-[10px] font-mono text-vs-muted truncate">
                    <span className="text-vs-green">+</span> {f.path?.split(/[/\\]/).pop() || f.path}
                  </p>
                ))}
                {item.file_changes.length > 8 && (
                  <p className="text-[10px] text-vs-muted">+{item.file_changes.length - 8} more...</p>
                )}
              </div>
            </div>
          )}

          {/* Action buttons */}
          {isMission && (onViewDetail || onReplay) && (
            <div className="flex items-center gap-4 mt-1 pt-2 border-t border-vs-border/50">
              {onViewDetail && (
                <button
                  onClick={(e) => { e.stopPropagation(); onViewDetail(item) }}
                  className="flex items-center gap-1.5 text-[10px] font-mono text-vs-accent hover:text-white transition-colors"
                >
                  <Eye size={9} />
                  Xem chi tiết
                </button>
              )}
              {onReplay && (
                <button
                  onClick={(e) => { e.stopPropagation(); onReplay(item) }}
                  className="flex items-center gap-1.5 text-[10px] font-mono text-vs-muted hover:text-vs-accent transition-colors"
                >
                  <RefreshCw size={9} />
                  Continue mission
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function MissionHistoryPanel({ onViewHistory, onContinueFromHistory }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [collapsed, setCollapsed] = useState(true)
  const [showAll, setShowAll] = useState(false)

  const loadHistory = async () => {
    setLoading(true)
    try {
      const h = await invoke('get_mission_history')
      setHistory(h || [])
    } catch {
      // no history yet
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadHistory()
  }, [])

  const missionHistory = history.filter(h => h.description !== undefined || h.ended_at !== undefined)

  if (missionHistory.length === 0 && !loading) return null

  return (
    <div className="border-t border-vs-border">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-1.5 hover:bg-white/5 transition-colors"
      >
        <span className="flex items-center gap-1.5 text-[10px] font-mono text-vs-muted uppercase tracking-wider">
          <Clock size={10} />
          Mission History {missionHistory.length > 0 && `(${missionHistory.length})`}
        </span>
        {collapsed ? <ChevronRight size={12} className="text-vs-muted" /> : <ChevronDown size={12} className="text-vs-muted" />}
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 max-h-64 overflow-y-auto scrollbar-thin space-y-1.5">
          {loading ? (
            <div className="py-4 text-center text-[10px] text-vs-muted">Loading...</div>
          ) : (
            <>
              {(showAll ? missionHistory : missionHistory.slice(0, 5)).map((item, i) => (
                <HistoryItem
                  key={item.id || i}
                  item={item}
                  onViewDetail={onViewHistory}
                  onReplay={onContinueFromHistory}
                />
              ))}
              {missionHistory.length > 5 && (
                <button
                  onClick={() => setShowAll(!showAll)}
                  className="w-full text-center text-[10px] font-mono text-vs-accent hover:text-white transition-colors py-1.5"
                >
                  {showAll ? 'Thu gọn' : `Xem tất cả (${missionHistory.length})`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
