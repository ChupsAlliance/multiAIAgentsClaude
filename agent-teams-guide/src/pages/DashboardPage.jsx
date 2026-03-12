import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Sidebar } from '../components/Sidebar'
import { CodeBlock } from '../components/CodeBlock'
import {
  LayoutDashboard, Terminal, CheckCircle2, XCircle,
  Clock, Play, Trash2, AlertCircle, Settings
} from 'lucide-react'

const setupCode = `// 1. Bật Agent Teams trong ~/.claude/settings.json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}

// 2. Mở terminal và chạy claude
// 3. Paste prompt từ Playground tab`

const launchCode = `# Cách đúng để dùng Agent Teams
# Mở terminal mới và chạy:

set CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
claude "Your agent team prompt here..."`

export function DashboardPage() {
  const [claudeStatus, setClaudeStatus] = useState(null)
  const [systemInfo, setSystemInfo] = useState(null)
  const [sessions, setSessions] = useState([])
  const [output, setOutput] = useState({})
  const [checkingClaude, setCheckingClaude] = useState(false)

  useEffect(() => {
    checkClaude()
    loadSystemInfo()
    // Listen for claude output events
    const unlisten = listen('claude-output', (event) => {
      const { session_id, content, output_type } = event.payload
      setOutput(prev => ({
        ...prev,
        [session_id]: [
          ...(prev[session_id] || []),
          { content, type: output_type, ts: Date.now() }
        ]
      }))
      if (output_type === 'exit') {
        setSessions(prev => prev.map(s =>
          s.id === session_id ? { ...s, status: 'done' } : s
        ))
      }
    })
    return () => { unlisten.then(f => f()) }
  }, [])

  const checkClaude = async () => {
    setCheckingClaude(true)
    try {
      const version = await invoke('check_claude_available')
      setClaudeStatus({ ok: true, version })
    } catch (err) {
      setClaudeStatus({ ok: false, error: err })
    } finally {
      setCheckingClaude(false)
    }
  }

  const loadSystemInfo = async () => {
    try {
      const info = await invoke('get_system_info')
      setSystemInfo(info)
    } catch { /* ignore */ }
  }

  const launchAgentTeam = async (prompt) => {
    try {
      await invoke('launch_agent_team', { prompt })
    } catch (err) {
      console.error('Launch failed:', err)
    }
  }

  const clearSession = (id) => {
    setSessions(prev => prev.filter(s => s.id !== id))
    setOutput(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  const statusCards = [
    {
      label: 'Claude CLI',
      icon: claudeStatus?.ok ? CheckCircle2 : XCircle,
      value: claudeStatus?.ok ? claudeStatus.version || 'Available' : 'Not found',
      status: claudeStatus?.ok ? 'ok' : claudeStatus ? 'error' : 'unknown',
    },
    {
      label: 'Agent Teams',
      icon: systemInfo ? (systemInfo.settings_exist ? CheckCircle2 : AlertCircle) : Clock,
      value: systemInfo?.settings_exist ? 'Config found' : 'Not configured',
      status: systemInfo?.settings_exist ? 'ok' : 'warning',
    },
    {
      label: 'Platform',
      icon: Settings,
      value: systemInfo?.platform || 'Detecting...',
      status: 'info',
    },
    {
      label: 'Active Sessions',
      icon: Terminal,
      value: `${sessions.filter(s => s.status === 'running').length} running`,
      status: 'info',
    },
  ]

  return (
    <div className="flex h-screen overflow-hidden bg-vs-bg">
      <Sidebar />

      <main className="flex-1 ml-0 md:ml-64 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-10 space-y-8">
          {/* Header */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <LayoutDashboard size={18} className="text-vs-accent" />
              <h1 className="text-xl font-bold text-white">Dashboard</h1>
            </div>
            <p className="text-vs-muted text-sm">Trạng thái hệ thống và quản lý Claude Agent Teams sessions.</p>
          </div>

          {/* Status cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {statusCards.map(({ label, icon: Icon, value, status }) => {
              const colors = {
                ok:      'border-vs-green text-vs-green',
                error:   'border-vs-red text-vs-red',
                warning: 'border-yellow-500 text-yellow-400',
                info:    'border-vs-border text-vs-muted',
                unknown: 'border-vs-border text-vs-muted',
              }
              return (
                <div key={label} className={`rounded-lg border ${colors[status].split(' ')[0]} bg-vs-panel/50 p-4`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon size={14} className={colors[status].split(' ')[1]} />
                    <span className="text-xs text-vs-muted font-mono">{label}</span>
                  </div>
                  <p className="text-sm font-medium text-white font-mono truncate">{value}</p>
                </div>
              )
            })}
          </div>

          {/* Check button */}
          <div className="flex gap-3">
            <button
              onClick={checkClaude}
              disabled={checkingClaude}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-vs-accent/20 border border-vs-accent/40
                text-vs-accent hover:bg-vs-accent/30 text-sm transition-colors disabled:opacity-50"
            >
              <Play size={14} className={checkingClaude ? 'animate-spin' : ''} />
              {checkingClaude ? 'Checking...' : 'Re-check Claude CLI'}
            </button>
          </div>

          {/* Setup guide if not configured */}
          {claudeStatus && !claudeStatus.ok && (
            <div className="rounded-lg border border-vs-red/40 bg-vs-red/10 p-5 space-y-3">
              <div className="flex items-center gap-2 text-vs-red font-semibold">
                <XCircle size={16} />
                Claude CLI không tìm thấy
              </div>
              <p className="text-vs-text text-sm">
                Cần cài đặt Claude Code CLI trước khi dùng Agent Teams.
                Tải về tại: <span className="text-vs-accent font-mono">claude.ai/download</span>
              </p>
            </div>
          )}

          {/* How to launch */}
          <div>
            <h2 className="text-white font-semibold mb-3 flex items-center gap-2">
              <Terminal size={16} className="text-vs-accent" />
              Cách launch Agent Teams
            </h2>
            <p className="text-vs-muted text-xs mb-3">
              Agent Teams cần chạy trong <strong className="text-vs-text">interactive terminal session</strong>.
              Dùng Playground tab để compose prompt, sau đó chạy trong terminal.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="text-xs text-vs-muted font-mono mb-2">1. Setup settings</p>
                <CodeBlock code={setupCode} language="json" />
              </div>
              <div>
                <p className="text-xs text-vs-muted font-mono mb-2">2. Launch trong terminal</p>
                <CodeBlock code={launchCode} language="bash" />
              </div>
            </div>
          </div>

          {/* Quick launch */}
          <div>
            <h2 className="text-white font-semibold mb-3 flex items-center gap-2">
              <Play size={16} className="text-vs-accent" />
              Quick Launch — Mở terminal với Agent Teams
            </h2>
            <p className="text-vs-muted text-xs mb-3">
              Mở Windows Terminal hoặc CMD với <code className="text-vs-string font-mono">CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1</code> đã set sẵn.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => launchAgentTeam('Hello, I need an agent team. What can you help with?')}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-vs-accent text-white
                  hover:bg-vs-accent2 text-sm transition-colors font-medium"
              >
                <Terminal size={14} />
                Mở terminal với Agent Teams enabled
              </button>
            </div>
          </div>

          {/* Settings path */}
          {systemInfo && (
            <div className="rounded-lg border border-vs-border bg-vs-panel/30 p-4">
              <p className="text-xs text-vs-muted font-mono uppercase tracking-wide mb-2">Settings file path</p>
              <code className="text-vs-string font-mono text-xs">{systemInfo.settings_path}</code>
              <span className={`ml-3 text-[10px] font-mono px-2 py-0.5 rounded-full
                ${systemInfo.settings_exist
                  ? 'bg-vs-green/20 text-vs-green'
                  : 'bg-vs-red/20 text-vs-red'}`}>
                {systemInfo.settings_exist ? '✓ Exists' : '✗ Not found'}
              </span>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
