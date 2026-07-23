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

test('tab switcher shows Vietnamese labels, not English', async () => {
  renderPage()
  expect(await screen.findByText('Xây dựng')).toBeInTheDocument()
  expect(screen.getByText('Lịch sử (0)')).toBeInTheDocument()
  expect(screen.queryByText('Builder')).not.toBeInTheDocument()
  expect(screen.queryByText(/^History/)).not.toBeInTheDocument()
})

test('folder picker button shows Vietnamese label after selecting a template', async () => {
  const { container } = renderPage()
  const firstTemplateCard = container.querySelector('button.text-left')
  firstTemplateCard.click()
  expect(await screen.findByText('Chọn folder')).toBeInTheDocument()
  expect(screen.queryByText('Browse')).not.toBeInTheDocument()
})

test('preview label, copy button, and export button show Vietnamese text', async () => {
  const { container } = renderPage()
  const firstTemplateCard = container.querySelector('button.text-left')
  firstTemplateCard.click()
  expect(await screen.findByText('Xem trước prompt')).toBeInTheDocument()
  expect(screen.getByText('Sao chép prompt')).toBeInTheDocument()
  expect(screen.getByText('Xuất .txt')).toBeInTheDocument()
  expect(screen.queryByText('Preview prompt')).not.toBeInTheDocument()
  expect(screen.queryByText('Copy prompt')).not.toBeInTheDocument()
  expect(screen.queryByText('Export .txt')).not.toBeInTheDocument()
})

test('launch button shows Vietnamese text', async () => {
  const { container } = renderPage()
  const firstTemplateCard = container.querySelector('button.text-left')
  firstTemplateCard.click()
  expect(await screen.findByText(/Khởi chạy — Tạo tệp & Mở terminal/)).toBeInTheDocument()
  expect(screen.queryByText(/Launch — Tạo files/)).not.toBeInTheDocument()
})
