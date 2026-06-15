// Pure translation layer: our state → pixel-agents wire protocol.
// No React. No side effects. Importable in both browser and Node.

export class AgentIdMap {
  #map = new Map()  // agentName → numeric id
  #next = 0

  getId(name) {
    if (this.#map.has(name)) return this.#map.get(name)
    const id = this.#next++
    this.#map.set(name, id)
    return id
  }

  remove(name) {
    this.#map.delete(name)
  }

  clear() {
    this.#map.clear()
    this.#next = 0
  }
}

export class ToolIdCounter {
  #next = 0
  next() { return this.#next++ }
}

// ── message builders ──────────────────────────────────────────────────────────

export const makeLayoutLoaded = () =>
  ({ type: 'layoutLoaded', wasReset: false })

export const makeAgentCreated = (id) =>
  ({ type: 'agentCreated', id })

export const makeAgentClosed = (id) =>
  ({ type: 'agentClosed', id })

export const makeAgentToolStart = (id, toolId, toolName) =>
  ({ type: 'agentToolStart', id, toolId, status: 'active', toolName })

export const makeAgentToolDone = (id, toolId) =>
  ({ type: 'agentToolDone', id, toolId })

// Maps our AgentAnimationState to pixel-agents status string.
// pixel-agents knows: 'active' | 'waiting'
export const makeAgentStatus = (id, ourState) => ({
  type: 'agentStatus',
  id,
  status: ourState === 'waiting' ? 'waiting' : 'active',
})
