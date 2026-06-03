import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { Bot, BookOpen, Play, LayoutDashboard, Menu, X, ChevronRight, Settings, Rocket, Sparkles } from 'lucide-react'
import { sections } from '../data/sections'
import { APP_VERSION } from '../data/changelog'

const navItems = [
  { path: '/',           label: 'Tài liệu',        icon: BookOpen },
  { path: '/playground', label: 'Playground',       icon: Play },
  { path: '/mission',    label: 'Mission Control',  icon: Rocket },
  { path: '/dashboard',  label: 'Dashboard',        icon: LayoutDashboard },
  { path: '/setup',      label: 'Setup',            icon: Settings },
]

export function Sidebar({ activeSection }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [progress, setProgress] = useState(0)
  const [agentTeamsOk, setAgentTeamsOk] = useState(null)

  useEffect(() => {
    // Check once on mount only — not on every route change
    invoke('get_system_info').then(info => {
      setAgentTeamsOk(info.claude_available && info.agent_teams_enabled)
    }).catch(() => setAgentTeamsOk(false))
  }, [])

  useEffect(() => {
    const onScroll = () => {
      const el = document.getElementById('main-scroll')
      if (!el) return
      const { scrollTop, scrollHeight, clientHeight } = el
      setProgress(scrollHeight > clientHeight ? (scrollTop / (scrollHeight - clientHeight)) * 100 : 0)
    }
    const el = document.getElementById('main-scroll')
    el?.addEventListener('scroll', onScroll)
    return () => el?.removeEventListener('scroll', onScroll)
  }, [])

  const isDocsPage = location.pathname === '/'

  const scrollToSection = (id) => {
    if (location.pathname !== '/') {
      navigate('/')
      setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    } else {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    setMobileOpen(false)
  }

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed top-3 left-3 z-50 md:hidden bg-vs-sidebar border border-vs-border p-1.5 rounded no-drag"
      >
        {mobileOpen ? <X size={18} /> : <Menu size={18} />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/60 z-30 md:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed left-0 top-0 h-screen w-64 bg-vs-sidebar border-r border-vs-border
        flex flex-col z-40 transition-transform duration-300
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0
      `}>
        {/* Logo */}
        <div className="p-4 border-b border-vs-border">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded bg-vs-accent/20 border border-vs-accent/40 flex items-center justify-center">
              <Bot size={15} className="text-vs-accent" />
            </div>
            <div>
              <p className="text-xs font-bold text-white font-mono">Claude Code</p>
              <p className="text-[10px] text-vs-muted font-mono">Agent Teams Guide</p>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        {isDocsPage && (
          <div className="h-0.5 w-full bg-vs-border">
            <div className="h-full bg-vs-accent transition-colors duration-200" style={{ width: `${progress}%` }} />
          </div>
        )}

        {/* Main nav */}
        <div className="px-3 py-3 border-b border-vs-border">
          {navItems.map(({ path, label, icon: Icon }) => {
            const active = location.pathname === path
            return (
              <button
                key={path}
                onClick={() => { navigate(path); setMobileOpen(false) }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors mb-0.5 no-drag
                  ${active ? 'bg-vs-accent/15 text-white' : 'text-vs-text hover:bg-white/5 hover:text-white'}`}
              >
                <Icon size={15} className={active ? 'text-vs-accent' : 'text-vs-muted'} />
                <span className="font-medium">{label}</span>
                {active && <ChevronRight size={12} className="ml-auto text-vs-accent" />}
              </button>
            )
          })}
        </div>

        {/* Docs sections (only on docs page) */}
        {isDocsPage && (
          <nav className="flex-1 overflow-y-auto py-2">
            <p className="px-4 py-1 text-[10px] uppercase tracking-widest text-vs-muted font-mono">Nội dung</p>
            {sections.map((s, i) => {
              const Icon = s.icon
              const isActive = activeSection === s.id
              return (
                <button
                  key={s.id}
                  onClick={() => scrollToSection(s.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-xs transition-colors border-l-2 no-drag
                    ${isActive
                      ? 'border-vs-accent text-white bg-vs-accent/10'
                      : 'border-transparent text-vs-muted hover:text-vs-text hover:bg-white/5'}`}
                >
                  <span className="font-mono text-[10px] w-4 shrink-0 opacity-50">{String(i+1).padStart(2,'0')}</span>
                  <Icon size={12} className={isActive ? 'text-vs-accent shrink-0' : 'shrink-0'} />
                  <span className="truncate">{s.titleVi}</span>
                  {s.badge && (
                    <span className="ml-auto text-[8px] font-mono bg-vs-green/20 text-vs-green px-1 py-0.5 rounded shrink-0">
                      {s.badge}
                    </span>
                  )}
                  {s.experimental && (
                    <span className="ml-auto text-[8px] font-mono bg-yellow-500/20 text-yellow-400 px-1 py-0.5 rounded shrink-0">
                      Exp
                    </span>
                  )}
                </button>
              )
            })}
          </nav>
        )}

        {!isDocsPage && <div className="flex-1" />}

        {/* Footer with status */}
        <div className="p-3 border-t border-vs-border space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-[10px] text-vs-muted font-mono">Agent Teams</p>
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${agentTeamsOk === null ? 'bg-vs-muted' : agentTeamsOk ? 'bg-vs-green' : 'bg-vs-red'}`} />
              <span className={`text-[10px] font-mono ${agentTeamsOk ? 'text-vs-green' : 'text-vs-muted'}`}>
                {agentTeamsOk === null ? '...' : agentTeamsOk ? 'Enabled' : 'Not set'}
              </span>
            </div>
          </div>
          <button
            onClick={() => window.__openChangelog?.()}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md
                       text-[10px] font-mono text-vs-muted
                       hover:text-vs-accent hover:bg-vs-accent/10 transition-colors no-drag"
          >
            <Sparkles size={10} />
            v{APP_VERSION} &middot; What's New
          </button>
        </div>
      </aside>
    </>
  )
}
