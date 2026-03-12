import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Rocket, FolderOpen, Zap, History, Trash2, Cpu, Eye, EyeOff, Users, FlaskConical, Paperclip, FileText, Image, Folder, Upload, X, AtSign } from 'lucide-react'
import { buildMissionPrompt } from '../../data/promptWrapper'
import { useTauriFileDrop } from '../../hooks/useTauriFileDrop'

const MODELS = [
  { id: 'sonnet',  label: 'Sonnet 4.6',  desc: 'Nhanh, tiết kiệm — phù hợp task đơn giản', badge: 'Fast' },
  { id: 'opus',    label: 'Opus 4.6',    desc: 'Mạnh nhất — task phức tạp, multi-agent', badge: 'Best' },
  { id: 'haiku',   label: 'Haiku 4.5',   desc: 'Siêu nhanh, rẻ — draft/prototype', badge: 'Cheap' },
]

const EXEC_MODES = [
  {
    id: 'standard',
    label: 'Standard',
    desc: 'Agents chạy tuần tự qua Lead, output đầy đủ',
    icon: Cpu,
    experimental: false,
  },
  {
    id: 'agent_teams',
    label: 'Agent Teams',
    desc: 'Agents giao tiếp qua SendMessage, chạy song song độc lập',
    icon: Users,
    experimental: true,
  },
]

export function MissionLauncher({ onLaunch }) {
  const [requirement, setRequirement] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [teamHint, setTeamHint] = useState(3)
  const [model, setModel] = useState('sonnet')
  const [executionMode, setExecutionMode] = useState('standard')
  const [launching, setLaunching] = useState(false)
  const [history, setHistory] = useState([])
  const [showPrompt, setShowPrompt] = useState(false)
  const [showAllHistory, setShowAllHistory] = useState(false)
  const [references, setReferences] = useState([]) // { type: 'file'|'folder'|'image', name, path, size, content? }

  // @mention state
  const [mentionQuery, setMentionQuery] = useState(null) // null = not mentioning, string = query after @
  const [mentionResults, setMentionResults] = useState([])
  const [mentionIndex, setMentionIndex] = useState(0) // selected index in dropdown
  const [mentionCursorPos, setMentionCursorPos] = useState(0) // cursor position where @ was typed
  const textareaRef = useRef(null)
  const mentionDropdownRef = useRef(null)

  // Helper: process a list of file paths from Tauri (native DnD or pick_files)
  const addFilePaths = useCallback(async (paths) => {
    for (const filePath of paths) {
      try {
        const info = await invoke('get_file_info', { path: filePath })
        // Check if it's a directory (size === 0 and no extension — heuristic; also check via Rust)
        if (info.is_dir) {
          const name = filePath.split(/[/\\]/).pop() || filePath
          setReferences(prev => [...prev, { type: 'folder', name, size: 0, content: null, path: filePath }])
          continue
        }
        const ext = info.extension?.toLowerCase() || ''
        const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)
        let content = null
        if (!isImage && info.size < 500000) {
          content = await invoke('read_file_content', { path: filePath }).catch(() => null)
        }
        setReferences(prev => [...prev, {
          type: isImage ? 'image' : 'file',
          name: info.name,
          size: info.size,
          content,
          path: filePath,
        }])
      } catch {
        // Skip unreadable files
      }
    }
  }, [])

  // Tauri native drag-and-drop (works on Windows where HTML5 DnD is intercepted)
  const { isDragging } = useTauriFileDrop(useCallback((paths) => {
    addFilePaths(paths)
  }, [addFilePaths]))

  // Clipboard paste image handler (Ctrl+V with image in clipboard)
  const handlePaste = useCallback(async (e) => {
    const items = e.clipboardData?.items
    if (!items) return

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const blob = item.getAsFile()
        if (!blob) continue

        // Convert blob to base64
        const reader = new FileReader()
        reader.onload = async () => {
          const base64 = reader.result.split(',')[1] // strip "data:image/png;base64,"
          try {
            const result = await invoke('save_clipboard_image', { base64Data: base64 })
            setReferences(prev => [...prev, {
              type: 'image',
              name: result.name,
              size: result.size,
              content: null,
              path: result.path,
            }])
          } catch (err) {
            console.error('Failed to save clipboard image:', err)
          }
        }
        reader.readAsDataURL(blob)
        break // only handle first image
      }
    }
  }, [])

  // @mention: detect @ in textarea, search project files
  const handleMentionInput = useCallback(async (e) => {
    const val = e.target.value
    setRequirement(val)

    const cursor = e.target.selectionStart
    // Find the last '@' before cursor that starts a mention
    const textBefore = val.slice(0, cursor)
    const atIdx = textBefore.lastIndexOf('@')

    if (atIdx >= 0) {
      // Check that @ is at start or preceded by whitespace/newline
      const charBefore = atIdx > 0 ? textBefore[atIdx - 1] : ' '
      if (charBefore === ' ' || charBefore === '\n' || charBefore === '\t' || atIdx === 0) {
        const query = textBefore.slice(atIdx + 1)
        // Only trigger if query doesn't contain spaces (user is still typing filename)
        if (!query.includes(' ') && query.length <= 60) {
          setMentionQuery(query)
          setMentionCursorPos(atIdx)
          setMentionIndex(0)

          // Search files if project path is set and query is non-empty
          if (projectPath && query.length >= 1) {
            try {
              const results = await invoke('search_project_files', {
                projectPath, query
              })
              setMentionResults(results || [])
            } catch {
              setMentionResults([])
            }
          } else if (query.length === 0) {
            // Show hint but no results yet
            setMentionResults([])
          }
          return
        }
      }
    }

    // No active mention
    setMentionQuery(null)
    setMentionResults([])
  }, [projectPath])

  // @mention: select a file from dropdown
  const selectMention = useCallback(async (file) => {
    const textarea = textareaRef.current
    if (!textarea) return

    // Replace @query with @filename
    const before = requirement.slice(0, mentionCursorPos)
    const afterQuery = requirement.slice(mentionCursorPos)
    // Find end of mention query (next space or end of string)
    const afterAt = afterQuery.slice(1) // skip the @
    const spaceIdx = afterAt.search(/[\s]/)
    const after = spaceIdx >= 0 ? afterAt.slice(spaceIdx) : ''

    const newText = before + '@' + file.relative + ' ' + after
    setRequirement(newText)
    setMentionQuery(null)
    setMentionResults([])

    // Add file to references
    try {
      const info = await invoke('get_file_info', { path: file.path })
      const ext = info.extension?.toLowerCase() || ''
      const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)
      let content = null
      if (!isImage && info.size < 500000) {
        content = await invoke('read_file_content', { path: file.path }).catch(() => null)
      }
      // Don't add duplicate
      setReferences(prev => {
        if (prev.some(r => r.path === file.path)) return prev
        return [...prev, {
          type: isImage ? 'image' : 'file',
          name: file.name,
          size: file.size,
          content,
          path: file.path,
        }]
      })
    } catch {}

    // Refocus textarea
    setTimeout(() => textarea.focus(), 50)
  }, [requirement, mentionCursorPos])

  // @mention: keyboard navigation in dropdown
  const handleTextareaKeyDown = useCallback((e) => {
    if (mentionQuery !== null && mentionResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex(prev => Math.min(prev + 1, mentionResults.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex(prev => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        selectMention(mentionResults[mentionIndex])
      } else if (e.key === 'Escape') {
        setMentionQuery(null)
        setMentionResults([])
      }
    }
  }, [mentionQuery, mentionResults, mentionIndex, selectMention])

  // Close mention dropdown when clicking outside
  useEffect(() => {
    const handleClick = (e) => {
      if (mentionDropdownRef.current && !mentionDropdownRef.current.contains(e.target) &&
          textareaRef.current && !textareaRef.current.contains(e.target)) {
        setMentionQuery(null)
        setMentionResults([])
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const previewPrompt = useMemo(() => {
    if (!requirement.trim()) return ''
    return buildMissionPrompt(requirement, {
      projectPath: projectPath || '(chưa chọn)',
      teamHint: `Use ${teamHint} teammates for this task`,
      references,
    })
  }, [requirement, projectPath, teamHint, references])

  useEffect(() => {
    invoke('load_history').then(setHistory).catch(() => {})
  }, [])

  const handlePickFolder = async () => {
    try {
      const path = await invoke('pick_folder')
      setProjectPath(path)
    } catch {}
  }

  const handleLaunch = async () => {
    if (!requirement.trim() || !projectPath.trim()) return
    setLaunching(true)

    try {
      const prompt = buildMissionPrompt(requirement, {
        projectPath,
        teamHint: `Use ${teamHint} teammates for this task`,
        references,
      })

      // Save to history — store full requirement
      await invoke('save_to_history', {
        entry: {
          description: requirement,
          project_path: projectPath,
          team_size: teamHint,
          timestamp: Date.now(),
        }
      }).catch(() => {})

      await onLaunch({ projectPath, prompt, description: requirement, model, executionMode })
    } catch (err) {
      console.error('Launch failed:', err)
    } finally {
      setLaunching(false)
    }
  }

  const handleDeleteHistory = async (index) => {
    await invoke('delete_history_entry', { index }).catch(() => {})
    const updated = await invoke('load_history').catch(() => [])
    setHistory(updated || [])
  }

  const handleReuse = (entry) => {
    setRequirement(entry.description || '')
    setProjectPath(entry.project_path || '')
    setTeamHint(entry.team_size || 3)
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Hero */}
      <div className="text-center space-y-3 pt-8">
        <div className="w-14 h-14 mx-auto rounded-xl bg-vs-accent/20 border border-vs-accent/40 flex items-center justify-center">
          <Rocket size={24} className="text-vs-accent" />
        </div>
        <h1 className="text-xl font-bold text-white">Mission Control</h1>
        <p className="text-sm text-vs-muted max-w-md mx-auto">
          Mô tả yêu cầu bằng ngôn ngữ tự nhiên, chọn thư mục project, nhấn Launch.
          Agent Team sẽ tự động phân tích và thực thi.
        </p>
      </div>

      {/* Input form */}
      <div className="space-y-4 p-5 rounded-xl border border-vs-border bg-vs-sidebar">
        {/* Project path — FIRST so @mention knows where to search */}
        <div className="space-y-1.5">
          <label className="text-xs font-mono text-vs-muted uppercase tracking-wider flex items-center gap-1.5">
            <FolderOpen size={11} />
            Thư mục Project
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
              placeholder="D:\projects\my-app"
              className="flex-1 bg-vs-bg border border-vs-border rounded-lg px-3 py-2
                         text-sm text-vs-text font-mono placeholder-vs-muted/50
                         focus:outline-none focus:border-vs-accent/60"
            />
            <button
              onClick={handlePickFolder}
              className="px-3 py-2 bg-vs-panel border border-vs-border rounded-lg text-xs font-mono
                         text-vs-text hover:bg-white/10 transition-colors"
            >
              Browse
            </button>
          </div>
        </div>

        {/* Requirement textarea */}
        <div className="space-y-1.5">
          <label className="text-xs font-mono text-vs-muted uppercase tracking-wider flex items-center gap-1.5">
            <Zap size={11} />
            Yêu cầu của bạn
          </label>
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={requirement}
              onChange={handleMentionInput}
              onKeyDown={handleTextareaKeyDown}
              onPaste={handlePaste}
              placeholder="Ví dụ: Build a user authentication feature with login, register, and password reset. Use Express.js for backend and React for frontend..."
              className="w-full h-32 resize-y bg-vs-bg border border-vs-border rounded-lg px-3 py-2.5
                         text-sm text-vs-text font-mono placeholder-vs-muted/50
                         focus:outline-none focus:border-vs-accent/60 focus:ring-1 focus:ring-vs-accent/30
                         transition-colors"
            />
            {/* @mention dropdown */}
            {mentionQuery !== null && mentionResults.length > 0 && (
              <div ref={mentionDropdownRef}
                className="absolute left-0 right-0 bottom-full mb-1 max-h-48 overflow-y-auto
                           bg-vs-panel border border-vs-border rounded-lg shadow-xl z-50">
                <div className="px-2.5 py-1.5 text-[9px] font-mono text-vs-muted uppercase tracking-wider border-b border-vs-border/50">
                  <AtSign size={9} className="inline mr-1" />
                  Mention file — {mentionResults.length} kết quả
                </div>
                {mentionResults.map((file, i) => (
                  <button
                    key={file.path}
                    onClick={() => selectMention(file)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                      i === mentionIndex
                        ? 'bg-vs-accent/20 text-vs-text'
                        : 'hover:bg-vs-bg text-vs-muted'
                    }`}
                  >
                    {file.is_image
                      ? <Image size={12} className="text-green-400 shrink-0" />
                      : <FileText size={12} className="text-blue-400 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] font-mono truncate block">{file.name}</span>
                      <span className="text-[9px] text-vs-muted/60 truncate block">{file.relative}</span>
                    </div>
                    <span className="text-[9px] text-vs-muted/50 shrink-0">
                      {(file.size / 1024).toFixed(1)}KB
                    </span>
                  </button>
                ))}
              </div>
            )}
            {mentionQuery !== null && mentionResults.length === 0 && mentionQuery.length >= 1 && (
              <div className="absolute left-0 right-0 bottom-full mb-1
                             bg-vs-panel border border-vs-border rounded-lg shadow-xl z-50 px-3 py-2">
                <span className="text-[10px] font-mono text-vs-muted">
                  Không tìm thấy file "{mentionQuery}" trong project
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 text-[9px] text-vs-muted/60 font-mono px-0.5">
            <span className="flex items-center gap-1">
              <AtSign size={8} /> Gõ @ để mention file
            </span>
            <span>·</span>
            <span>Ctrl+V để dán ảnh từ clipboard</span>
          </div>
        </div>

        {/* Reference Materials — always visible */}
        <div className="space-y-2">
          <label className="flex items-center gap-1.5 text-xs font-mono text-vs-muted uppercase tracking-wider">
            <Paperclip size={11} />
            Tài liệu tham khảo {references.length > 0 && `(${references.length})`}
          </label>

          {/* List of attached references */}
          {references.length > 0 && (
            <div className="space-y-1">
              {references.map((ref, i) => (
                <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-vs-panel border border-vs-border group">
                  {ref.type === 'file' && <FileText size={12} className="text-blue-400 shrink-0" />}
                  {ref.type === 'folder' && <Folder size={12} className="text-yellow-400 shrink-0" />}
                  {ref.type === 'image' && <Image size={12} className="text-green-400 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <span className="text-[11px] font-mono text-vs-text truncate block">{ref.name}</span>
                    <span className="text-[9px] text-vs-muted">
                      {ref.type === 'folder' ? 'folder' : `${(ref.size / 1024).toFixed(1)} KB`}
                    </span>
                  </div>
                  <button
                    onClick={() => setReferences(prev => prev.filter((_, j) => j !== i))}
                    className="opacity-0 group-hover:opacity-100 text-vs-muted hover:text-red-400 transition-colors shrink-0"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Upload zone: drag files from OS, or click buttons to pick files/folders */}
          <div
            className={`flex flex-col items-center justify-center gap-2 px-4 py-4 rounded-lg border-2 border-dashed transition-colors ${
              isDragging
                ? 'border-vs-accent bg-vs-accent/10'
                : 'border-vs-border/50'
            }`}
          >
            <Upload size={16} className={isDragging ? 'text-vs-accent' : 'text-vs-muted'} />
            <span className="text-[10px] font-mono text-vs-muted text-center">
              {isDragging ? 'Thả file vào đây...' : 'Kéo thả file/folder vào đây, hoặc:'}
            </span>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  try {
                    const paths = await invoke('pick_files')
                    if (paths && paths.length > 0) await addFilePaths(paths)
                  } catch {}
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-mono
                           bg-vs-bg border border-vs-border text-vs-muted
                           hover:border-vs-accent/40 hover:text-vs-text transition-colors cursor-pointer"
              >
                <FileText size={10} /> Chọn file
              </button>
              <button
                onClick={async () => {
                  try {
                    const path = await invoke('pick_folder')
                    if (path) {
                      const name = path.split(/[/\\]/).pop() || path
                      setReferences(prev => [...prev, { type: 'folder', name, size: 0, content: null, path }])
                    }
                  } catch {}
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-mono
                           bg-vs-bg border border-vs-border text-vs-muted
                           hover:border-vs-accent/40 hover:text-vs-text transition-colors cursor-pointer"
              >
                <Folder size={10} /> Chọn folder
              </button>
            </div>
            <span className="text-[9px] text-vs-muted/60 font-mono">
              Hỗ trợ: docs, code, images, folders
            </span>
          </div>
        </div>

        {/* Model selector */}
        <div className="space-y-1.5">
          <label className="text-xs font-mono text-vs-muted uppercase tracking-wider flex items-center gap-1.5">
            <Cpu size={11} />
            Model
          </label>
          <div className="grid grid-cols-3 gap-2">
            {MODELS.map(m => (
              <button
                key={m.id}
                onClick={() => setModel(m.id)}
                className={`relative text-left px-3 py-2.5 rounded-lg border text-xs transition-colors ${
                  model === m.id
                    ? 'border-vs-accent bg-vs-accent/10 text-white'
                    : 'border-vs-border bg-vs-bg text-vs-muted hover:border-vs-text/30 hover:bg-white/5'
                }`}
              >
                <span className="font-semibold block">{m.label}</span>
                <span className="text-[10px] text-vs-muted block mt-0.5 leading-tight">{m.desc}</span>
                <span className={`absolute top-1.5 right-1.5 text-[9px] font-mono px-1 py-0.5 rounded ${
                  model === m.id ? 'bg-vs-accent/30 text-vs-accent' : 'bg-vs-panel text-vs-muted'
                }`}>{m.badge}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Execution Mode selector */}
        <div className="space-y-1.5">
          <label className="text-xs font-mono text-vs-muted uppercase tracking-wider flex items-center gap-1.5">
            <Users size={11} />
            Execution Mode
          </label>
          <div className="grid grid-cols-2 gap-2">
            {EXEC_MODES.map(mode => {
              const Icon = mode.icon
              return (
                <button
                  key={mode.id}
                  onClick={() => setExecutionMode(mode.id)}
                  className={`relative text-left px-3 py-2.5 rounded-lg border text-xs transition-colors ${
                    executionMode === mode.id
                      ? mode.experimental
                        ? 'border-yellow-500/60 bg-yellow-500/10 text-white'
                        : 'border-vs-accent bg-vs-accent/10 text-white'
                      : 'border-vs-border bg-vs-bg text-vs-muted hover:border-vs-text/30 hover:bg-white/5'
                  }`}
                >
                  <span className="font-semibold flex items-center gap-1.5">
                    <Icon size={11} />
                    {mode.label}
                  </span>
                  <span className="text-[10px] text-vs-muted block mt-0.5 leading-tight">{mode.desc}</span>
                  {mode.experimental && (
                    <span className={`absolute top-1.5 right-1.5 flex items-center gap-0.5 text-[9px] font-mono px-1 py-0.5 rounded ${
                      executionMode === mode.id ? 'bg-yellow-500/30 text-yellow-300' : 'bg-vs-panel text-vs-muted'
                    }`}>
                      <FlaskConical size={8} />
                      Exp.
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          {executionMode === 'agent_teams' && (
            <p className="text-[10px] text-yellow-400/80 font-mono bg-yellow-500/5 border border-yellow-500/20 rounded px-2 py-1.5 leading-relaxed">
              ⚗ Experimental: Agents giao tiếp qua SendMessage. Tab Messages sẽ hiển thị messages thực tế.
              Backend polling task files mỗi 2s để cập nhật Tasks và Files.
            </p>
          )}
        </div>

        {/* Team size */}
        <div className="space-y-1.5">
          <label className="text-xs font-mono text-vs-muted uppercase tracking-wider">
            Team Size: {teamHint} agents
          </label>
          <input
            type="range"
            min={2}
            max={6}
            value={teamHint}
            onChange={(e) => setTeamHint(Number(e.target.value))}
            className="w-full accent-vs-accent"
          />
          <div className="flex justify-between text-[10px] text-vs-muted font-mono">
            <span>2 (nhỏ)</span>
            <span>4 (tiêu chuẩn)</span>
            <span>6 (lớn)</span>
          </div>
        </div>

        {/* System Prompt Preview */}
        {requirement.trim() && (
          <div className="space-y-1.5">
            <button
              onClick={() => setShowPrompt(!showPrompt)}
              className="flex items-center gap-1.5 text-[10px] font-mono text-vs-muted hover:text-vs-text transition-colors uppercase tracking-wider"
            >
              {showPrompt ? <EyeOff size={10} /> : <Eye size={10} />}
              {showPrompt ? 'Ẩn System Prompt' : 'Xem System Prompt sẽ gửi đi'}
            </button>
            {showPrompt && (
              <div className="relative">
                <pre className="bg-black/40 border border-vs-border rounded-lg p-3 text-[10px] font-mono text-vs-muted leading-relaxed max-h-64 overflow-auto scrollbar-thin whitespace-pre-wrap break-words">
                  {previewPrompt}
                </pre>
                <div className="absolute top-2 right-2 flex gap-1">
                  <span className="px-1.5 py-0.5 rounded text-[8px] font-mono bg-vs-accent/20 text-vs-accent">
                    READ-ONLY
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Launch button */}
        <button
          onClick={handleLaunch}
          disabled={!requirement.trim() || !projectPath.trim() || launching}
          className={`w-full flex items-center justify-center gap-2 py-3 rounded-lg font-semibold text-sm transition-colors ${
            !requirement.trim() || !projectPath.trim() || launching
              ? 'bg-vs-panel text-vs-muted cursor-not-allowed'
              : 'bg-vs-accent text-white hover:bg-vs-accent/80 shadow-lg shadow-vs-accent/20'
          }`}
        >
          {launching ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Đang khởi chạy...
            </>
          ) : (
            <>
              <Rocket size={16} />
              Launch Mission
            </>
          )}
        </button>
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-vs-muted font-mono flex items-center gap-1.5 px-1">
            <History size={10} />
            Lịch sử ({history.length})
          </p>
          <div className="space-y-1">
            {(showAllHistory ? history : history.slice(0, 5)).map((entry, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-3 py-2 rounded-md border border-vs-border bg-vs-panel
                           hover:bg-white/5 transition-colors group"
              >
                <button
                  onClick={() => handleReuse(entry)}
                  className="flex-1 text-left min-w-0"
                >
                  <p className="text-xs text-vs-text truncate">{entry.description}</p>
                  <p className="text-[10px] text-vs-muted font-mono truncate">
                    {entry.project_path} · {entry.team_size || 3} agents
                  </p>
                </button>
                <button
                  onClick={() => handleDeleteHistory(i)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-vs-muted hover:text-vs-red transition-colors"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            {history.length > 5 && (
              <button
                onClick={() => setShowAllHistory(!showAllHistory)}
                className="w-full text-center text-[10px] font-mono text-vs-accent hover:text-white transition-colors py-1.5"
              >
                {showAllHistory ? 'Thu gọn' : `Xem tất cả (${history.length})`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
