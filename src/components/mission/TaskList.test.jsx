import { render, screen, fireEvent } from '@testing-library/react'
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

test('a task with lastFailureDetail reveals the failure reason when clicked', () => {
  const tasks = [
    {
      id: 't5',
      title: 'Widget fixes',
      status: 'failed_qc',
      assigned_agent: 'Dev',
      lastFailureDetail: {
        stage: 'qc', reason: 'lint error on line 42', responsibleAgent: 'Dev',
        qcRound: 2, timestamp: 100,
      },
    },
  ]
  render(<TaskList tasks={tasks} logs={[]} />)

  expect(screen.queryByText(/lint error on line 42/i)).toBeNull()
  fireEvent.click(screen.getByText('Widget fixes'))
  expect(screen.getByText(/lint error on line 42/i)).toBeInTheDocument()
  expect(screen.getAllByText(/attempt 2\/8/i).length).toBeGreaterThan(0)
})

test('a task with multi-round failureHistory shows every round, most-recent-first, when clicked', () => {
  const tasks = [
    {
      id: 't7',
      title: 'Widget rewrite',
      status: 'failed_qc',
      assigned_agent: 'Dev',
      lastFailureDetail: {
        stage: 'qc', reason: 'second failure', responsibleAgent: 'Dev',
        qcRound: 2, timestamp: 200,
      },
      failureHistory: [
        { stage: 'qc', reason: 'first failure', responsibleAgent: 'Dev', qcRound: 1, timestamp: 100 },
        { stage: 'qc', reason: 'second failure', responsibleAgent: 'Dev', qcRound: 2, timestamp: 200 },
      ],
    },
  ]
  render(<TaskList tasks={tasks} logs={[]} />)

  fireEvent.click(screen.getByText('Widget rewrite'))

  expect(screen.getByText(/first failure/i)).toBeInTheDocument()
  expect(screen.getByText(/second failure/i)).toBeInTheDocument()
  expect(screen.getAllByText(/attempt 2\/8/i).length).toBeGreaterThan(0)
  expect(screen.getByText(/\(2 rounds\)/i)).toBeInTheDocument()

  const reasons = screen.getAllByText(/failure$/i).map(el => el.textContent)
  expect(reasons).toEqual(['second failure', 'first failure'])
})

test('a task without lastFailureDetail is not clickable/expandable', () => {
  const tasks = [
    { id: 't6', title: 'Plain task', status: 'in_progress', assigned_agent: 'Dev' },
  ]
  render(<TaskList tasks={tasks} logs={[]} />)

  fireEvent.click(screen.getByText('Plain task'))
  expect(screen.queryByText(/attempt/i)).toBeNull()
})
