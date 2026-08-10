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
    emit('replay:mission:agent-spawned', { agent_name: 'Lead', role: 'Coordinator', reset: true, timestamp: 1 })
  })

  await waitFor(() => expect(result.current.replayMissionState.phase).toBe('Planning'))
})

test('plan-ready sets phase to ReviewPlan and populates replayPlanReady', async () => {
  const { result } = renderHook(() => useReplay('rec-phase-2'))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    emit('replay:mission:agent-spawned', { agent_name: 'Lead', role: 'Coordinator', reset: true, timestamp: 1 })
  })
  act(() => {
    emit('replay:mission:plan-ready', {
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
    emit('replay:mission:mockup', { title: 'Login v2', url: 'http://localhost:1' })
  })
  await waitFor(() => expect(result.current.mockupInfo).toEqual({ title: 'Login v2', url: 'http://localhost:1' }))

  act(() => {
    emit('replay:mission:plan-ready', { agents: [], tasks: [], mission_context: null })
  })

  await waitFor(() => expect(result.current.mockupInfo).toBe(null))
})

test('completed status while ReviewPlan does not change phase', async () => {
  const { result } = renderHook(() => useReplay('rec-phase-4'))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    emit('replay:mission:plan-ready', { agents: [], tasks: [], mission_context: null })
  })
  await waitFor(() => expect(result.current.replayMissionState.phase).toBe('ReviewPlan'))

  act(() => {
    emit('replay:mission:status', { status: 'completed' })
  })

  expect(result.current.replayMissionState.phase).toBe('ReviewPlan')
})

test('stopped status while ReviewPlan moves phase to Done', async () => {
  const { result } = renderHook(() => useReplay('rec-phase-5'))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    emit('replay:mission:plan-ready', { agents: [], tasks: [], mission_context: null })
  })
  await waitFor(() => expect(result.current.replayMissionState.phase).toBe('ReviewPlan'))

  act(() => {
    emit('replay:mission:status', { status: 'stopped' })
  })

  await waitFor(() => expect(result.current.replayMissionState.phase).toBe('Done'))
})

test('first task-update after ReviewPlan moves phase to Executing', async () => {
  const { result } = renderHook(() => useReplay('rec-phase-6'))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    emit('replay:mission:plan-ready', { agents: [], tasks: [], mission_context: null })
  })
  await waitFor(() => expect(result.current.replayMissionState.phase).toBe('ReviewPlan'))

  act(() => {
    emit('replay:mission:task-update', { agent: 'Dev', description: 'Build it', status: 'in_progress', timestamp: 5 })
  })

  await waitFor(() => expect(result.current.replayMissionState.phase).toBe('Executing'))
})

test('completed status while Executing moves phase to Done', async () => {
  const { result } = renderHook(() => useReplay('rec-phase-7'))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    emit('replay:mission:plan-ready', { agents: [], tasks: [], mission_context: null })
  })
  act(() => {
    emit('replay:mission:task-update', { agent: 'Dev', description: 'Build it', status: 'in_progress', timestamp: 5 })
  })
  await waitFor(() => expect(result.current.replayMissionState.phase).toBe('Executing'))

  act(() => {
    emit('replay:mission:status', { status: 'completed' })
  })

  await waitFor(() => expect(result.current.replayMissionState.phase).toBe('Done'))
})

test('pendingQuestion is set by mission:question and cleared by mission:answer-sent', async () => {
  const { result } = renderHook(() => useReplay('rec-phase-8'))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    emit('replay:mission:question', { questions: [{ question: 'Dùng React hay Vue?' }] })
  })
  await waitFor(() => expect(result.current.pendingQuestion).not.toBe(null))
  expect(result.current.pendingQuestion.questions).toEqual([{ question: 'Dùng React hay Vue?' }])

  act(() => {
    emit('replay:mission:answer-sent', { answers: [{ question_index: 0, answer: 'React' }] })
  })

  await waitFor(() => expect(result.current.pendingQuestion).toBe(null))
  // qa_events history still populated exactly as before this change
  expect(result.current.replayMissionState.qa_events).toHaveLength(1)
})

test('mockupInfo is set by mission:mockup and mockup_events history still accumulates', async () => {
  const { result } = renderHook(() => useReplay('rec-phase-9'))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    emit('replay:mission:mockup', { title: 'Trang đăng nhập v2', url: 'http://localhost:1' })
  })

  await waitFor(() => expect(result.current.mockupInfo).toEqual({ title: 'Trang đăng nhập v2', url: 'http://localhost:1' }))
  expect(result.current.replayMissionState.mockup_events).toHaveLength(1)
  expect(result.current.replayMissionState.mockup_events[0].title).toBe('Trang đăng nhập v2')
})
