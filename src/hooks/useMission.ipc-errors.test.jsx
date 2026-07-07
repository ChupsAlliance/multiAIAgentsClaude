import { renderHook, act, cleanup } from '@testing-library/react'
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

afterEach(cleanup)

test('stop failure shows toast error', async () => {
  const { result } = renderHook(() => useMission(), { wrapper })
  await act(async () => { await result.current.stop() })
  const alerts = document.querySelectorAll('[role="alert"]')
  expect(alerts.length).toBeGreaterThan(0)
  expect(alerts[0].textContent).toContain('Không thể dừng mission')
})

test('answerQuestion failure shows toast warn', async () => {
  const { result } = renderHook(() => useMission(), { wrapper })
  await act(async () => { await result.current.answerQuestion(['answer']) })
  const alerts = document.querySelectorAll('[role="alert"]')
  expect(alerts.length).toBeGreaterThan(0)
  const text = Array.from(alerts).map(a => a.textContent).join(' ')
  expect(text).toContain('Không gửi được câu trả lời')
})

test('respondToMockup failure shows toast warn', async () => {
  const { result } = renderHook(() => useMission(), { wrapper })
  await act(async () => { await result.current.respondToMockup('approve', '') })
  const alerts = document.querySelectorAll('[role="alert"]')
  expect(alerts.length).toBeGreaterThan(0)
  const text = Array.from(alerts).map(a => a.textContent).join(' ')
  expect(text).toContain('Không gửi được phản hồi mockup')
})
