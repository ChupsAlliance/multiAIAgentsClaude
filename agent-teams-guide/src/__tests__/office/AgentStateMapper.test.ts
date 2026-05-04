import { describe, it, expect } from 'vitest'
import { mapLogEntryToState, TOOL_TO_STATE } from '../../components/office/agent-bridge/AgentStateMapper'
import type { MissionLogEntry } from '../../components/office/types'

describe('mapLogEntryToState', () => {
  it('returns coding for Write tool', () => {
    const entry: MissionLogEntry = { agent: 'A', message: '', log_type: 'tool', tool_name: 'Write' }
    expect(mapLogEntryToState(entry)).toBe('coding')
  })

  it('returns coding for Edit tool', () => {
    const entry: MissionLogEntry = { agent: 'A', message: '', log_type: 'tool', tool_name: 'Edit' }
    expect(mapLogEntryToState(entry)).toBe('coding')
  })

  it('returns coding for MultiEdit tool', () => {
    const entry: MissionLogEntry = { agent: 'A', message: '', log_type: 'tool', tool_name: 'MultiEdit' }
    expect(mapLogEntryToState(entry)).toBe('coding')
  })

  it('returns reading for Read tool', () => {
    const entry: MissionLogEntry = { agent: 'A', message: '', log_type: 'tool', tool_name: 'Read' }
    expect(mapLogEntryToState(entry)).toBe('reading')
  })

  it('returns reading for Glob tool', () => {
    const entry: MissionLogEntry = { agent: 'A', message: '', log_type: 'tool', tool_name: 'Glob' }
    expect(mapLogEntryToState(entry)).toBe('reading')
  })

  it('returns reading for Grep tool', () => {
    const entry: MissionLogEntry = { agent: 'A', message: '', log_type: 'tool', tool_name: 'Grep' }
    expect(mapLogEntryToState(entry)).toBe('reading')
  })

  it('returns working for Bash tool', () => {
    const entry: MissionLogEntry = { agent: 'A', message: '', log_type: 'tool', tool_name: 'Bash' }
    expect(mapLogEntryToState(entry)).toBe('working')
  })

  it('returns working for WebFetch tool', () => {
    const entry: MissionLogEntry = { agent: 'A', message: '', log_type: 'tool', tool_name: 'WebFetch' }
    expect(mapLogEntryToState(entry)).toBe('working')
  })

  it('returns working for WebSearch tool', () => {
    const entry: MissionLogEntry = { agent: 'A', message: '', log_type: 'tool', tool_name: 'WebSearch' }
    expect(mapLogEntryToState(entry)).toBe('working')
  })

  it('returns managing for Agent tool', () => {
    const entry: MissionLogEntry = { agent: 'A', message: '', log_type: 'tool', tool_name: 'Agent' }
    expect(mapLogEntryToState(entry)).toBe('managing')
  })

  it('returns idle for unknown tool', () => {
    const entry: MissionLogEntry = { agent: 'A', message: '', log_type: 'tool', tool_name: 'UnknownTool' }
    expect(mapLogEntryToState(entry)).toBe('idle')
  })

  it('returns idle for non-tool log entry', () => {
    const entry: MissionLogEntry = { agent: 'A', message: 'hello', log_type: 'message' }
    expect(mapLogEntryToState(entry)).toBe('idle')
  })

  it('returns idle when tool_name is undefined', () => {
    const entry: MissionLogEntry = { agent: 'A', message: '', log_type: 'tool' }
    expect(mapLogEntryToState(entry)).toBe('idle')
  })
})

describe('formatSpeechBubble', () => {
  it('abbreviates long tool messages', async () => {
    const { formatSpeechBubble } = await import('../../components/office/agent-bridge/AgentStateMapper')
    const entry: MissionLogEntry = {
      agent: 'A',
      message: 'src/components/very/long/path/to/SomeComponent.jsx',
      log_type: 'tool',
      tool_name: 'Write',
    }
    const bubble = formatSpeechBubble(entry)
    expect(bubble.length).toBeLessThanOrEqual(30)
    expect(bubble).toContain('write:')
  })

  it('returns null for non-tool entries', async () => {
    const { formatSpeechBubble } = await import('../../components/office/agent-bridge/AgentStateMapper')
    const entry: MissionLogEntry = { agent: 'A', message: 'hello', log_type: 'message' }
    expect(formatSpeechBubble(entry)).toBeNull()
  })
})
