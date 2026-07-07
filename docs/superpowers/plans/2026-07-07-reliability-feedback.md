# Reliability & Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate silent failures and give users clear feedback — toast notifications for errors, planning progress timer, mockup timeout warnings, and agent retry UI.

**Architecture:** Toast-first. `ToastProvider` wraps the app at `main.jsx`. All failure points use `useToast()` hook. Planning timer lives in `useMission.js` and `PlanningStream.jsx`. Mockup timeouts use existing log stream. Agent retry adds one new IPC handler.

**Tech Stack:** React Context, React Portal, lucide-react icons, existing IPC/event system

## Global Constraints

- No external toast library — hand-rolled to match VS Code dark theme
- Toast max 5 simultaneous, newest on top, portal-rendered to avoid overflow-hidden clipping
- No new IPC events except `retry_agent`
- All user-visible strings in Vietnamese
- No breaking changes to existing component APIs
- Tailwind classes only — no inline styles

---

### Task 1: ToastProvider + useToast hook

**Files:**
- Create: `src/components/ui/ToastProvider.jsx`
- Create: `src/hooks/useToast.js`
- Modify: `src/main.jsx`

**Interfaces:**
- Produces: `ToastContext` (internal), `ToastProvider` component, `useToast()` hook
- `useToast()` returns `{ toast: { error, warn, success, info } }`
- Each method signature: `toast.error(title: string, message?: string, action?: { label: string, onClick: () => void })`

- [ ] **Step 1: Write the test**

Create `src/components/ui/ToastProvider.test.jsx`:

```jsx
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from './ToastProvider'
import { useToast } from '../../hooks/useToast'

function Trigger({ type, title, message }) {
  const { toast } = useToast()
  return <button onClick={() => toast[type](title, message)}>fire</button>
}

function TestApp({ type = 'error', title = 'Test title', message = 'Test message' }) {
  return (
    <ToastProvider>
      <Trigger type={type} title={title} message={message} />
    </ToastProvider>
  )
}

test('shows toast on error', async () => {
  render(<TestApp type="error" title="Lỗi" message="Chi tiết lỗi" />)
  await userEvent.click(screen.getByText('fire'))
  expect(screen.getByText('Lỗi')).toBeInTheDocument()
  expect(screen.getByText('Chi tiết lỗi')).toBeInTheDocument()
})

test('dismisses toast on × click', async () => {
  render(<TestApp type="error" title="Lỗi" />)
  await userEvent.click(screen.getByText('fire'))
  await userEvent.click(screen.getByLabelText('Đóng thông báo'))
  expect(screen.queryByText('Lỗi')).not.toBeInTheDocument()
})

test('shows action button and calls onClick', async () => {
  const onClick = vi.fn()
  function AppWithAction() {
    const { toast } = useToast()
    return (
      <ToastProvider>
        <button onClick={() => toast.error('Title', 'Msg', { label: 'Retry', onClick })}>fire</button>
      </ToastProvider>
    )
  }
  render(<AppWithAction />)
  await userEvent.click(screen.getByText('fire'))
  await userEvent.click(screen.getByText('Retry'))
  expect(onClick).toHaveBeenCalledOnce()
})

test('caps at 5 toasts', async () => {
  function ManyFires() {
    const { toast } = useToast()
    return <button onClick={() => { for (let i = 0; i < 6; i++) toast.error(`Toast ${i}`) }}>fire</button>
  }
  render(<ToastProvider><ManyFires /></ToastProvider>)
  await userEvent.click(screen.getByText('fire'))
  expect(screen.getAllByRole('alert')).toHaveLength(5)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- ToastProvider --run
```

Expected: FAIL — `Cannot find module './ToastProvider'`

- [ ] **Step 3: Create `src/hooks/useToast.js`**

```js
import { useContext } from 'react'
import { ToastContext } from '../components/ui/ToastProvider'

const DURATIONS = { error: 6000, warn: 5000, success: 3000, info: 4000 }

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')

  const make = (type) => (title, message, action) =>
    ctx.addToast({ type, title, message, duration: DURATIONS[type], action })

  return {
    toast: {
      error:   make('error'),
      warn:    make('warn'),
      success: make('success'),
      info:    make('info'),
    }
  }
}
```

- [ ] **Step 4: Create `src/components/ui/ToastProvider.jsx`**

```jsx
import { createContext, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from 'lucide-react'

export const ToastContext = createContext(null)

const ICONS = {
  error:   { Icon: AlertCircle,   cls: 'border-red-500/40 bg-red-950/80 text-red-200',       icon: 'text-red-400' },
  warn:    { Icon: AlertTriangle,  cls: 'border-yellow-500/40 bg-yellow-950/80 text-yellow-200', icon: 'text-yellow-400' },
  success: { Icon: CheckCircle,   cls: 'border-green-500/40 bg-green-950/80 text-green-200',  icon: 'text-green-400' },
  info:    { Icon: Info,           cls: 'border-blue-500/40 bg-blue-950/80 text-blue-200',    icon: 'text-blue-400' },
}

function Toast({ toast, onDismiss }) {
  const { Icon, cls, icon } = ICONS[toast.type]
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 shadow-lg font-mono text-[11px] ${cls}`}
    >
      <Icon size={13} className={`${icon} shrink-0 mt-0.5`} />
      <div className="flex-1 min-w-0">
        <div className="font-semibold leading-tight">{toast.title}</div>
        {toast.message && (
          <div className="opacity-70 mt-0.5 leading-snug break-words">{toast.message}</div>
        )}
        {toast.action && (
          <button
            onClick={() => { toast.action.onClick(); onDismiss(toast.id) }}
            className="mt-1.5 text-[10px] underline underline-offset-2 opacity-80 hover:opacity-100"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        aria-label="Đóng thông báo"
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 opacity-50 hover:opacity-100 transition-opacity"
      >
        <X size={12} />
      </button>
    </div>
  )
}

function ToastStack({ toasts, onDismiss }) {
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 w-80 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className="pointer-events-auto">
          <Toast toast={t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  )
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const addToast = useCallback((toast) => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2, 6)
    setToasts(prev => [{ ...toast, id }, ...prev].slice(0, 5))
    setTimeout(() => removeToast(id), toast.duration)
  }, [removeToast])

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      {createPortal(
        <ToastStack toasts={toasts} onDismiss={removeToast} />,
        document.body
      )}
    </ToastContext.Provider>
  )
}
```

- [ ] **Step 5: Wrap app in `src/main.jsx`**

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { ToastProvider } from './components/ui/ToastProvider'

// Prism.js language support
import Prism from 'prismjs'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-toml'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </HashRouter>
  </StrictMode>,
)
```

- [ ] **Step 6: Run tests**

```bash
npm test -- ToastProvider --run
```

Expected: 4 tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/ToastProvider.jsx src/hooks/useToast.js src/main.jsx src/components/ui/ToastProvider.test.jsx
git commit -m "feat: add ToastProvider and useToast hook"
```

---

### Task 2: IPC Error Handling in useMission

**Files:**
- Modify: `src/hooks/useMission.js`

**Interfaces:**
- Consumes: `useToast()` from Task 1 — `toast.error(title, message)`, `toast.warn(title, message)`
- Note: `useMission` is a hook, not a component. Call `useToast()` at the top of `useMission()`.

- [ ] **Step 1: Write the test**

Add to existing `src/hooks/useMission.test.js` (create if not exists):

```js
// src/hooks/useMission.ipc-errors.test.js
import { renderHook, act } from '@testing-library/react'
import { vi } from 'vitest'
import { useMission } from './useMission'
import { ToastProvider } from '../components/ui/ToastProvider'

// Mock the tauri invoke to throw
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockRejectedValue(new Error('IPC error')),
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

const wrapper = ({ children }) => <ToastProvider>{children}</ToastProvider>

test('stop failure shows toast error', async () => {
  const { result } = renderHook(() => useMission(), { wrapper })
  // stop calls invoke('stop_mission') which will throw
  await act(async () => { await result.current.stop() })
  // Check toast appeared — the DOM should have the error text
  const alerts = document.querySelectorAll('[role="alert"]')
  expect(alerts.length).toBeGreaterThan(0)
  expect(alerts[0].textContent).toContain('Không thể dừng mission')
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- ipc-errors --run
```

Expected: FAIL — toast not shown yet

- [ ] **Step 3: Add `useToast` to `useMission` and patch IPC calls**

In `src/hooks/useMission.js`, add import at top:

```js
import { useToast } from './useToast'
```

Inside `useMission()` function body, add after existing useState declarations:

```js
const { toast } = useToast()
```

**Patch `launch` (around line 536)** — replace existing catch block:

```js
  } catch (err) {
    toast.error('Không thể khởi động mission', err?.message)
    setMissionState({
      id: `m-${Date.now()}`,
      description: description || 'Mission',
      project_path: projectPath,
      status: 'Failed',
      phase: 'Done',
      agents: [],
      tasks: [],
      log: [{
        timestamp: Date.now(), agent: 'System',
        message: `Launch failed: ${err?.message || err}`, log_type: 'error',
      }],
      file_changes: [],
      raw_output: [],
      messages: [],
      started_at: Date.now(),
    })
  }
```

**Patch `deploy` (around line 587)** — replace existing catch block:

```js
  } catch (err) {
    toast.error('Deploy thất bại', err?.message)
    setMissionState(prev => prev ? {
      ...prev,
      status: 'Failed',
      phase: 'Done',
      log: [...(prev.log || []), {
        timestamp: Date.now(), agent: 'System',
        message: `Deploy failed: ${err?.message || err}`, log_type: 'error',
      }],
    } : prev)
  }
```

**Patch `continueM` (around line 675)** — replace existing catch block:

```js
  } catch (err) {
    toast.error('Không thể tiếp tục mission', err?.message)
    setMissionState(prev => prev ? {
      ...prev,
      status: 'Failed',
      phase: 'Done',
      log: [...(prev.log || []), {
        timestamp: Date.now(), agent: 'System',
        message: `Continue failed: ${err?.message || err}`, log_type: 'error',
      }],
    } : prev)
  }
```

**Patch `stop` (around line 689)** — replace existing call:

```js
  const stop = useCallback(async () => {
    try {
      await invoke('stop_mission')
    } catch (err) {
      toast.error('Không thể dừng mission', err?.message)
    }
    setIsRunning(false)
    setPlanReady(null)
    setMockupInfo(null)
  }, [toast])
```

**Patch `replan` (around line 724)** — replace existing catch block:

```js
  } catch (err) {
    toast.error('Replan thất bại', err?.message)
    setIsReplanning(false)
    return null
  }
```

**Patch `answerQuestion` (around line 739)** — replace existing catch block:

```js
  } catch (err) {
    toast.warn('Không gửi được câu trả lời', 'Thử lại hoặc reload trang')
  }
```

**Patch `respondToMockup` (around line 749)** — replace existing catch block:

```js
  } catch (err) {
    toast.warn('Không gửi được phản hồi mockup', err?.message)
    // Don't clear mockupInfo — let user retry
  }
```

Also add `toast` to dependency arrays where needed (stop uses it in useCallback).

- [ ] **Step 4: Run tests**

```bash
npm test -- ipc-errors --run
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useMission.js src/hooks/useMission.ipc-errors.test.js
git commit -m "feat: replace silent IPC failures with toast notifications"
```

---

### Task 3: Planning Progress Timer

**Files:**
- Modify: `src/components/mission/PlanningStream.jsx`
- Modify: `src/hooks/useMission.js`

**Interfaces:**
- Consumes: `isRunning` (already prop on PlanningStream), `useToast()` from Task 1
- `PlanningStream` receives `isRunning` prop — timer driven from it

- [ ] **Step 1: Write the test**

Create `src/components/mission/PlanningStream.timer.test.jsx`:

```jsx
import { render, screen, act } from '@testing-library/react'
import { vi } from 'vitest'
import { PlanningStream } from './PlanningStream'
import { ToastProvider } from '../ui/ToastProvider'

function wrap(ui) {
  return <ToastProvider>{ui}</ToastProvider>
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

test('shows 0:00 timer when running', () => {
  render(wrap(<PlanningStream state={{ agents: [], log: [] }} isRunning={true} />))
  expect(screen.getByText('0:00')).toBeInTheDocument()
})

test('increments timer each second', async () => {
  render(wrap(<PlanningStream state={{ agents: [], log: [] }} isRunning={true} />))
  act(() => { vi.advanceTimersByTime(65000) })
  expect(screen.getByText('1:05')).toBeInTheDocument()
})

test('resets timer when isRunning goes false', async () => {
  const { rerender } = render(wrap(<PlanningStream state={{ agents: [], log: [] }} isRunning={true} />))
  act(() => { vi.advanceTimersByTime(30000) })
  rerender(wrap(<PlanningStream state={{ agents: [], log: [] }} isRunning={false} />))
  expect(screen.queryByText('0:30')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- PlanningStream.timer --run
```

Expected: FAIL — no timer element found

- [ ] **Step 3: Add timer to `PlanningStream.jsx`**

Add `useEffect` and `useState` are already imported. Add timer state and effect inside the `PlanningStream` component, after existing state/refs:

```jsx
// ── Elapsed timer ──
const [elapsed, setElapsed] = useState(0)

useEffect(() => {
  if (!isRunning) { setElapsed(0); return }
  const interval = setInterval(() => setElapsed(s => s + 1), 1000)
  return () => clearInterval(interval)
}, [isRunning])
```

Add helper function before the return statement (outside component or as const inside):

```jsx
function formatElapsed(s) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}
```

In the header bar JSX, add the timer between the phase label span and the Stop button:

```jsx
{/* ── Top header bar ── */}
<div className="flex items-center justify-between px-4 py-2.5 border-b border-vs-border shrink-0 bg-vs-panel">
  <div className="flex items-center gap-2 min-w-0">
    <Brain size={14} className="text-vs-accent shrink-0 animate-pulse" />
    <span className="text-xs font-mono text-white font-medium">Lead đang phân tích & lên plan</span>
    <span className="text-xs font-mono text-vs-muted truncate hidden sm:inline">
      — {currentPhase}
    </span>
  </div>
  <div className="flex items-center gap-2 shrink-0">
    <span className="text-[10px] font-mono text-vs-muted/50">
      {formatElapsed(elapsed)}
    </span>
    {onStop && (
      <button
        onClick={onStop}
        className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-vs-muted hover:text-red-400 hover:border-red-400/40 border border-vs-border rounded transition-colors"
      >
        <Square size={9} />
        Stop
      </button>
    )}
  </div>
</div>
```

- [ ] **Step 4: Add planning warning toasts to `useMission.js`**

Add two refs after existing refs in `useMission()`:

```js
const planningTimerRef = useRef(null)
const planningElapsedRef = useRef(0)
```

In the `mission:status` listener (around line 139), after the phase is determined, add planning timer logic. Find the section where `missionState.phase` is set to `'Planning'` and add:

```js
// Inside the mission:status listener, after setMissionState update:
if (status === 'running' || status === 'launching') {
  // Check if entering planning phase
  // Start planning timer when mission starts
  if (!planningTimerRef.current) {
    planningElapsedRef.current = 0
    planningTimerRef.current = setInterval(() => {
      planningElapsedRef.current += 1
      if (planningElapsedRef.current === 180) {
        toast.info('Lead đang suy nghĩ...', 'Bình thường mất 3–8 phút cho dự án lớn')
      }
      if (planningElapsedRef.current === 480) {
        toast.warn('Planning kéo dài bất thường', 'Bạn có thể Stop và thử lại nếu bị kẹt')
      }
    }, 1000)
  }
} else {
  // Clear timer when not running
  if (planningTimerRef.current) {
    clearInterval(planningTimerRef.current)
    planningTimerRef.current = null
    planningElapsedRef.current = 0
  }
}
```

Also clear in `stop` and `reset` callbacks:

```js
// In stop():
if (planningTimerRef.current) {
  clearInterval(planningTimerRef.current)
  planningTimerRef.current = null
  planningElapsedRef.current = 0
}

// In reset():
if (planningTimerRef.current) {
  clearInterval(planningTimerRef.current)
  planningTimerRef.current = null
  planningElapsedRef.current = 0
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- PlanningStream.timer --run
```

Expected: 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/mission/PlanningStream.jsx src/hooks/useMission.js src/components/mission/PlanningStream.timer.test.jsx
git commit -m "feat: add planning progress timer and long-running warnings"
```

---

### Task 4: Mockup Timeout Warnings

**Files:**
- Modify: `electron/ipc/mission.cjs` — `spawnMockupGenerator()` function
- Modify: `src/hooks/useMission.js` — `mission:log` listener

**Interfaces:**
- Consumes: existing `makeLogEntry`, `sendToWindow`, `missionState` in mission.cjs
- Consumes: existing `mission:log` listener in useMission.js, `useToast()` from Task 1
- Detection: frontend checks `entry.message?.includes('sắp timeout')`

- [ ] **Step 1: Find `spawnMockupGenerator` in mission.cjs**

Read `electron/ipc/mission.cjs` around line 780 to locate the function. The function has a `try { const htmlContent = await runClaudeForHtml(prompt) ... } catch (err) { ... }` structure. The timeouts go BEFORE the `try`, so they can be cleared in both success and failure paths.

- [ ] **Step 2: Add timeout log entries to `spawnMockupGenerator`**

In `electron/ipc/mission.cjs`, inside `spawnMockupGenerator`, add before the `try` block:

```js
async function spawnMockupGenerator(title, spec, missionId, sendToWindow) {
  const prompt = /* existing prompt string unchanged */

  // Timeout warnings — cleared on success or failure
  let warn30, warn50
  const clearWarnings = () => { clearTimeout(warn30); clearTimeout(warn50) }

  warn30 = setTimeout(() => {
    const entry = makeLogEntry(now(), 'System', 'Mockup đang generate (30s)...', 'info')
    if (missionState) missionState.log.push(entry)
    sendToWindow('mission:log', entry)
  }, 30000)

  warn50 = setTimeout(() => {
    const entry = makeLogEntry(now(), 'System',
      'Mockup sắp timeout — nếu thất bại sẽ tiếp tục planning tự động', 'info')
    if (missionState) missionState.log.push(entry)
    sendToWindow('mission:log', entry)
  }, 50000)

  try {
    const htmlContent = await runClaudeForHtml(prompt)
    clearWarnings()  // ← add this line at start of try success path

    const server = http.createServer(/* existing unchanged */)
    // ... rest of existing try block unchanged
  } catch (err) {
    clearWarnings()  // ← add this line at start of catch
    // ... rest of existing catch block unchanged
  }
}
```

- [ ] **Step 3: Add toast detection in `useMission.js` `mission:log` listener**

In `src/hooks/useMission.js`, find the `listen('mission:log', ...)` handler (around line 238). At the start of the callback, add the timeout detection before the existing buffer push:

```js
listen('mission:log', (e) => {
  const entry = e.payload
  // Mockup timeout warning — show toast in addition to log entry
  if (entry?.message?.includes('sắp timeout')) {
    toast.warn('Mockup sắp timeout', 'Nếu thất bại sẽ tiếp tục planning tự động')
  }
  // existing code below — push to logBuffer unchanged
  logBuffer.current.push(entry)
  // ...
}),
```

- [ ] **Step 4: Run all tests**

```bash
npm test --run
```

Expected: all tests PASS (no new test file for this task — backend is CJS, frontend change is a one-liner)

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/mission.cjs src/hooks/useMission.js
git commit -m "feat: add mockup timeout warnings at 30s and 50s"
```

---

### Task 5: Agent Retry UI + Backend Handler

**Files:**
- Modify: `src/components/mission/AgentCard.jsx` — add Retry button
- Modify: `src/components/mission/AgentGrid.jsx` — thread `onRetryAgent` prop
- Modify: `src/components/mission/MissionDashboard.jsx` — thread `onRetryAgent` prop
- Modify: `src/hooks/useMission.js` — add `retryAgent` callback
- Modify: `electron/ipc/mission.cjs` — add `retry_agent` IPC handler
- Modify: `electron/preload.cjs` — add `retry_agent` to ALLOWED_COMMANDS

**Interfaces:**
- `retryAgent(agentName: string): Promise<void>` — exported from `useMission()`
- `onRetryAgent(agentName: string): void` — prop on `MissionDashboard`, `AgentGrid`, `AgentCard`
- IPC: `invoke('retry_agent', { agentName })` → `{ ok: boolean, error?: string }`

- [ ] **Step 1: Write the test**

Create `src/components/mission/AgentCard.retry.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentCard } from './AgentCard'

const errorAgent = {
  name: 'frontend-ui',
  role: 'Frontend',
  status: 'error',
  model: 'sonnet',
  current_task: 'Build login form',
  spawned_at: Date.now(),
}

const workingAgent = { ...errorAgent, status: 'working' }

test('shows Retry button when agent status is error', () => {
  const onRetry = vi.fn()
  render(<AgentCard agent={errorAgent} logs={[]} isSelected={false} onSelect={() => {}} onRetryAgent={onRetry} />)
  expect(screen.getByText('Retry')).toBeInTheDocument()
})

test('does not show Retry button when status is working', () => {
  render(<AgentCard agent={workingAgent} logs={[]} isSelected={false} onSelect={() => {}} onRetryAgent={() => {}} />)
  expect(screen.queryByText('Retry')).not.toBeInTheDocument()
})

test('calls onRetryAgent with agent name on click', async () => {
  const onRetry = vi.fn()
  render(<AgentCard agent={errorAgent} logs={[]} isSelected={false} onSelect={() => {}} onRetryAgent={onRetry} />)
  await userEvent.click(screen.getByText('Retry'))
  expect(onRetry).toHaveBeenCalledWith('frontend-ui')
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- AgentCard.retry --run
```

Expected: FAIL — no Retry button found

- [ ] **Step 3: Add Retry button to `AgentCard.jsx`**

Add `RotateCcw` to the lucide-react import at top of `src/components/mission/AgentCard.jsx`:

```js
import { Zap, Brain, Coins, ChevronDown, ChevronRight, Eye, RotateCcw } from 'lucide-react'
```

Add `onRetryAgent` to `AgentCard` component props. Find the component definition and update:

```jsx
export const AgentCard = memo(function AgentCard({ agent, logs, isSelected, onSelect, onRetryAgent }) {
```

Find the status badge area in AgentCard (where `StatusBadge` is rendered in the header row) and add the Retry button after it:

```jsx
<StatusBadge status={agent.status} />
{agent.status === 'error' && onRetryAgent && (
  <button
    onClick={(e) => { e.stopPropagation(); onRetryAgent(agent.name) }}
    className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono border border-vs-border text-vs-muted hover:text-orange-300 hover:border-orange-400/40 rounded transition-colors"
  >
    <RotateCcw size={8} />
    Retry
  </button>
)}
```

- [ ] **Step 4: Thread `onRetryAgent` through `AgentGrid.jsx`**

In `src/components/mission/AgentGrid.jsx`:

```jsx
export const AgentGrid = memo(function AgentGrid({ agents = [], logs = [], selectedAgent, onSelectAgent, onRetryAgent }) {
  // ... existing empty state unchanged ...
  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-widest text-vs-muted font-mono px-1">
        Agents ({agents.length})
      </p>
      <div className="space-y-2">
        {agents.map((agent) => (
          <AgentCard
            key={agent.name}
            agent={agent}
            logs={logs}
            isSelected={selectedAgent === agent.name}
            onSelect={() => onSelectAgent(agent.name)}
            onRetryAgent={onRetryAgent}
          />
        ))}
      </div>
    </div>
  )
})
```

- [ ] **Step 5: Thread `onRetryAgent` through `MissionDashboard.jsx`**

Find `MissionDashboard` component definition and add `onRetryAgent` prop:

```jsx
export const MissionDashboard = memo(function MissionDashboard({
  state, isRunning, onStop, onContinue, onNewMission, elapsed,
  isHistoryView, pendingQuestions, onAnswerQuestion, onRetryAgent
}) {
```

Find where `<AgentGrid` is rendered and pass the prop:

```jsx
<AgentGrid
  agents={state?.agents || []}
  logs={state?.log || []}
  selectedAgent={selectedAgent}
  onSelectAgent={setSelectedAgent}
  onRetryAgent={onRetryAgent}
/>
```

- [ ] **Step 6: Add `retryAgent` to `useMission.js` and wire in MissionControlPage**

In `src/hooks/useMission.js`, add after `respondToMockup`:

```js
const retryAgent = useCallback(async (agentName) => {
  try {
    const result = await invoke('retry_agent', { agentName })
    if (result?.ok === false) {
      toast.error(`Không thể retry "${agentName}"`, result.error)
    } else {
      toast.info(`Đang retry agent "${agentName}"`)
    }
  } catch (err) {
    toast.error(`Không thể retry agent "${agentName}"`, err?.message)
  }
}, [toast])
```

Add `retryAgent` to the return object:

```js
return { missionState, isRunning, planReady, setPlanReady, isReplanning, pendingQuestions, mockupInfo, recoverableMission, setRecoverableMission, launch, deploy, continueM, stop, reset, replan, answerQuestion, respondToMockup, retryAgent }
```

In `src/pages/MissionControlPage.jsx`, destructure `retryAgent` from `useMission()` and pass to `MissionDashboard`:

```jsx
const { /* existing */, retryAgent } = useMission()

// In the MissionDashboard JSX:
<MissionDashboard
  // ... existing props ...
  onRetryAgent={retryAgent}
/>
```

- [ ] **Step 7: Add `retry_agent` IPC handler to `mission.cjs`**

In `electron/ipc/mission.cjs`, add the handler near other mission handlers:

```js
ipcMain.handle('retry_agent', async (_event, args) => {
  const { agentName } = args || {}
  if (!missionState) return { ok: false, error: 'No active mission' }

  const agent = missionState.agents.find(a => a.name === agentName)
  if (!agent) return { ok: false, error: `Agent "${agentName}" not found` }

  const task = missionState.tasks.find(t =>
    t.agent === agentName && ['error', 'in-progress'].includes(t.status)
  )
  if (!task) return { ok: false, error: 'No retryable task found for this agent' }

  // Reset state
  agent.status = 'idle'
  agent.error = null
  task.status = 'pending'

  // Notify frontend
  const entry = makeLogEntry(now(), 'System', `[Lead] Retrying agent "${agentName}"...`, 'info')
  missionState.log.push(entry)
  sendToWindow('mission:log', entry)
  sendToWindow('mission:agent-spawned', { ...agent, reset: true })

  // Best-effort: if Lead still running, ask it to re-spawn
  if (missionState.process && !missionState.process.killed) {
    try {
      missionState.process.stdin.write(
        `\n[System] Agent "${agentName}" encountered an error. Please re-spawn it with the same task.\n`
      )
    } catch (_) {}
  }

  return { ok: true }
})
```

- [ ] **Step 8: Add `retry_agent` to preload allowlist**

In `electron/preload.cjs`, add to `ALLOWED_COMMANDS` array:

```js
'read_planning_template', 'answer_question', 'read_superpowers_skill', 'mockup_respond', 'retry_agent',
```

- [ ] **Step 9: Run tests**

```bash
npm test -- AgentCard.retry --run
```

Expected: 3 tests PASS

```bash
npm test --run
```

Expected: all tests PASS

- [ ] **Step 10: Commit**

```bash
git add src/components/mission/AgentCard.jsx src/components/mission/AgentGrid.jsx src/components/mission/MissionDashboard.jsx src/hooks/useMission.js src/pages/MissionControlPage.jsx electron/ipc/mission.cjs electron/preload.cjs src/components/mission/AgentCard.retry.test.jsx
git commit -m "feat: add agent retry button and retry_agent IPC handler"
```

---

## Self-Review

**Spec coverage:**
- ✅ Task 1: ToastProvider + useToast
- ✅ Task 2: IPC error handling (7 call sites patched)
- ✅ Task 3: Planning progress timer + 3min/8min warnings
- ✅ Task 4: Mockup 30s/50s timeout log entries + frontend toast
- ✅ Task 5: Agent retry button + IPC handler + preload allowlist

**Placeholder scan:** No TBD/TODO. All code blocks complete.

**Type consistency:**
- `useToast()` returns `{ toast: { error, warn, success, info } }` — used consistently across Tasks 2, 3, 4, 5
- `onRetryAgent(agentName: string)` — same signature in AgentCard, AgentGrid, MissionDashboard, useMission
- `invoke('retry_agent', { agentName })` — matches handler `args.agentName`
