import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from './ToastProvider'
import { useToast } from '../../hooks/useToast'

function Trigger({ type, title, message }) {
  const { toast } = useToast()
  return <button onClick={() => toast[type](title, message)}>fire</button>
}

function TestApp({ type = 'error', title = 'Test title', message = 'Test message' }) {
  return (
    <ToastProvider>
      <Trigger type={type} title={title} message={message} />
    </ToastProvider>
  )
}

test('shows toast on error', async () => {
  render(<TestApp type="error" title="Lỗi" message="Chi tiết lỗi" />)
  await userEvent.click(screen.getByText('fire'))
  expect(screen.getByText('Lỗi')).toBeInTheDocument()
  expect(screen.getByText('Chi tiết lỗi')).toBeInTheDocument()
})

test('dismisses toast on × click', async () => {
  render(<TestApp type="error" title="Lỗi" />)
  await userEvent.click(screen.getByText('fire'))
  await userEvent.click(screen.getByLabelText('Đóng thông báo'))
  expect(screen.queryByText('Lỗi')).not.toBeInTheDocument()
})

test('shows action button and calls onClick', async () => {
  const onClick = vi.fn()
  function TriggerWithAction() {
    const { toast } = useToast()
    return (
      <button onClick={() => toast.error('Title', 'Msg', { label: 'Retry', onClick })}>fire</button>
    )
  }
  render(
    <ToastProvider>
      <TriggerWithAction />
    </ToastProvider>
  )
  await userEvent.click(screen.getByText('fire'))
  await userEvent.click(screen.getByText('Retry'))
  expect(onClick).toHaveBeenCalledOnce()
})

test('caps at 5 toasts', async () => {
  function ManyFires() {
    const { toast } = useToast()
    return <button onClick={() => { for (let i = 0; i < 6; i++) toast.error(`Toast ${i}`) }}>fire</button>
  }
  render(<ToastProvider><ManyFires /></ToastProvider>)
  await userEvent.click(screen.getByText('fire'))
  expect(screen.getAllByRole('alert')).toHaveLength(5)
})
