import { render, screen } from '@testing-library/react'
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

const EXPLANATION_TEXT = 'Sẽ tạo tệp .md trong .claude-agent-team/ và mở terminal thật tại folder đã chọn.'

function findExplanationParagraph(container) {
  return Array.from(container.querySelectorAll('p')).find(
    (p) => p.textContent === EXPLANATION_TEXT
  )
}

test('shows Launch-behavior explanation line even with no template selected', () => {
  const { container } = renderPage()
  expect(findExplanationParagraph(container)).toBeTruthy()
})

test('explanation line still visible after selecting a template (button enabled or not)', async () => {
  const { container } = renderPage()
  const firstTemplateCard = container.querySelector('button.text-left')
  firstTemplateCard.click()
  await screen.findByText('Chọn folder')
  expect(findExplanationParagraph(container)).toBeTruthy()
})
