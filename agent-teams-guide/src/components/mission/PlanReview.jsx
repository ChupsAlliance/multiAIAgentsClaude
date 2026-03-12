import { useState, useMemo, useCallback, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { DndContext, closestCenter, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Cpu, Rocket, ChevronDown, ChevronUp, Zap, Brain, Coins,
  Wrench, MessageSquare, Info, Plus, Trash2, X, GripVertical,
  UserPlus, PackagePlus, FileText, Upload, Layers, Check
} from 'lucide-react'
import { SYSTEM_INFO } from '../../data/promptWrapper'

const MODELS = [
  { id: 'sonnet', label: 'Sonnet', desc: 'Fast & capable', icon: Zap, color: 'text-blue-400' },
  { id: 'opus',   label: 'Opus',   desc: 'Most powerful', icon: Brain, color: 'text-purple-400' },
  { id: 'haiku',  label: 'Haiku',  desc: 'Fast & cheap', icon: Coins, color: 'text-green-400' },
]

const PRIORITIES = [
  { id: 'high',   label: 'High',   color: 'bg-red-400' },
  { id: 'medium', label: 'Med',    color: 'bg-yellow-400' },
  { id: 'low',    label: 'Low',    color: 'bg-green-400' },
]

// ─── Draggable Task Item ───
function DraggableTask({ task, onEdit, onDelete, onPriorityChange }) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(task.title)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', task },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const cyclePriority = () => {
    const order = ['high', 'medium', 'low']
    const idx = order.indexOf(task.priority || 'medium')
    onPriorityChange(task.id, order[(idx + 1) % 3])
  }

  const handleSave = () => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== task.title) {
      onEdit(task.id, trimmed)
    } else {
      setEditValue(task.title)
    }
    setEditing(false)
  }

  const pri = PRIORITIES.find(p => p.id === (task.priority || 'medium'))

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1.5 group px-2 py-1.5 rounded-md transition-colors ${
        isDragging ? 'bg-vs-accent/20 ring-1 ring-vs-accent' : 'hover:bg-white/5'
      }`}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="text-vs-muted/40 hover:text-vs-muted cursor-grab active:cursor-grabbing shrink-0"
      >
        <GripVertical size={12} />
      </button>

      {/* Priority dot — clickable */}
      <button
        onClick={cyclePriority}
        title={`Priority: ${pri.label} (click to change)`}
        className={`w-2 h-2 rounded-full shrink-0 ${pri.color} hover:ring-2 hover:ring-white/30 transition-colors`}
      />

      {/* Task title — editable */}
      {editing ? (
        <input
          autoFocus
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={e => {
            if (e.key === 'Enter') handleSave()
            if (e.key === 'Escape') { setEditValue(task.title); setEditing(false) }
          }}
          className="flex-1 bg-vs-bg border border-vs-accent/50 rounded px-1.5 py-0.5 text-xs text-vs-text font-mono
                     focus:outline-none focus:ring-1 focus:ring-vs-accent/30"
        />
      ) : (
        <span
          onClick={() => setEditing(true)}
          className="flex-1 text-xs text-vs-text truncate cursor-text hover:text-white transition-colors"
          title="Click to edit"
        >
          {task.title}
        </span>
      )}

      {/* Priority label */}
      <span className="text-[9px] text-vs-muted font-mono shrink-0">{pri.label}</span>

      {/* Delete button */}
      <button
        onClick={() => onDelete(task.id)}
        className="opacity-0 group-hover:opacity-100 text-vs-muted hover:text-red-400 transition-colors shrink-0"
        title="Xoá task"
      >
        <X size={11} />
      </button>
    </div>
  )
}

// ─── Inline Add Task Form ───
function AddTaskInline({ onAdd, agentName }) {
  const [active, setActive] = useState(false)
  const [title, setTitle] = useState('')

  const handleAdd = () => {
    const trimmed = title.trim()
    if (trimmed) {
      onAdd(trimmed, agentName)
      setTitle('')
      setActive(false)
    }
  }

  if (!active) {
    return (
      <button
        onClick={() => setActive(true)}
        className="flex items-center gap-1 text-[10px] text-vs-muted hover:text-vs-accent font-mono transition-colors mt-1 px-2"
      >
        <Plus size={10} /> Thêm task
      </button>
    )
  }

  return (
    <div className="flex gap-1.5 mt-1 px-2">
      <input
        autoFocus
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') handleAdd()
          if (e.key === 'Escape') { setTitle(''); setActive(false) }
        }}
        placeholder="Tên task..."
        className="flex-1 bg-vs-bg border border-vs-border rounded px-2 py-1 text-[11px] text-vs-text font-mono
                   placeholder-vs-muted/40 focus:outline-none focus:border-vs-accent/50"
      />
      <button
        onClick={handleAdd}
        disabled={!title.trim()}
        className="px-2 py-1 rounded text-[10px] font-mono bg-vs-accent/20 text-vs-accent
                   hover:bg-vs-accent/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        Add
      </button>
      <button
        onClick={() => { setTitle(''); setActive(false) }}
        className="px-1.5 py-1 rounded text-[10px] text-vs-muted hover:text-vs-text transition-colors"
      >
        <X size={10} />
      </button>
    </div>
  )
}

// ─── Agent Section (with droppable task area) ───
function AgentSection({ agent, tasks, onModelChange, onCustomPromptChange, onRemove,
                         onEditTask, onDeleteTask, onPriorityChange, onAddTask, onLoadSkillFile, isOnly }) {
  const [expanded, setExpanded] = useState(true)
  const [showCustom, setShowCustom] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const taskIds = useMemo(() => tasks.map(t => t.id), [tasks])

  return (
    <div className="border border-vs-border rounded-lg overflow-hidden bg-vs-panel/50" data-agent={agent.name}>
      {/* Agent header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-8 h-8 rounded-md bg-vs-accent/20 flex items-center justify-center text-vs-accent font-mono text-xs font-bold shrink-0">
          {agent.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{agent.name}</p>
          <p className="text-[10px] text-vs-muted font-mono truncate">{agent.role}</p>
        </div>

        {/* Model chips */}
        <div className="flex gap-1.5">
          {MODELS.map(m => {
            const Icon = m.icon
            const selected = (agent.model || 'sonnet') === m.id
            return (
              <button
                key={m.id}
                onClick={() => onModelChange(agent.name, m.id)}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono transition-colors ${
                  selected
                    ? 'bg-vs-accent/20 border border-vs-accent text-white'
                    : 'bg-vs-bg border border-vs-border text-vs-muted hover:border-vs-text/30 hover:text-vs-text'
                }`}
              >
                <Icon size={10} />
                {m.label}
              </button>
            )
          })}
        </div>

        {/* Remove agent */}
        {!isOnly && (
          confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => { onRemove(agent.name); setConfirmDelete(false) }}
                className="px-2 py-1 rounded text-[10px] font-mono bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
              >
                Xoá
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-1.5 py-1 rounded text-[10px] text-vs-muted hover:text-vs-text"
              >
                <X size={10} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-vs-muted hover:text-red-400 transition-colors p-1"
              title="Xoá agent"
            >
              <Trash2 size={13} />
            </button>
          )
        )}

        {/* Toggle details */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-vs-muted hover:text-vs-text transition-colors p-1"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Expanded: tasks + custom prompt */}
      {expanded && (
        <div className="border-t border-vs-border/50">
          {/* Droppable task area */}
          <div className="px-3 py-2 min-h-[40px]">
            <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
              {tasks.length === 0 ? (
                <p className="text-[10px] text-vs-muted/50 font-mono py-2 text-center italic">
                  Kéo task vào đây
                </p>
              ) : (
                <div className="space-y-0.5">
                  {tasks.map(task => (
                    <DraggableTask
                      key={task.id}
                      task={task}
                      onEdit={onEditTask}
                      onDelete={onDeleteTask}
                      onPriorityChange={onPriorityChange}
                    />
                  ))}
                </div>
              )}
            </SortableContext>
            <AddTaskInline onAdd={onAddTask} agentName={agent.name} />
          </div>

          {/* Custom prompt + skill file */}
          <div className="px-4 pb-3">
            <button
              onClick={() => setShowCustom(!showCustom)}
              className="flex items-center gap-1.5 text-[10px] font-mono text-vs-muted hover:text-vs-accent transition-colors uppercase tracking-wider"
            >
              <MessageSquare size={9} />
              {showCustom ? 'Ẩn custom instructions' : 'Thêm custom instructions'}
            </button>
            {showCustom && (
              <div className="mt-1.5 space-y-2">
                {/* Loaded skill file badge */}
                {agent.skillFile && (
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-purple-500/10 border border-purple-500/30">
                    <FileText size={12} className="text-purple-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] font-mono text-purple-300 truncate block">{agent.skillFile.name}</span>
                      <span className="text-[9px] text-vs-muted">{(agent.skillFile.size / 1024).toFixed(1)} KB</span>
                    </div>
                    <button
                      onClick={() => {
                        onCustomPromptChange(agent.name, '')
                        onLoadSkillFile(agent.name, null)
                      }}
                      className="text-vs-muted hover:text-red-400 transition-colors shrink-0"
                      title="Xoá skill file"
                    >
                      <X size={11} />
                    </button>
                  </div>
                )}

                {/* Browse skill file — click to select .md/.txt */}
                <div
                  className="flex items-center gap-2 px-3 py-2 rounded-md border border-vs-border/50
                             hover:border-purple-400/40 hover:bg-purple-500/5 transition-colors cursor-pointer"
                  onClick={async () => {
                    try {
                      const paths = await invoke('pick_files')
                      if (paths && paths.length > 0) {
                        const filePath = paths[0]
                        const content = await invoke('read_file_content', { path: filePath })
                        const info = await invoke('get_file_info', { path: filePath })
                        onLoadSkillFile(agent.name, { name: info.name, size: info.size, path: filePath, content })
                      }
                    } catch {}
                  }}
                >
                  <Upload size={11} className="text-vs-muted" />
                  <span className="text-[10px] font-mono text-vs-muted">
                    Click để chọn skill file (.md, .txt)
                  </span>
                </div>

                {/* Manual textarea */}
                <textarea
                  value={agent.customPrompt || ''}
                  onChange={(e) => onCustomPromptChange(agent.name, e.target.value)}
                  placeholder="Hoặc nhập trực tiếp: Dùng TypeScript strict mode, viết unit tests..."
                  className="w-full h-16 resize-y bg-vs-bg border border-vs-border rounded-md px-3 py-2
                             text-[11px] text-vs-text font-mono placeholder-vs-muted/40
                             focus:outline-none focus:border-vs-accent/60 focus:ring-1 focus:ring-vs-accent/30
                             transition-colors"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Add Agent Form ───
function AddAgentForm({ onAdd, onCancel }) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [model, setModel] = useState('sonnet')

  const handleSubmit = () => {
    const trimName = name.trim()
    const trimRole = role.trim()
    if (trimName && trimRole) {
      onAdd({ name: trimName, role: trimRole, model, customPrompt: '' })
      setName(''); setRole(''); setModel('sonnet')
    }
  }

  return (
    <div className="border-2 border-dashed border-vs-accent/30 rounded-lg p-4 bg-vs-accent/5 space-y-3 animate-fade-in">
      <p className="text-xs font-semibold text-vs-accent flex items-center gap-1.5">
        <UserPlus size={13} /> Thêm Agent Mới
      </p>
      <div className="grid grid-cols-2 gap-2">
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Tên agent (e.g. backend-dev)"
          className="bg-vs-bg border border-vs-border rounded px-3 py-2 text-xs text-vs-text font-mono
                     placeholder-vs-muted/40 focus:outline-none focus:border-vs-accent/50"
        />
        <input
          value={role}
          onChange={e => setRole(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="Role (e.g. Backend Developer)"
          className="bg-vs-bg border border-vs-border rounded px-3 py-2 text-xs text-vs-text font-mono
                     placeholder-vs-muted/40 focus:outline-none focus:border-vs-accent/50"
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-vs-muted font-mono">Model:</span>
        {MODELS.map(m => {
          const Icon = m.icon
          return (
            <button
              key={m.id}
              onClick={() => setModel(m.id)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-colors ${
                model === m.id
                  ? 'bg-vs-accent/20 border border-vs-accent text-white'
                  : 'bg-vs-bg border border-vs-border text-vs-muted hover:text-vs-text'
              }`}
            >
              <Icon size={9} /> {m.label}
            </button>
          )
        })}
      </div>
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded text-xs font-mono text-vs-muted hover:text-vs-text transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!name.trim() || !role.trim()}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-semibold
                     bg-vs-accent/20 text-vs-accent hover:bg-vs-accent/30
                     disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <Plus size={11} /> Add Agent
        </button>
      </div>
    </div>
  )
}

// ─── Bulk Skill Modal ───
function BulkSkillModal({ agents, onApply, onClose }) {
  const [skillFile, setSkillFile] = useState(null)   // { name, size, path, content }
  const [selected, setSelected] = useState(() =>
    agents.reduce((acc, a) => ({ ...acc, [a.name]: true }), {})
  )
  const [loading, setLoading] = useState(false)

  const allChecked = agents.every(a => selected[a.name])
  const noneChecked = agents.every(a => !selected[a.name])

  const toggleAll = () => {
    const val = !allChecked
    setSelected(agents.reduce((acc, a) => ({ ...acc, [a.name]: val }), {}))
  }

  const pickFile = async () => {
    setLoading(true)
    try {
      const paths = await invoke('pick_files')
      if (paths && paths.length > 0) {
        const filePath = paths[0]
        const [content, info] = await Promise.all([
          invoke('read_file_content', { path: filePath }),
          invoke('get_file_info', { path: filePath }),
        ])
        setSkillFile({ name: info.name, size: info.size, path: filePath, content })
      }
    } catch {}
    setLoading(false)
  }

  const handleApply = () => {
    if (!skillFile) return
    const targetAgents = agents.filter(a => selected[a.name]).map(a => a.name)
    if (targetAgents.length === 0) return
    onApply(targetAgents, skillFile)
    onClose()
  }

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const targetCount = Object.values(selected).filter(Boolean).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
         onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-vs-panel border border-vs-border rounded-xl shadow-2xl w-[420px] max-w-[90vw]
                      flex flex-col overflow-hidden animate-fade-in">
        {/* Title */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-vs-border">
          <div className="flex items-center gap-2">
            <Layers size={14} className="text-purple-400" />
            <span className="text-sm font-semibold text-white">Apply Skill to Agents</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded transition-colors">
            <X size={14} className="text-vs-muted" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Step 1: Pick skill file */}
          <div className="space-y-2">
            <p className="text-[10px] font-mono text-vs-muted uppercase tracking-wider">
              1. Chọn skill file (.md, .txt)
            </p>
            {skillFile ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/30">
                <FileText size={13} className="text-purple-300 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-mono text-purple-300 truncate">{skillFile.name}</p>
                  <p className="text-[9px] text-vs-muted">{(skillFile.size / 1024).toFixed(1)} KB</p>
                </div>
                <button onClick={() => setSkillFile(null)}
                        className="text-vs-muted hover:text-red-400 transition-colors">
                  <X size={11} />
                </button>
              </div>
            ) : (
              <button
                onClick={pickFile}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg
                           border border-dashed border-vs-border hover:border-purple-400/50
                           hover:bg-purple-500/5 text-vs-muted hover:text-purple-300 transition-colors text-xs font-mono"
              >
                <Upload size={12} />
                {loading ? 'Đang chọn...' : 'Click để chọn skill file'}
              </button>
            )}
          </div>

          {/* Step 2: Select agents */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-mono text-vs-muted uppercase tracking-wider">
                2. Chọn agents áp dụng
              </p>
              <button
                onClick={toggleAll}
                className="text-[9px] font-mono text-vs-accent hover:text-vs-accent/70 transition-colors"
              >
                {allChecked ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
              </button>
            </div>
            <div className="space-y-1.5 max-h-[200px] overflow-y-auto scrollbar-thin">
              {agents.map(agent => (
                <label key={agent.name}
                       className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                         selected[agent.name]
                           ? 'bg-vs-accent/10 border border-vs-accent/30'
                           : 'bg-vs-bg border border-vs-border hover:bg-white/5'
                       }`}>
                  {/* Custom checkbox */}
                  <div className={`w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors ${
                    selected[agent.name] ? 'bg-vs-accent' : 'bg-vs-bg border border-vs-border'
                  }`}
                       onClick={() => setSelected(prev => ({ ...prev, [agent.name]: !prev[agent.name] }))}>
                    {selected[agent.name] && <Check size={10} className="text-black" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-white truncate">{agent.name}</p>
                    <p className="text-[9px] text-vs-muted font-mono truncate">{agent.role}</p>
                  </div>
                  {agent.skillFile && (
                    <span className="text-[8px] font-mono text-purple-400 shrink-0">has skill</span>
                  )}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-vs-border bg-vs-bg/50">
          <span className="text-[10px] text-vs-muted font-mono">
            {targetCount === 0 ? 'Chưa chọn agent nào' : `Sẽ áp dụng cho ${targetCount} agent${targetCount > 1 ? 's' : ''}`}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose}
                    className="px-3 py-1.5 rounded text-xs font-mono text-vs-muted
                               hover:bg-white/10 transition-colors">
              Huỷ
            </button>
            <button
              onClick={handleApply}
              disabled={!skillFile || noneChecked}
              className="px-3 py-1.5 rounded text-xs font-mono font-semibold
                         bg-purple-500/20 text-purple-300 border border-purple-500/40
                         hover:bg-purple-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Apply Skill
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main PlanReview ───
export function PlanReview({ agents = [], tasks = [], onDeploy, onCancel }) {
  const [localAgents, setLocalAgents] = useState(() =>
    agents.map(a => ({ ...a, customPrompt: '' }))
  )
  const [localTasks, setLocalTasks] = useState(() =>
    tasks.map((t, i) => ({
      id: t.id || `task-${i}`,
      title: t.title,
      priority: t.priority || 'medium',
      assigned_agent: t.agent || t.assigned_agent,
    }))
  )
  const [addingAgent, setAddingAgent] = useState(false)
  const [showFlow, setShowFlow] = useState(false)
  const [activeId, setActiveId] = useState(null)
  const [showBulkSkill, setShowBulkSkill] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  // ── Agent CRUD ──
  const handleAddAgent = (agent) => {
    setLocalAgents(prev => [...prev, agent])
    setAddingAgent(false)
  }

  const handleRemoveAgent = (agentName) => {
    setLocalAgents(prev => prev.filter(a => a.name !== agentName))
    setLocalTasks(prev => prev.map(t =>
      t.assigned_agent === agentName ? { ...t, assigned_agent: null } : t
    ))
  }

  const handleModelChange = (agentName, model) => {
    setLocalAgents(prev => prev.map(a =>
      a.name === agentName ? { ...a, model } : a
    ))
  }

  const handleCustomPromptChange = (agentName, prompt) => {
    setLocalAgents(prev => prev.map(a =>
      a.name === agentName ? { ...a, customPrompt: prompt } : a
    ))
  }

  const handleLoadSkillFile = useCallback((agentName, fileInfo) => {
    setLocalAgents(prev => prev.map(a =>
      a.name === agentName ? { ...a, skillFile: fileInfo } : a
    ))
  }, [])

  // Bulk apply: same skill file to multiple agents at once
  const handleBulkApplySkill = useCallback((targetAgentNames, skillFile) => {
    setLocalAgents(prev => prev.map(a =>
      targetAgentNames.includes(a.name) ? { ...a, skillFile } : a
    ))
  }, [])

  const handleSetAllModels = (model) => {
    setLocalAgents(prev => prev.map(a => ({ ...a, model })))
  }

  // ── Task CRUD ──
  const handleEditTask = (taskId, newTitle) => {
    setLocalTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, title: newTitle } : t
    ))
  }

  const handleDeleteTask = (taskId) => {
    setLocalTasks(prev => prev.filter(t => t.id !== taskId))
  }

  const handlePriorityChange = (taskId, priority) => {
    setLocalTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, priority } : t
    ))
  }

  const handleAddTask = (title, agentName) => {
    setLocalTasks(prev => [...prev, {
      id: `task-${Date.now()}`,
      title,
      priority: 'medium',
      assigned_agent: agentName || null,
    }])
  }

  // ── Drag and Drop ──
  const handleDragStart = (event) => {
    setActiveId(event.active.id)
  }

  const handleDragEnd = (event) => {
    setActiveId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    const activeTask = localTasks.find(t => t.id === active.id)
    if (!activeTask) return

    // Determine target: over could be a task (inherit its agent) or an agent container
    let targetAgent = null
    const overTask = localTasks.find(t => t.id === over.id)
    if (overTask) {
      targetAgent = overTask.assigned_agent
    } else if (over.id === '__unassigned__') {
      targetAgent = null
    } else {
      // Dropped on agent section by name
      targetAgent = over.id
    }

    if (activeTask.assigned_agent !== targetAgent) {
      setLocalTasks(prev => prev.map(t =>
        t.id === active.id ? { ...t, assigned_agent: targetAgent } : t
      ))
    }
  }

  // ── Deploy ──
  const handleDeploy = () => {
    const finalAgents = localAgents.map(a => {
      // Merge skillFile content into customPrompt if both present
      let mergedPrompt = a.customPrompt || ''
      if (a.skillFile?.content) {
        const skillSection = `\n\n## Skill Reference\n${a.skillFile.content}`
        mergedPrompt = mergedPrompt ? mergedPrompt + skillSection : skillSection.trim()
        console.log(`[Deploy] Skill injected for "${a.name}": ${a.skillFile.name} (${a.skillFile.content.length} chars)`)
      }
      return {
        name: a.name,
        role: a.role,
        model: a.model || 'sonnet',
        customPrompt: mergedPrompt,
        skillFile: a.skillFile ? { name: a.skillFile.name } : null,
      }
    })
    const finalTasks = localTasks.filter(t => t.assigned_agent)
    console.log('[Deploy] Final agents:', finalAgents.map(a => ({
      name: a.name, model: a.model,
      hasSkill: !!a.skillFile,
      promptLength: a.customPrompt?.length || 0,
    })))
    onDeploy(finalAgents, finalTasks)
  }

  // ── Derived ──
  const unassignedTasks = localTasks.filter(t => !t.assigned_agent)
  const unassignedIds = useMemo(() => unassignedTasks.map(t => t.id), [unassignedTasks])
  const draggedTask = activeId ? localTasks.find(t => t.id === activeId) : null
  const canDeploy = localAgents.length > 0 && localTasks.some(t => t.assigned_agent)

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="px-5 py-4 border-b border-vs-border bg-vs-panel/30">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Cpu size={16} className="text-vs-accent" />
              Review Mission Plan
            </h2>
            <p className="text-xs text-vs-muted mt-0.5">
              Tuỳ chỉnh agents, tasks, models — kéo thả task giữa các agents
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowFlow(!showFlow)}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono
                         bg-vs-bg border border-vs-border text-vs-muted
                         hover:border-vs-accent hover:text-white transition-colors"
            >
              <Info size={9} /> Flow
            </button>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-vs-muted font-mono mr-1">Set all:</span>
              {MODELS.map(m => {
                const Icon = m.icon
                return (
                  <button
                    key={m.id}
                    onClick={() => handleSetAllModels(m.id)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono
                               bg-vs-bg border border-vs-border text-vs-muted
                               hover:border-vs-accent hover:text-white transition-colors"
                  >
                    <Icon size={9} /> {m.label}
                  </button>
                )
              })}
            </div>
            {/* Bulk Apply Skill button */}
            <button
              onClick={() => setShowBulkSkill(true)}
              title="Áp dụng một skill file cho nhiều agents cùng lúc"
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono
                         bg-vs-bg border border-purple-500/40 text-purple-400
                         hover:border-purple-400 hover:bg-purple-500/10 transition-colors"
            >
              <Layers size={9} /> Bulk Skill
            </button>
          </div>
        </div>

        {showFlow && (
          <div className="mt-3 bg-vs-bg rounded-lg border border-vs-border p-3">
            <p className="text-[10px] text-vs-muted font-mono uppercase tracking-wider mb-2">
              Tiếp theo sẽ xảy ra gì?
            </p>
            <div className="grid grid-cols-1 gap-1">
              {SYSTEM_INFO.flowSteps.slice(5).map(s => (
                <div key={s.step} className="flex items-start gap-2 text-[11px]">
                  <span className="w-4 h-4 rounded-full bg-vs-accent/20 text-vs-accent flex items-center justify-center shrink-0 text-[9px] font-mono font-bold">
                    {s.step}
                  </span>
                  <div>
                    <span className="text-white font-medium">{s.title}</span>
                    <span className="text-vs-muted ml-1">— {s.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Main — DnD */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {localAgents.map(agent => {
            const agentTasks = localTasks.filter(t => t.assigned_agent === agent.name)
            return (
              <AgentSection
                key={agent.name}
                agent={agent}
                tasks={agentTasks}
                isOnly={localAgents.length <= 1}
                onModelChange={handleModelChange}
                onCustomPromptChange={handleCustomPromptChange}
                onLoadSkillFile={handleLoadSkillFile}
                onRemove={handleRemoveAgent}
                onEditTask={handleEditTask}
                onDeleteTask={handleDeleteTask}
                onPriorityChange={handlePriorityChange}
                onAddTask={handleAddTask}
              />
            )
          })}

          {/* Add agent */}
          {addingAgent ? (
            <AddAgentForm onAdd={handleAddAgent} onCancel={() => setAddingAgent(false)} />
          ) : (
            <button
              onClick={() => setAddingAgent(true)}
              className="w-full border-2 border-dashed border-vs-border rounded-lg py-3 px-4
                         flex items-center justify-center gap-2 text-xs font-mono text-vs-muted
                         hover:border-vs-accent/40 hover:text-vs-accent hover:bg-vs-accent/5 transition-colors"
            >
              <UserPlus size={14} /> Thêm Agent
            </button>
          )}

          {/* Unassigned pool */}
          <div className={`border rounded-lg overflow-hidden ${
            unassignedTasks.length > 0
              ? 'border-yellow-500/30 bg-yellow-500/5'
              : 'border-vs-border/30 bg-vs-panel/20'
          }`}>
            <div className="px-4 py-2 flex items-center gap-2">
              <PackagePlus size={13} className={unassignedTasks.length > 0 ? 'text-yellow-500' : 'text-vs-muted'} />
              <span className={`text-xs font-semibold ${unassignedTasks.length > 0 ? 'text-yellow-500' : 'text-vs-muted'}`}>
                Chưa phân công ({unassignedTasks.length})
              </span>
            </div>
            <div className={`px-3 py-2 min-h-[32px] border-t ${
              unassignedTasks.length > 0 ? 'border-yellow-500/20' : 'border-vs-border/20'
            }`}>
              <SortableContext items={unassignedIds} strategy={verticalListSortingStrategy}>
                {unassignedTasks.length === 0 ? (
                  <p className="text-[10px] text-vs-muted/50 font-mono py-1 text-center italic">
                    Kéo task vào đây để bỏ phân công
                  </p>
                ) : (
                  <div className="space-y-0.5">
                    {unassignedTasks.map(task => (
                      <DraggableTask
                        key={task.id}
                        task={task}
                        onEdit={handleEditTask}
                        onDelete={handleDeleteTask}
                        onPriorityChange={handlePriorityChange}
                      />
                    ))}
                  </div>
                )}
              </SortableContext>
              <AddTaskInline onAdd={handleAddTask} agentName={null} />
            </div>
          </div>

          {/* Drag overlay */}
          <DragOverlay>
            {draggedTask && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-vs-panel border border-vs-accent shadow-lg shadow-vs-accent/20">
                <GripVertical size={12} className="text-vs-accent" />
                <span className={`w-2 h-2 rounded-full ${
                  PRIORITIES.find(p => p.id === draggedTask.priority)?.color || 'bg-yellow-400'
                }`} />
                <span className="text-xs text-white font-mono truncate">{draggedTask.title}</span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-vs-border bg-vs-panel/30 flex items-center justify-between">
        <div className="text-xs text-vs-muted font-mono space-x-2">
          <span>{localAgents.length} agents</span>
          <span>·</span>
          <span>{localTasks.filter(t => t.assigned_agent).length} assigned</span>
          {unassignedTasks.length > 0 && (
            <>
              <span>·</span>
              <span className="text-yellow-500">{unassignedTasks.length} unassigned</span>
            </>
          )}
          <span>·</span>
          <span>{MODELS.map(m => {
            const c = localAgents.filter(a => (a.model || 'sonnet') === m.id).length
            return c > 0 ? `${c}× ${m.label}` : null
          }).filter(Boolean).join(', ')}</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-xs font-mono text-vs-muted
                       border border-vs-border hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDeploy}
            disabled={!canDeploy}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold transition-colors ${
              canDeploy
                ? 'bg-vs-accent hover:bg-vs-accent/80 text-white'
                : 'bg-vs-panel text-vs-muted cursor-not-allowed'
            }`}
            title={!canDeploy ? 'Cần ít nhất 1 agent và 1 task đã phân công' : ''}
          >
            <Rocket size={13} />
            Deploy Team
          </button>
        </div>
      </div>

      {/* Bulk Skill Modal (portal-like, rendered inside component) */}
      {showBulkSkill && (
        <BulkSkillModal
          agents={localAgents}
          onApply={handleBulkApplySkill}
          onClose={() => setShowBulkSkill(false)}
        />
      )}
    </div>
  )
}
