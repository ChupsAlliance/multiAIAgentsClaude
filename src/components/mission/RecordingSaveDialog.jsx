import { useState, useEffect, useRef } from 'react'
import { Circle, Save, X } from 'lucide-react'

/**
 * Modal hỏi tên bản ghi khi mission hoàn thành và đang bật Record.
 * props:
 *  - open: boolean
 *  - defaultName: string (mặc định = mission description)
 *  - onSave(name): Promise|void — gọi stopRecordingAndSave
 *  - onDiscard(): Promise|void — gọi discardRecording
 */
export function RecordingSaveDialog({ open, defaultName, onSave, onDiscard }) {
  const [name, setName] = useState(defaultName || '')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (open) {
      setName(defaultName || '')
      setSaving(false)
      // Focus + select all so user can quickly retype
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 50)
    }
  }, [open, defaultName])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onDiscard?.()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onDiscard])

  if (!open) return null

  const handleSave = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      await onSave?.(trimmed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-testid="dialog-save-recording" className="fixed inset-0 z-[9998] flex items-center justify-center bg-[#00000099] backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-xl border border-vs-border bg-vs-panel shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-vs-border bg-vs-red/5">
          <div className="w-8 h-8 rounded-full bg-vs-red/15 flex items-center justify-center shrink-0">
            <Circle size={14} className="text-vs-red" fill="currentColor" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-vs-heading">Lưu bản ghi phiên chạy</h2>
            <p className="text-[11px] text-vs-muted">Mission đã hoàn thành — đặt tên cho bản ghi này</p>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-2">
          <label className="text-xs font-mono text-vs-muted uppercase tracking-wider">
            Tên bản ghi
          </label>
          <input
            ref={inputRef}
            type="text"
            data-testid="input-recording-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
            disabled={saving}
            placeholder="Ví dụ: Demo tính năng đăng nhập"
            className="w-full bg-vs-bg border border-vs-border rounded-lg px-3 py-2.5
                       text-sm text-vs-text placeholder-vs-muted/50
                       focus:outline-none focus:border-vs-accent/60 focus:ring-1 focus:ring-vs-accent/30
                       transition-colors disabled:opacity-60"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-vs-border bg-vs-bg/40">
          <button
            onClick={onDiscard}
            disabled={saving}
            data-testid="btn-discard-recording"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-mono
                       text-vs-muted hover:text-vs-red hover:bg-vs-red/10 transition-colors disabled:opacity-50"
          >
            <X size={13} />
            Huỷ bản ghi
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            data-testid="btn-save-recording"
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold transition-colors ${
              !name.trim() || saving
                ? 'bg-vs-panel text-vs-muted cursor-not-allowed border border-vs-border'
                : 'bg-vs-accent text-vs-heading hover:bg-vs-accent/80 shadow-lg shadow-vs-accent/20'
            }`}
          >
            {saving ? (
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Save size={13} />
            )}
            {saving ? 'Đang lưu...' : 'Lưu bản ghi'}
          </button>
        </div>
      </div>
    </div>
  )
}
