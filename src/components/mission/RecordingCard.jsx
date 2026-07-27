import { useState, useRef, useEffect } from 'react'
import { Play, Presentation, Trash2, Clock, Calendar, Rocket, Check, X, Pencil } from 'lucide-react'

function formatDate(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleString('vi-VN', { hour12: false, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return '0:00'
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Card hiển thị 1 bản ghi trong RecordingsPage.
 * props: { recording, onPlayOnRealUI, onPresent, onDelete, onRename }
 * recording: { id, name, created_at, duration_ms, mission_description, project_path }
 */
export function RecordingCard({ recording, onPlayOnRealUI, onPresent, onDelete, onRename }) {
  const [editing, setEditing] = useState(false)
  const [nameInput, setNameInput] = useState(recording.name || '')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    setNameInput(recording.name || '')
  }, [recording.name])

  useEffect(() => {
    if (editing) {
      setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select() }, 30)
    }
  }, [editing])

  const commitRename = () => {
    const trimmed = nameInput.trim()
    setEditing(false)
    if (trimmed && trimmed !== recording.name) {
      onRename?.(recording.id, trimmed)
    } else {
      setNameInput(recording.name || '')
    }
  }

  return (
    <div data-testid={`recording-card-${recording.id}`} className="rounded-xl border border-vs-border bg-vs-panel overflow-hidden hover:border-vs-accent/40 transition-colors group">
      {/* Header: name (inline editable) */}
      <div className="px-4 pt-3.5 pb-2.5 border-b border-vs-border/60">
        {editing ? (
          <div className="flex items-center gap-1.5">
            <input
              ref={inputRef}
              type="text"
              data-testid={`input-rename-${recording.id}`}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') { setEditing(false); setNameInput(recording.name || '') }
              }}
              onBlur={commitRename}
              className="flex-1 min-w-0 bg-vs-bg border border-vs-accent/60 rounded px-2 py-1
                         text-sm font-semibold text-vs-heading focus:outline-none"
            />
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            data-testid={`btn-edit-name-${recording.id}`}
            className="flex items-center gap-1.5 text-left w-full group/name"
            title="Nhấn để đổi tên"
          >
            <h3 data-testid={`recording-name-${recording.id}`} className="text-sm font-semibold text-vs-heading truncate">{recording.name || 'Bản ghi không tên'}</h3>
            <Pencil size={11} className="text-vs-muted opacity-0 group-hover/name:opacity-100 transition-opacity shrink-0" />
          </button>
        )}
        {recording.mission_description && (
          <p className="text-[11px] text-vs-muted truncate mt-1 flex items-center gap-1.5">
            <Rocket size={10} className="shrink-0 opacity-60" />
            {recording.mission_description}
          </p>
        )}
      </div>

      {/* Meta */}
      <div className="px-4 py-2.5 flex items-center gap-3 text-[10px] font-mono text-vs-muted">
        <span className="flex items-center gap-1">
          <Calendar size={10} />
          {formatDate(recording.created_at)}
        </span>
        <span className="flex items-center gap-1">
          <Clock size={10} />
          {formatDuration(recording.duration_ms)}
        </span>
      </div>

      {/* Actions */}
      <div className="px-4 pb-3.5 pt-1 flex items-center gap-2">
        <button
          onClick={() => onPlayOnRealUI?.(recording)}
          data-testid={`btn-play-real-ui-${recording.id}`}
          className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-mono
                     bg-vs-accent/15 text-vs-accent hover:bg-vs-accent/25 transition-colors"
        >
          <Play size={11} fill="currentColor" />
          Phát trên UI thật
        </button>
        <button
          onClick={() => onPresent?.(recording)}
          data-testid={`btn-present-${recording.id}`}
          className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-mono
                     bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 transition-colors"
        >
          <Presentation size={11} />
          Trình chiếu
        </button>
        {confirmingDelete ? (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => { onDelete?.(recording.id); setConfirmingDelete(false) }}
              title="Xác nhận xoá"
              data-testid={`btn-confirm-delete-${recording.id}`}
              className="flex items-center justify-center w-7 h-7 rounded-md bg-vs-red/20 text-vs-red hover:bg-vs-red/30 transition-colors"
            >
              <Check size={12} />
            </button>
            <button
              onClick={() => setConfirmingDelete(false)}
              title="Huỷ"
              className="flex items-center justify-center w-7 h-7 rounded-md bg-vs-panel border border-vs-border text-vs-muted hover:text-vs-text transition-colors"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmingDelete(true)}
            title="Xoá bản ghi"
            data-testid={`btn-delete-${recording.id}`}
            className="flex items-center justify-center w-7 h-7 rounded-md shrink-0 text-vs-muted hover:text-vs-red hover:bg-vs-red/10 transition-colors"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  )
}
