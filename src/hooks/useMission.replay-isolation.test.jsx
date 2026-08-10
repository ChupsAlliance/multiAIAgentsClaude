import { renderHook, act, cleanup, waitFor } from '@testing-library/react'
import { vi, afterEach, test, expect } from 'vitest'
import { useMission } from './useMission'
import { useReplay } from './useReplay'

const listeners = new Map()
function emit(channel, payload) {
  const cbs = listeners.get(channel) || []
  cbs.forEach(cb => cb({ payload }))
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd) => {
    if (cmd === 'replay_start') {
      return Promise.resolve({ totalMs: 1000, eventCount: 1, recording: { name: 'demo' }, stepMarkers: [] })
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

const stableToast = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() }
vi.mock('./useToast', () => ({
  useToast: () => ({ toast: stableToast }),
}))

afterEach(() => {
  cleanup()
  listeners.clear()
})

test('a replayed reset agent-spawned event updates useReplay but leaves useMission untouched', async () => {
  const mission = renderHook(() => useMission())
  const replay = renderHook(() => useReplay('rec-isolation-1'))

  await act(async () => { await Promise.resolve() })
  await waitFor(() => expect(replay.result.current.loading).toBe(false))

  expect(mission.result.current.missionState).toBe(null)

  act(() => {
    emit('replay:mission:agent-spawned', { agent_name: 'Lead', role: 'Coordinator', reset: true, timestamp: 1 })
  })

  await waitFor(() => expect(replay.result.current.replayMissionState.phase).toBe('Planning'))
  expect(replay.result.current.replayMissionState.agents).toHaveLength(1)

  // Regression check for issue #6: even with both hooks mounted simultaneously
  // (as MissionControlPage.jsx does today), a replayed event must never reach
  // useMission's state.
  expect(mission.result.current.missionState).toBe(null)
})

test('a bare-channel live event still reaches useMission normally', async () => {
  const mission = renderHook(() => useMission())
  await act(async () => { await Promise.resolve() })

  act(() => {
    emit('mission:agent-spawned', { agent_name: 'Lead', role: 'Coordinator', reset: true, timestamp: 1 })
  })

  await waitFor(() => expect(mission.result.current.missionState).not.toBe(null))
  expect(mission.result.current.missionState.agents).toHaveLength(1)
})
