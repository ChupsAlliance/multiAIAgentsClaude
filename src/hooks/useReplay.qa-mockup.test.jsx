import { renderHook, act, cleanup, waitFor } from '@testing-library/react'
import { vi, afterEach, test, expect } from 'vitest'
import { useReplay } from './useReplay'

// Bắt các callback đăng ký qua listen(channel, cb) theo channel, để test
// tự bắn event mô phỏng replay engine phát lại.
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
  useToast: () => ({
    toast: {
      error: vi.fn(),
      warn: vi.fn(),
    },
  }),
}))

afterEach(() => {
  cleanup()
  listeners.clear()
})

test('mission:question followed by mission:answer-sent produces one qa_events entry', async () => {
  const { result } = renderHook(() => useReplay('rec-1'))

  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    emit('mission:question', { questions: [{ question: 'Dùng React hay Vue?' }] })
  })
  act(() => {
    emit('mission:answer-sent', { answers: [{ question_index: 0, answer: 'React' }] })
  })

  await waitFor(() => expect(result.current.replayMissionState.qa_events).toHaveLength(1))
  const entry = result.current.replayMissionState.qa_events[0]
  expect(entry.questions).toEqual([{ question: 'Dùng React hay Vue?' }])
  expect(entry.answers).toEqual([{ question_index: 0, answer: 'React' }])
})

test('mission:answer-sent without a prior mission:question still produces an entry with empty questions', async () => {
  const { result } = renderHook(() => useReplay('rec-2'))

  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    emit('mission:answer-sent', { answers: [{ question_index: 0, answer: 'OK' }] })
  })

  await waitFor(() => expect(result.current.replayMissionState.qa_events).toHaveLength(1))
  const entry = result.current.replayMissionState.qa_events[0]
  expect(entry.questions).toEqual([])
  expect(entry.answers).toEqual([{ question_index: 0, answer: 'OK' }])
})

test('mission:mockup produces one mockup_events entry with title', async () => {
  const { result } = renderHook(() => useReplay('rec-3'))

  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    emit('mission:mockup', { title: 'Trang đăng nhập v2', spec: '...', url: 'http://localhost:1', port: 1 })
  })

  await waitFor(() => expect(result.current.replayMissionState.mockup_events).toHaveLength(1))
  expect(result.current.replayMissionState.mockup_events[0].title).toBe('Trang đăng nhập v2')
})
