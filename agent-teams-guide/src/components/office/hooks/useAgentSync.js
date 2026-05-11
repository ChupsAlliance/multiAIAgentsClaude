import { useRef, useEffect } from 'react'
import { mapLogEntryToState } from '../agent-bridge/AgentStateMapper'
import {
  AgentIdMap,
  ToolIdCounter,
  makeAgentCreated,
  makeAgentClosed,
  makeAgentToolStart,
  makeAgentToolDone,
  makeAgentStatus,
} from '../bridge/pixelAgentsProtocol.js'

function sendToWebview(webviewRef, message) {
  webviewRef.current?.send('pa:in', message)
}

export function useAgentSync(missionState, isRunning, logs, webviewRef, webviewReady) {
  const agentsRef      = useRef({})                  // name → { state }
  const idMapRef       = useRef(new AgentIdMap())
  const toolCounterRef = useRef(new ToolIdCounter())
  const activeToolsRef = useRef({})                  // agentName → toolId | null

  // On first webviewReady: flush all existing agents.
  // (layoutLoaded is sent by VirtualOffice.jsx with the actual pixel-agents layout.)
  useEffect(() => {
    if (!webviewReady) return
    for (const name of Object.keys(agentsRef.current)) {
      sendToWebview(webviewRef, makeAgentCreated(idMapRef.current.getId(name)))
    }
  }, [webviewReady, webviewRef])

  // Sync agent roster from missionState
  useEffect(() => {
    if (!missionState?.agents) return
    const currentNames = new Set(missionState.agents.map(a => a.name))

    for (const agent of missionState.agents) {
      if (!agentsRef.current[agent.name]) {
        agentsRef.current[agent.name] = { state: 'spawning' }
        if (webviewReady) {
          sendToWebview(webviewRef, makeAgentCreated(idMapRef.current.getId(agent.name)))
        }
      }
    }

    for (const name of Object.keys(agentsRef.current)) {
      if (!currentNames.has(name)) {
        if (webviewReady) {
          sendToWebview(webviewRef, makeAgentClosed(idMapRef.current.getId(name)))
        }
        idMapRef.current.remove(name)
        delete agentsRef.current[name]
        delete activeToolsRef.current[name]
      }
    }
  }, [missionState?.agents, webviewReady, webviewRef])

  // Process latest log entry → send tool start/done + status
  useEffect(() => {
    if (!logs?.length || !webviewReady) return
    const latest = logs[logs.length - 1]
    if (!latest?.agent || !agentsRef.current[latest.agent]) return

    const agentName = latest.agent
    const id = idMapRef.current.getId(agentName)
    const newState = mapLogEntryToState(latest)

    agentsRef.current[agentName] = { ...agentsRef.current[agentName], state: newState }

    if (latest.log_type === 'tool' && latest.tool_name) {
      // Close previous tool if still open
      const prevToolId = activeToolsRef.current[agentName]
      if (prevToolId != null) {
        sendToWebview(webviewRef, makeAgentToolDone(id, prevToolId))
      }
      const toolId = toolCounterRef.current.next()
      activeToolsRef.current[agentName] = toolId
      sendToWebview(webviewRef, makeAgentToolStart(id, toolId, latest.tool_name))
    } else if (latest.log_type === 'result') {
      const toolId = activeToolsRef.current[agentName]
      if (toolId != null) {
        sendToWebview(webviewRef, makeAgentToolDone(id, toolId))
        activeToolsRef.current[agentName] = null
      }
      sendToWebview(webviewRef, makeAgentStatus(id, newState))
    }
  }, [logs, webviewReady, webviewRef])

  // Reset on mission stop
  useEffect(() => {
    if (!isRunning) {
      agentsRef.current = {}
      idMapRef.current.clear()
      toolCounterRef.current = new ToolIdCounter()
      activeToolsRef.current = {}
    }
  }, [isRunning])
}
