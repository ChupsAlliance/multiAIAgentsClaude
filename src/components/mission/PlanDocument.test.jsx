import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { PlanDocument } from './PlanDocument'
import { planToMarkdown } from '../../utils/planMarkdown'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const agents = [{ name: 'Dev', role: 'Backend developer', model: 'sonnet', reason: 'r' }]
const tasks = [{ id: 't1', title: 'Build API', why: 'w', depends_on: [], detail: '', priority: 'high', assigned_agent: 'Dev' }]
const meta = { projectPath: '/tmp/proj', requirement: 'Build X', mission_context: 'ctx' }

// Edits the raw markdown textarea to a version with a real, diff-detectable change
// (an agent role change), then drives the Apply → confirm-in-modal flow.
async function editMarkdownAndApply(user) {
  const editedMarkdown = planToMarkdown(
    [{ ...agents[0], role: 'Backend developer v2' }],
    tasks,
    meta
  )
  const textarea = screen.getByRole('textbox')
  fireEvent.change(textarea, { target: { value: editedMarkdown } })

  const applyButton = await screen.findByText('Áp dụng thay đổi')
  await user.click(applyButton)

  const confirmButton = await screen.findByRole('button', { name: 'Áp dụng' })
  await user.click(confirmButton)
}

describe('PlanDocument manual-edit plan version save', () => {
  beforeEach(() => {
    invoke.mockReset()
    invoke.mockResolvedValue({})
  })

  test('saves a manual_edit plan version via invoke when missionId is set', async () => {
    const onApply = vi.fn()
    const user = userEvent.setup()
    render(
      <PlanDocument
        agents={agents}
        tasks={tasks}
        missionContext="ctx"
        projectPath="/tmp/proj"
        requirement="Build X"
        missionId="m1"
        onApply={onApply}
      />
    )

    await editMarkdownAndApply(user)

    expect(invoke).toHaveBeenCalledWith('save_plan_version', expect.objectContaining({
      missionId: 'm1',
      trigger: 'manual_edit',
      agents: expect.any(Array),
      tasks: expect.any(Array),
    }))
    expect(onApply).toHaveBeenCalled()
  })

  test('does not call invoke when missionId is falsy', async () => {
    const onApply = vi.fn()
    const user = userEvent.setup()
    render(
      <PlanDocument
        agents={agents}
        tasks={tasks}
        missionContext="ctx"
        projectPath="/tmp/proj"
        requirement="Build X"
        missionId={null}
        onApply={onApply}
      />
    )

    await editMarkdownAndApply(user)

    expect(invoke).not.toHaveBeenCalled()
    expect(onApply).toHaveBeenCalled()
  })
})
