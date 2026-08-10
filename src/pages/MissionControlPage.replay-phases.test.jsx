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

vi.mock('../hooks/useToast', () => ({
  useToast: () => ({
    toast: {
      error: vi.fn(),
      warn: vi.fn(),
    },
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

  emitEvent('replay:mission:agent-spawned', { agent_name: 'Lead', role: 'Coordinator', reset: true, timestamp: 1 })

  await waitFor(() => expect(screen.getByText('Lead đang phân tích & lên plan')).toBeInTheDocument())
})

test('ReviewPlan phase renders PlanReview inside a read-only overlay', async () => {
  renderReplayPage()
  await waitFor(() => expect(screen.queryByText(/Đang tải/)).not.toBeInTheDocument())

  emitEvent('replay:mission:agent-spawned', { agent_name: 'Lead', role: 'Coordinator', reset: true, timestamp: 1 })
  emitEvent('replay:mission:plan-ready', {
    agents: [{ name: 'Dev', role: 'Developer' }],
    tasks: [{ id: 't1', title: 'Build it', agent: 'Dev' }],
    mission_context: null,
  })

  await waitFor(() => expect(screen.getByTestId('replay-readonly-overlay')).toBeInTheDocument())
})

test('Executing phase renders MissionDashboard', async () => {
  renderReplayPage()
  await waitFor(() => expect(screen.queryByText(/Đang tải/)).not.toBeInTheDocument())

  emitEvent('replay:mission:agent-spawned', { agent_name: 'Lead', role: 'Coordinator', reset: true, timestamp: 1 })
  emitEvent('replay:mission:plan-ready', { agents: [{ name: 'Dev', role: 'Developer' }], tasks: [{ id: 't1', title: 'Build it', agent: 'Dev' }], mission_context: null })
  emitEvent('replay:mission:task-update', { agent: 'Dev', description: 'Build it', status: 'in_progress', timestamp: 5 })

  await waitFor(() => expect(screen.getByTestId('mission-dashboard-replay-mode')).toBeInTheDocument())
})

// Named alias for `emit` used at call sites below, purely for readability —
// no act() wrapping happens here; the downstream waitFor() calls are what
// flush the resulting state updates.
function emitEvent(channel, payload) {
  emit(channel, payload)
}
