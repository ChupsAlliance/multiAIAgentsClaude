import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { PlanVersionHistory } from './PlanVersionHistory'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const versions = [
  { version: 2, label: 'v2 - rollback', timestamp: Date.now(), agents: [], tasks: [] },
  { version: 1, label: 'v1 - initial', timestamp: Date.now() - 1000, agents: [], tasks: [] },
]

describe('PlanVersionHistory', () => {
  beforeEach(() => { invoke.mockReset() })

  test('on mount, calls invoke(get_plan_versions) and renders each returned version label', async () => {
    invoke.mockResolvedValueOnce(versions)
    render(
      <PlanVersionHistory missionId="m1" currentAgents={[]} currentTasks={[]} onRollback={vi.fn()} />
    )

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('get_plan_versions', { missionId: 'm1' }))
    expect(await screen.findByText('v2 - rollback')).toBeInTheDocument()
    expect(screen.getByText('v1 - initial')).toBeInTheDocument()
    expect(screen.queryByText('Chưa có lịch sử')).not.toBeInTheDocument()
  })

  test('confirming a rollback calls invoke(save_plan_version) then onRollback', async () => {
    invoke.mockResolvedValueOnce(versions) // initial loadVersions() on mount
    const onRollback = vi.fn()
    const user = userEvent.setup()
    render(
      <PlanVersionHistory missionId="m1" currentAgents={[]} currentTasks={[]} onRollback={onRollback} />
    )
    await screen.findByText('v1 - initial')

    invoke.mockResolvedValueOnce(undefined) // save_plan_version(trigger: rollback)
    invoke.mockResolvedValueOnce(versions)  // loadVersions() re-fetch after rollback

    await user.click(screen.getByTitle('Khôi phục về version này'))
    await user.click(screen.getByRole('button', { name: 'Khôi phục' }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('save_plan_version', {
      missionId: 'm1',
      trigger: 'rollback',
      agents: [],
      tasks: [],
    }))
    await waitFor(() => expect(onRollback).toHaveBeenCalledWith([], []))
  })

  test('shows the rollback error banner when the confirmed rollback invoke rejects', async () => {
    invoke.mockResolvedValueOnce(versions) // initial loadVersions() on mount
    const user = userEvent.setup()
    render(
      <PlanVersionHistory missionId="m1" currentAgents={[]} currentTasks={[]} onRollback={vi.fn()} />
    )
    await screen.findByText('v1 - initial')

    invoke.mockRejectedValueOnce(new Error('save failed'))

    await user.click(screen.getByTitle('Khôi phục về version này'))
    await user.click(screen.getByRole('button', { name: 'Khôi phục' }))

    expect(await screen.findByText('save failed')).toBeInTheDocument()
  })
})
