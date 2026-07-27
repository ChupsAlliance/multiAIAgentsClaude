import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { Film, RefreshCw } from 'lucide-react'
import { Sidebar } from '../components/Sidebar'
import { RecordingCard } from '../components/mission/RecordingCard'
import { useToast } from '../hooks/useToast'

export function RecordingsPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [recordings, setRecordings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadRecordings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await invoke('list_recordings')
      setRecordings(Array.isArray(list) ? list : [])
    } catch (err) {
      setError(err?.message || String(err))
      setRecordings([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRecordings()
  }, [loadRecordings])

  const handlePlayOnRealUI = useCallback((recording) => {
    navigate(`/mission?replay=${encodeURIComponent(recording.id)}`)
  }, [navigate])

  const handlePresent = useCallback((recording) => {
    navigate(`/presentation/${encodeURIComponent(recording.id)}`)
  }, [navigate])

  const handleDelete = useCallback(async (id) => {
    const prev = recordings
    setRecordings(list => list.filter(r => r.id !== id))
    try {
      await invoke('delete_recording', { recordingId: id })
      toast.success('Đã xoá bản ghi')
    } catch (err) {
      setRecordings(prev)
      toast.error('Không thể xoá bản ghi', err?.message)
    }
  }, [recordings, toast])

  const handleRename = useCallback(async (id, name) => {
    const prev = recordings
    setRecordings(list => list.map(r => r.id === id ? { ...r, name } : r))
    try {
      await invoke('rename_recording', { recordingId: id, name })
    } catch (err) {
      setRecordings(prev)
      toast.error('Không thể đổi tên bản ghi', err?.message)
    }
  }, [recordings, toast])

  return (
    <div className="h-screen bg-vs-bg text-vs-text flex overflow-hidden">
      <Sidebar />
      <main className="flex-1 md:ml-64 flex flex-col h-screen overflow-hidden">
        {/* Title bar drag region */}
        <div className="h-8 shrink-0 drag-region" />

        <div className="flex-1 overflow-y-auto px-6 pb-8">
          {/* Header */}
          <div className="max-w-5xl mx-auto pt-4 pb-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-vs-accent/20 border border-vs-accent/40 flex items-center justify-center shrink-0">
                <Film size={18} className="text-vs-accent" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-vs-heading">Bản ghi</h1>
                <p className="text-xs text-vs-muted">Danh sách các phiên chạy mission đã ghi lại</p>
              </div>
            </div>
            <button
              onClick={loadRecordings}
              disabled={loading}
              data-testid="btn-refresh-recordings"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono
                         bg-vs-panel border border-vs-border text-vs-muted
                         hover:border-vs-accent/40 hover:text-vs-text transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Làm mới
            </button>
          </div>

          <div className="max-w-5xl mx-auto">
            {loading && recordings.length === 0 && (
              <div className="flex items-center justify-center py-24">
                <div className="w-6 h-6 border-2 border-vs-accent border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {!loading && error && (
              <div className="text-center py-16 rounded-xl border border-vs-red/30 bg-vs-red/5">
                <p className="text-sm text-vs-red font-medium mb-1">Không tải được danh sách bản ghi</p>
                <p className="text-xs text-vs-muted">{error}</p>
              </div>
            )}

            {!loading && !error && recordings.length === 0 && (
              <div data-testid="empty-state-recordings" className="text-center py-24 rounded-xl border border-dashed border-vs-border">
                <Film size={32} className="mx-auto text-vs-muted/40 mb-3" />
                <p className="text-sm font-medium text-vs-heading mb-1">Chưa có bản ghi nào</p>
                <p className="text-xs text-vs-muted max-w-sm mx-auto">
                  Bật "Ghi lại phiên chạy" khi khởi chạy mission ở Mission Control để tạo bản ghi đầu tiên.
                  Bản ghi có thể dùng để phát lại demo hoặc trình chiếu cho khách hàng.
                </p>
              </div>
            )}

            {!loading && !error && recordings.length > 0 && (
              <div data-testid="list-recordings" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {recordings.map(rec => (
                  <RecordingCard
                    key={rec.id}
                    recording={rec}
                    onPlayOnRealUI={handlePlayOnRealUI}
                    onPresent={handlePresent}
                    onDelete={handleDelete}
                    onRename={handleRename}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
