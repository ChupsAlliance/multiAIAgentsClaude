import { useState, useMemo, memo } from 'react'
import { FileText, FilePlus, FileEdit, ChevronRight, ChevronDown, X, Copy, Check } from 'lucide-react'

const actionIcon = {
  created:  <FilePlus size={12} className="text-vs-green" />,
  modified: <FileEdit size={12} className="text-vs-accent" />,
  deleted:  <FileText size={12} className="text-vs-red" />,
}

function fileName(path) {
  return (path || '').split(/[/\\]/).pop() || path
}

function DiffViewer({ fc, onClose }) {
  const [copied, setCopied] = useState(false)
  const isNew = fc.action === 'created'
  const isEdit = !!fc.diff_old || !!fc.diff_new

  const handleCopy = async (text) => {
    await navigator.clipboard.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // For Edit: show old vs new side-by-side style
  if (isEdit && fc.diff_old != null && fc.diff_new != null) {
    const oldLines = (fc.diff_old || '').split('\n')
    const newLines = (fc.diff_new || '').split('\n')

    return (
      <div className="border border-vs-border rounded-md overflow-hidden bg-[#0d1117] animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-vs-panel border-b border-vs-border">
          <div className="flex items-center gap-2">
            <FileEdit size={11} className="text-vs-accent" />
            <span className="text-[11px] font-mono text-vs-text truncate">{fc.path}</span>
            <span className="text-[9px] font-mono text-vs-muted">modified by {fc.agent}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => handleCopy(fc.diff_new || '')}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono text-vs-muted hover:text-white hover:bg-white/10 transition-colors"
            >
              {copied ? <Check size={8} /> : <Copy size={8} />}
              {copied ? 'Copied!' : 'Copy new'}
            </button>
            <button onClick={onClose} className="p-0.5 text-vs-muted hover:text-white transition-colors">
              <X size={12} />
            </button>
          </div>
        </div>

        {/* Diff content — unified style */}
        <div className="overflow-auto max-h-[50vh] p-0">
          <table className="w-full text-[11px] font-mono border-collapse">
            <tbody>
              {/* Removed lines (old) */}
              {oldLines.map((line, i) => (
                <tr key={`old-${i}`} className="bg-red-500/10 hover:bg-red-500/15">
                  <td className="text-[9px] text-red-400/50 px-2 py-0 select-none text-right w-8 border-r border-red-500/20">
                    {i + 1}
                  </td>
                  <td className="text-[9px] text-red-400/50 px-1 py-0 select-none w-4 text-center">−</td>
                  <td className="px-2 py-0 text-red-300 whitespace-pre-wrap break-all">{line || ' '}</td>
                </tr>
              ))}
              {/* Separator */}
              <tr>
                <td colSpan={3} className="h-px bg-vs-border/50"></td>
              </tr>
              {/* Added lines (new) */}
              {newLines.map((line, i) => (
                <tr key={`new-${i}`} className="bg-green-500/10 hover:bg-green-500/15">
                  <td className="text-[9px] text-green-400/50 px-2 py-0 select-none text-right w-8 border-r border-green-500/20">
                    {i + 1}
                  </td>
                  <td className="text-[9px] text-green-400/50 px-1 py-0 select-none w-4 text-center">+</td>
                  <td className="px-2 py-0 text-green-300 whitespace-pre-wrap break-all">{line || ' '}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer stats */}
        <div className="flex items-center gap-3 px-3 py-1 bg-vs-panel border-t border-vs-border text-[9px] font-mono text-vs-muted">
          <span className="text-red-400">−{oldLines.length} lines</span>
          <span className="text-green-400">+{newLines.length} lines</span>
          {(fc.diff_old || '').endsWith('…') && <span className="text-yellow-400">truncated</span>}
        </div>
      </div>
    )
  }

  // For Write (new file): show content preview
  if (isNew && fc.content_preview) {
    const lines = fc.content_preview.split('\n')
    return (
      <div className="border border-vs-border rounded-md overflow-hidden bg-[#0d1117] animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-vs-panel border-b border-vs-border">
          <div className="flex items-center gap-2">
            <FilePlus size={11} className="text-vs-green" />
            <span className="text-[11px] font-mono text-vs-text truncate">{fc.path}</span>
            <span className="text-[9px] font-mono text-vs-green">+{fc.lines || lines.length} lines</span>
            <span className="text-[9px] font-mono text-vs-muted">by {fc.agent}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => handleCopy(fc.content_preview)}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono text-vs-muted hover:text-white hover:bg-white/10 transition-colors"
            >
              {copied ? <Check size={8} /> : <Copy size={8} />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button onClick={onClose} className="p-0.5 text-vs-muted hover:text-white transition-colors">
              <X size={12} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="overflow-auto max-h-[50vh] p-0">
          <table className="w-full text-[11px] font-mono border-collapse">
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className="bg-green-500/5 hover:bg-green-500/10">
                  <td className="text-[9px] text-green-400/40 px-2 py-0 select-none text-right w-8 border-r border-green-500/15">
                    {i + 1}
                  </td>
                  <td className="text-[9px] text-green-400/40 px-1 py-0 select-none w-4 text-center">+</td>
                  <td className="px-2 py-0 text-vs-text whitespace-pre-wrap break-all">{line || ' '}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-3 py-1 bg-vs-panel border-t border-vs-border text-[9px] font-mono text-vs-muted">
          <span className="text-green-400">+{fc.lines || lines.length} lines (new file)</span>
          {fc.content_preview.endsWith('…') && <span className="text-yellow-400">truncated — showing first ~2000 chars</span>}
        </div>
      </div>
    )
  }

  // Fallback: no diff data available
  return (
    <div className="border border-vs-border rounded-md overflow-hidden bg-[#0d1117] animate-fade-in">
      <div className="flex items-center justify-between px-3 py-1.5 bg-vs-panel border-b border-vs-border">
        <div className="flex items-center gap-2">
          {actionIcon[fc.action] || actionIcon.modified}
          <span className="text-[11px] font-mono text-vs-text truncate">{fc.path}</span>
        </div>
        <button onClick={onClose} className="p-0.5 text-vs-muted hover:text-white transition-colors">
          <X size={12} />
        </button>
      </div>
      <div className="px-4 py-6 text-center">
        <p className="text-xs text-vs-muted font-mono">Diff data not available for this change.</p>
        <p className="text-[10px] text-vs-muted/60 mt-1">
          {fc.lines ? `${fc.lines} lines changed` : 'Detected via filesystem watcher'}
        </p>
      </div>
    </div>
  )
}

export const FileChangesPanel = memo(function FileChangesPanel({ changes = [] }) {
  const [expandedIdx, setExpandedIdx] = useState(null)

  const hasDiff = (fc) => fc.content_preview || fc.diff_old != null || fc.diff_new != null

  // Only show last 100 changes
  const visible = useMemo(() => changes.slice(-100), [changes])

  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-widest text-vs-muted font-mono px-1">
        Files ({changes.length})
      </p>
      {changes.length === 0 ? (
        <p className="text-xs text-vs-muted font-mono text-center py-4">
          Chưa có file thay đổi.
        </p>
      ) : (
        <div className="overflow-y-auto space-y-0.5 scrollbar-thin" style={{ maxHeight: 'calc(100vh - 300px)' }}>
          {visible.map((fc, i) => {
            const isExpanded = expandedIdx === i
            const clickable = hasDiff(fc)

            return (
              <div key={i}>
                {/* File row */}
                <div
                  onClick={() => {
                    if (clickable) setExpandedIdx(isExpanded ? null : i)
                  }}
                  className={`flex items-center gap-2 px-2 py-1.5 text-[11px] font-mono rounded transition-colors
                    ${clickable ? 'cursor-pointer hover:bg-white/5' : ''}
                    ${isExpanded ? 'bg-white/5 border-l-2 border-vs-accent' : ''}`}
                >
                  {/* Expand indicator */}
                  <span className="w-3 shrink-0 text-vs-muted">
                    {clickable ? (
                      isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />
                    ) : (
                      <span className="text-[8px] opacity-30">·</span>
                    )}
                  </span>
                  {actionIcon[fc.action] || actionIcon.modified}
                  <span className={`flex-1 min-w-0 truncate ${isExpanded ? 'text-white' : 'text-vs-text'}`}>
                    {fileName(fc.path)}
                  </span>
                  {fc.lines > 0 && (
                    <span className={`shrink-0 text-[9px] ${fc.action === 'created' ? 'text-vs-green' : 'text-vs-accent'}`}>
                      +{fc.lines}
                    </span>
                  )}
                  <span className="text-vs-muted shrink-0 text-[10px] w-12 text-right">{fc.agent}</span>
                  <span className="text-vs-muted shrink-0 text-[10px]">
                    {new Date(fc.timestamp).toLocaleTimeString('vi-VN', { hour12: false })}
                  </span>
                </div>

                {/* Expanded: full path */}
                {isExpanded && (
                  <div className="ml-5 mb-1">
                    <p className="text-[9px] font-mono text-vs-muted/60 truncate px-2 mb-1">{fc.path}</p>
                    <DiffViewer fc={fc} onClose={() => setExpandedIdx(null)} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})
