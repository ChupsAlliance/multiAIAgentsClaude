import { describe, test, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MissionHeader } from './MissionHeader'

function baseState(overrides = {}) {
  return {
    id: 'm1', description: 'Build the checkout flow', status: 'Running',
    ...overrides,
  }
}

describe('MissionHeader — Stop & create fix mission button', () => {
  test('renders when stuck on exhausted final-QA retry', () => {
    const onCreateQaFixMission = vi.fn()
    render(
      <MissionHeader
        state={baseState({ status: 'Needs Attention', stuckReason: 'final_qa_retry_exhausted' })}
        onStop={vi.fn()} onNewMission={vi.fn()} elapsed={0}
        onCreateQaFixMission={onCreateQaFixMission}
      />
    )

    const button = screen.getByRole('button', { name: /fix mission/i })
    fireEvent.click(button)
    expect(onCreateQaFixMission).toHaveBeenCalledTimes(1)
  })

  test('does not render for the other Needs Attention cause (per-task escalation ceiling)', () => {
    render(
      <MissionHeader
        state={baseState({ status: 'Needs Attention', stuckReason: null })}
        onStop={vi.fn()} onNewMission={vi.fn()} elapsed={0}
        onCreateQaFixMission={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: /fix mission/i })).toBeNull()
  })

  test('does not render while Running', () => {
    render(
      <MissionHeader
        state={baseState({ status: 'Running' })}
        onStop={vi.fn()} onNewMission={vi.fn()} elapsed={0}
        onCreateQaFixMission={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: /fix mission/i })).toBeNull()
  })
})
