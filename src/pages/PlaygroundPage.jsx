import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Sidebar } from '../components/Sidebar'
import { CodeBlock } from '../components/CodeBlock'
import { TEMPLATES } from '../data/templates'
import {
  Sparkles, FolderOpen, Terminal, Copy, Check,
  Clock, Trash2, Download, ChevronRight, Users,
  ArrowRight, CheckCircle2, AlertCircle
} from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────
function exportPrompt(prompt, templateLabel) {
  const blob = new Blob([prompt], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `agent-team-prompt-${templateLabel.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

function timeAgo(ts) {
  const diff = Date.now() - ts
  if (diff < 60000)  return 'vừa xong'
  if (diff < 3600000) return `${Math.floor(diff/60000)}p trước`
  if (diff < 86400000) return `${Math.floor(diff/3600000)}h trước`
  return new Date(ts).toLocaleDateString('vi-VN')
}

// ── Sub-components ─────────────────────────────────────────────
function TemplateCard({ tpl, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-3 rounded-lg border transition-colors text-xs
        ${selected
          ? 'border-vs-accent bg-vs-accent/10 text-white'
          : 'border-vs-border hover:border-vs-accent/40 text-vs-text hover:bg-white/5'}`}
    >
      <span className="text-xl block mb-1">{tpl.icon}</span>
      <span className="font-semibold block text-[13px]">{tpl.label}</span>
      <span className="text-vs-muted block mt-0.5 leading-relaxed">{tpl.desc}</span>
      <span className="mt-2 inline-flex items-center gap-1 text-vs-muted">
        <Users size={10} />{tpl.defaultTeamSize} agents
      </span>
    </button>
  )
}

function FieldInput({ field, value, onChange }) {
  return (
    <div>
      <label className="block text-xs text-vs-muted mb-1">
        {field.label}
        {field.required && <span className="text-vs-red ml-1">*</span>}
      </label>
      <input
        type={field.type || 'text'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={field.placeholder}
        className="w-full bg-[#1a1a1a] border border-vs-border rounded px-3 py-2 text-xs
          font-mono text-vs-text placeholder-vs-muted/50 focus:outline-none focus:border-vs-accent
          transition-colors"
      />
    </div>
  )
}

function LaunchStatus({ status, detail }) {
  if (!status) return null
  const cfg = {
    scaffolding: { icon: <Clock size={14} className="animate-spin text-vs-accent" />, text: 'Đang tạo files...', color: 'text-vs-accent' },
    launching:   { icon: <Terminal size={14} className="animate-pulse text-vs-accent" />, text: 'Đang mở terminal...', color: 'text-vs-accent' },
    done:        { icon: <CheckCircle2 size={14} className="text-vs-green" />, text: 'Terminal đã mở! Nhấn Enter trong terminal.', color: 'text-vs-green' },
    error:       { icon: <AlertCircle size={14} className="text-vs-red" />, text: detail, color: 'text-vs-red' },
  }
  const c = cfg[status]
  return (
    <div className={`flex items-center gap-2 text-xs ${c.color} bg-vs-panel border border-current/20 rounded-lg px-3 py-2`}>
      {c.icon}<span>{c.text}</span>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────
export function PlaygroundPage() {
  const [selectedTpl, setSelectedTpl] = useState(null)
  const [fields, setFields] = useState({})
  const [projectPath, setProjectPath] = useState('')
  const [teamSize, setTeamSize] = useState(3)
  const [generatedPrompt, setGeneratedPrompt] = useState('')
  const [copied, setCopied] = useState(false)
  const [history, setHistory] = useState([])
  const [view, setView] = useState('builder') // builder | history
  const [launchStatus, setLaunchStatus] = useState(null)
  const [launchDetail, setLaunchDetail] = useState('')
  const [scaffoldResult, setScaffoldResult] = useState(null)

  useEffect(() => { loadHistory() }, [])

  const loadHistory = async () => {
    try {
      const h = await invoke('load_history')
      setHistory(h)
    } catch { /* no history yet */ }
  }

  const selectTemplate = (tpl) => {
    setSelectedTpl(tpl)
    setFields({})
    setTeamSize(tpl.defaultTeamSize)
    setGeneratedPrompt('')
    setScaffoldResult(null)
    setLaunchStatus(null)
  }

  const updateField = (id, val) => {
    const newFields = { ...fields, [id]: val }
    setFields(newFields)
    if (selectedTpl) {
      setGeneratedPrompt(selectedTpl.buildPrompt(newFields))
    }
  }

  const pickFolder = async () => {
    try {
      const path = await invoke('pick_folder')
      setProjectPath(path)
    } catch { /* cancelled */ }
  }

  const handleLaunch = async () => {
    if (!generatedPrompt) return
    if (!projectPath) { alert('Vui lòng chọn project folder trước!'); return }

    // 1. Scaffold .md files
    setLaunchStatus('scaffolding')
    try {
      const result = await invoke('scaffold_project', {
        projectPath,
        templateId: selectedTpl.id,
        config: fields,
      })
      setScaffoldResult(result)
    } catch (err) {
      setLaunchStatus('error')
      setLaunchDetail(`Scaffold failed: ${err}`)
      return
    }

    // 2. Save to history
    await invoke('save_to_history', {
      entry: {
        id: Date.now().toString(),
        ts: Date.now(),
        template: selectedTpl.label,
        template_id: selectedTpl.id,
        project_path: projectPath,
        prompt: generatedPrompt,
        team_size: teamSize,
      }
    })
    await loadHistory()

    // 3. Open terminal
    setLaunchStatus('launching')
    try {
      await invoke('launch_in_terminal', { projectPath, prompt: generatedPrompt })
      setLaunchStatus('done')
    } catch (err) {
      setLaunchStatus('error')
      setLaunchDetail(`Terminal launch failed: ${err}`)
    }
  }

  const handleCopy = async () => {
    if (!generatedPrompt) return
    try { await navigator.clipboard.writeText(generatedPrompt) } catch { /* ignore */ }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const deleteHistoryItem = async (index) => {
    await invoke('delete_history_entry', { index })
    await loadHistory()
  }

  const reloadFromHistory = (item) => {
    const tpl = TEMPLATES.find(t => t.id === item.template_id)
    if (tpl) {
      setSelectedTpl(tpl)
      setTeamSize(item.team_size || tpl.defaultTeamSize)
      setGeneratedPrompt(item.prompt)
      setProjectPath(item.project_path || '')
      setScaffoldResult(null)
      setLaunchStatus(null)
    }
    setView('builder')
  }

  const missingRequired = selectedTpl?.fields
    .filter(f => f.required && !fields[f.id])
    .length > 0

  return (
    <div className="flex h-screen overflow-hidden bg-vs-bg">
      <Sidebar />
      <main className="flex-1 ml-0 md:ml-64 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">

          {/* Header + tabs */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <Sparkles size={16} className="text-vs-accent" />
                <h1 className="text-lg font-bold text-white">Playground</h1>
              </div>
              <p className="text-vs-muted text-xs">Chọn template, điền thông tin → app tự tạo file .MD + mở terminal</p>
            </div>
            <div className="flex rounded-lg overflow-hidden border border-vs-border">
              {['builder', 'history'].map(v => (
                <button key={v}
                  onClick={() => setView(v)}
                  className={`px-4 py-1.5 text-xs font-medium transition-colors
                    ${view === v ? 'bg-vs-accent text-white' : 'text-vs-muted hover:text-white hover:bg-white/5'}`}>
                  {v === 'builder' ? 'Builder' : `History (${history.length})`}
                </button>
              ))}
            </div>
          </div>

          {/* ── BUILDER VIEW ── */}
          {view === 'builder' && (
            <div className="grid gap-5 xl:grid-cols-[1fr_400px]">
              {/* Left column */}
              <div className="space-y-5">
                {/* Template grid */}
                <div>
                  <p className="text-[10px] text-vs-muted font-mono uppercase tracking-widest mb-2">1. Chọn template</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {TEMPLATES.map(tpl => (
                      <TemplateCard
                        key={tpl.id}
                        tpl={tpl}
                        selected={selectedTpl?.id === tpl.id}
                        onClick={() => selectTemplate(tpl)}
                      />
                    ))}
                  </div>
                </div>

                {/* Dynamic fields */}
                {selectedTpl && (
                  <div className="rounded-lg border border-vs-border bg-vs-panel/40 p-4 space-y-3">
                    <p className="text-[10px] text-vs-muted font-mono uppercase tracking-widest">2. Điền thông tin</p>
                    {selectedTpl.fields.map(field => (
                      <FieldInput
                        key={field.id}
                        field={field}
                        value={fields[field.id] || ''}
                        onChange={val => updateField(field.id, val)}
                      />
                    ))}

                    {/* Team size */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs text-vs-muted">Team size</label>
                        <span className={`text-xs font-mono font-bold ${teamSize > 5 ? 'text-yellow-400' : 'text-vs-accent'}`}>
                          {teamSize} agents {teamSize > 5 ? '(chi phí cao)' : ''}
                        </span>
                      </div>
                      <input type="range" min={2} max={6} value={teamSize}
                        onChange={e => setTeamSize(Number(e.target.value))}
                        className="w-full accent-vs-accent" />
                    </div>
                  </div>
                )}

                {/* Project folder */}
                {selectedTpl && (
                  <div className="rounded-lg border border-vs-border bg-vs-panel/40 p-4">
                    <p className="text-[10px] text-vs-muted font-mono uppercase tracking-widest mb-2">
                      3. Project folder <span className="text-vs-red">*</span>
                    </p>
                    <p className="text-xs text-vs-muted mb-3">
                      App sẽ tạo thư mục <code className="text-vs-string font-mono">.claude-agent-team/</code> và
                      các file .MD mẫu trong đây, sau đó mở terminal tại folder này.
                    </p>
                    <div className="flex gap-2">
                      <input
                        value={projectPath}
                        onChange={e => setProjectPath(e.target.value)}
                        placeholder="C:\Users\...\my-project"
                        className="flex-1 bg-[#1a1a1a] border border-vs-border rounded px-3 py-2 text-xs
                          font-mono text-vs-text placeholder-vs-muted/50 focus:outline-none focus:border-vs-accent"
                      />
                      <button onClick={pickFolder}
                        className="flex items-center gap-1.5 px-3 py-2 rounded border border-vs-border
                          text-vs-muted hover:text-white hover:border-vs-accent text-xs transition-colors">
                        <FolderOpen size={13} />Browse
                      </button>
                    </div>
                    {projectPath && (
                      <p className="text-[10px] text-vs-green font-mono mt-1.5">✓ {projectPath}</p>
                    )}
                  </div>
                )}

                {/* Scaffold result */}
                {scaffoldResult && (
                  <div className="rounded-lg border border-vs-green/30 bg-vs-green/5 p-4">
                    <div className="flex items-center gap-2 mb-2 text-vs-green text-xs font-semibold">
                      <CheckCircle2 size={14} />
                      Files .MD đã được tạo trong .claude-agent-team/
                    </div>
                    <div className="space-y-1">
                      {scaffoldResult.created_files?.map(f => (
                        <div key={f} className="text-[10px] font-mono text-vs-muted flex items-center gap-1.5">
                          <span className="text-vs-green">+</span>
                          {f.split(/[\\/]/).slice(-2).join('/')}
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => invoke('open_folder_in_explorer', { path: scaffoldResult.agent_dir })}
                      className="mt-3 text-[10px] text-vs-accent hover:underline flex items-center gap-1">
                      <FolderOpen size={10} />Mở folder trong Explorer
                    </button>
                  </div>
                )}
              </div>

              {/* Right column: prompt preview + actions */}
              <div className="space-y-4">
                <div>
                  <p className="text-[10px] text-vs-muted font-mono uppercase tracking-widest mb-2">Preview prompt</p>
                  {generatedPrompt ? (
                    <div className="max-h-[380px] overflow-y-auto rounded-lg">
                      <CodeBlock code={generatedPrompt} language="text" />
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-vs-border p-8 text-center text-vs-muted text-xs">
                      Chọn template và điền thông tin để xem prompt
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div className="space-y-2">
                  <button onClick={handleLaunch}
                    disabled={!generatedPrompt || !projectPath || missingRequired}
                    className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-semibold text-sm transition-colors
                      ${generatedPrompt && projectPath && !missingRequired
                        ? 'bg-vs-accent hover:bg-vs-accent2 text-white cursor-pointer'
                        : 'bg-vs-border text-vs-muted cursor-not-allowed'}`}>
                    <Terminal size={15} />
                    Launch — Tạo files &amp; Mở terminal
                    <ArrowRight size={14} />
                  </button>

                  {missingRequired && selectedTpl && (
                    <p className="text-[10px] text-yellow-400 text-center">
                      Điền đầy đủ các trường bắt buộc (*) để Launch
                    </p>
                  )}

                  <div className="flex gap-2">
                    <button onClick={handleCopy} disabled={!generatedPrompt}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs transition-colors
                        ${generatedPrompt ? 'border border-vs-border hover:border-vs-accent text-vs-text' : 'border border-vs-border text-vs-muted cursor-not-allowed opacity-50'}`}>
                      {copied ? <><Check size={12} />Copied!</> : <><Copy size={12} />Copy prompt</>}
                    </button>
                    <button
                      onClick={() => generatedPrompt && exportPrompt(generatedPrompt, selectedTpl?.label || 'prompt')}
                      disabled={!generatedPrompt}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs transition-colors
                        ${generatedPrompt ? 'border border-vs-border hover:border-vs-accent text-vs-text' : 'border border-vs-border text-vs-muted cursor-not-allowed opacity-50'}`}>
                      <Download size={12} />Export .txt
                    </button>
                  </div>
                </div>

                <LaunchStatus status={launchStatus} detail={launchDetail} />

                {/* Usage hint */}
                {launchStatus === 'done' && (
                  <div className="rounded-lg border border-vs-green/30 bg-vs-green/5 p-4 text-xs text-vs-text space-y-1.5">
                    <p className="font-semibold text-vs-green flex items-center gap-1.5">
                      <CheckCircle2 size={13} /> Terminal đã mở. Tiếp theo:
                    </p>
                    <ol className="space-y-1 ml-4 text-vs-muted">
                      <li>1. Nhấn <kbd className="bg-vs-border px-1 rounded font-mono">Enter</kbd> trong terminal để gửi prompt</li>
                      <li>2. Claude sẽ spawn teammates tự động</li>
                      <li>3. Dùng <kbd className="bg-vs-border px-1 rounded font-mono">Shift+↓</kbd> để switch giữa agents</li>
                      <li>4. Xem kết quả trong <code className="text-vs-string">.claude-agent-team/</code></li>
                    </ol>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── HISTORY VIEW ── */}
          {view === 'history' && (
            <div className="space-y-3">
              {history.length === 0 ? (
                <div className="text-center py-16 text-vs-muted text-sm">
                  <Clock size={32} className="mx-auto mb-3 opacity-30" />
                  <p>Chưa có lịch sử. Launch session đầu tiên từ Builder.</p>
                </div>
              ) : (
                history.map((item, i) => (
                  <div key={item.id || i}
                    className="rounded-lg border border-vs-border hover:border-vs-accent/30 bg-vs-panel/30 p-4 transition-colors">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-white text-sm font-semibold">{item.template}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-vs-accent/20 text-vs-accent">
                            {item.team_size || '?'} agents
                          </span>
                        </div>
                        <p className="text-vs-muted text-xs font-mono mt-0.5 truncate max-w-xs">
                          {item.project_path || 'no path'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-vs-muted">{timeAgo(item.ts)}</span>
                        <button onClick={() => reloadFromHistory(item)}
                          className="text-vs-accent hover:text-white text-xs flex items-center gap-1 transition-colors">
                          <ChevronRight size={12} />Dùng lại
                        </button>
                        <button onClick={() => deleteHistoryItem(i)}
                          className="text-vs-muted hover:text-vs-red transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    <pre className="text-[10px] text-vs-muted font-mono bg-[#1a1a1a] rounded p-2 line-clamp-3 overflow-hidden whitespace-pre-wrap">
                      {item.prompt?.slice(0, 200)}...
                    </pre>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
