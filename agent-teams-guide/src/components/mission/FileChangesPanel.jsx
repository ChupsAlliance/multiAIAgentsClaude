import { useState, useMemo, memo } from 'react'
import {
  FileText, FilePlus, FileEdit, ChevronRight, ChevronDown,
  X, Copy, Check, Clock, Hash
} from 'lucide-react'

const actionIcon = {
  created:  <FilePlus size={12} className="text-vs-green" />,
  modified: <FileEdit size={12} className="text-vs-accent" />,
  deleted:  <FileText size={12} className="text-vs-red" />,
}
const actionIconSm = {
  created:  <FilePlus size={9} className="text-vs-green" />,
  modified: <FileEdit size={9} className="text-vs-accent" />,
  deleted:  <FileText size={9} className="text-vs-red" />,
}

function fileName(path) {
  return (path || '').split(/[/\\]/).pop() || path
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('vi-VN', { hour12: false })
}

// ─── DiffViewer — renders diff for a single snapshot ───
function DiffViewer({ fc, compact = false }) {
  const [copied, setCopied] = useState(false)
  const isNew = fc.action === 'created'
  const isEdit = !!fc.diff_old || !!fc.diff_new

  const handleCopy = async (text) => {
    await navigator.clipboard.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const maxH = compact ? 'max-h-[30vh]' : 'max-h-[50vh]'

  // Edit diff: old → new
  if (isEdit && fc.diff_old != null && fc.diff_new != null) {
    const oldLines = (fc.diff_old || '').split('\n')
    const newLines = (fc.diff_new || '').split('\n')

    return (
      <div className="border border-vs-border rounded-md overflow-hidden bg-[#0d1117] animate-fade-in">
        {!compact && (
          <div className="flex items-center justify-between px-3 py-1.5 bg-vs-panel border-b border-vs-border">
            <div className="flex items-center gap-2">
              <FileEdit size={11} className="text-vs-accent" />
              <span className="text-[11px] font-mono text-vs-text truncate">{fc.path}</span>
              <span className="text-[9px] font-mono text-vs-muted">modified by {fc.agent}</span>
            </div>
            <button
              onClick={() => handleCopy(fc.diff_new || '')}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono text-vs-muted hover:text-white hover:bg-white/10 transition-colors"
            >
              {copied ? <Check size={8} /> : <Copy size={8} />}
              {copied ? 'Copied!' : 'Copy new'}
            </button>
          </div>
        )}
        <div className={`overflow-auto ${maxH} p-0`}>
          <table className="w-full text-[11px] font-mono border-collapse">
            <tbody>
              {oldLines.map((line, i) => (
                <tr key={`old-${i}`} className="bg-red-500/10 hover:bg-red-500/15">
                  <td className="text-[9px] text-red-400/50 px-2 py-0 select-none text-right w-8 border-r border-red-500/20">{i + 1}</td>
                  <td className="text-[9px] text-red-400/50 px-1 py-0 select-none w-4 text-center">-</td>
                  <td className="px-2 py-0 text-red-300 whitespace-pre-wrap break-all">{line || ' '}</td>
                </tr>
              ))}
              <tr><td colSpan={3} className="h-px bg-vs-border/50"></td></tr>
              {newLines.map((line, i) => (
                <tr key={`new-${i}`} className="bg-green-500/10 hover:bg-green-500/15">
                  <td className="text-[9px] text-green-400/50 px-2 py-0 select-none text-right w-8 border-r border-green-500/20">{i + 1}</td>
                  <td className="text-[9px] text-green-400/50 px-1 py-0 select-none w-4 text-center">+</td>
                  <td className="px-2 py-0 text-green-300 whitespace-pre-wrap break-all">{line || ' '}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-3 px-3 py-1 bg-vs-panel border-t border-vs-border text-[9px] font-mono text-vs-muted">
          <span className="text-red-400">-{oldLines.length} lines</span>
          <span className="text-green-400">+{newLines.length} lines</span>
          {(fc.diff_old || '').endsWith('\u2026') && <span className="text-yellow-400">truncated</span>}
        </div>
      </div>
    )
  }

  // New file: content preview
  if (isNew && fc.content_preview) {
    const lines = fc.content_preview.split('\n')
    return (
      <div className="border border-vs-border rounded-md overflow-hidden bg-[#0d1117] animate-fade-in">
        {!compact && (
          <div className="flex items-center justify-between px-3 py-1.5 bg-vs-panel border-b border-vs-border">
            <div className="flex items-center gap-2">
              <FilePlus size={11} className="text-vs-green" />
              <span className="text-[11px] font-mono text-vs-text truncate">{fc.path}</span>
              <span className="text-[9px] font-mono text-vs-green">+{fc.lines || lines.length} lines</span>
              <span className="text-[9px] font-mono text-vs-muted">by {fc.agent}</span>
            </div>
            <button
              onClick={() => handleCopy(fc.content_preview)}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono text-vs-muted hover:text-white hover:bg-white/10 transition-colors"
            >
              {copied ? <Check size={8} /> : <Copy size={8} />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        )}
        <div className={`overflow-auto ${maxH} p-0`}>
          <table className="w-full text-[11px] font-mono border-collapse">
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className="bg-green-500/5 hover:bg-green-500/10">
                  <td className="text-[9px] text-green-400/40 px-2 py-0 select-none text-right w-8 border-r border-green-500/15">{i + 1}</td>
                  <td className="text-[9px] text-green-400/40 px-1 py-0 select-none w-4 text-center">+</td>
                  <td className="px-2 py-0 text-vs-text whitespace-pre-wrap break-all">{line || ' '}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-3 px-3 py-1 bg-vs-panel border-t border-vs-border text-[9px] font-mono text-vs-muted">
          <span className="text-green-400">+{fc.lines || lines.length} lines (new file)</span>
          {fc.content_preview.endsWith('\u2026') && <span className="text-yellow-400">truncated</span>}
        </div>
      </div>
    )
  }

  // Fallback: no diff
  return (
    <div className="border border-vs-border rounded-md overflow-hidden bg-[#0d1117] animate-fade-in">
      <div className="px-4 py-4 text-center">
        <p className="text-[10px] text-vs-muted font-mono">
          {fc.lines ? `${fc.lines} lines changed` : 'Diff data not available'}
        </p>
      </div>
    </div>
  )
}

// ─── hasDiffData — check if a snapshot has viewable diff ───
function hasDiffData(fc) {
  return fc.content_preview || fc.diff_old != null || fc.diff_new != null
}

// ─── FileExpandedView — shows timeline + selected diff ───
function FileExpandedView({ fc, onClose }) {
  const history = fc.history || []
  // Default: show latest (top-level fc is latest)
  const [selectedIdx, setSelectedIdx] = useState(-1) // -1 = latest (top-level)

  const currentDiff = selectedIdx === -1 ? fc : (history[selectedIdx] || fc)
  const hasMultiple = history.length > 1

  return (
    <div className="ml-5 mb-2 animate-fade-in">
      {/* Full path */}
      <p className="text-[9px] font-mono text-vs-muted/60 truncate px-2 mb-1.5">{fc.path}</p>

      {/* Timeline selector — only show if multiple edits */}
      {hasMultiple && (
        <div className="mb-2 px-1">
          <div className="flex items-center gap-1 mb-1.5">
            <Clock size={9} className="text-vs-muted" />
            <span className="text-[9px] font-mono text-vs-muted">
              {history.length} edits
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {/* Latest (aggregate) button */}
            <button
              onClick={() => setSelectedIdx(-1)}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono transition-colors ${
                selectedIdx === -1
                  ? 'bg-vs-accent/20 border border-vs-accent text-vs-accent'
                  : 'bg-vs-panel/50 border border-vs-border text-vs-muted hover:border-vs-accent/40 hover:text-white'
              }`}
            >
              <Hash size={7} />
              Latest
            </button>
            {/* Individual edit buttons */}
            {history.map((h, idx) => {
              const hasDiff = hasDiffData(h)
              return (
                <button
                  key={idx}
                  onClick={() => hasDiff && setSelectedIdx(idx)}
                  disabled={!hasDiff}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono transition-colors ${
                    selectedIdx === idx
                      ? 'bg-vs-accent/20 border border-vs-accent text-vs-accent'
                      : hasDiff
                        ? 'bg-vs-panel/50 border border-vs-border text-vs-muted hover:border-vs-accent/40 hover:text-white'
                        : 'bg-vs-panel/20 border border-vs-border/30 text-vs-muted/30 cursor-not-allowed'
                  }`}
                  title={`${h.action} by ${h.agent} at ${formatTime(h.timestamp)}${!hasDiff ? ' (no diff data)' : ''}`}
                >
                  {actionIconSm[h.action] || actionIconSm.modified}
                  #{idx + 1}
                  <span className="text-[8px] text-vs-muted/60">{formatTime(h.timestamp)}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Diff viewer — show header only when NOT in multi-edit mode (DiffViewer handles its own) */}
      <DiffViewer fc={{ ...currentDiff, path: fc.path }} compact={hasMultiple} />

      {/* Close button */}
      <div className="flex justify-end mt-1 px-1">
        <button
          onClick={onClose}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-mono text-vs-muted hover:text-white hover:bg-white/10 transition-colors"
        >
          <X size={8} /> Close
        </button>
      </div>
    </div>
  )
}

// ─── Main Panel ───
export const FileChangesPanel = memo(function FileChangesPanel({ changes = [] }) {
  const [expandedPath, setExpandedPath] = useState(null)

  // Sort: most recently changed first
  const sorted = useMemo(() => {
    return [...changes].sort((a, b) => {
      const tA = new Date(a.timestamp).getTime() || 0
      const tB = new Date(b.timestamp).getTime() || 0
      return tB - tA
    })
  }, [changes])

  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-widest text-vs-muted font-mono px-1">
        Files ({changes.length})
      </p>
      {changes.length === 0 ? (
        <p className="text-xs text-vs-muted font-mono text-center py-4">
          No file changes yet.
        </p>
      ) : (
        <div className="overflow-y-auto space-y-0.5 scrollbar-thin" style={{ maxHeight: 'calc(100vh - 300px)' }}>
          {sorted.map((fc) => {
            const isExpanded = expandedPath === fc.path
            const clickable = hasDiffData(fc) || (fc.history && fc.history.some(hasDiffData))
            const editCount = fc.history ? fc.history.length : 1

            return (
              <div key={fc.path}>
                {/* File row */}
                <div
                  onClick={() => {
                    if (clickable) setExpandedPath(isExpanded ? null : fc.path)
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
                  {editCount > 1 && (
                    <span className="shrink-0 text-[8px] font-mono px-1 py-0.5 rounded bg-vs-accent/15 text-vs-accent"
                          title={`${editCount} edits on this file`}>
                      {editCount}x
                    </span>
                  )}
                  {fc.lines > 0 && (
                    <span className={`shrink-0 text-[9px] ${fc.action === 'created' ? 'text-vs-green' : 'text-vs-accent'}`}>
                      +{fc.lines}
                    </span>
                  )}
                  <span className="text-vs-muted shrink-0 text-[10px] w-12 text-right">{fc.agent}</span>
                  <span className="text-vs-muted shrink-0 text-[10px]">
                    {formatTime(fc.timestamp)}
                  </span>
                </div>

                {/* Expanded: timeline + diff viewer */}
                {isExpanded && (
                  <FileExpandedView fc={fc} onClose={() => setExpandedPath(null)} />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})
