import { render, screen } from '@testing-library/react'
import { test, expect } from 'vitest'
import { PresentationTimeline } from './PresentationTimeline'

const baseState = {
  agents: [],
  log: [],
  file_changes: [],
  tasks: [],
}

test('renders a qa card with question and answer text', () => {
  const state = {
    ...baseState,
    qa_events: [{
      timestamp: 1000,
      questions: [{ question: 'Dùng React hay Vue?' }],
      answers: [{ question_index: 0, answer: 'React' }],
    }],
    mockup_events: [],
  }
  render(<PresentationTimeline state={state} currentMs={10000} charsPerSecond={999} instant />)
  expect(screen.getByText(/Lead hỏi: Dùng React hay Vue\?/)).toBeInTheDocument()
  expect(screen.getByText(/User trả lời: React/)).toBeInTheDocument()
})

test('renders a mockup card with the mockup title', () => {
  const state = {
    ...baseState,
    qa_events: [],
    mockup_events: [{ timestamp: 1000, title: 'Trang đăng nhập v2' }],
  }
  render(<PresentationTimeline state={state} currentMs={10000} charsPerSecond={999} instant />)
  expect(screen.getByText(/Lead đã tạo mockup: Trang đăng nhập v2/)).toBeInTheDocument()
})

test('joins multiple questions in one qa_events entry with a blank line between pairs', () => {
  const state = {
    ...baseState,
    qa_events: [{
      timestamp: 1000,
      questions: [{ question: 'Câu 1?' }, { question: 'Câu 2?' }],
      answers: [{ question_index: 0, answer: 'Trả lời 1' }, { question_index: 1, answer: 'Trả lời 2' }],
    }],
    mockup_events: [],
  }
  render(<PresentationTimeline state={state} currentMs={10000} charsPerSecond={999} instant />)
  expect(screen.getByText(/Câu 1\?/)).toBeInTheDocument()
  expect(screen.getByText(/Câu 2\?/)).toBeInTheDocument()
})
