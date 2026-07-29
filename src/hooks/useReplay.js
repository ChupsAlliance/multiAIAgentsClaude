import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useToast } from './useToast'

// ── useReplay ──────────────────────────────────────────────────────
// Quản lý toàn bộ vòng đời phát lại (replay) một bản ghi mission.
// Gọi replay_start/pause/resume/seek/stop, lắng nghe replay:progress
// để cập nhật currentMs/eventIndex, và lắng nghe lại các kênh mission
// gốc (mission:log, mission:agent-spawned, ...) để dựng lại một bản
// `replayMissionState` riêng biệt — cùng format với missionState thật
// để có thể tái sử dụng MissionDashboard/PlanningStream.
//
// IPC contract (electron/ipc backend — recordingStore.cjs/replayEngine.cjs):
//   invoke('replay_start', { recordingId, speed })  -> { totalMs, stepMarkers, recording: {...} }
//   invoke('replay_pause')
//   invoke('replay_resume')
//   invoke('replay_seek', { positionMs })
//   invoke('replay_stop')
//   listen('replay:progress', { currentMs, totalMs, eventIndex })
//   + replayed original channels: mission:log, mission:agent-spawned, mission:task-update,
//     mission:file-change, mission:agent-message, mission:status, mission:agent-stuck
// ─────────────────────────────────────────────────────────────────

const EMPTY_STATE = () => ({
  id: null,
  description: '',
  project_path: '',
  status: 'Running',
  phase: 'Executing',
  execution_mode: 'standard',
  agents: [],
  tasks: [],
  log: [],
  file_changes: [],
  raw_output: [],
  messages: [],
  qa_events: [],
  mockup_events: [],
  started_at: Date.now(),
})

export function useReplay(recordingId) {
  const [replayMissionState, setReplayMissionState] = useState(null)
  const [replayPlanReady, setReplayPlanReady] = useState(null)
  const [pendingQuestion, setPendingQuestion] = useState(null)
  const [mockupInfo, setMockupInfo] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(1) // 1 | 2 | 5 | 'instant'
  const [currentMs, setCurrentMs] = useState(0)
  const [totalMs, setTotalMs] = useState(0)
  const [stepMarkers, setStepMarkers] = useState([]) // [{ ms, type, label }]
  const [recordingMeta, setRecordingMeta] = useState(null) // { name, mission_description, ... }
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const unlistenersRef = useRef([])
  const { toast } = useToast()

  // ── Rebuild replayMissionState from replayed mission:* events ──
  // Reuses the exact same reducer shapes as useMission.js so MissionDashboard
  // can render it unmodified.
  const applyEvent = useCallback((channel, payload) => {
    switch (channel) {
      case 'mission:status': {
        const { status } = payload
        if (status === 'reset') {
          setReplayMissionState(EMPTY_STATE())
          setReplayPlanReady(null)
          setPendingQuestion(null)
          setMockupInfo(null)
          return
        }
        setReplayMissionState(prev => {
          if (!prev) return prev
          const capitalized = status.charAt(0).toUpperCase() + status.slice(1)
          if (prev.phase === 'ReviewPlan') {
            if (status === 'completed') return prev
            if (['stopped', 'failed'].includes(status)) {
              return { ...prev, phase: 'Done', status: capitalized }
            }
            return prev
          }
          if (['completed', 'stopped', 'failed'].includes(status)) {
            return { ...prev, phase: 'Done', status: capitalized }
          }
          return { ...prev, status: capitalized }
        })
        break
      }
      case 'mission:agent-spawned': {
        const { agent_name, name, role, timestamp, reset, model } = payload
        const agentName = agent_name || name
        setReplayMissionState(prev => {
          const base = prev || EMPTY_STATE()
          if (reset) {
            return {
              ...base,
              phase: 'Planning',
              agents: [{
                name: agentName, role, status: 'Running',
                current_task: 'Analyzing requirement...',
                spawned_at: timestamp || Date.now(), model: model || null, model_reason: null,
              }],
            }
          }
          const idx = base.agents.findIndex(a => a.name === agentName)
          if (idx !== -1) {
            const updated = [...base.agents]
            updated[idx] = { ...updated[idx], status: 'Working', current_task: 'Starting...', spawned_at: timestamp || updated[idx].spawned_at }
            return { ...base, agents: updated }
          }
          return {
            ...base,
            agents: [...base.agents, {
              name: agentName, role, status: 'Spawning', current_task: null,
              spawned_at: timestamp, model: model || null, model_reason: null,
            }],
          }
        })
        break
      }
      case 'mission:log': {
        const entry = payload
        setReplayMissionState(prev => {
          const base = prev || EMPTY_STATE()
          const log = [...base.log, entry].slice(-2000)
          let agents = base.agents
          if (entry.agent && entry.log_type !== 'error') {
            agents = base.agents.map(a => a.name === entry.agent
              ? { ...a, status: entry.log_type === 'result' ? 'Done' : 'Working', current_task: entry.message?.slice(0, 80) }
              : a)
          }
          return { ...base, log, agents }
        })
        break
      }
      case 'mission:file-change': {
        setReplayMissionState(prev => {
          const base = prev || EMPTY_STATE()
          const fc = payload
          const map = new Map(base.file_changes.map(f => [f.path, f]))
          const existing = map.get(fc.path)
          const entry = {
            timestamp: fc.timestamp, agent: fc.agent, action: fc.action,
            lines: fc.lines, content_preview: fc.content_preview,
            diff_old: fc.diff_old, diff_new: fc.diff_new,
          }
          if (existing) {
            map.set(fc.path, { ...existing, ...fc, history: [...(existing.history || []), entry] })
          } else {
            map.set(fc.path, { ...fc, history: [entry] })
          }
          return { ...base, file_changes: Array.from(map.values()) }
        })
        break
      }
      case 'mission:task-update': {
        const { agent, owner, description, status, timestamp, task_id } = payload
        const agentName = agent || owner || ''
        const taskDesc = description || ''
        setReplayMissionState(prev => {
          const base = prev || EMPTY_STATE()
          const nextPhase = base.phase === 'ReviewPlan' ? 'Executing' : base.phase
          let idx = -1
          if (task_id) idx = base.tasks.findIndex(t => t.id === task_id)
          if (idx < 0 && taskDesc) {
            const descLower = taskDesc.trim().toLowerCase()
            idx = base.tasks.findIndex(t => t.assigned_agent === agentName && t.title.trim().toLowerCase() === descLower)
          }
          if (idx >= 0) {
            const tasks = [...base.tasks]
            tasks[idx] = {
              ...tasks[idx], status,
              assigned_agent: agentName || tasks[idx].assigned_agent,
              completed_at: status === 'completed' ? timestamp : tasks[idx].completed_at,
              started_at: status === 'in_progress' ? timestamp : tasks[idx].started_at,
            }
            return { ...base, phase: nextPhase, tasks }
          }
          return {
            ...base,
            phase: nextPhase,
            tasks: [...base.tasks, {
              id: task_id || `task-${Date.now()}-${Math.random()}`,
              title: taskDesc || `Task by ${agentName}`,
              status, assigned_agent: agentName || null,
              started_at: timestamp, completed_at: status === 'completed' ? timestamp : null,
            }],
          }
        })
        break
      }
      case 'mission:plan-ready': {
        const { agents, tasks, mission_context } = payload
        setReplayPlanReady({ agents, tasks, mission_context: mission_context || null })
        setMockupInfo(null)
        setReplayMissionState(prev => {
          const base = prev || EMPTY_STATE()
          return { ...base, phase: 'ReviewPlan' }
        })
        break
      }
      case 'mission:raw-line': {
        setReplayMissionState(prev => {
          const base = prev || EMPTY_STATE()
          return { ...base, raw_output: [...base.raw_output, payload.line].slice(-5000) }
        })
        break
      }
      case 'mission:agent-message': {
        const { from, to, content, msg_type, timestamp } = payload
        setReplayMissionState(prev => {
          const base = prev || EMPTY_STATE()
          const messages = [...(base.messages || []), { from, to, content, msg_type, timestamp }].slice(-500)
          return { ...base, messages }
        })
        break
      }
      case 'mission:agent-stuck': {
        const { agent } = payload
        setReplayMissionState(prev => {
          const base = prev || EMPTY_STATE()
          return { ...base, agents: base.agents.map(a => a.name === agent ? { ...a, stuckWarning: true } : a) }
        })
        break
      }
      case 'mission:question': {
        const { questions } = payload
        setPendingQuestion({ questions: questions || [], timestamp: Date.now() })
        break
      }
      case 'mission:answer-sent': {
        const { answers } = payload
        setPendingQuestion(currentPending => {
          const entry = {
            timestamp: currentPending ? currentPending.timestamp : Date.now(),
            questions: currentPending ? currentPending.questions : [],
            answers: answers || [],
          }
          setReplayMissionState(prev => {
            const base = prev || EMPTY_STATE()
            return { ...base, qa_events: [...base.qa_events, entry] }
          })
          return null
        })
        break
      }
      case 'mission:mockup': {
        setMockupInfo(payload)
        setReplayMissionState(prev => {
          const base = prev || EMPTY_STATE()
          const entry = { timestamp: Date.now(), title: payload?.title || '' }
          return { ...base, mockup_events: [...base.mockup_events, entry] }
        })
        break
      }
      default:
        break
    }
  }, [])

  // ── Setup listeners once ──
  useEffect(() => {
    let cancelled = false
    const setup = async () => {
      const channels = [
        'mission:status', 'mission:agent-spawned', 'mission:log', 'mission:file-change',
        'mission:task-update', 'mission:raw-line', 'mission:agent-message', 'mission:agent-stuck',
        'mission:question', 'mission:answer-sent', 'mission:mockup', 'mission:plan-ready',
      ]
      const unlisteners = await Promise.all([
        ...channels.map(ch => listen(ch, (e) => applyEvent(ch, e.payload))),
        listen('replay:progress', (e) => {
          const { currentMs: cur, totalMs: tot, eventIndex } = e.payload || {}
          if (typeof cur === 'number') setCurrentMs(cur)
          if (typeof tot === 'number') setTotalMs(tot)
          if (eventIndex != null && eventIndex >= 0 && typeof tot === 'number' && cur >= tot) {
            setIsPlaying(false)
          }
        }),
      ])
      if (cancelled) {
        unlisteners.forEach(fn => fn())
        return
      }
      unlistenersRef.current = unlisteners
    }
    setup()
    return () => {
      cancelled = true
      unlistenersRef.current.forEach(fn => fn())
      unlistenersRef.current = []
    }
  }, [applyEvent])

  // ── Start replay when recordingId changes ──
  useEffect(() => {
    if (!recordingId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setReplayMissionState(EMPTY_STATE())
    setReplayPlanReady(null)
    setPendingQuestion(null)
    setMockupInfo(null)
    setCurrentMs(0)
    setIsPlaying(false)

    invoke('replay_start', { recordingId, speed: speed === 'instant' ? 'instant' : speed })
      .then((result) => {
        if (cancelled) return
        setTotalMs(result?.totalMs || 0)
        setStepMarkers(result?.stepMarkers || [])
        setRecordingMeta(result?.recording || null)
        setReplayMissionState(prev => ({
          ...(prev || EMPTY_STATE()),
          description: result?.recording?.mission_description || result?.recording?.name || '',
          project_path: result?.recording?.project_path || '',
        }))
        setIsPlaying(true)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setLoading(false)
        setError(err?.message || String(err))
        toast.error('Không thể bắt đầu phát lại', err?.message)
      })

    return () => {
      cancelled = true
      invoke('replay_stop').catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingId])

  const play = useCallback(async () => {
    try {
      await invoke('replay_resume')
      setIsPlaying(true)
    } catch (err) {
      toast.error('Không thể tiếp tục phát lại', err?.message)
    }
  }, [toast])

  const pause = useCallback(async () => {
    try {
      await invoke('replay_pause')
      setIsPlaying(false)
    } catch (err) {
      toast.error('Không thể tạm dừng', err?.message)
    }
  }, [toast])

  const togglePlayPause = useCallback(() => {
    if (isPlaying) pause()
    else play()
  }, [isPlaying, play, pause])

  // Đổi tốc độ áp dụng ngay không cần restart: re-invoke replay_start với
  // speed mới, giữ nguyên vị trí hiện tại (backend dùng recordingId + speed
  // làm tham số điều khiển tốc độ phát; currentMs giữ nguyên vì ta seek lại
  // ngay sau khi start để không bị nhảy về đầu).
  const changeSpeed = useCallback(async (next) => {
    const resumeAt = currentMs
    const wasPlaying = isPlaying
    setSpeed(next)
    try {
      await invoke('replay_start', { recordingId, speed: next === 'instant' ? 'instant' : next })
      if (resumeAt > 0) await invoke('replay_seek', { positionMs: resumeAt })
      if (!wasPlaying) await invoke('replay_pause')
      setIsPlaying(wasPlaying)
    } catch (err) {
      toast.warn('Không thể đổi tốc độ phát lại', err?.message)
    }
  }, [recordingId, currentMs, isPlaying, toast])

  const seek = useCallback(async (positionMs) => {
    try {
      await invoke('replay_seek', { positionMs })
      setCurrentMs(positionMs)
    } catch (err) {
      toast.error('Không thể tua', err?.message)
    }
  }, [toast])

  const stopReplay = useCallback(async () => {
    try {
      await invoke('replay_stop')
    } catch (_) {
      // best-effort
    }
    setIsPlaying(false)
  }, [])

  return {
    replayMissionState, replayPlanReady, pendingQuestion, mockupInfo,
    isPlaying, speed, currentMs, totalMs, stepMarkers, recordingMeta,
    loading, error,
    togglePlayPause, play, pause, changeSpeed, seek, stopReplay,
  }
}
