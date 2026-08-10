import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { ExportDropdown } from './ExportDropdown'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const missionState = {
  id: 'm1',
  description: 'Test mission',
  project_path: '/tmp/proj',
  requirement: 'Build X',
  mission_context: 'ctx',
  agents: [{ name: 'Dev', role: 'Backend', model: 'sonnet', reason: 'r' }],
  tasks: [{ id: 't1', title: 'Task 1', why: 'w', depends_on: [], detail: '', priority: 'high', assigned_agent: 'Dev' }],
}

describe('ExportDropdown', () => {
  beforeEach(() => { invoke.mockReset() })

  test('clicking Markdown export calls invoke(export_plan_markdown) and shows success toast', async () => {
    invoke.mockResolvedValueOnce({ success: true })
    const onToast = vi.fn()
    const user = userEvent.setup()
    render(<ExportDropdown missionState={missionState} projectPath="/tmp/proj" onToast={onToast} />)

    await user.click(screen.getByTitle('Xuất ra file (Ctrl+E)'))
    await user.click(screen.getByText('Markdown (.md)'))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('export_plan_markdown', {
      markdown: expect.any(String),
      projectPath: '/tmp/proj',
    }))
    await waitFor(() => expect(onToast).toHaveBeenCalledWith('success', expect.stringContaining('Đã xuất')))
  })

  test('clicking Markdown export shows a failure toast when invoke rejects', async () => {
    invoke.mockRejectedValueOnce(new Error('boom'))
    const onToast = vi.fn()
    const user = userEvent.setup()
    render(<ExportDropdown missionState={missionState} projectPath="/tmp/proj" onToast={onToast} />)

    await user.click(screen.getByTitle('Xuất ra file (Ctrl+E)'))
    await user.click(screen.getByText('Markdown (.md)'))

    await waitFor(() => expect(onToast).toHaveBeenCalledWith('error', expect.stringContaining('boom')))
  })

  test('clicking PDF export calls invoke(export_plan_pdf) and shows success toast when resolved', async () => {
    invoke.mockResolvedValueOnce({ success: true })
    const onToast = vi.fn()
    const user = userEvent.setup()
    render(<ExportDropdown missionState={missionState} projectPath="/tmp/proj" onToast={onToast} />)

    await user.click(screen.getByTitle('Xuất ra file (Ctrl+E)'))
    await user.click(screen.getByText('PDF (.pdf)'))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('export_plan_pdf', {
      htmlContent: expect.any(String),
      description: 'Test mission',
    }))
    await waitFor(() => expect(onToast).toHaveBeenCalledWith('success', 'Đã xuất PDF'))
  })
})
