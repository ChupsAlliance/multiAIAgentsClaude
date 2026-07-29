# "Phát trên UI thật" Full-Fidelity Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/mission?replay=<id>` ("Phát trên UI thật") render the exact
screen the user saw live at every point in the recording — Planning stream,
plan review, prompt preview, and the execution dashboard — instead of always
showing `MissionDashboard`.

**Architecture:** `useReplay.js` gains phase derivation (mirroring
`useMission.js`'s live reducer) plus two new top-level state values
(`replayPlanReady`, `pendingQuestion`/`mockupInfo` already split out).
`MissionControlPage.jsx`'s `isReplayMode` branch switches between
`PlanningStream`, `PlanReview`+`PromptPreview` (tab-toggle, both wrapped in a
pointer-events-blocking overlay), and `MissionDashboard` based on
`replay.replayMissionState.phase`, exactly mirroring the phase switch already
used in the live-mode branch further down the same file. `ReplayControls`
stays mounted at the bottom across all three.

**Tech Stack:** React 19, Vite, Vitest + @testing-library/react,
`@tauri-apps/api` (`invoke`/`listen`, backed by Electron IPC).

## Global Constraints

- Presentation Mode (`PresentationModePage.jsx`, `PresentationTimeline.jsx`)
  must not be touched.
- No backend/Electron IPC changes — recording/replay already re-emits every
  channel verbatim (confirmed: `electron/ipc/mission.cjs`'s `sendToWindow`
  wraps all channels with recording capture; `electron/lib/replayEngine.cjs`'s
  `emitEvent` re-emits every recorded event on its original channel,
  including `mission:plan-ready`).
- `PlanReview.jsx` and `PromptPreview.jsx` receive **no prop changes and no
  internal edits** — read-only lock during replay is done by wrapping them in
  a pointer-events-blocking overlay `<div>` in `MissionControlPage.jsx`, not
  by threading a `readOnly` prop through their ~15+ internal interactive
  elements (drag-and-drop, inline edit, model chips, skill picker). This was
  an explicit decision to avoid missing an interactive element buried in
  `PlanReview.jsx`'s 1481 lines. (`PlanReview.jsx` has one `fixed inset-0
  z-50` modal — `BulkSkillModal` — which sits above the overlay's `z-10`,
  but it only opens via a button click the overlay already intercepts, and
  nothing in `PlanReview.jsx` opens it on mount, so it can never appear
  during replay.)
- `useReplay.js`'s existing nested `qa_events`/`mockup_events` arrays inside
  `replayMissionState` are unchanged (existing test
  `src/hooks/useReplay.qa-mockup.test.jsx` asserts against them and must keep
  passing unmodified). Only the *pending* (unresolved) question/mockup move
  to separate top-level hook state, matching `useMission.js`'s shape.
- Phase transition rules (exact, mirroring `useMission.js`):
  - `mission:agent-spawned` with `reset: true` → `phase: 'Planning'`.
  - `mission:plan-ready` → `phase: 'ReviewPlan'`, clears pending mockup
    (`mockupInfo: null`), populates `replayPlanReady`.
  - `mission:status` with `status === 'completed'` while
    `phase === 'ReviewPlan'` → **no phase change** (stays `ReviewPlan` —
    live mode ignores a completed status while waiting on review).
  - `mission:status` with `status` in `['stopped', 'failed']` while
    `phase === 'ReviewPlan'` → `phase: 'Done'`.
  - First `mission:task-update` event seen after `phase === 'ReviewPlan'` →
    `phase: 'Executing'`.
  - `mission:status` with `status` in `['completed', 'stopped', 'failed']`
    while `phase` is `'Executing'` (or anything other than `'ReviewPlan'`) →
    `phase: 'Done'`.

---

### Task 1: `useReplay.js` — phase tracking, `replayPlanReady`, separated pending state

**Files:**
- Modify: `src/hooks/useReplay.js`
- Test: `src/hooks/useReplay.phase.test.jsx` (new)

**Interfaces:**
- Consumes: nothing new — same `listen`/`invoke` mocks as existing
  `useReplay.qa-mockup.test.jsx`.
- Produces: `useReplay(recordingId)` return object gains three new fields:
  `replayPlanReady` (`{ agents, tasks, mission_context } | null`),
  `pendingQuestion` (`{ questions, timestamp } | null`), `mockupInfo`
  (`{ title, url, ... } | null`). `replayMissionState.phase` now actually
  changes over time instead of being permanently `'Executing'`.
  `replayMissionState._pendingQuestion` field is removed (nothing else in
  the codebase reads it — confirmed by grep before this task starts).

- [ ] **Step 1: Write failing tests for phase transitions**

Create `src/hooks/useReplay.phase.test.jsx`:

```jsx
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'
import { vi, afterEach, test, expect } from 'vitest'
import { useReplay } from './useReplay'

const listeners = new Map()
function emit(channel, payload) {
  const cbs = listeners.get(channel) || []
  cbs.forEach(cb => cb({ payload }))
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd) => {
    if (cmd === 'replay_start') {
      return Promise.resolve({ totalMs: 1000, eventCount: 2, recording: { name: 'demo' }, stepMarkers: [] })
    }
    return Promise.resolve(null)
  }),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((channel, cb) => {
    if (!listeners.has(channel)) listeners.set(channel, [])
    listeners.get(channel).push(cb)
    return Promise.resolve(() => {
      const arr = listeners.get(channel) || []
      const idx = arr.indexOf(cb)
      if (idx >= 0) arr.splice(idx, 1)
    })
  }),
}))

vi.mock('./useToast', () => ({
  useToast: () => ({ toast: { error: vi.fn(), warn: vi.fn() } }),
}))

afterEach(() => {
  cleanup()
  listeners.clear()
})

test('agent-spawned reset sets phase to Planning', async () => {
  const { result } = renderHook(() => useReplay('rec-phase-1'))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    emit('mission:agent-spawned', { agent_name: 'Lead', role: 'Coordinator', reset: true, timestamp: 1 })
  })

  await waitFor(() => expect(result.current.replayMissionState.phase).toBe('Planning'))
})

test('plan-ready sets phase to ReviewPlan and populates replayPlanReady', async () => {
  const { result } = renderHook(() => useReplay('rec-phase-2'))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    emit('mission:agent-spawned', { agent_name: 'Lead', role: 'Coordinator', reset: true, timestamp: 1 })
  })
  act(() => {
    emit('mission:plan-ready', {
      agents: [{ name: 'Dev', role: 'Developer' }],
      tasks: [{ id: 't1', title: 'Build it', agent: 'Dev' }],
      mission_context: 'ctx',
    })
  })

  await waitFor(() => expect(result.current.replayMissionState.phase).toBe('ReviewPlan'))
  expect(result.current.replayPlanReady).toEqual({
    agents: [{ name: 'Dev', role: 'Developer' }],
    tasks: [{ id: 't1', title: 'Build it', agent: 'Dev' }],
    mission_context: 'ctx',
  })
})

test('plan-ready clears any pending mockupInfo', async () => {
  const { result } = renderHook(() => useReplay('rec-phase-3'))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    emit('mission:mockup', { title: 'Login v2', url: 'http://localhost:1' })
  })
  await waitFor(() => expect(result.current.mockupInfo).toEqual({ title: 'Login v2', url: 'http://localhost:1' }))

  act(() => {
    emit('mission:plan-ready', { agents: [], tasks: [], mission_context: null })
  })

  await waitFor(() => expect(result.current.mockupInfo).toBe(null))
})

test('completed status while ReviewPlan does not change phase', async () => {
  const { result } = renderHook(() => useReplay('rec-phase-4'))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    emit('mission:plan-ready', { agents: [], tasks: [], mission_context: null })
  })
  await waitFor(() => expect(result.current.replayMissionState.phase).toBe('ReviewPlan'))

  act(() => {
    emit('mission:status', { status: 'completed' })
  })

  expect(result.current.replayMissionState.phase).toBe('ReviewPlan')
})

test('stopped status while ReviewPlan moves phase to Done', async () => {
  const { result } = renderHook(() => useReplay('rec-phase-5'))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    emit('mission:plan-ready', { agents: [], tasks: [], mission_context: null })
  })
  await waitFor(() => expect(result.current.replayMissionState.phase).toBe('ReviewPlan'))

  act(() => {
    emit('mission:status', { status: 'stopped' })
  })

  await waitFor(() => expect(result.current.replayMissionState.phase).toBe('Done'))
})

test('first task-update after ReviewPlan moves phase to Executing', async () => {
  const { result } = renderHook(() => useReplay('rec-phase-6'))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    emit('mission:plan-ready', { agents: [], tasks: [], mission_context: null })
  })
  await waitFor(() => expect(result.current.replayMissionState.phase).toBe('ReviewPlan'))

  act(() => {
    emit('mission:task-update', { agent: 'Dev', description: 'Build it', status: 'in_progress', timestamp: 5 })
  })

  await waitFor(() => expect(result.current.replayMissionState.phase).toBe('Executing'))
})

test('completed status while Executing moves phase to Done', async () => {
  const { result } = renderHook(() => useReplay('rec-phase-7'))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    emit('mission:plan-ready', { agents: [], tasks: [], mission_context: null })
  })
  act(() => {
    emit('mission:task-update', { agent: 'Dev', description: 'Build it', status: 'in_progress', timestamp: 5 })
  })
  await waitFor(() => expect(result.current.replayMissionState.phase).toBe('Executing'))

  act(() => {
    emit('mission:status', { status: 'completed' })
  })

  await waitFor(() => expect(result.current.replayMissionState.phase).toBe('Done'))
})

test('pendingQuestion is set by mission:question and cleared by mission:answer-sent', async () => {
  const { result } = renderHook(() => useReplay('rec-phase-8'))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    emit('mission:question', { questions: [{ question: 'Dùng React hay Vue?' }] })
  })
  await waitFor(() => expect(result.current.pendingQuestion).not.toBe(null))
  expect(result.current.pendingQuestion.questions).toEqual([{ question: 'Dùng React hay Vue?' }])

  act(() => {
    emit('mission:answer-sent', { answers: [{ question_index: 0, answer: 'React' }] })
  })

  await waitFor(() => expect(result.current.pendingQuestion).toBe(null))
  // qa_events history still populated exactly as before this change
  expect(result.current.replayMissionState.qa_events).toHaveLength(1)
})

test('mockupInfo is set by mission:mockup and mockup_events history still accumulates', async () => {
  const { result } = renderHook(() => useReplay('rec-phase-9'))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    emit('mission:mockup', { title: 'Trang đăng nhập v2', url: 'http://localhost:1' })
  })

  await waitFor(() => expect(result.current.mockupInfo).toEqual({ title: 'Trang đăng nhập v2', url: 'http://localhost:1' }))
  expect(result.current.replayMissionState.mockup_events).toHaveLength(1)
  expect(result.current.replayMissionState.mockup_events[0].title).toBe('Trang đăng nhập v2')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/useReplay.phase.test.jsx`
Expected: FAIL — `replayPlanReady`/`pendingQuestion`/`mockupInfo` are
`undefined`, phase never changes from `'Executing'`.

- [ ] **Step 3: Confirm nothing else reads `replayMissionState._pendingQuestion`**

Run: `grep -rn "_pendingQuestion" src/` (or use the Grep tool) — expect only
matches inside `src/hooks/useReplay.js` itself. If any other file matches,
stop and update this task's plan before proceeding (this should not happen
per the codebase read during planning, but is worth a fast verify since it's
a removed field).

- [ ] **Step 4: Rewrite `EMPTY_STATE`, add `replayPlanReady`/`pendingQuestion`/`mockupInfo` state**

In `src/hooks/useReplay.js`, replace the `EMPTY_STATE` function to remove the
`_pendingQuestion` field (now tracked as separate top-level `pendingQuestion`
state — see below). Keep `phase: 'Executing'` as the pre-first-event default
so a replay opened mid-recording via a fresh seek never renders `undefined`;
the real phase is established by the first `mission:agent-spawned
reset:true` event that was already recorded at the very start of every
recording:

```js
const EMPTY_STATE = () => ({
  id: null,
  description: '',
  project_path: '',
  status: 'Running',
  phase: 'Executing',
  execution_mode: 'standard',
  agents: [],
  tasks: [],
  log: [],
  file_changes: [],
  raw_output: [],
  messages: [],
  qa_events: [],
  mockup_events: [],
  started_at: Date.now(),
})
```

(The only diff from the current file is the removed `_pendingQuestion: null`
line — everything else in `EMPTY_STATE` is unchanged.)

Add two new state hooks near the top of `useReplay`, alongside
`replayMissionState`:

```js
const [replayPlanReady, setReplayPlanReady] = useState(null)
const [pendingQuestion, setPendingQuestion] = useState(null)
const [mockupInfo, setMockupInfo] = useState(null)
```

- [ ] **Step 5: Update `applyEvent` — phase transitions, `plan-ready` case, pending state**

Modify the `'mission:agent-spawned'` case: when `reset` is true, also set
`phase: 'Planning'` on the returned state:

```js
      case 'mission:agent-spawned': {
        const { agent_name, name, role, timestamp, reset, model } = payload
        const agentName = agent_name || name
        setReplayMissionState(prev => {
          const base = prev || EMPTY_STATE()
          if (reset) {
            return {
              ...base,
              phase: 'Planning',
              agents: [{
                name: agentName, role, status: 'Running',
                current_task: 'Analyzing requirement...',
                spawned_at: timestamp || Date.now(), model: model || null, model_reason: null,
              }],
            }
          }
          const idx = base.agents.findIndex(a => a.name === agentName)
          if (idx !== -1) {
            const updated = [...base.agents]
            updated[idx] = { ...updated[idx], status: 'Working', current_task: 'Starting...', spawned_at: timestamp || updated[idx].spawned_at }
            return { ...base, agents: updated }
          }
          return {
            ...base,
            agents: [...base.agents, {
              name: agentName, role, status: 'Spawning', current_task: null,
              spawned_at: timestamp, model: model || null, model_reason: null,
            }],
          }
        })
        break
      }
```

Add a new case for `'mission:plan-ready'` (insert after the
`'mission:task-update'` case, before `'mission:raw-line'`):

```js
      case 'mission:plan-ready': {
        const { agents, tasks, mission_context } = payload
        setReplayPlanReady({ agents, tasks, mission_context: mission_context || null })
        setMockupInfo(null)
        setReplayMissionState(prev => {
          const base = prev || EMPTY_STATE()
          return { ...base, phase: 'ReviewPlan' }
        })
        break
      }
```

Modify the `'mission:task-update'` case to flip phase to `'Executing'` the
first time it fires after `'ReviewPlan'` (keep all existing task-list logic
unchanged, only add the phase bump inside the same `setReplayMissionState`
updater so it reads the correct `prev.phase`):

```js
      case 'mission:task-update': {
        const { agent, owner, description, status, timestamp, task_id } = payload
        const agentName = agent || owner || ''
        const taskDesc = description || ''
        setReplayMissionState(prev => {
          const base = prev || EMPTY_STATE()
          const nextPhase = base.phase === 'ReviewPlan' ? 'Executing' : base.phase
          let idx = -1
          if (task_id) idx = base.tasks.findIndex(t => t.id === task_id)
          if (idx < 0 && taskDesc) {
            const descLower = taskDesc.trim().toLowerCase()
            idx = base.tasks.findIndex(t => t.assigned_agent === agentName && t.title.trim().toLowerCase() === descLower)
          }
          if (idx >= 0) {
            const tasks = [...base.tasks]
            tasks[idx] = {
              ...tasks[idx], status,
              assigned_agent: agentName || tasks[idx].assigned_agent,
              completed_at: status === 'completed' ? timestamp : tasks[idx].completed_at,
              started_at: status === 'in_progress' ? timestamp : tasks[idx].started_at,
            }
            return { ...base, phase: nextPhase, tasks }
          }
          return {
            ...base,
            phase: nextPhase,
            tasks: [...base.tasks, {
              id: task_id || `task-${Date.now()}-${Math.random()}`,
              title: taskDesc || `Task by ${agentName}`,
              status, assigned_agent: agentName || null,
              started_at: timestamp, completed_at: status === 'completed' ? timestamp : null,
            }],
          }
        })
        break
      }
```

Modify the `'mission:status'` case to implement the terminal-status rules
from Global Constraints:

```js
      case 'mission:status': {
        const { status } = payload
        if (status === 'reset') {
          setReplayMissionState(EMPTY_STATE())
          setReplayPlanReady(null)
          setPendingQuestion(null)
          setMockupInfo(null)
          return
        }
        setReplayMissionState(prev => {
          if (!prev) return prev
          const capitalized = status.charAt(0).toUpperCase() + status.slice(1)
          if (prev.phase === 'ReviewPlan') {
            if (status === 'completed') return prev
            if (['stopped', 'failed'].includes(status)) {
              return { ...prev, phase: 'Done', status: capitalized }
            }
            return prev
          }
          if (['completed', 'stopped', 'failed'].includes(status)) {
            return { ...prev, phase: 'Done', status: capitalized }
          }
          return { ...prev, status: capitalized }
        })
        break
      }
```

Modify the `'mission:question'` case to set `pendingQuestion` top-level
state instead of the nested `_pendingQuestion` field:

```js
      case 'mission:question': {
        const { questions } = payload
        setPendingQuestion({ questions: questions || [], timestamp: Date.now() })
        break
      }
```

Modify the `'mission:answer-sent'` case to read/clear the new top-level
`pendingQuestion` state (via a functional update captured through a ref-free
approach — read current value with the state setter's updater form is not
available for a *different* state variable, so capture it via a local
variable read before clearing):

```js
      case 'mission:answer-sent': {
        const { answers } = payload
        setPendingQuestion(currentPending => {
          const entry = {
            timestamp: currentPending ? currentPending.timestamp : Date.now(),
            questions: currentPending ? currentPending.questions : [],
            answers: answers || [],
          }
          setReplayMissionState(prev => {
            const base = prev || EMPTY_STATE()
            return { ...base, qa_events: [...base.qa_events, entry] }
          })
          return null
        })
        break
      }
```

Modify the `'mission:mockup'` case to also set the top-level `mockupInfo`
(keep the existing `mockup_events` append untouched):

```js
      case 'mission:mockup': {
        setMockupInfo(payload)
        setReplayMissionState(prev => {
          const base = prev || EMPTY_STATE()
          const entry = { timestamp: Date.now(), title: payload?.title || '' }
          return { ...base, mockup_events: [...base.mockup_events, entry] }
        })
        break
      }
```

- [ ] **Step 6: Add `mission:plan-ready` to the listened channels list**

In the listener-setup `useEffect`, add `'mission:plan-ready'` to the
`channels` array:

```js
      const channels = [
        'mission:status', 'mission:agent-spawned', 'mission:log', 'mission:file-change',
        'mission:task-update', 'mission:raw-line', 'mission:agent-message', 'mission:agent-stuck',
        'mission:question', 'mission:answer-sent', 'mission:mockup', 'mission:plan-ready',
      ]
```

- [ ] **Step 7: Reset new state when `recordingId` changes**

In the `useEffect` that fires on `recordingId` change (the one calling
`invoke('replay_start', ...)`), add resets alongside the existing
`setReplayMissionState(EMPTY_STATE())` / `setCurrentMs(0)` / `setIsPlaying(false)`:

```js
    setReplayMissionState(EMPTY_STATE())
    setReplayPlanReady(null)
    setPendingQuestion(null)
    setMockupInfo(null)
    setCurrentMs(0)
    setIsPlaying(false)
```

- [ ] **Step 8: Return the new state from the hook**

Update the hook's final `return` statement to include the three new values:

```js
  return {
    replayMissionState, replayPlanReady, pendingQuestion, mockupInfo,
    isPlaying, speed, currentMs, totalMs, stepMarkers, recordingMeta,
    loading, error,
    togglePlayPause, play, pause, changeSpeed, seek, stopReplay,
  }
```

- [ ] **Step 9: Run the new tests and the existing qa-mockup tests**

Run: `npx vitest run src/hooks/useReplay.phase.test.jsx src/hooks/useReplay.qa-mockup.test.jsx`
Expected: All PASS — the phase tests pass with the new logic, and the
pre-existing qa-mockup tests keep passing unmodified (they only assert on
`replayMissionState.qa_events`/`mockup_events`, which retain their exact
prior shape and content).

- [ ] **Step 10: Commit**

```bash
git add src/hooks/useReplay.js src/hooks/useReplay.phase.test.jsx
git commit -m "feat: track phase and separate pending state in useReplay"
```

---

### Task 2: `MissionControlPage.jsx` — phase-driven replay UI switch

**Files:**
- Modify: `src/pages/MissionControlPage.jsx`
- Test: `src/pages/MissionControlPage.replay-phases.test.jsx` (new)

**Interfaces:**
- Consumes: `useReplay()`'s new return fields from Task 1
  (`replayPlanReady`, `pendingQuestion`, `mockupInfo`, and
  `replayMissionState.phase` now meaningfully varying). `PlanningStream`'s
  existing props (`state`, `isRunning`, `onStop`, `mockupInfo`,
  `onMockupRespond`) — unchanged signature. `PlanReview`'s existing props
  (`agents`, `tasks`, `onDeploy`, `onCancel`, `onReplan`, `isReplanning`) —
  unchanged signature, all four callbacks passed as no-ops during replay.
  `PromptPreview`'s existing props (`agents`, `tasks`, `projectPath`,
  `onConfirm`, `onBack`) — unchanged signature, callbacks as no-ops.
- Produces: nothing new consumed elsewhere — this is the leaf page component.

- [ ] **Step 1: Write a failing integration test for the phase switch**

Create `src/pages/MissionControlPage.replay-phases.test.jsx`. This test
renders the page in replay mode and drives phase changes by emitting the
same mocked IPC events Task 1's tests use, then asserts which top-level
component is on screen via `data-testid` attributes already present in the
codebase (`PlanningStream` has no root testid today — assert via visible
text unique to each component instead, which is simpler and avoids editing
component internals for the sake of a test).

```jsx
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, afterEach, test, expect } from 'vitest'
import { MissionControlPage } from './MissionControlPage'

const listeners = new Map()
function emit(channel, payload) {
  const cbs = listeners.get(channel) || []
  cbs.forEach(cb => cb({ payload }))
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd) => {
    if (cmd === 'replay_start') {
      return Promise.resolve({ totalMs: 1000, eventCount: 3, recording: { name: 'demo' }, stepMarkers: [] })
    }
    return Promise.resolve(null)
  }),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((channel, cb) => {
    if (!listeners.has(channel)) listeners.set(channel, [])
    listeners.get(channel).push(cb)
    return Promise.resolve(() => {
      const arr = listeners.get(channel) || []
      const idx = arr.indexOf(cb)
      if (idx >= 0) arr.splice(idx, 1)
    })
  }),
}))

vi.mock('../hooks/useMission', () => ({
  useMission: () => ({
    missionState: null, isRunning: false, planReady: null, setPlanReady: vi.fn(),
    isReplanning: false, pendingQuestions: null, mockupInfo: null,
    recoverableMission: null, setRecoverableMission: vi.fn(),
    isRecording: false, startRecording: vi.fn(), stopRecordingAndSave: vi.fn(), discardRecording: vi.fn(),
    launch: vi.fn(), deploy: vi.fn(), continueM: vi.fn(), stop: vi.fn(), reset: vi.fn(),
    replan: vi.fn(), answerQuestion: vi.fn(), respondToMockup: vi.fn(), retryAgent: vi.fn(),
  }),
}))

function renderReplayPage() {
  return render(
    <MemoryRouter initialEntries={['/mission?replay=rec-page-1']}>
      <Routes>
        <Route path="/mission" element={<MissionControlPage />} />
      </Routes>
    </MemoryRouter>
  )
}

afterEach(() => {
  cleanup()
  listeners.clear()
})

test('Planning phase renders PlanningStream', async () => {
  renderReplayPage()
  await waitFor(() => expect(screen.queryByText(/Đang tải/)).not.toBeInTheDocument())

  act_emit('mission:agent-spawned', { agent_name: 'Lead', role: 'Coordinator', reset: true, timestamp: 1 })

  await waitFor(() => expect(screen.getByText('Lead đang phân tích & lên plan')).toBeInTheDocument())
})

test('ReviewPlan phase renders PlanReview inside a read-only overlay', async () => {
  renderReplayPage()
  await waitFor(() => expect(screen.queryByText(/Đang tải/)).not.toBeInTheDocument())

  act_emit('mission:agent-spawned', { agent_name: 'Lead', role: 'Coordinator', reset: true, timestamp: 1 })
  act_emit('mission:plan-ready', {
    agents: [{ name: 'Dev', role: 'Developer' }],
    tasks: [{ id: 't1', title: 'Build it', agent: 'Dev' }],
    mission_context: null,
  })

  await waitFor(() => expect(screen.getByTestId('replay-readonly-overlay')).toBeInTheDocument())
})

test('Executing phase renders MissionDashboard', async () => {
  renderReplayPage()
  await waitFor(() => expect(screen.queryByText(/Đang tải/)).not.toBeInTheDocument())

  act_emit('mission:agent-spawned', { agent_name: 'Lead', role: 'Coordinator', reset: true, timestamp: 1 })
  act_emit('mission:plan-ready', { agents: [{ name: 'Dev', role: 'Developer' }], tasks: [{ id: 't1', title: 'Build it', agent: 'Dev' }], mission_context: null })
  act_emit('mission:task-update', { agent: 'Dev', description: 'Build it', status: 'in_progress', timestamp: 5 })

  await waitFor(() => expect(screen.getByTestId('mission-dashboard-replay-mode')).toBeInTheDocument())
})

// Small helper — React Testing Library's `render` already wraps effects in
// act() via its own internal scheduler for these synchronous IPC-mock
// callbacks, but wrapping explicitly keeps intent obvious.
function act_emit(channel, payload) {
  emit(channel, payload)
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pages/MissionControlPage.replay-phases.test.jsx`
Expected: FAIL — page still unconditionally renders `MissionDashboard`, so
the Planning/ReviewPlan assertions fail; `replay-readonly-overlay` testid
does not exist yet.

- [ ] **Step 3: Replace the `isReplayMode` branch's body with a phase switch**

In `src/pages/MissionControlPage.jsx`, replace the block from `{/* Replay-on-real-UI mode... */}` through the closing of that `if (isReplayMode) { return (...) }` (current lines 167-217) with:

```jsx
  // ── Replay-on-real-UI mode: read-only, switches UI by recorded phase ──
  if (isReplayMode) {
    const replayPhase = replay.replayMissionState?.phase
    const isReplayPlanning = replayPhase === 'Planning'
    const isReplayReviewPlan = replayPhase === 'ReviewPlan' && replay.replayPlanReady

    return (
      <div className="h-screen bg-vs-bg text-vs-text flex overflow-hidden">
        <Sidebar />
        <main className="flex-1 md:ml-64 flex flex-col h-screen overflow-hidden relative">
          <div className="h-8 shrink-0 drag-region" />

          {/* Banner: đang phát lại bản ghi */}
          <div className="mx-4 mt-1 mb-2 shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg border border-purple-500/40 bg-purple-500/10">
            <Radio size={13} className="text-purple-300 shrink-0 animate-pulse" />
            <span className="text-xs font-mono text-purple-200">
              Đang phát lại bản ghi: <strong>{replay.recordingMeta?.name || replay.replayMissionState?.description || replayRecordingId}</strong>
            </span>
            {replay.loading && (
              <span className="text-[10px] text-purple-300/60 ml-auto">Đang tải...</span>
            )}
          </div>

          <div className="flex-1 px-4 pb-28 min-h-0 overflow-hidden">
            {isReplayPlanning && (
              <PlanningStream
                state={replay.replayMissionState}
                isRunning={true}
                onStop={undefined}
                mockupInfo={replay.mockupInfo}
                onMockupRespond={replay.mockupInfo ? () => Promise.resolve() : undefined}
              />
            )}

            {isReplayReviewPlan && (
              <div data-testid="replay-readonly-overlay" className="relative h-full min-h-0">
                <div className="absolute inset-0 z-10" />
                {replayPlanViewTab === 'plan' ? (
                  <div className="h-full min-h-0 bg-vs-bg rounded-lg border border-vs-border overflow-hidden flex flex-col">
                    <PlanReview
                      agents={replay.replayPlanReady.agents}
                      tasks={replay.replayPlanReady.tasks}
                      onDeploy={() => {}}
                      onCancel={() => {}}
                      onReplan={undefined}
                      isReplanning={false}
                    />
                  </div>
                ) : (
                  <div className="h-full min-h-0 overflow-y-auto">
                    <PromptPreview
                      agents={replay.replayPlanReady.agents}
                      tasks={replay.replayPlanReady.tasks}
                      projectPath={replay.replayMissionState?.project_path || ''}
                      onConfirm={() => {}}
                      onBack={() => {}}
                    />
                  </div>
                )}
              </div>
            )}

            {!isReplayPlanning && !isReplayReviewPlan && (
              <div data-testid="mission-dashboard-replay-mode" className="h-full min-h-0">
                <MissionDashboard
                  state={replay.replayMissionState}
                  isRunning={true}
                  isHistoryView={true}
                  onStop={() => {}}
                  onContinue={async () => {}}
                  onNewMission={handleExitReplay}
                  elapsed=""
                />
              </div>
            )}
          </div>

          {/* Tab bar for ReviewPlan phase — mirrors live mode's PlanReview/PromptPreview split */}
          {isReplayReviewPlan && (
            <div className="absolute left-4 top-16 z-20 flex items-center gap-0.5">
              <button
                onClick={() => setReplayPlanViewTab('plan')}
                className={`px-3 py-1.5 rounded-t-md text-xs font-mono transition-colors ${
                  replayPlanViewTab === 'plan'
                    ? 'bg-vs-panel text-vs-heading border-t border-x border-vs-border'
                    : 'text-vs-muted hover:text-vs-heading hover:bg-vs-overlay/5'
                }`}
              >
                Kế hoạch
              </button>
              <button
                onClick={() => setReplayPlanViewTab('prompts')}
                className={`px-3 py-1.5 rounded-t-md text-xs font-mono transition-colors ${
                  replayPlanViewTab === 'prompts'
                    ? 'bg-vs-panel text-vs-heading border-t border-x border-vs-border'
                    : 'text-vs-muted hover:text-vs-heading hover:bg-vs-overlay/5'
                }`}
              >
                Prompts
              </button>
            </div>
          )}

          {/* ReplayControls overlay cố định ở đáy */}
          <div className="absolute left-0 right-0 bottom-0 px-4 pb-4 md:pl-4 pointer-events-none">
            <div className="pointer-events-auto max-w-3xl mx-auto">
              <ReplayControls
                isPlaying={replay.isPlaying}
                speed={replay.speed}
                currentMs={replay.currentMs}
                totalMs={replay.totalMs}
                stepMarkers={replay.stepMarkers}
                onPlayPause={replay.togglePlayPause}
                onSpeedChange={replay.changeSpeed}
                onSeek={replay.seek}
                onExit={handleExitReplay}
              />
            </div>
          </div>
        </main>
      </div>
    )
  }
```

Note: the pre-existing `data-testid="mission-dashboard-replay-mode"`
(currently on the branch's outer wrapper `<div>`, which is present across
all three phases) moves to wrap only the `MissionDashboard` render — it must
distinguish the `Executing`/`Done` sub-case, not the whole replay branch, or
the Step 1 test's third assertion would pass trivially regardless of phase.
No other file references this testid (confirmed by grep before this task
starts), so relocating it is safe.

Note: `PlanningStream`'s `onMockupRespond` prop gates whether
`MockupApprovalCard` renders at all (`{mockupInfo && onMockupRespond && (...)}`
in `PlanningStream.jsx`) — passing a no-op-returning-a-resolved-promise
function (rather than `undefined`) when `replay.mockupInfo` is present makes
the card visible-but-inert-in-effect during replay (its internal buttons
still fire the no-op, which is indistinguishable from doing nothing since
replay never listens for a resulting IPC call). This matches the spec's
"show exactly as recorded" requirement without needing a `readOnly` prop
change to `PlanningStream.jsx`.

- [ ] **Step 4: Add the `replayPlanViewTab` state hook**

Near the top of `MissionControlPage`, alongside the existing `planViewTab`
state declaration, add:

```jsx
  const [replayPlanViewTab, setReplayPlanViewTab] = useState('plan') // 'plan' | 'prompts' — replay-only tab
```

- [ ] **Step 5: Run the integration test**

Run: `npx vitest run src/pages/MissionControlPage.replay-phases.test.jsx`
Expected: PASS for all three phase assertions.

- [ ] **Step 6: Run the full test suite to check for regressions**

Run: `npx vitest run`
Expected: All tests PASS, including pre-existing
`src/hooks/useReplay.qa-mockup.test.jsx` and any existing
`MissionControlPage`-adjacent tests.

- [ ] **Step 7: Commit**

```bash
git add src/pages/MissionControlPage.jsx src/pages/MissionControlPage.replay-phases.test.jsx
git commit -m "feat: phase-driven UI switch for real-UI replay mode"
```

---

### Task 3: Manual verification against a real recording

**Files:** none (manual QA task, no code changes)

**Interfaces:** N/A

- [ ] **Step 1: Build and launch the Electron app**

Run: `npm run electron:dev`

- [ ] **Step 2: Record a short live mission**

In the app, click the record toggle in `MissionLauncher`, launch a small
mission that will go through Planning → ReviewPlan → Executing → Done (a
trivial one-file task is enough), let it reach `PlanReview`, click Deploy,
let it finish, save the recording when prompted.

- [ ] **Step 3: Play the recording via "Phát trên UI thật"**

From `MissionHistoryPanel`/recordings list, open the saved recording with
"Phát trên UI thật". Verify:
- Planning phase shows the `PlanningStream` terminal view (not the
  dashboard).
- When the recording reaches plan-ready, the UI switches to `PlanReview`
  looking pixel-identical to the live version, and clicking anywhere inside
  it (Deploy button, drag a task, edit a task) has no effect — the overlay
  blocks it.
- The "Prompts" tab shows `PromptPreview` for the same recorded agents/tasks,
  also inert.
- Once the recording's execution events start, the UI switches to
  `MissionDashboard` as before.
- `ReplayControls` remains visible and functional (play/pause/seek/speed) at
  the bottom throughout all three phases.
- Seeking backward into an earlier phase (e.g. scrub back into Planning
  after reaching Executing) correctly switches the UI back to that phase's
  view.

- [ ] **Step 4: Report results**

If any step in Step 3 fails, note exactly which behavior diverged before
moving to code review — this task exists to catch anything the unit/
integration tests (headless, no real Electron IPC) can't observe, such as
actual visual layout or timing glitches.
