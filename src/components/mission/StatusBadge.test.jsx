import { render, screen } from '@testing-library/react'
import { test, expect } from 'vitest'
import { StatusBadge } from './StatusBadge'

test('renders a distinct label for pending_qc', () => {
  render(<StatusBadge status="pending_qc" />)
  expect(screen.getByText(/QC/i)).toBeInTheDocument()
})

test('renders a distinct label for pending_qa', () => {
  render(<StatusBadge status="pending_qa" />)
  expect(screen.getByText(/QA/i)).toBeInTheDocument()
})

test('renders a distinct label for failed_qc', () => {
  render(<StatusBadge status="failed_qc" />)
  expect(screen.getByText(/QC/i)).toBeInTheDocument()
})

test('renders a distinct label for Needs Attention', () => {
  render(<StatusBadge status="Needs Attention" />)
  expect(screen.getByText('Needs Attention')).toBeInTheDocument()
})

test('renders a distinct label for AwaitingFinalQA', () => {
  render(<StatusBadge status="AwaitingFinalQA" />)
  expect(screen.getByText(/Final QA/i)).toBeInTheDocument()
})
