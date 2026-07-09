import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  FileText, Plus, UserPlus, Check, AlertTriangle,
  RotateCcw, ChevronRight, ChevronDown, X, Bot, ListTodo, Link2, Eye, Code2, Clock
} from 'lucide-react'
import {
  planToMarkdown, parseMissionPlan, diffPlanChanges,
  extractOutline, agentTemplate, taskTemplate,
} from '../../utils/planMarkdown'
import { useAppHotkeys } from '../../hooks/useAppHotkeys'
import { PlanVersionHistory } from './PlanVersionHistory'
import { ExportDropdown } from './ExportDropdown'

// ─── Markdown Preview Renderer ─────────────────────────────────────────────

function renderMarkdownHtml(md) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = s => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.3);padding:1px 4px;border-radius:3px;color:#569cd6">$1</code>')

  const lines = md.split('\n')
  const out = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('#### ')) { out.push(`<h4>${inline(line.slice(5))}</h4>`); i++; continue }
    if (line.startsWith('### '))  { out.push(`<h3>${inline(line.slice(4))}</h3>`);  i++; continue }
    if (line.startsWith('## '))   { out.push(`<h2>${inline(line.slice(3))}</h2>`);  i++; continue }
    if (line.startsWith('# '))    { out.push(`<h1>${inline(line.slice(2))}</h1>`);  i++; continue }
    if (line.trim() === '---')    { out.push('<hr/>'); i++; continue }

    // Table block
    if (line.startsWith('|')) {
      const rows = []
      while (i < lines.length && lines[i].startsWith('|')) { rows.push(lines[i]); i++ }
      if (rows.length >= 2) {
        const parseRow = r => r.split('|').slice(1, -1).map(c => c.trim())
        const heads = parseRow(rows[0])
        const body = rows.slice(2).map(r => parseRow(r))
        out.push(
          '<table>' +
          '<thead><tr>' + heads.map(h => `<th>${inline(h)}</th>`).join('') + '</tr></thead>' +
          '<tbody>' + body.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody>' +
          '</table>'
        )
      }
      continue
    }

    // Blockquote (consecutive lines)
    if (line.startsWith('> ')) {
      const items = []
      while (i < lines.length && lines[i].startsWith('> ')) { items.push(lines[i].slice(2)); i++ }
      out.push('<blockquote>' + items.map(inline).join('<br/>') + '</blockquote>')
      continue
    }

    // Unordered list (consecutive items)
    if (line.startsWith('- ')) {
      const items = []
      while (i < lines.length && lines[i].startsWith('- ')) { items.push(lines[i].slice(2)); i++ }
      out.push('<ul>' + items.map(t => `<li>${inline(t)}</li>`).join('') + '</ul>')
      continue
    }

    if (line.trim() === '') { i++; continue }

    out.push(`<p>${inline(line)}</p>`)
    i++
  }

  return out.join('')
}

// ─── Outline Sidebar ───────────────────────────────────────────────────────

function OutlineSidebar({ outline, onJumpTo }) {
  const [collapsed, setCollapsed] = useState({})

  const toggle = (idx) => {
    setCollapsed(prev => ({ ...prev, [idx]: !prev[idx] }))
  }

  // Group: agents with their tasks nested underneath
  const tree = useMemo(() => {
    const nodes = []
    let currentAgent = null

    for (let i = 0; i < outline.length; i++) {
      const item = outline[i]
      if (item.level === 2) {
        if (item.type === 'agent') {
          currentAgent = { ...item, idx: i, children: [] }
          nodes.push(currentAgent)
        } else {
          currentAgent = null
          nodes.push({ ...item, idx: i, children: [] })
        }
      } else if (item.level === 4 && item.type === 'task') {
        if (currentAgent) {
          currentAgent.children.push({ ...item, idx: i })
        }
      }
    }
    return nodes
  }, [outline])

  const typeIcon = (type) => {
    if (type === 'agent') return <Bot size={10} className="text-vs-accent shrink-0" />
    if (type === 'task') return <ListTodo size={9} className="text-vs-muted shrink-0" />
    return <Link2 size={10} className="text-vs-muted shrink-0" />
  }

  return (
    <div className="w-[160px] shrink-0 border-r border-vs-border overflow-y-auto scrollbar-thin bg-[#1e1e1e]">
      <div className="px-2 py-1.5 text-[9px] font-bold text-vs-muted uppercase tracking-wider border-b border-vs-border">
        Outline
      </div>
      <div className="py-1">
        {tree.map((node, i) => (
          <div key={i}>
            {/* Section/Agent header */}
            <button
              className="w-full flex items-center gap-1 px-2 py-1 text-left hover:bg-white/5 text-[10px]"
              onClick={() => {
                if (node.children?.length > 0) toggle(i)
                onJumpTo(node.line)
              }}
            >
              {node.children?.length > 0 ? (
                collapsed[i]
                  ? <ChevronRight size={9} className="text-vs-muted shrink-0" />
                  : <ChevronDown size={9} className="text-vs-muted shrink-0" />
              ) : (
                <span className="w-[9px] shrink-0" />
              )}
              {typeIcon(node.type)}
              <span className="truncate text-vs-text">{node.text}</span>
              {node.children?.length > 0 && (
                <span className="ml-auto text-[8px] text-vs-muted shrink-0">
                  {node.children.length}
                </span>
              )}
            </button>

            {/* Nested tasks */}
            {!collapsed[i] && node.children?.map((child, j) => (
              <button
                key={j}
                className="w-full flex items-center gap-1 pl-6 pr-2 py-0.5 text-left hover:bg-white/5 text-[9px]"
                onClick={() => onJumpTo(child.line)}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  child.priority === 'high' ? 'bg-red-400' :
                  child.priority === 'low' ? 'bg-green-400' : 'bg-yellow-400'
                }`} />
                <span className="truncate text-vs-muted">{child.text}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Diff Summary Modal ────────────────────────────────────────────────────

function DiffSummary({ diff, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-vs-panel border border-vs-border rounded-lg shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-vs-border">
          <h3 className="text-xs font-bold text-white flex items-center gap-2">
            <FileText size={13} className="text-vs-accent" />
            Xác nhận thay đổi
          </h3>
          <button onClick={onCancel} className="text-vs-muted hover:text-white">
            <X size={14} />
          </button>
        </div>

        {/* Changes */}
        <div className="px-4 py-3 space-y-2">
          <p className="text-[10px] text-vs-muted font-mono">{diff.summary}</p>

          {diff.addedAgents.length > 0 && (
            <div className="text-[10px]">
              <span className="text-green-400 font-bold">+ Agents mới:</span>
              <span className="text-vs-text ml-1">{diff.addedAgents.map(a => a.name).join(', ')}</span>
            </div>
          )}
          {diff.removedAgents.length > 0 && (
            <div className="text-[10px]">
              <span className="text-red-400 font-bold">- Agents xóa:</span>
              <span className="text-vs-text ml-1">{diff.removedAgents.map(a => a.name).join(', ')}</span>
            </div>
          )}
          {diff.modifiedAgents.length > 0 && (
            <div className="text-[10px]">
              <span className="text-yellow-400 font-bold">• Agents sửa:</span>
              <span className="text-vs-text ml-1">{diff.modifiedAgents.map(a => a.name).join(', ')}</span>
            </div>
          )}
          {diff.addedTasks.length > 0 && (
            <div className="text-[10px]">
              <span className="text-green-400 font-bold">+ Tasks mới:</span>
              <span className="text-vs-text ml-1">{diff.addedTasks.map(t => t.title).join(', ')}</span>
            </div>
          )}
          {diff.removedTasks.length > 0 && (
            <div className="text-[10px]">
              <span className="text-red-400 font-bold">- Tasks xóa:</span>
              <span className="text-vs-text ml-1">{diff.removedTasks.map(t => t.title).join(', ')}</span>
            </div>
          )}
          {diff.modifiedTasks.length > 0 && (
            <div className="text-[10px]">
              <span className="text-yellow-400 font-bold">• Tasks sửa:</span>
              <span className="text-vs-text ml-1">{diff.modifiedTasks.map(t => t.title).join(', ')}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-4 py-3 border-t border-vs-border">
          <button
            onClick={onConfirm}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-vs-accent text-white
                       rounded text-xs font-mono hover:bg-vs-accent2 transition-colors"
          >
            <Check size={11} /> Áp dụng
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-2 border border-vs-border text-vs-text rounded text-xs font-mono hover:bg-white/5"
          >
            Hủy
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main PlanDocument Component ───────────────────────────────────────────

export function PlanDocument({ agents, tasks, missionContext, projectPath, requirement, missionId, onApply, onExport, isReplanning }) {
  const textareaRef = useRef(null)

  // Generate initial markdown from plan data
  const initialMd = useMemo(() =>
    planToMarkdown(agents, tasks, { projectPath, requirement, mission_context: missionContext }),
    [] // Only generate once on mount
  )

  const [markdown, setMarkdown] = useState(initialMd)
  const [originalMd, setOriginalMd] = useState(initialMd)
  const [hasChanges, setHasChanges] = useState(false)
  const [parseResult, setParseResult] = useState(null)
  const [outline, setOutline] = useState([])
  const [showDiff, setShowDiff] = useState(false)
  const [pendingDiff, setPendingDiff] = useState(null)
  const [toast, setToast] = useState(null)
  const [viewMode, setViewMode] = useState('raw') // 'raw' | 'preview'
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const pendingJumpRef = useRef(null)

  // Regenerate markdown when agents/tasks change externally (e.g. after replan)
  useEffect(() => {
    const newMd = planToMarkdown(agents, tasks, { projectPath, requirement, mission_context: missionContext })
    setMarkdown(newMd)
    setOriginalMd(newMd)
    setHasChanges(false)
  }, [agents, tasks])

  // Live parse + outline extraction (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      const result = parseMissionPlan(markdown)
      setParseResult(result)
      setOutline(extractOutline(markdown))
    }, 400)
    return () => clearTimeout(timer)
  }, [markdown])

  // Track changes
  useEffect(() => {
    setHasChanges(markdown !== originalMd)
  }, [markdown, originalMd])


  // Apply ref for keyboard shortcut access
  const applyRef = useRef(null)

  // Handle Tab key → insert 2 spaces (textarea-specific, kept inline)
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = textareaRef.current
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const val = ta.value
      const newVal = val.substring(0, start) + '  ' + val.substring(end)
      setMarkdown(newVal)
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2
      })
    }
  }, [])

  // Jump to line from outline
  const jumpToLine = useCallback((lineNum) => {
    const ta = textareaRef.current
    if (!ta) return
    const lines = ta.value.split('\n')
    let charPos = 0
    for (let i = 0; i < Math.min(lineNum, lines.length); i++) {
      charPos += lines[i].length + 1
    }
    ta.focus()
    ta.setSelectionRange(charPos, charPos)
    // Scroll to approximate position
    const lineHeight = 18 // approximate
    ta.scrollTop = Math.max(0, lineNum * lineHeight - ta.clientHeight / 3)
  }, [])

  // Outline jump — if in preview, switch to raw first then jump
  const handleOutlineJump = useCallback((lineNum) => {
    if (viewMode === 'preview') {
      pendingJumpRef.current = lineNum
      setViewMode('raw')
    } else {
      jumpToLine(lineNum)
    }
  }, [viewMode, jumpToLine])

  // After switching preview → raw, execute pending outline jump
  useEffect(() => {
    if (viewMode === 'raw' && pendingJumpRef.current !== null) {
      const line = pendingJumpRef.current
      pendingJumpRef.current = null
      requestAnimationFrame(() => jumpToLine(line))
    }
  }, [viewMode, jumpToLine])

  // Insert template at cursor
  const insertAtCursor = useCallback((template) => {
    const ta = textareaRef.current
    if (!ta) return
    const pos = ta.selectionStart
    const val = ta.value
    const newVal = val.substring(0, pos) + template + val.substring(pos)
    setMarkdown(newVal)
    requestAnimationFrame(() => {
      const newPos = pos + template.indexOf('[')
      if (newPos > pos) {
        ta.focus()
        ta.setSelectionRange(newPos, newPos)
      }
    })
  }, [])

  // Apply changes
  const handleApply = useCallback(() => {
    const edited = parseMissionPlan(markdown)
    if (edited.warnings.length > 0 && edited.agents.length === 0) {
      showToast('Parse lỗi: Không tìm thấy agent', 'error')
      return
    }

    const original = { agents, tasks }
    const diff = diffPlanChanges(original, edited)

    if (!diff.hasChanges) {
      showToast('Không có thay đổi', 'info')
      return
    }

    setPendingDiff(diff)
    setShowDiff(true)
  }, [markdown, agents, tasks])

  // Keep applyRef in sync for keyboard shortcut
  useEffect(() => {
    applyRef.current = hasChanges ? handleApply : null
  }, [hasChanges, handleApply])

  // Global hotkeys via useAppHotkeys
  useAppHotkeys({
    scope: 'plan-document',
    handlers: {
      'ctrl+s': () => applyRef.current?.(),
      'ctrl+e': () => setShowExportMenu(prev => !prev),
    },
  })

  const confirmApply = useCallback(() => {
    const edited = parseMissionPlan(markdown)
    setShowDiff(false)
    setPendingDiff(null)

    // Map to match the expected data structure
    const newAgents = edited.agents.map(a => ({
      name: a.name,
      role: a.role,
      model: a.model || 'sonnet',
      reason: a.reason,
      customPrompt: '',
      skillFile: null,
      // Preserve existing skillFile and customPrompt if agent existed before
      ...(() => {
        const existing = agents.find(ea => ea.name === a.name)
        if (existing) return {
          customPrompt: existing.customPrompt || '',
          skillFile: existing.skillFile || null,
        }
        return {}
      })(),
    }))

    const newTasks = edited.tasks.map((t, idx) => ({
      id: t.id || `task-${Date.now()}-${idx}`,
      title: t.title,
      why: t.why || '',
      depends_on: Array.isArray(t.depends_on) ? t.depends_on : [],
      detail: t.detail || '',
      priority: t.priority || 'medium',
      assigned_agent: t.assigned_agent,
    }))

    onApply(newAgents, newTasks)
    setOriginalMd(markdown)
    setHasChanges(false)
    showToast('Đã áp dụng thay đổi', 'success')

    // Save manual_edit version after successful apply
    if (missionId) {
      window.electron?.ipcRenderer?.invoke('save_plan_version', {
        missionId,
        trigger: 'manual_edit',
        agents: newAgents,
        tasks: newTasks,
      }).catch(err => console.error('Failed to save plan version:', err))
    }
  }, [markdown, agents, onApply, missionId])

  // Export to file
  const handleExport = useCallback(async () => {
    if (!projectPath) {
      showToast('Chưa có project path', 'error')
      return
    }
    try {
      const filePath = await invoke('export_plan_markdown', {
        markdown: markdown,
        projectPath: projectPath,
      })
      showToast(`Đã xuất: ${filePath}`, 'success')
      if (onExport) onExport()
    } catch (err) {
      showToast(`Lỗi xuất: ${err}`, 'error')
    }
  }, [markdown, projectPath, onExport])

  // Reset to original
  const handleReset = useCallback(() => {
    setMarkdown(originalMd)
  }, [originalMd])

  // Apply rollback from version history
  const handleApplyRollback = useCallback((rolledBackAgents, rolledBackTasks) => {
    onApply(rolledBackAgents, rolledBackTasks)
    const newMd = planToMarkdown(rolledBackAgents, rolledBackTasks, { projectPath, requirement, mission_context: missionContext })
    setMarkdown(newMd)
    setOriginalMd(newMd)
    setHasChanges(false)
    showToast('Đã khôi phục plan', 'success')
  }, [onApply, projectPath, requirement, missionContext])

  // Toast helper
  const showToast = (msg, type = 'info') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  // Stats from parse result
  const stats = useMemo(() => {
    if (!parseResult) return null
    const { agents: pa, tasks: pt, warnings } = parseResult
    const high = pt.filter(t => t.priority === 'high').length
    const med = pt.filter(t => t.priority === 'medium').length
    const low = pt.filter(t => t.priority === 'low').length
    return {
      agents: pa.length,
      tasks: pt.length,
      high, med, low,
      warnings: warnings.length,
      warningList: warnings,
    }
  }, [parseResult])

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] rounded-lg overflow-hidden">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-1.5 px-3 py-2 bg-[#252526] border-b border-vs-border">
        <button
          onClick={handleReset}
          disabled={!hasChanges}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono rounded
                     border border-vs-border text-vs-muted hover:text-white hover:bg-white/5
                     disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Hoàn tác về bản gốc"
        >
          <RotateCcw size={10} /> Hoàn tác
        </button>

        <div className="w-px h-4 bg-vs-border mx-1" />

        <button
          onClick={() => insertAtCursor(agentTemplate())}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono rounded
                     border border-vs-border text-vs-muted hover:text-white hover:bg-white/5 transition-colors"
          title="Thêm agent mới"
        >
          <UserPlus size={10} /> Thêm Agent
        </button>

        <button
          onClick={() => insertAtCursor(taskTemplate())}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono rounded
                     border border-vs-border text-vs-muted hover:text-white hover:bg-white/5 transition-colors"
          title="Thêm task mới"
        >
          <Plus size={10} /> Thêm Task
        </button>

        <div className="flex-1" />

        <button
          onClick={() => setShowVersionHistory(prev => !prev)}
          className={`flex items-center gap-1 px-2 py-1 text-xs font-mono rounded border transition-colors ${
            showVersionHistory
              ? 'border-vs-accent text-vs-accent bg-vs-accent/10'
              : 'border-vs-border text-vs-muted hover:text-vs-text'
          }`}
          title="Lịch sử version"
        >
          <Clock size={11} />
          Lịch sử
        </button>

        <ExportDropdown
          missionState={{
            id: missionId,
            description: requirement,
            project_path: projectPath,
            requirement,
            mission_context: missionContext,
            agents,
            tasks,
          }}
          projectPath={projectPath}
          externalOpen={showExportMenu}
          onToast={(type, msg) => showToast(msg, type)}
        />

        <div className="w-px h-4 bg-vs-border mx-0.5" />

        {/* Raw / Preview toggle */}
        <div className="flex items-center border border-vs-border rounded overflow-hidden">
          <button
            onClick={() => setViewMode('raw')}
            className={`flex items-center gap-1 px-2 py-1 text-[10px] font-mono transition-colors ${
              viewMode === 'raw'
                ? 'bg-vs-accent/20 text-vs-accent'
                : 'text-vs-muted hover:text-white hover:bg-white/5'
            }`}
            title="Chế độ chỉnh sửa"
          >
            <Code2 size={9} /> Raw
          </button>
          <button
            onClick={() => setViewMode('preview')}
            className={`flex items-center gap-1 px-2 py-1 text-[10px] font-mono border-l border-vs-border transition-colors ${
              viewMode === 'preview'
                ? 'bg-vs-accent/20 text-vs-accent'
                : 'text-vs-muted hover:text-white hover:bg-white/5'
            }`}
            title="Xem trước có render"
          >
            <Eye size={9} /> Preview
          </button>
        </div>

        {hasChanges && (
          <button
            onClick={handleApply}
            className="flex items-center gap-1 px-3 py-1 text-[10px] font-mono font-bold rounded
                       bg-vs-accent text-white hover:bg-vs-accent2 transition-colors
                       animate-pulse-subtle"
          >
            <Check size={10} /> Áp dụng thay đổi
          </button>
        )}
      </div>

      {/* ── Main area: Outline + Editor/Preview + Version History panel ── */}
      <div className="flex flex-1 min-h-0">
        {/* Outline sidebar */}
        <OutlineSidebar outline={outline} onJumpTo={handleOutlineJump} />

        {viewMode === 'raw' ? (
          /* ── Raw editor (soft-wrap; no line number gutter to avoid desync) ── */
          <div className="flex-1 flex min-h-0 overflow-hidden">
            <textarea
              ref={textareaRef}
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-[#1e1e1e] text-[#d4d4d4] text-[11px] font-mono leading-[18px]
                         p-3 resize-none outline-none border-none
                         scrollbar-thin scrollbar-thumb-[#444] scrollbar-track-transparent
                         selection:bg-vs-accent/30"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
            />
          </div>
        ) : (
          /* ── Preview mode ── */
          <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#444] scrollbar-track-transparent bg-[#1e1e1e]">
            <div
              className="px-8 py-5 text-[12px] leading-relaxed
                [&_h1]:text-xl [&_h1]:font-bold [&_h1]:text-white [&_h1]:mb-4 [&_h1]:mt-1
                [&_h2]:text-sm [&_h2]:font-bold [&_h2]:text-vs-accent [&_h2]:mb-3 [&_h2]:mt-7
                [&_h2]:border-b [&_h2]:border-vs-border/50 [&_h2]:pb-1
                [&_h3]:text-xs [&_h3]:font-bold [&_h3]:text-white [&_h3]:mb-2 [&_h3]:mt-5
                [&_h4]:text-xs [&_h4]:font-semibold [&_h4]:text-yellow-400/90 [&_h4]:mb-2 [&_h4]:mt-4
                [&_blockquote]:border-l-2 [&_blockquote]:border-vs-accent/60 [&_blockquote]:pl-3
                [&_blockquote]:my-2.5 [&_blockquote]:text-vs-text/75 [&_blockquote]:italic
                [&_hr]:border-vs-border/50 [&_hr]:my-5
                [&_p]:text-vs-text/80 [&_p]:leading-relaxed [&_p]:mb-3 [&_p]:break-words
                [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2.5 [&_ul]:mb-3
                [&_li]:text-vs-text/80 [&_li]:leading-relaxed [&_li]:pb-0.5
                [&_strong]:text-white [&_strong]:font-semibold
                [&_em]:text-vs-text/70
                [&_table]:w-full [&_table]:border-collapse [&_table]:text-[11px] [&_table]:mb-3
                [&_th]:bg-vs-panel [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left
                [&_th]:text-[10px] [&_th]:text-vs-muted [&_th]:font-mono [&_th]:uppercase
                [&_th]:border [&_th]:border-vs-border/50
                [&_td]:px-3 [&_td]:py-1.5 [&_td]:border [&_td]:border-vs-border/30
                [&_td]:text-vs-text/80 [&_td]:align-top [&_td]:break-words [&_td]:max-w-xs"
              dangerouslySetInnerHTML={{ __html: renderMarkdownHtml(markdown) }}
            />
          </div>
        )}

        {/* ── Version History panel ── */}
        {showVersionHistory && (
          <div className="w-72 shrink-0 border-l border-vs-border bg-vs-surface overflow-hidden flex flex-col">
            <PlanVersionHistory
              missionId={missionId}
              currentAgents={agents}
              currentTasks={tasks}
              onRollback={(rolledBackAgents, rolledBackTasks) => {
                handleApplyRollback(rolledBackAgents, rolledBackTasks)
                setShowVersionHistory(false)
              }}
            />
          </div>
        )}
      </div>

      {/* ── Status bar ── */}
      <div className="flex items-center gap-3 px-3 py-1 bg-[#007acc] text-white text-[10px] font-mono shrink-0">
        {stats && (
          <>
            <span>{stats.agents} agent{stats.agents !== 1 ? 's' : ''}</span>
            <span>•</span>
            <span>
              {stats.tasks} task{stats.tasks !== 1 ? 's' : ''}
              {stats.tasks > 0 && (
                <span className="ml-1 text-white/70">
                  ({stats.high > 0 ? `${stats.high}H` : ''}{stats.med > 0 ? ` ${stats.med}M` : ''}{stats.low > 0 ? ` ${stats.low}L` : ''})
                </span>
              )}
            </span>
            <span>•</span>
          </>
        )}

        {hasChanges ? (
          <span className="text-yellow-200">Đã chỉnh sửa</span>
        ) : (
          <span className="text-white/70">Không thay đổi</span>
        )}

        {stats && stats.warnings > 0 ? (
          <span className="flex items-center gap-1 text-yellow-200" title={stats.warningList.join('\n')}>
            <AlertTriangle size={9} /> {stats.warnings} cảnh báo
          </span>
        ) : stats ? (
          <span className="flex items-center gap-1 text-green-200">
            <Check size={9} /> Hợp lệ
          </span>
        ) : null}

        <div className="flex-1" />
        <span className="text-white/50">{'Ctrl+S để áp dụng'}</span>
      </div>

      {/* ── Diff Summary Modal ── */}
      {showDiff && pendingDiff && (
        <DiffSummary
          diff={pendingDiff}
          onConfirm={confirmApply}
          onCancel={() => { setShowDiff(false); setPendingDiff(null) }}
        />
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className={`fixed bottom-4 right-4 z-50 px-4 py-2 rounded-lg text-xs font-mono shadow-lg
                         animate-fade-in ${
          toast.type === 'success' ? 'bg-green-600 text-white' :
          toast.type === 'error' ? 'bg-red-600 text-white' :
          'bg-[#333] text-white'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
