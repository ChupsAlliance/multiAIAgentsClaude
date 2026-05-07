import { useState, useRef, useEffect } from 'react'
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
          animFrame: 0,
          animDir: 0,
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

    const agent = agentsRef.current[latest.agent]
    agent.state = mapLogEntryToState(latest)
    const bubble = formatSpeechBubble(latest)
    if (bubble) {
      agent.speechBubble = bubble
      agent.speechBubbleExpiry = Date.now() + 3000
    } else {
      agent.speechBubble = null
      agent.speechBubbleExpiry = null
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

  return { agents, agentsRef }
}
