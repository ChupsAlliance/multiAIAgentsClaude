import { useState, useEffect, useCallback } from 'react'
import { Clock, ChevronLeft, RotateCcw } from 'lucide-react'
import { diffPlanChanges } from '../../utils/planMarkdown'

export function PlanVersionHistory({ missionId, currentAgents, currentTasks, onRollback }) {
  const [versions, setVersions] = useState([])
  const [selectedVersion, setSelectedVersion] = useState(null)
  const [showDiff, setShowDiff] = useState(false)
  const [confirmRollback, setConfirmRollback] = useState(null) // version to rollback to
  const [loading, setLoading] = useState(false)

  const loadVersions = useCallback(async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('get_plan_versions', { missionId })
      setVersions(result || [])
    } catch (err) {
      console.error('Failed to load plan versions:', err)
      setVersions([])
    }
  }, [missionId])

  useEffect(() => { loadVersions() }, [loadVersions])

  const handleViewDiff = (version) => {
    setSelectedVersion(version)
    setShowDiff(true)
  }

  const handleRollbackConfirm = async () => {
    if (!confirmRollback) return
    setLoading(true)
    try {
      await window.electron.ipcRenderer.invoke('save_plan_version', {
        missionId,
        trigger: 'rollback',
        agents: confirmRollback.agents,
        tasks: confirmRollback.tasks,
      })
      onRollback(confirmRollback.agents, confirmRollback.tasks)
      setConfirmRollback(null)
      await loadVersions()
    } catch (err) {
      console.error('Rollback failed:', err)
    } finally {
      setLoading(false)
    }
  }

  // Diff selected version vs current state
  const diff = selectedVersion
    ? diffPlanChanges(
        { agents: selectedVersion.agents, tasks: selectedVersion.tasks },
        { agents: currentAgents, tasks: currentTasks }
      )
    : null

  if (showDiff && selectedVersion) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-vs-border">
          <button onClick={() => setShowDiff(false)} className="text-vs-muted hover:text-vs-text">
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs font-mono text-vs-text">{selectedVersion.label}</span>
        </div>

        {/* Summary */}
        <div className="px-3 py-2 border-b border-vs-border">
          <span className="text-[10px] font-mono text-vs-muted">{diff?.summary || 'Không có thay đổi'}</span>
        </div>

        {/* Diff list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {diff?.addedAgents?.map(a => (
            <div key={a.name} className="px-2 py-1 rounded bg-green-500/10 border border-green-500/30 text-xs font-mono text-green-400">
              + Agent: {a.name}
            </div>
          ))}
          {diff?.removedAgents?.map(a => (
            <div key={a.name} className="px-2 py-1 rounded bg-red-500/10 border border-red-500/30 text-xs font-mono text-red-400">
              - Agent: {a.name}
            </div>
          ))}
          {diff?.modifiedAgents?.map(a => (
            <div key={a.name} className="px-2 py-1 rounded bg-yellow-500/10 border border-yellow-500/30 text-xs font-mono text-yellow-400">
              ~ Agent: {a.name}
            </div>
          ))}
          {diff?.addedTasks?.map(t => (
            <div key={t.id} className="px-2 py-1 rounded bg-green-500/10 border border-green-500/30 text-xs font-mono text-green-400">
              + Task: {t.title}
            </div>
          ))}
          {diff?.removedTasks?.map((t, i) => (
            <div key={t.title || t.id || i} className="px-2 py-1 rounded bg-red-500/10 border border-red-500/30 text-xs font-mono text-red-400">
              - Task: {t.title}
            </div>
          ))}
          {diff?.modifiedTasks?.map(t => (
            <div key={t.id} className="px-2 py-1 rounded bg-yellow-500/10 border border-yellow-500/30 text-xs font-mono text-yellow-400">
              ~ Task: {t.title}
            </div>
          ))}
          {!diff?.hasChanges && (
            <p className="text-[10px] text-vs-muted font-mono text-center py-4">Không có sự khác biệt</p>
          )}
        </div>
      </div>
    )
  }

  if (confirmRollback) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-vs-border">
          <button onClick={() => setConfirmRollback(null)} className="text-vs-muted hover:text-vs-text">
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs font-mono text-vs-text">Xác nhận khôi phục</span>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs font-mono text-vs-text">
            Khôi phục về <span className="text-amber-300">{confirmRollback.label}</span>?
            Thao tác này sẽ tạo version mới.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleRollbackConfirm}
              disabled={loading}
              className="px-3 py-1.5 text-xs font-mono bg-vs-accent text-white rounded hover:bg-vs-accent/80 disabled:opacity-50"
            >
              {loading ? 'Đang khôi phục...' : 'Khôi phục'}
            </button>
            <button
              onClick={() => setConfirmRollback(null)}
              className="px-3 py-1.5 text-xs font-mono border border-vs-border text-vs-muted rounded hover:text-vs-text"
            >
              Hủy
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-vs-border">
        <Clock size={12} className="text-vs-muted" />
        <span className="text-xs font-mono text-vs-text font-semibold">Lịch sử Plan</span>
        <span className="text-[10px] font-mono text-vs-muted ml-auto">{versions.length} version</span>
      </div>

      {versions.length === 0 ? (
        <p className="text-[10px] text-vs-muted font-mono text-center py-6">Chưa có lịch sử</p>
      ) : (
        <div className="flex-1 overflow-y-auto divide-y divide-vs-border/30">
          {versions.map((v, i) => (
            <div key={v.version} className="px-3 py-2.5 hover:bg-vs-surface/50">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className={`text-xs font-mono ${i === 0 ? 'text-vs-accent' : 'text-vs-text'}`}>
                    {v.label}
                  </span>
                  {i === 0 && (
                    <span className="ml-2 text-[9px] font-mono text-vs-accent border border-vs-accent/40 rounded px-1">
                      hiện tại
                    </span>
                  )}
                  <p className="text-[10px] text-vs-muted font-mono mt-0.5">
                    {new Date(v.timestamp).toLocaleString('vi-VN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      day: '2-digit',
                      month: '2-digit',
                    })}
                  </p>
                </div>
                {i !== 0 && (
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => handleViewDiff(v)}
                      className="text-[10px] font-mono text-vs-muted hover:text-vs-text border border-vs-border rounded px-1.5 py-0.5"
                    >
                      Diff
                    </button>
                    <button
                      onClick={() => setConfirmRollback(v)}
                      className="text-[10px] font-mono text-vs-muted hover:text-amber-300 border border-vs-border rounded px-1.5 py-0.5"
                      title="Khôi phục về version này"
                    >
                      <RotateCcw size={9} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
