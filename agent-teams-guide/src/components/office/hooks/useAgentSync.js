import { useState, useRef, useEffect, useCallback } from 'react'
import { DeskAssigner } from '../agent-bridge/DeskAssigner'
import { mapLogEntryToState, formatSpeechBubble } from '../agent-bridge/AgentStateMapper'

/**
 * useAgentSync — syncs mission agents to office render state.
 *
 * Reads missionState.agents and logs to produce an array of
 * office agent objects ready for rendering.
 *
 * Returns { agents } where each agent has:
 *   name, characterIndex, state, deskSlot,
 *   speechBubble, speechBubbleExpiry,
 *   animFrame (set by animation tick), animDir
 */
export function useAgentSync(missionState, isRunning, logs, layout) {
  const [agents, setAgents] = useState([])
  const agentsRef = useRef({})
  const assignerRef = useRef(new DeskAssigner([]))

  // Update desk layout when layout changes
  useEffect(() => {
    if (!layout) return
    const deskTiles = layout.tiles.filter(t => t.type === 'desk')
    assignerRef.current.updateLayout(deskTiles)
    // Re-assign any existing agents after the layout was replaced
    const existing = Object.values(agentsRef.current)
    for (const agent of existing) {
      agent.deskSlot = assignerRef.current.assign(agent.name)
    }
    if (existing.length > 0) {
      setAgents(Object.values(agentsRef.current))
    }
  }, [layout])

  // Sync agents from missionState
  useEffect(() => {
    if (!missionState?.agents) return
    const currentNames = new Set(missionState.agents.map(a => a.name))

    for (const agent of missionState.agents) {
      if (!agentsRef.current[agent.name]) {
        const slot = assignerRef.current.assign(agent.name)
        agentsRef.current[agent.name] = {
          name: agent.name,
          characterIndex: Math.floor(Math.random() * 6),
          state: 'spawning',
          deskSlot: slot,
          speechBubble: null,
          speechBubbleExpiry: null,
          // animFrame and animDir are managed by VirtualOffice, not here
        }
      }
    }
    for (const name of Object.keys(agentsRef.current)) {
      if (!currentNames.has(name)) {
        assignerRef.current.release(name)
        delete agentsRef.current[name]
      }
    }
    setAgents(Object.values(agentsRef.current))
  }, [missionState?.agents])

  // Process logs → update agent state + speech bubble
  useEffect(() => {
    if (!logs?.length) return
    const latest = logs[logs.length - 1]
    if (!latest?.agent || !agentsRef.current[latest.agent]) return

    const existing = agentsRef.current[latest.agent]
    const bubble = formatSpeechBubble(latest)
    agentsRef.current[latest.agent] = {
      ...existing,
      state: mapLogEntryToState(latest),
      speechBubble: bubble ?? null,
      speechBubbleExpiry: bubble ? Date.now() + 3000 : null,
    }
    setAgents(Object.values(agentsRef.current))
  }, [logs])

  // Reset when mission stops
  useEffect(() => {
    if (!isRunning) {
      assignerRef.current.reset()
      agentsRef.current = {}
      setAgents([])
    }
  }, [isRunning])

  const clearExpiredBubbles = useCallback(() => {
    let cleared = false
    const now = Date.now()
    for (const [name, agent] of Object.entries(agentsRef.current)) {
      if (agent.speechBubble && agent.speechBubbleExpiry && now > agent.speechBubbleExpiry) {
        agentsRef.current[name] = { ...agent, speechBubble: null, speechBubbleExpiry: null }
        cleared = true
      }
    }
    if (cleared) setAgents(Object.values(agentsRef.current))
  }, [])

  return { agents, clearExpiredBubbles }
}
