import { render, screen } from '@testing-library/react'
import { test, expect } from 'vitest'
import { TaskList } from './TaskList'

test('renders QC Review status text when task has pending_qc status', () => {
  const tasks = [
    {
      id: 't1',
      title: 'Build the widget',
      status: 'pending_qc',
      assigned_agent: 'Dev',
    },
  ]
  render(<TaskList tasks={tasks} logs={[]} />)
  expect(screen.getByText(/In QC Review/i)).toBeInTheDocument()
})

test('renders QC Failed status text when task has failed_qc status', () => {
  const tasks = [
    {
      id: 't2',
      title: 'Widget implementation',
      status: 'failed_qc',
      assigned_agent: 'Dev',
    },
  ]
  render(<TaskList tasks={tasks} logs={[]} />)
  expect(screen.getByText(/QC Failed/i)).toBeInTheDocument()
})

test('renders QA Review status text when task has pending_qa status', () => {
  const tasks = [
    {
      id: 't3',
      title: 'Widget testing',
      status: 'pending_qa',
      assigned_agent: 'QA',
    },
  ]
  render(<TaskList tasks={tasks} logs={[]} />)
  expect(screen.getByText(/In QA Review/i)).toBeInTheDocument()
})

test('renders QA Failed status text when task has failed_qa status', () => {
  const tasks = [
    {
      id: 't4',
      title: 'Widget fixes',
      status: 'failed_qa',
      assigned_agent: 'QA',
    },
  ]
  render(<TaskList tasks={tasks} logs={[]} />)
  expect(screen.getByText(/QA Failed/i)).toBeInTheDocument()
})
