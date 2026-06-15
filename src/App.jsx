import { useState, useEffect, lazy, Suspense } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { useChangelog, ChangelogModal } from './components/ChangelogModal'

// Lazy load all pages — only load what's needed
const DocsPage = lazy(() => import('./pages/DocsPage').then(m => ({ default: m.DocsPage })))
const PlaygroundPage = lazy(() => import('./pages/PlaygroundPage').then(m => ({ default: m.PlaygroundPage })))
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })))
const OnboardingPage = lazy(() => import('./pages/OnboardingPage').then(m => ({ default: m.OnboardingPage })))
const MissionControlPage = lazy(() => import('./pages/MissionControlPage').then(m => ({ default: m.MissionControlPage })))

const SETUP_DONE_KEY = 'agent_teams_setup_done'

function PageLoader() {
  return (
    <div className="min-h-screen bg-vs-bg flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-vs-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const [checked, setChecked] = useState(false)
  const { showChangelog, shouldAutoShow, openChangelog, closeChangelog, markSeen } = useChangelog()

  // Auto-show changelog on first visit after version update
  useEffect(() => {
    if (checked && shouldAutoShow) {
      // Small delay so the app renders first
      const t = setTimeout(() => openChangelog(), 600)
      return () => clearTimeout(t)
    }
  }, [checked, shouldAutoShow, openChangelog])

  useEffect(() => {
    if (location.pathname === '/setup') {
      setChecked(true)
      return
    }
    const done = localStorage.getItem(SETUP_DONE_KEY)
    if (done) {
      setChecked(true)
      return
    }
    // First run: check if already configured
    invoke('get_system_info').then(info => {
      if (info.claude_available && info.agent_teams_enabled) {
        localStorage.setItem(SETUP_DONE_KEY, '1')
        setChecked(true)
      } else {
        navigate('/setup')
        setChecked(true)
      }
    }).catch(() => {
      navigate('/setup')
      setChecked(true)
    })
  }, [])

  // Mark setup done when leaving /setup
  useEffect(() => {
    if (location.pathname !== '/setup') {
      localStorage.setItem(SETUP_DONE_KEY, '1')
    }
  }, [location.pathname])

  // Expose openChangelog globally so Sidebar can trigger it
  useEffect(() => {
    window.__openChangelog = openChangelog
    return () => { delete window.__openChangelog }
  }, [openChangelog])

  if (!checked) return <PageLoader />

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/setup"      element={<OnboardingPage />} />
        <Route path="/"           element={<DocsPage />} />
        <Route path="/playground" element={<PlaygroundPage />} />
        <Route path="/dashboard"  element={<DashboardPage />} />
        <Route path="/mission"    element={<MissionControlPage />} />
      </Routes>
      <ChangelogModal open={showChangelog} onClose={closeChangelog} />
    </Suspense>
  )
}
