# Reliability & Feedback — Design Spec

**Date:** 2026-07-07
**Goal:** Eliminate silent failures and give users clear feedback on what's happening at all times — errors, progress, timeouts, and agent recovery.

**Architecture:** Toast-first. One global `ToastProvider` wraps the app. All failure points emit toasts via `useToast()` hook. Progress and timeout warnings reuse existing channels (planning stream timer, log entries) rather than adding new IPC events.

**Tech Stack:** React Context, React Portal, existing IPC/event system

## Global Constraints

- No new IPC events except `retry_agent`
- Toast max 5 simultaneous, newest on top, portal-rendered to avoid overflow-hidden clipping
- No external toast library — hand-rolled to match VS Code dark theme
- All user-visible strings in Vietnamese (consistent with existing UI)
- No breaking changes to existing component APIs

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/components/ui/ToastProvider.jsx` | Create | Context, state, Portal renderer, Toast component |
| `src/hooks/useToast.js` | Create | `useToast()` hook exposing `toast.error/warn/success/info()` |
| `src/main.jsx` | Modify | Wrap app in `<ToastProvider>` |
| `src/hooks/useMission.js` | Modify | IPC error → toast; planning timer; mockup log detection |
| `src/components/mission/PlanningStream.jsx` | Modify | Show elapsed timer in header |
| `src/components/mission/AgentCard.jsx` | Modify | Retry button when status = error |
| `electron/ipc/mission.cjs` | Modify | Timeout log entries at 30s/50s; `retry_agent` IPC handler |

---

## Task 1: ToastProvider + useToast

**Files:**
- Create: `src/components/ui/ToastProvider.jsx`
- Create: `src/hooks/useToast.js`
- Modify: `src/main.jsx`

### Toast Data Model

```js
{
  id: string,          // crypto.randomUUID() or Date.now()
  type: 'error' | 'warn' | 'success' | 'info',
  title: string,       // bold first line
  message?: string,    // optional detail line
  duration: number,    // ms; default per type
  action?: { label: string, onClick: () => void }  // optional action button
}
```

### Default Durations

| type | duration |
|------|----------|
| error | 6000ms |
| warn | 5000ms |
| success | 3000ms |
| info | 4000ms |

### ToastProvider

```jsx
// src/components/ui/ToastProvider.jsx
const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((toast) => {
    const id = Date.now().toString()
    setToasts(prev => {
      const next = [{ ...toast, id }, ...prev]
      return next.slice(0, 5)  // max 5
    })
    setTimeout(() => removeToast(id), toast.duration)
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      {createPortal(<ToastStack toasts={toasts} onDismiss={removeToast} />, document.body)}
    </ToastContext.Provider>
  )
}
```

### ToastStack & Toast Visual

```
position: fixed, top-4 right-4, z-index: 9999
width: 320px, flex-col gap-2
```

Per toast:
```
rounded-lg border px-4 py-3 font-mono text-[11px] shadow-lg
animate-in: slide-in-from-right + fade-in (150ms)
animate-out: fade-out (100ms)

error:   border-red-500/40    bg-red-950/80    text-red-200
warn:    border-yellow-500/40 bg-yellow-950/80 text-yellow-200
success: border-green-500/40  bg-green-950/80  text-green-200
info:    border-blue-500/40   bg-blue-950/80   text-blue-200

Layout:
[Icon] [Title]          [×]
       [message]
       [Action button?]
```

Icons: `AlertCircle` (error), `AlertTriangle` (warn), `CheckCircle` (success), `Info` (info) — from lucide-react.

### useToast Hook

```js
// src/hooks/useToast.js
export function useToast() {
  const { addToast } = useContext(ToastContext)
  const DURATIONS = { error: 6000, warn: 5000, success: 3000, info: 4000 }

  const make = (type) => (title, message, action) =>
    addToast({ type, title, message, duration: DURATIONS[type], action })

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

### main.jsx

```jsx
import { ToastProvider } from './components/ui/ToastProvider'

// Wrap existing app root:
<ToastProvider>
  <App />
</ToastProvider>
```

### Acceptance

- Toast appears top-right when `toast.error('title')` called from any component
- Max 5 toasts stack; 6th push drops the oldest
- Auto-dismiss after correct duration
- Manual dismiss via × button
- Action button fires onClick and closes toast
- Portal renders outside normal DOM tree (no overflow-hidden clipping)

---

## Task 2: IPC Error Handling in useMission

**File:** `src/hooks/useMission.js`

Patch the following IPC calls to emit toasts on failure instead of silently swallowing:

| IPC Call | Error Toast |
|----------|-------------|
| `launch_mission` | `toast.error('Không thể khởi động mission', err.message)` |
| `deploy_mission` | `toast.error('Deploy thất bại', err.message)` |
| `answer_question` | `toast.warn('Không gửi được câu trả lời', 'Thử lại hoặc reload')` |
| `mockup_respond` | `toast.warn('Không gửi được phản hồi mockup', err.message)` |
| `stop_mission` | `toast.error('Không thể dừng mission', err.message)` |
| `replan_mission` | `toast.error('Replan thất bại', err.message)` |
| `continue_mission` | `toast.error('Không thể tiếp tục mission', err.message)` |

Pattern (replace existing `.catch(() => {})` or console.error):

```js
try {
  await invoke('launch_mission', args)
} catch (err) {
  toast.error('Không thể khởi động mission', err?.message)
}
```

`respondToMockup` already has try/catch logging to console — convert to toast:

```js
} catch (err) {
  // Before: console.error('[respondToMockup] IPC failed:', err)
  // After:
  toast.warn('Không gửi được phản hồi mockup', err?.message)
  setSubmitting(false)
}
```

### Acceptance

- Trigger each failure scenario (e.g., kill handler before calling) → correct toast appears
- No silent failures for the 7 patched IPC calls
- Error message includes err.message where available

---

## Task 3: Planning Progress Timer

**File:** `src/components/mission/PlanningStream.jsx`

Add elapsed timer to the existing top header bar (right side, next to Stop button).

```jsx
// In PlanningStream component:
const [elapsed, setElapsed] = useState(0)

useEffect(() => {
  if (!isRunning) { setElapsed(0); return }
  const interval = setInterval(() => setElapsed(s => s + 1), 1000)
  return () => clearInterval(interval)
}, [isRunning])

function formatElapsed(s) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}
```

Display in header:
```jsx
<span className="text-[10px] font-mono text-vs-muted/50 shrink-0">
  {formatElapsed(elapsed)}
</span>
```

Position: between phase label and Stop button.

**Warning toasts** (emitted from `useMission.js` — track elapsed since planning started):

- At 3 min (180s): `toast.info('Lead đang suy nghĩ...', 'Bình thường mất 3–8 phút cho dự án lớn')`
- At 8 min (480s): `toast.warn('Planning kéo dài bất thường', 'Bạn có thể Stop và thử lại nếu bị kẹt')`

Timer starts when `missionState.phase === 'Planning' && isRunning`, resets on phase change or stop.

Logic in `useMission.js`:

```js
const planningTimerRef = useRef(null)

// When phase enters Planning:
planningTimerRef.current = setInterval(() => {
  planningElapsedRef.current += 1
  if (planningElapsedRef.current === 180) toast.info(...)
  if (planningElapsedRef.current === 480) toast.warn(...)
}, 1000)

// Clear on phase exit or stop/reset
```

### Acceptance

- Timer displays in PlanningStream header while `isRunning && phase === 'Planning'`
- Timer resets to 0:00 when planning ends
- toast.info fires exactly once at 3min mark
- toast.warn fires exactly once at 8min mark
- No duplicate toasts if user replans

---

## Task 4: Mockup Timeout Warnings

**File:** `electron/ipc/mission.cjs` — inside `spawnMockupGenerator()`

At 30s and 50s into mockup generation, emit log entries the frontend already receives:

```js
// Inside spawnMockupGenerator(), after spawning claude:
const warn30 = setTimeout(() => {
  const entry = makeLogEntry(now(), 'System', 'Mockup đang generate (30s)...', 'info')
  if (missionState) missionState.log.push(entry)
  sendToWindow('mission:log', entry)
}, 30000)

const warn50 = setTimeout(() => {
  const entry = makeLogEntry(now(), 'System',
    'Mockup sắp timeout — nếu thất bại sẽ tiếp tục planning tự động', 'info')
  if (missionState) missionState.log.push(entry)
  sendToWindow('mission:log', entry)
}, 50000)

// Clear both timers on success or failure:
const cleanup = () => { clearTimeout(warn30); clearTimeout(warn50) }
// Call cleanup() in both try (success path) and catch (error path)
```

**Frontend** (`useMission.js`) — detect the 50s log entry and show toast:

```js
listen('mission:log', (e) => {
  const entry = e.payload
  if (entry.message?.includes('sắp timeout')) {
    toast.warn('Mockup sắp timeout', 'Nếu thất bại sẽ tiếp tục planning tự động')
  }
  // ... existing log handling
})
```

### Acceptance

- At 30s: log entry "Mockup đang generate (30s)..." appears in planning stream
- At 50s: log entry appears AND toast.warn fires in top-right
- Both timers clear if mockup succeeds before timeout
- Both timers clear if mockup fails before timeout

---

## Task 5: Agent Retry UI + Backend Handler

### Frontend — AgentCard

**File:** `src/components/mission/AgentCard.jsx`

When `agent.status === 'error'`, show Retry button next to the error badge:

```jsx
{agent.status === 'error' && onRetryAgent && (
  <button
    onClick={() => onRetryAgent(agent.name)}
    className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono
               border border-vs-border text-vs-muted hover:text-orange-300
               hover:border-orange-400/40 rounded transition-colors"
  >
    <RotateCcw size={8} />
    Retry
  </button>
)}
```

`onRetryAgent` prop passed down from `MissionDashboard` → `AgentGrid` → `AgentCard`.

### Frontend — useMission

Add `retryAgent(agentName)` to `useMission.js`:

```js
const retryAgent = useCallback(async (agentName) => {
  try {
    await invoke('retry_agent', { agentName })
    toast.info(`Đang retry agent "${agentName}"`)
  } catch (err) {
    toast.error(`Không thể retry agent "${agentName}"`, err?.message)
  }
}, [])
// Add retryAgent to returned object
```

### Backend — retry_agent handler

**File:** `electron/ipc/mission.cjs`

```js
ipcMain.handle('retry_agent', async (_event, args) => {
  const { agentName } = args || {}
  if (!missionState) return { ok: false, error: 'No active mission' }

  const agent = missionState.agents.find(a => a.name === agentName)
  if (!agent) return { ok: false, error: `Agent "${agentName}" not found` }

  // Find agent's task from missionState.tasks
  const task = missionState.tasks.find(t =>
    t.agent === agentName && ['error', 'in-progress'].includes(t.status)
  )
  if (!task) return { ok: false, error: 'No retryable task found' }

  // Reset agent status to 'idle' so it can be re-spawned
  agent.status = 'idle'
  agent.error = null
  task.status = 'pending'

  // Emit status update so UI refreshes
  const agentEntry = makeLogEntry(now(), 'System',
    `[Lead] Retrying agent "${agentName}"...`, 'info')
  missionState.log.push(agentEntry)
  sendToWindow('mission:log', agentEntry)
  sendToWindow('mission:agent-spawned', { ...agent, reset: true })

  // Re-inject retry instruction to running Lead process via stdin.
  // Primary effect is UI state reset (agent → idle, task → pending).
  // If Lead is still running, the stdin write may prompt it to re-spawn;
  // if Lead has already exited, the UI reset alone is the recovery path.
  if (missionState.process && !missionState.process.killed) {
    missionState.process.stdin.write(
      `\n[System] Agent "${agentName}" encountered an error. Please re-spawn it with the same task.\n`
    )
  }

  return { ok: true }
})
```

Add `retry_agent` to `ALLOWED_COMMANDS` in `electron/preload.cjs`.

### Acceptance

- AgentCard shows Retry button when `agent.status === 'error'`
- Clicking Retry calls `retry_agent` IPC
- toast.info confirms retry initiated
- Agent status resets to idle in UI immediately
- Backend injects retry signal to Lead stdin
- If mission not running (already stopped), toast.error explains

---

## Error & Edge Cases

| Scenario | Behavior |
|----------|----------|
| Toast when app not focused | Still renders in top-right (Electron window) |
| 6+ toasts arrive simultaneously | 5 shown, oldest dismissed to make room |
| retry_agent called when mission stopped | Returns error, frontend shows toast.error |
| Planning timer when user replans | Timer resets — planningElapsedRef.current = 0 on replan |
| Mockup 30s/50s timers when mockup succeeds early | clearTimeout() clears both |
| IPC error with no message | Shows generic Vietnamese fallback, no undefined shown |
