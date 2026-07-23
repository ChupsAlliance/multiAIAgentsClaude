import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { PlaygroundPage } from './PlaygroundPage'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd) => {
    if (cmd === 'load_history') return Promise.resolve([])
    return Promise.resolve(null)
  }),
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <PlaygroundPage />
    </MemoryRouter>
  )
}

async function selectFirstTemplateAndFillRequiredFields(container) {
  const firstTemplateCard = container.querySelector('button.text-left')
  await userEvent.click(firstTemplateCard)
  const requiredInput = container.querySelector('input[type="text"], input:not([type])')
  if (requiredInput) await userEvent.type(requiredInput, 'test value')
}

test('does not call window.alert when Launch is clicked without a folder', async () => {
  const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
  const { container } = renderPage()
  await selectFirstTemplateAndFillRequiredFields(container)

  const launchButton = await screen.findByRole('button', { name: /Khởi chạy/ })
  await userEvent.click(launchButton)

  expect(alertSpy).not.toHaveBeenCalled()
  alertSpy.mockRestore()
})

test('Launch button is disabled when project folder is empty', async () => {
  const { container } = renderPage()
  await selectFirstTemplateAndFillRequiredFields(container)

  const launchButton = await screen.findByRole('button', { name: /Khởi chạy/ })
  expect(launchButton).toBeDisabled()
})

test('shows inline warning "Chọn project folder để khởi chạy" when folder missing', async () => {
  const { container } = renderPage()
  await selectFirstTemplateAndFillRequiredFields(container)

  expect(await screen.findByText('Chọn project folder để khởi chạy')).toBeInTheDocument()
})

test('Launch button enables once folder and required fields are filled', async () => {
  const { container } = renderPage()
  await selectFirstTemplateAndFillRequiredFields(container)

  const folderInput = screen.getByPlaceholderText('C:\\Users\\...\\my-project')
  await userEvent.type(folderInput, 'C:\\fake\\project')

  const launchButton = await screen.findByRole('button', { name: /Khởi chạy/ })
  expect(launchButton).not.toBeDisabled()
})
