import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { Sidebar } from './Sidebar'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve({ claude_available: true, agent_teams_enabled: true, app_version: '0.10.1' })),
}))

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar activeSection={null} />
    </MemoryRouter>
  )
}

test('renders a theme toggle button in the sidebar footer', () => {
  renderSidebar()
  expect(screen.getByRole('button', { name: /chuyển giao diện|toggle theme/i })).toBeInTheDocument()
})

test('clicking the theme toggle adds the light class to html and persists it', async () => {
  localStorage.clear()
  document.documentElement.classList.remove('light')
  renderSidebar()
  const toggleButton = screen.getByRole('button', { name: /chuyển giao diện|toggle theme/i })
  toggleButton.click()
  await waitFor(() => expect(document.documentElement.classList.contains('light')).toBe(true))
  expect(localStorage.getItem('theme')).toBe('light')
  document.documentElement.classList.remove('light')
})
