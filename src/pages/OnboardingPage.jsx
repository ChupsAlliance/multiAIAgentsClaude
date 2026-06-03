import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, XCircle, Loader2, ArrowRight, Terminal, Settings, Zap } from 'lucide-react'

const STEPS = [
  { id: 'check',  label: 'Kiểm tra Claude CLI',     icon: Terminal },
  { id: 'enable', label: 'Bật Agent Teams',          icon: Settings },
  { id: 'done',   label: 'Sẵn sàng!',               icon: Zap },
]

export function OnboardingPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)           // 0,1,2
  const [status, setStatus] = useState('idle')  // idle | loading | ok | error
  const [detail, setDetail] = useState('')
  const [sysInfo, setSysInfo] = useState(null)

  useEffect(() => {
    invoke('get_system_info').then(info => {
      setSysInfo(info)
      // If already fully set up, skip to done
      if (info.claude_available && info.agent_teams_enabled) {
        setStep(2)
        setStatus('ok')
      }
    })
  }, [])

  const runStep = async () => {
    if (step === 0) {
      setStatus('loading')
      try {
        const ver = await invoke('check_claude_available')
        setDetail(ver || 'Claude CLI detected')
        setStatus('ok')
        setStep(1)
      } catch (err) {
        setDetail(err)
        setStatus('error')
      }
    } else if (step === 1) {
      setStatus('loading')
      try {
        const path = await invoke('enable_agent_teams')
        setDetail(`Đã ghi: ${path}`)
        setStatus('ok')
        setStep(2)
      } catch (err) {
        setDetail(err)
        setStatus('error')
      }
    } else {
      navigate('/')
    }
  }

  const stepLabels = {
    0: { btn: 'Kiểm tra ngay', loading: 'Đang kiểm tra...' },
    1: { btn: 'Bật Agent Teams', loading: 'Đang ghi settings...' },
    2: { btn: 'Vào app →', loading: '' },
  }

  return (
    <div className="min-h-screen bg-vs-bg flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="text-4xl mb-4">🤖</div>
          <h1 className="text-2xl font-bold text-white mb-2">Claude Code Agent Teams</h1>
          <p className="text-vs-muted text-sm">Hướng dẫn nội bộ · Thiết lập lần đầu</p>
        </div>

        {/* Steps */}
        <div className="space-y-3 mb-8">
          {STEPS.map((s, i) => {
            const Icon = s.icon
            const isDone   = i < step || (i === step && status === 'ok' && step === 2)
            const isActive = i === step
            const isFuture = i > step

            return (
              <div key={s.id} className={`flex items-center gap-4 p-4 rounded-lg border transition-colors
                ${isDone   ? 'border-vs-green/40 bg-vs-green/5' :
                  isActive ? 'border-vs-accent/60 bg-vs-accent/5' :
                             'border-vs-border bg-vs-panel/30 opacity-50'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0
                  ${isDone   ? 'bg-vs-green/20 text-vs-green' :
                    isActive ? 'bg-vs-accent/20 text-vs-accent' :
                               'bg-vs-border/30 text-vs-muted'}`}>
                  {isDone
                    ? <CheckCircle2 size={18} />
                    : isActive && status === 'loading'
                      ? <Loader2 size={16} className="animate-spin" />
                      : <Icon size={16} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${isDone ? 'text-vs-green' : isActive ? 'text-white' : 'text-vs-muted'}`}>
                    {s.label}
                  </p>
                  {isActive && detail && (
                    <p className={`text-xs font-mono mt-0.5 truncate ${status === 'error' ? 'text-vs-red' : 'text-vs-muted'}`}>
                      {detail}
                    </p>
                  )}
                </div>
                {isDone && <CheckCircle2 size={16} className="text-vs-green shrink-0" />}
                {isActive && status === 'error' && <XCircle size={16} className="text-vs-red shrink-0" />}
              </div>
            )
          })}
        </div>

        {/* Precheck info */}
        {sysInfo && step < 2 && (
          <div className="rounded-lg border border-vs-border bg-vs-panel/30 p-4 mb-6 text-xs font-mono space-y-1.5">
            <p className="text-vs-muted uppercase tracking-wide text-[10px] mb-2">Trạng thái hiện tại</p>
            <div className="flex justify-between">
              <span className="text-vs-muted">Claude CLI</span>
              <span className={sysInfo.claude_available ? 'text-vs-green' : 'text-vs-red'}>
                {sysInfo.claude_available ? '✓ Found' : '✗ Not found'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-vs-muted">Agent Teams config</span>
              <span className={sysInfo.agent_teams_enabled ? 'text-vs-green' : 'text-yellow-400'}>
                {sysInfo.agent_teams_enabled ? '✓ Enabled' : '○ Not yet'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-vs-muted">Settings path</span>
              <span className="text-vs-muted truncate ml-4 max-w-[200px]">{sysInfo.settings_path}</span>
            </div>
          </div>
        )}

        {/* Done card */}
        {step === 2 && (
          <div className="rounded-lg border border-vs-green/40 bg-vs-green/5 p-5 mb-6 text-center">
            <CheckCircle2 size={32} className="text-vs-green mx-auto mb-3" />
            <p className="text-white font-semibold">Tất cả đã sẵn sàng!</p>
            <p className="text-vs-muted text-xs mt-1">
              Claude CLI ✓ · Agent Teams enabled ✓ · Vào app để bắt đầu.
            </p>
          </div>
        )}

        {/* Error: claude not found */}
        {status === 'error' && step === 0 && (
          <div className="rounded-lg border border-vs-red/40 bg-vs-red/5 p-4 mb-6 text-xs text-vs-muted">
            <p className="text-vs-red font-semibold mb-1">Claude CLI chưa được cài đặt</p>
            <p>Truy cập <span className="text-vs-accent font-mono">claude.ai/code</span> để tải và cài Claude Code, sau đó chạy lại wizard này.</p>
          </div>
        )}

        {/* CTA Button */}
        <button
          onClick={runStep}
          disabled={status === 'loading'}
          className={`w-full flex items-center justify-center gap-2 py-3 rounded-lg font-semibold text-sm transition-colors
            ${status === 'loading'
              ? 'bg-vs-border text-vs-muted cursor-not-allowed'
              : step === 2
                ? 'bg-vs-green hover:bg-vs-green/90 text-black'
                : 'bg-vs-accent hover:bg-vs-accent2 text-white'}`}
        >
          {status === 'loading' ? (
            <><Loader2 size={16} className="animate-spin" />{stepLabels[step].loading}</>
          ) : (
            <>{stepLabels[step].btn}<ArrowRight size={16} /></>
          )}
        </button>

        {step < 2 && (
          <button onClick={() => navigate('/')} className="w-full mt-3 py-2 text-xs text-vs-muted hover:text-vs-text transition-colors">
            Bỏ qua, vào thẳng app
          </button>
        )}
      </div>
    </div>
  )
}
