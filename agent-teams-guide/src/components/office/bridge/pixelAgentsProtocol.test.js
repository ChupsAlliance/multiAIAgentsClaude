import { describe, it, expect } from 'vitest'
import {
  AgentIdMap,
  ToolIdCounter,
  makeLayoutLoaded,
  makeAgentCreated,
  makeAgentClosed,
  makeAgentToolStart,
  makeAgentToolDone,
  makeAgentStatus,
} from './pixelAgentsProtocol.js'

describe('AgentIdMap', () => {
  it('assigns sequential numeric IDs to new agents', () => {
    const map = new AgentIdMap()
    expect(map.getId('alice')).toBe(0)
    expect(map.getId('bob')).toBe(1)
    expect(map.getId('alice')).toBe(0)
  })

  it('removes an entry (counter keeps incrementing, no reuse)', () => {
    const map = new AgentIdMap()
    map.getId('alice') // 0
    map.remove('alice')
    expect(map.getId('carol')).toBe(1)
  })

  it('clear() resets all IDs', () => {
    const map = new AgentIdMap()
    map.getId('alice') // 0
    map.clear()
    expect(map.getId('bob')).toBe(0)
  })
})

describe('ToolIdCounter', () => {
  it('returns incrementing IDs starting at 0', () => {
    const counter = new ToolIdCounter()
    expect(counter.next()).toBe(0)
    expect(counter.next()).toBe(1)
    expect(counter.next()).toBe(2)
  })
})

describe('makeLayoutLoaded', () => {
  it('returns layoutLoaded with wasReset false and no layout object', () => {
    expect(makeLayoutLoaded()).toEqual({ type: 'layoutLoaded', wasReset: false })
  })
})

describe('makeAgentCreated', () => {
  it('returns correct shape', () => {
    expect(makeAgentCreated(3)).toEqual({ type: 'agentCreated', id: 3 })
  })
})

describe('makeAgentClosed', () => {
  it('returns correct shape', () => {
    expect(makeAgentClosed(3)).toEqual({ type: 'agentClosed', id: 3 })
  })
})

describe('makeAgentToolStart', () => {
  it('returns correct shape with toolName', () => {
    expect(makeAgentToolStart(0, 5, 'Read')).toEqual({
      type: 'agentToolStart',
      id: 0,
      toolId: 5,
      status: 'active',
      toolName: 'Read',
    })
  })
})

describe('makeAgentToolDone', () => {
  it('returns correct shape', () => {
    expect(makeAgentToolDone(0, 5)).toEqual({
      type: 'agentToolDone',
      id: 0,
      toolId: 5,
    })
  })
})

describe('makeAgentStatus', () => {
  it('maps "waiting" state to pixel-agents "waiting"', () => {
    expect(makeAgentStatus(1, 'waiting')).toEqual({
      type: 'agentStatus', id: 1, status: 'waiting',
    })
  })

  it('maps all other states to "active"', () => {
    for (const s of ['idle', 'coding', 'reading', 'working', 'spawning', 'managing', 'celebrating']) {
      expect(makeAgentStatus(1, s).status).toBe('active')
    }
  })
})
