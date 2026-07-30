import { renderHook, act, cleanup } from '@testing-library/react'
import { afterEach, test, expect, vi } from 'vitest'
import { useMission } from './useMission'

// Reuse the shared listeners-map / emit pattern used by
// MissionControlPage.replay-phases.test.jsx for mocking @tauri-apps/api/event.
const listeners = new Map()
function emit(channel, payload) {
  const cbs = listeners.get(channel) || []
  cbs.forEach(cb => cb({ payload }))
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
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

// Stable toast object — a fresh object per render would change identity on
// every render and cause hooks with a `[toast]` dependency (e.g. the
// planning timer helpers) to re-run, which in turn would re-run the main
// listen() effect and register duplicate listeners.
const stableToast = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() }
vi.mock('./useToast', () => ({
  useToast: () => ({ toast: stableToast }),
}))

afterEach(() => {
  cleanup()
  listeners.clear()
})

async function setupMissionWithOneTask() {
  const { result } = renderHook(() => useMission())

  // Wait for the effect's listen() registrations to resolve.
  await act(async () => { await Promise.resolve() })

  // Seed missionState (agent-spawned with reset creates a fresh missionState).
  act(() => {
    emit('mission:agent-spawned', { agent_name: 'Lead', role: 'Coordinator', reset: true, timestamp: 1 })
  })

  // Seed one task via the "else" (create) branch of the task-update handler.
  act(() => {
    emit('mission:task-update', { agent: 'Dev', description: 'Build it', status: 'in_progress', timestamp: 2 })
  })

  expect(result.current.missionState.tasks).toHaveLength(1)
  expect(result.current.missionState.tasks[0].status).toBe('in_progress')

  return result
}

test('a pending_qc update replaces the matching in_progress task, not appends a duplicate', async () => {
  const result = await setupMissionWithOneTask()

  act(() => {
    emit('mission:task-update', { agent: 'Dev', description: 'Build it', status: 'pending_qc', timestamp: 5 })
  })

  expect(result.current.missionState.tasks).toHaveLength(1)
  expect(result.current.missionState.tasks[0].status).toBe('pending_qc')
})

test('a failed_qc update on an existing pending_qc task updates it in place', async () => {
  const result = await setupMissionWithOneTask()

  act(() => {
    emit('mission:task-update', { agent: 'Dev', description: 'Build it', status: 'pending_qc', timestamp: 5 })
  })
  act(() => {
    emit('mission:task-update', { agent: 'Dev', description: 'Build it', status: 'failed_qc', reason: 'x', timestamp: 6 })
  })

  expect(result.current.missionState.tasks).toHaveLength(1)
  expect(result.current.missionState.tasks[0].status).toBe('failed_qc')
})

test('a completed update with no description still matches a pending_qa task via the agent-only fallback', async () => {
  const result = await setupMissionWithOneTask()

  // Move through the QC/QA in-flight states, same as the backend does,
  // ending on pending_qa (task not currently in_progress).
  act(() => {
    emit('mission:task-update', { agent: 'Dev', description: 'Build it', status: 'pending_qc', timestamp: 5 })
  })
  act(() => {
    emit('mission:task-update', { agent: 'Dev', description: 'Build it', status: 'pending_qa', timestamp: 6 })
  })
  expect(result.current.missionState.tasks).toHaveLength(1)
  expect(result.current.missionState.tasks[0].status).toBe('pending_qa')

  // QA pass event carries no `description`, so the exact/substring title
  // matchers can't fire — only the agent+status fallback can find it.
  act(() => {
    emit('mission:task-update', { agent: 'Dev', status: 'completed', timestamp: 7 })
  })

  expect(result.current.missionState.tasks).toHaveLength(1)
  expect(result.current.missionState.tasks[0].status).toBe('completed')
})
