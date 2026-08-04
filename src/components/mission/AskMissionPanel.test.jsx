import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, vi, beforeAll } from 'vitest'
import { AskMissionPanel } from './AskMissionPanel'

// jsdom doesn't implement scrollIntoView; the component calls it on mount/update as a
// (real-browser-only) UX nicety, unrelated to what this test is verifying.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

// The direct `invoke('ask_mission_live', ...)` call is mocked to never resolve within the
// test's timeframe, isolating the `mission:companion-answer` event-listener path so we can
// verify its matching logic in isolation (this is the path that was previously broken:
// it matched on a backend-generated `timestamp` that can never equal the client's).
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => new Promise(() => {})), // never resolves
}))

test('event listener resolves the pending pair by matching question text, not timestamp', async () => {
  let registeredHandler = null
  window.electronAPI = {
    on: vi.fn((event, cb) => {
      if (event === 'mission:companion-answer') registeredHandler = cb
      return () => {}
    }),
  }

  const user = userEvent.setup()
  render(<AskMissionPanel />)

  const input = screen.getByPlaceholderText('Hỏi mission đang chạy...')
  await user.type(input, 'What is the current task?')
  await user.keyboard('{Enter}')

  // Pending state shown while the (never-resolving) direct invoke() is in flight.
  expect(screen.getByText('Đang suy nghĩ…')).toBeInTheDocument()

  // Simulate the backend event arriving with its OWN fresh timestamp (never equal to the
  // client-side timestamp used as the pending pair's key) but the same question text.
  act(() => {
    registeredHandler({
      question: 'What is the current task?',
      answer: 'The current task is building the API.',
      timestamp: Date.now() + 999999, // deliberately mismatched vs. the client's timestamp
    })
  })

  expect(await screen.findByText('A: The current task is building the API.')).toBeInTheDocument()
  expect(screen.queryByText('Đang suy nghĩ…')).not.toBeInTheDocument()

  delete window.electronAPI
})
