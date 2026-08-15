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
    emit('mission:task-update', {
      agent: 'Dev', description: 'Build it', status: 'failed_qc',
      reason: 'x', stage: 'qc', qcRound: 1, timestamp: 6,
    })
  })

  expect(result.current.missionState.tasks).toHaveLength(1)
  expect(result.current.missionState.tasks[0].status).toBe('failed_qc')
  expect(result.current.missionState.tasks[0].lastFailureDetail).toEqual({
    stage: 'qc', reason: 'x', responsibleAgent: 'Dev', qcRound: 1, timestamp: 6,
  })
  expect(result.current.missionState.tasks[0].failureHistory).toEqual([
    { stage: 'qc', reason: 'x', responsibleAgent: 'Dev', qcRound: 1, timestamp: 6 },
  ])
})

test('failureHistory accumulates across rounds without duplicating on the retry bounce-back', async () => {
  const result = await setupMissionWithOneTask()

  act(() => {
    emit('mission:task-update', {
      agent: 'Dev', description: 'Build it', status: 'failed_qc',
      reason: 'first', stage: 'qc', qcRound: 1, timestamp: 6,
    })
  })
  act(() => {
    emit('mission:task-update', {
      agent: 'Dev', description: 'Build it', status: 'in_progress',
      reason: 'first', stage: 'qc', qcRound: 1, timestamp: 7,
    })
  })
  act(() => {
    emit('mission:task-update', {
      agent: 'Dev', description: 'Build it', status: 'failed_qc',
      reason: 'second', stage: 'qc', qcRound: 2, timestamp: 8,
    })
  })

  expect(result.current.missionState.tasks[0].failureHistory).toEqual([
    { stage: 'qc', reason: 'first', responsibleAgent: 'Dev', qcRound: 1, timestamp: 6 },
    { stage: 'qc', reason: 'second', responsibleAgent: 'Dev', qcRound: 2, timestamp: 8 },
  ])
})

test('lastFailureDetail survives the retry bounce-back to in_progress', async () => {
  const result = await setupMissionWithOneTask()

  act(() => {
    emit('mission:task-update', { agent: 'Dev', description: 'Build it', status: 'pending_qc', timestamp: 5 })
  })
  act(() => {
    emit('mission:task-update', {
      agent: 'Dev', description: 'Build it', status: 'failed_qc',
      reason: 'x', stage: 'qc', qcRound: 1, timestamp: 6,
    })
  })
  act(() => {
    emit('mission:task-update', {
      agent: 'Dev', description: 'Build it', status: 'in_progress',
      reason: 'x', stage: 'qc', qcRound: 1, timestamp: 7,
    })
  })

  expect(result.current.missionState.tasks[0].status).toBe('in_progress')
  expect(result.current.missionState.tasks[0].lastFailureDetail).toEqual({
    stage: 'qc', reason: 'x', responsibleAgent: 'Dev', qcRound: 1, timestamp: 7,
  })
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

test('stop() shows a confirm dialog and does not call stop_mission when a retry is pending and the user cancels', async () => {
  const { invoke } = await import('@tauri-apps/api/core')
  invoke.mockClear()
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

  const { result } = renderHook(() => useMission())
  await act(async () => { await Promise.resolve() })

  act(() => {
    emit('mission:retry-pending', { pending: true, attempt: 2, maxAttempts: 3, delayMs: 60000 })
  })

  await act(async () => {
    await result.current.stop()
  })

  expect(confirmSpy).toHaveBeenCalledWith(
    'Mission đang tự động thử lại lần 2/3 sau lỗi tạm thời. Nếu dừng ngay bây giờ, lần thử lại sẽ bị huỷ. Bạn có chắc chắn muốn dừng mission?'
  )
  expect(invoke).not.toHaveBeenCalledWith('stop_mission')

  confirmSpy.mockRestore()
})

test('stop() calls stop_mission after the user confirms, when a retry is pending', async () => {
  const { invoke } = await import('@tauri-apps/api/core')
  invoke.mockClear()
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

  const { result } = renderHook(() => useMission())
  await act(async () => { await Promise.resolve() })

  act(() => {
    emit('mission:retry-pending', { pending: true, attempt: 1, maxAttempts: 3, delayMs: 30000 })
  })

  await act(async () => {
    await result.current.stop()
  })

  expect(confirmSpy).toHaveBeenCalled()
  expect(invoke).toHaveBeenCalledWith('stop_mission')

  confirmSpy.mockRestore()
})

test('stop() does not show a confirm dialog when no retry is pending', async () => {
  const { invoke } = await import('@tauri-apps/api/core')
  invoke.mockClear()
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

  const { result } = renderHook(() => useMission())
  await act(async () => { await Promise.resolve() })

  await act(async () => {
    await result.current.stop()
  })

  expect(confirmSpy).not.toHaveBeenCalled()
  expect(invoke).toHaveBeenCalledWith('stop_mission')

  confirmSpy.mockRestore()
})

test('a mission:status event clears a pending-retry flag, so a later stop() does not prompt', async () => {
  const { invoke } = await import('@tauri-apps/api/core')
  invoke.mockClear()
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

  const { result } = renderHook(() => useMission())
  await act(async () => { await Promise.resolve() })

  act(() => {
    emit('mission:retry-pending', { pending: true, attempt: 1, maxAttempts: 3, delayMs: 30000 })
  })
  act(() => {
    emit('mission:status', { status: 'running' })
  })

  await act(async () => {
    await result.current.stop()
  })

  expect(confirmSpy).not.toHaveBeenCalled()
  expect(invoke).toHaveBeenCalledWith('stop_mission')

  confirmSpy.mockRestore()
})

test('a mission:status event with stuck_reason updates renderer state.stuckReason live (no reload needed)', async () => {
  const result = await setupMissionWithOneTask()

  await act(async () => {
    emit('mission:status', { status: 'Needs Attention', stuck_reason: 'final_qa_retry_exhausted' })
  })

  expect(result.current.missionState.stuckReason).toBe('final_qa_retry_exhausted')

  // And it must clear on the next non-stuck transition (e.g. a manual retry, which
  // emits mission:status with no stuck_reason field at all):
  await act(async () => {
    emit('mission:status', { status: 'running' })
  })

  expect(result.current.missionState.stuckReason).toBeNull()
})

test('createQaFixMission calls create_qa_fix_mission and shows a success toast', async () => {
  const { invoke } = await import('@tauri-apps/api/core')
  invoke.mockClear()
  invoke.mockResolvedValueOnce({ ok: true, mission_id: 'mission-999' })

  const { result } = renderHook(() => useMission())
  await act(async () => { await Promise.resolve() })

  await act(async () => { await result.current.createQaFixMission() })

  expect(invoke).toHaveBeenCalledWith('create_qa_fix_mission')
})
