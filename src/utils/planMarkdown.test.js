// src/utils/planMarkdown.test.js
import { describe, it, expect } from 'vitest'
import { planToMarkdown, extractOutline } from './planMarkdown'

describe('extractOutline agent entries', () => {
  it('normalizes to the bare agent name after stripping the "Agent: " prefix', () => {
    const markdown = planToMarkdown([{ name: 'backend-api', role: 'x', model: 'sonnet' }], [], {})
    const outline = extractOutline(markdown)
    const entry = outline.find(o => o.type === 'agent')
    expect(entry).toBeDefined()
    expect(entry.text.replace(/^Agent:\s*/i, '')).toBe('backend-api')
  })
})
