import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

// ── Batched event system ──
// Instead of calling setState on every single event (10-20 per second),
// we buffer high-frequency events and flush once per animation frame.
// This reduces React re-renders from ~20/s to ~8/s (huge perf win).

const BATCH_INTERVAL = 120 // ms between flushes

export function useMission() {
  const [missionState, setMissionState] = useState(null)
  const [isRunning, setIsRunning] = useState(false)
  const [planReady, setPlanReady] = useState(null)
  const unlistenersRef = useRef([])

  // ── Batch buffers (mutable refs, no re-render) ──
  const logBuffer = useRef([])
  const rawLineBuffer = useRef([])
  const fileChangeBuffer = useRef([])
  const agentUpdates = useRef(new Map()) // agentName -> { status, current_task }
  const flushTimer = useRef(null)

  // Flush all buffered events into a single setState call
  const flushBuffers = useCallback(() => {
    const logs = logBuffer.current.splice(0)
    const rawLines = rawLineBuffer.current.splice(0)
    const fileChanges = fileChangeBuffer.current.splice(0)
    const agentMap = new Map(agentUpdates.current)
    agentUpdates.current.clear()

    if (logs.length === 0 && rawLines.length === 0 && fileChanges.length === 0 && agentMap.size === 0) {
      return // nothing to flush
    }

    setMissionState(prev => {
      if (!prev) return prev

      // Merge logs
      let newLog = prev.log
      if (logs.length > 0) {
        newLog = [...prev.log, ...logs].slice(-2000)
      }

      // Merge raw lines
      let newRawOutput = prev.raw_output
      if (rawLines.length > 0) {
        newRawOutput = [...prev.raw_output, ...rawLines].slice(-5000)
      }

      // Merge file changes — group by path, keep full edit history
      let newFileChanges = prev.file_changes
      if (fileChanges.length > 0) {
        const map = new Map()
        // Load existing grouped entries into map
        for (const fc of prev.file_changes) {
          map.set(fc.path, fc)
        }
        // Upsert new changes — append to history array
        for (const fc of fileChanges) {
          const key = fc.path
          const existing = map.get(key)
          if (existing) {
            const entry = {
              timestamp: fc.timestamp, agent: fc.agent, action: fc.action,
              lines: fc.lines, content_preview: fc.content_preview,
              diff_old: fc.diff_old, diff_new: fc.diff_new,
            }
            existing.history = [...(existing.history || []), entry]
            // Update top-level fields to latest
            existing.timestamp = fc.timestamp
            existing.lines = fc.lines ?? existing.lines
            existing.content_preview = fc.content_preview ?? existing.content_preview
            existing.diff_old = fc.diff_old ?? existing.diff_old
            existing.diff_new = fc.diff_new ?? existing.diff_new
            existing.action = fc.action || existing.action
            existing.agent = fc.agent || existing.agent
          } else {
            // First time seeing this file — init with history
            const entry = {
              timestamp: fc.timestamp, agent: fc.agent, action: fc.action,
              lines: fc.lines, content_preview: fc.content_preview,
              diff_old: fc.diff_old, diff_new: fc.diff_new,
            }
            map.set(key, { ...fc, history: [entry] })
          }
        }
        newFileChanges = Array.from(map.values())
      }

      // Merge agent status updates
      let newAgents = prev.agents
      if (agentMap.size > 0) {
        newAgents = prev.agents.map(a => {
          const update = agentMap.get(a.name)
          if (!update) return a
          // Never downgrade Done/Error agents
          if (a.status === 'Done' || a.status === 'Error') return a
          return { ...a, ...update }
        })
      }

      // Only create new object if something actually changed
      if (newLog === prev.log && newRawOutput === prev.raw_output &&
          newFileChanges === prev.file_changes && newAgents === prev.agents) {
        return prev
      }

      return {
        ...prev,
        log: newLog,
        raw_output: newRawOutput,
        file_changes: newFileChanges,
        agents: newAgents,
      }
    })
  }, [])

  // Schedule a flush if not already scheduled
  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) return
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null
      flushBuffers()
    }, BATCH_INTERVAL)
  }, [flushBuffers])

  useEffect(() => {
    const setup = async () => {
      const unlisteners = await Promise.all([
        // ── Status events (low frequency — apply immediately) ──
        listen('mission:status', (e) => {
          const { status } = e.payload

          if (status === 'reset') {
            setMissionState(null)
            setIsRunning(false)
            setPlanReady(null)
            return
          }

          setMissionState(prev => {
            if (!prev) return prev
            if (prev.phase === 'ReviewPlan') {
              if (status === 'completed') return prev
              if (['stopped', 'failed'].includes(status)) {
                return { ...prev, phase: 'Done', status: status.charAt(0).toUpperCase() + status.slice(1) }
              }
              return prev
            }
            return { ...prev, status: status.charAt(0).toUpperCase() + status.slice(1) }
          })
          setPlanReady(prev => {
            if (prev && status === 'completed') return prev
            return prev
          })
          setIsRunning(['running', 'launching', 'deploying'].includes(status))

          if (['completed', 'stopped', 'failed'].includes(status)) {
            // Flush any remaining buffered data before hydrating
            flushBuffers()
            invoke('get_mission_state').then(state => {
              if (!state) return
              setMissionState(prev => {
                if (!prev) return prev
                if (prev.phase === 'ReviewPlan' && status === 'completed') return prev
                const wasReviewing = prev.phase === 'ReviewPlan'
                return {
                  ...state,
                  phase: wasReviewing ? 'Done' : state.phase,
                  file_changes: prev.file_changes?.length ? prev.file_changes : (state.file_changes ?? []),
                  raw_output: prev.raw_output ?? state.raw_output ?? [],
                  log: prev.log ?? state.log ?? [],
                }
              })
            }).catch(() => {})
          }
        }),

        // ── Agent spawned (low frequency — apply immediately) ──
        listen('mission:agent-spawned', (e) => {
          const { agent_name, name, role, timestamp, reset } = e.payload
          const agentName = agent_name || name
          setMissionState(prev => {
            if (reset) {
              const freshAgent = {
                name: agentName,
                role,
                status: 'Running',
                current_task: e.payload.model ? 'Starting continuation...' : 'Analyzing requirement...',
                spawned_at: timestamp || Date.now(),
                model: e.payload.model || null,
                model_reason: null,
              }
              if (!prev) return { agents: [freshAgent], log: [], tasks: [], file_changes: [], raw_output: [], messages: [] }
              return { ...prev, agents: [freshAgent] }
            }
            if (!prev) return prev
            if (prev.agents.some(a => a.name === agentName)) return prev
            return {
              ...prev,
              agents: [...prev.agents, {
                name: agentName,
                role,
                status: 'Spawning',
                current_task: null,
                spawned_at: timestamp,
                model: null,
                model_reason: null,
              }]
            }
          })
        }),

        // ── HIGH-FREQUENCY: Log entries → buffer ──
        listen('mission:log', (e) => {
          const entry = e.payload
          logBuffer.current.push(entry)

          // Buffer agent status update too
          if (entry.agent && entry.log_type !== 'error') {
            if (entry.log_type === 'result') {
              agentUpdates.current.set(entry.agent, {
                status: 'Done',
                current_task: entry.message?.slice(0, 80),
              })
            } else {
              // Only update if agent isn't already marked Done
              const existing = agentUpdates.current.get(entry.agent)
              if (!existing || existing.status !== 'Done') {
                agentUpdates.current.set(entry.agent, {
                  status: 'Working',
                  current_task: entry.message?.slice(0, 80),
                })
              }
            }
          }

          scheduleFlush()
        }),

        // ── HIGH-FREQUENCY: File changes → buffer ──
        listen('mission:file-change', (e) => {
          fileChangeBuffer.current.push(e.payload)
          scheduleFlush()
        }),

        // ── Task updates (medium frequency — apply immediately, important for UI) ──
        listen('mission:task-update', (e) => {
          const { agent, owner, description, status, timestamp, task_id } = e.payload
          const agentName = agent || owner || ''
          const taskDesc = description || ''

          setMissionState(prev => {
            if (!prev) return prev

            let idx = -1

            if (task_id) {
              idx = prev.tasks.findIndex(t => t.id === task_id)
            }

            if (idx < 0 && status === 'completed' && agentName) {
              idx = prev.tasks.findLastIndex(
                t => t.assigned_agent === agentName && t.status === 'in_progress'
              )
            }

            if (idx < 0 && agentName && taskDesc) {
              const descLower = taskDesc.trim().toLowerCase()
              idx = prev.tasks.findIndex(t =>
                t.assigned_agent === agentName &&
                t.title.trim().toLowerCase() === descLower
              )
            }

            if (idx < 0 && taskDesc) {
              const descLower = taskDesc.trim().toLowerCase()
              idx = prev.tasks.findIndex(t =>
                t.status !== 'completed' &&
                (descLower.includes(t.title.trim().toLowerCase()) ||
                 t.title.trim().toLowerCase().includes(descLower))
              )
            }

            if (idx < 0 && status === 'completed' && agentName) {
              idx = prev.tasks.findLastIndex(
                t => t.assigned_agent === agentName && t.status !== 'completed'
              )
            }

            if (idx >= 0) {
              const tasks = [...prev.tasks]
              tasks[idx] = {
                ...tasks[idx],
                status,
                assigned_agent: agentName || tasks[idx].assigned_agent,
                completed_at: status === 'completed' ? timestamp : tasks[idx].completed_at,
                started_at: status === 'in_progress' ? timestamp : tasks[idx].started_at,
              }
              return { ...prev, tasks }
            } else {
              const alreadyExists = prev.tasks.some(
                t => t.assigned_agent === agentName &&
                     taskDesc && t.title.trim().toLowerCase() === taskDesc.trim().toLowerCase() &&
                     t.status === 'completed'
              )
              if (alreadyExists) {
                return { ...prev, tasks: [...prev.tasks] }
              }
              const tasks = [...prev.tasks, {
                id: task_id || `task-${Date.now()}`,
                title: taskDesc || `Task by ${agentName}`,
                status,
                assigned_agent: agentName || null,
                started_at: timestamp,
                completed_at: status === 'completed' ? timestamp : null,
              }]
              return { ...prev, tasks }
            }
          })
        }),

        // ── HIGH-FREQUENCY: Raw output lines → buffer ──
        listen('mission:raw-line', (e) => {
          rawLineBuffer.current.push(e.payload.line)
          scheduleFlush()
        }),

        // ── Plan ready (one-time — apply immediately) ──
        listen('mission:plan-ready', (e) => {
          const { agents, tasks } = e.payload
          setPlanReady({ agents, tasks })

          setMissionState(prev => {
            if (!prev) return prev
            return {
              ...prev,
              phase: 'ReviewPlan',
              agents: [
                ...prev.agents.filter(a => a.name === 'Lead').map(a => ({
                  ...a,
                  status: 'Idle',
                  current_task: 'Plan ready — waiting for review',
                })),
                ...agents.map(a => ({
                  name: a.name,
                  role: a.role,
                  status: 'Idle',
                  current_task: null,
                  spawned_at: Date.now(),
                  model: a.model || 'sonnet',
                  model_reason: a.model_reason || a.reason || null,
                })),
              ],
              tasks: tasks.map((t, i) => ({
                id: `task-${i}`,
                title: t.title,
                status: 'Pending',
                assigned_agent: t.agent || t.assigned_agent,
                started_at: null,
                completed_at: null,
                priority: t.priority || null,
              })),
            }
          })
        }),

        // ── Agent messages (medium frequency — apply immediately) ──
        listen('mission:agent-message', (e) => {
          const { from, to, content, msg_type, timestamp } = e.payload
          setMissionState(prev => {
            if (!prev) return prev
            const messages = [...(prev.messages || []), { from, to, content, msg_type, timestamp }].slice(-500)
            const logMsg = msg_type === 'broadcast'
              ? `[Broadcast] ${content}`
              : msg_type === 'shutdown_request'
                ? `[Shutdown -> ${to}] ${content}`
                : `[DM -> ${to}] ${content}`
            const logEntry = { timestamp, agent: from, message: logMsg, log_type: 'message' }
            return {
              ...prev,
              messages,
              log: [...prev.log, logEntry].slice(-2000),
            }
          })
        }),

        // ── Team lifecycle (rare — apply immediately) ──
        listen('mission:team-event', (e) => {
          const { event, team_name, timestamp } = e.payload
          setMissionState(prev => {
            if (!prev) return prev
            const logEntry = {
              timestamp: timestamp || Date.now(),
              agent: 'Lead',
              message: event === 'created'
                ? `Team "${team_name}" created`
                : 'Team deleted — cleanup complete',
              log_type: event === 'created' ? 'spawn' : 'result',
            }
            return {
              ...prev,
              team_name: event === 'created' ? team_name : null,
              log: [...prev.log, logEntry].slice(-2000),
            }
          })
        }),

        // ── Task reassignment (rare — apply immediately) ──
        listen('mission:task-reassigned', (e) => {
          const { task, from, to, timestamp } = e.payload
          setMissionState(prev => {
            if (!prev) return prev
            const logEntry = {
              timestamp: timestamp || Date.now(),
              agent: 'Lead',
              message: `Reassigned "${task}" from ${from || 'unassigned'} to ${to}`,
              log_type: 'message',
            }
            return {
              ...prev,
              log: [...prev.log, logEntry].slice(-2000),
            }
          })
        }),
      ])

      unlistenersRef.current = unlisteners
    }

    setup()

    // Hydrate on mount
    invoke('get_mission_state').then(state => {
      if (state) {
        const finalStatuses = ['completed', 'stopped', 'failed']
        const statusLower = state.status?.toLowerCase?.() || ''
        const fixedState = (finalStatuses.includes(statusLower) && state.phase === 'ReviewPlan')
          ? { ...state, phase: 'Done' }
          : state
        setMissionState(fixedState)
        setIsRunning(['running', 'launching', 'deploying'].includes(statusLower))
        if (fixedState.phase === 'ReviewPlan') {
          const planAgents = fixedState.agents.filter(a => a.name !== 'Lead')
          setPlanReady({ agents: planAgents, tasks: fixedState.tasks })
        }
      }
    }).catch(() => {})

    return () => {
      if (flushTimer.current) clearTimeout(flushTimer.current)
      unlistenersRef.current.forEach(fn => fn())
    }
  }, [flushBuffers, scheduleFlush])

  const launch = useCallback(async ({ projectPath, prompt, description, model, executionMode }) => {
    setPlanReady(null)
    try {
      const initialState = await invoke('launch_mission', {
        projectPath,
        prompt,
        description,
        model: model || 'sonnet',
        executionMode: executionMode || 'standard',
      })
      setMissionState(initialState)
      setIsRunning(true)
    } catch (err) {
      console.error('[launch] Error:', err)
      setMissionState({
        id: `m-${Date.now()}`,
        description: description || 'Mission',
        project_path: projectPath,
        status: 'Failed',
        phase: 'Done',
        agents: [],
        tasks: [],
        log: [{
          timestamp: Date.now(), agent: 'System',
          message: `Launch failed: ${err?.message || err}`, log_type: 'error',
        }],
        file_changes: [],
        raw_output: [],
        messages: [],
        started_at: Date.now(),
      })
    }
  }, [])

  const deploy = useCallback(async (agents, tasks) => {
    setPlanReady(null)
    try {
      await invoke('deploy_mission', {
        agents: agents.map(a => ({
          name: a.name,
          role: a.role,
          model: a.model || 'sonnet',
          customPrompt: a.customPrompt || '',
          skillFile: a.skillFile || null,
        })),
        tasks: tasks.map(t => ({
          title: t.title,
          detail: t.detail || '',
          assigned_agent: t.assigned_agent || t.agent,
          priority: t.priority || 'medium',
        })),
      })
      setMissionState(prev => prev ? {
        ...prev,
        phase: 'Deploying',
        status: 'Running',
      } : prev)
    } catch (err) {
      console.error('[deploy] Error:', err)
      setMissionState(prev => prev ? {
        ...prev,
        status: 'Failed',
        phase: 'Done',
        log: [...(prev.log || []), {
          timestamp: Date.now(), agent: 'System',
          message: `Deploy failed: ${err?.message || err}`, log_type: 'error',
        }],
      } : prev)
    }
  }, [])

  const continueM = useCallback(async (message, agentsOrContext = null) => {
    // agentsOrContext can be:
    //   - null (normal intervention from current mission)
    //   - an array of agents (intervention with custom agents — InterventionPanel)
    //   - a history state object (continue from history)
    const isHistoryContext = agentsOrContext && !Array.isArray(agentsOrContext) && agentsOrContext.id
    const historyContext = isHistoryContext ? agentsOrContext : null
    const customAgents = Array.isArray(agentsOrContext) ? agentsOrContext : null

    // Build message with agent config if provided
    let fullMessage = message
    if (customAgents && customAgents.length > 0) {
      const agentLines = customAgents
        .filter(a => a.name && a.task)
        .map(a => `- Agent "${a.name}" (model: ${a.model || 'sonnet'}): ${a.task}`)
        .join('\n')
      if (agentLines) {
        fullMessage += `\n\nSpawn these specific agents:\n${agentLines}`
      }
    }

    const contextJson = historyContext ? JSON.stringify(historyContext) : ''

    try {
      const result = await invoke('continue_mission', { message: fullMessage, contextJson })
      // Backend returns error string on failure
      if (typeof result === 'string' && result.length > 0) {
        console.error('[continueM] Backend error:', result)
        setMissionState(prev => prev ? {
          ...prev,
          log: [...(prev.log || []), {
            timestamp: Date.now(), agent: 'System',
            message: `Continue failed: ${result}`, log_type: 'error',
          }],
        } : prev)
        return
      }

      setIsRunning(true)

      if (historyContext) {
        setMissionState({
          ...historyContext,
          phase: 'Continuing',
          status: 'Running',
          messages: [],
        })
      } else {
        setMissionState(prev => prev ? {
          ...prev,
          phase: 'Continuing',
          status: 'Running',
        } : prev)
      }
    } catch (err) {
      console.error('[continueM] Exception:', err)
      setMissionState(prev => prev ? {
        ...prev,
        status: 'Failed',
        phase: 'Done',
        log: [...(prev.log || []), {
          timestamp: Date.now(), agent: 'System',
          message: `Continue failed: ${err?.message || err}`, log_type: 'error',
        }],
      } : prev)
    }
  }, [])

  const stop = useCallback(async () => {
    await invoke('stop_mission')
    setIsRunning(false)
    setPlanReady(null)
  }, [])

  const reset = useCallback(async () => {
    await invoke('reset_mission').catch(() => {})
    setMissionState(null)
    setIsRunning(false)
    setPlanReady(null)
  }, [])

  // ── Re-plan: send modified agents/tasks to Lead for incremental update ──
  const [isReplanning, setIsReplanning] = useState(false)

  const replan = useCallback(async (agents, tasks) => {
    setIsReplanning(true)
    try {
      const result = await invoke('replan_mission', { agents, tasks })
      if (typeof result === 'string') {
        // Error string returned
        console.error('[replan] Error:', result)
        setIsReplanning(false)
        return null
      }
      // result = { agents: [...], tasks: [...] }
      if (result && result.agents && result.tasks) {
        setPlanReady(result)
        setIsReplanning(false)
        return result
      }
      setIsReplanning(false)
      return null
    } catch (err) {
      console.error('[replan] Exception:', err)
      setIsReplanning(false)
      return null
    }
  }, [])

  return { missionState, isRunning, planReady, isReplanning, launch, deploy, continueM, stop, reset, replan }
}
