// src/utils/exportPlan.test.js
import { describe, it, expect } from 'vitest'
import { generateSlug, generateFilename, generateHTML, downloadBlob } from './exportPlan'

describe('generateSlug', () => {
  it('lowercases and replaces spaces with dashes', () => {
    expect(generateSlug('Build Auth System')).toBe('build-auth-system')
  })
  it('strips special characters', () => {
    expect(generateSlug('Fix bug: #123 (urgent!)')).toBe('fix-bug-123-urgent')
  })
  it('truncates to 40 chars', () => {
    const long = 'a'.repeat(60)
    expect(generateSlug(long).length).toBeLessThanOrEqual(40)
  })
  it('handles empty string', () => {
    expect(generateSlug('')).toBe('mission')
  })
})

describe('generateFilename', () => {
  it('formats correctly', () => {
    const filename = generateFilename('Build Auth', 'pdf')
    expect(filename).toMatch(/^build-auth-\d{4}-\d{2}-\d{2}\.pdf$/)
  })
})

describe('generateHTML', () => {
  it('returns valid HTML string', () => {
    const state = {
      description: 'Test mission',
      project_path: '/home/user/project',
      status: 'Done',
      phase: 'Done',
      agents: [{ name: 'Agent1', role: 'Developer', model: 'sonnet', status: 'Done' }],
      tasks: [{ id: 'task-0', title: 'Task 1', why: 'reason', detail: '', depends_on: [], status: 'completed', assigned_agent: 'Agent1' }],
      log: [],
      file_changes: [],
      plan_versions: [],
      started_at: Date.now(),
      ended_at: null,
    }
    const html = generateHTML(state)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('Test mission')
    expect(html).toContain('Agent1')
    expect(html).toContain('Task 1')
  })
})
