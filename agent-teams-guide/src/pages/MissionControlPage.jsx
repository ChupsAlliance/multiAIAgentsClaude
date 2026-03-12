import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Sidebar } from '../components/Sidebar'
import { MissionLauncher } from '../components/mission/MissionLauncher'
import { MissionDashboard } from '../components/mission/MissionDashboard'
import { PlanReview } from '../components/mission/PlanReview'
import { PromptPreview } from '../components/mission/PromptPreview'
import { MissionHistoryPanel } from '../components/mission/MissionHistoryPanel'
import { useMission } from '../hooks/useMission'

export function MissionControlPage() {
  const { missionState, isRunning, planReady, launch, deploy, continueM, stop, reset } = useMission()
  const [elapsed, setElapsed] = useState('0:00')
  const [promptPreview, setPromptPreview] = useState(null) // { agents, tasks }
  const [historyView, setHistoryView] = useState(null)     // full MissionState snapshot from history

  // Elapsed timer
  useEffect(() => {
    if (!missionState?.started_at || !isRunning) return

    const interval = setInterval(() => {
      const diff = Math.floor((Date.now() - missionState.started_at) / 1000)
      const min = Math.floor(diff / 60)
      const sec = String(diff % 60).padStart(2, '0')
      setElapsed(`${min}:${sec}`)
    }, 1000)

    return () => clearInterval(interval)
  }, [missionState?.started_at, isRunning])

  // Final elapsed when stopped
  useEffect(() => {
    if (missionState && !isRunning && missionState.started_at) {
      const diff = Math.floor((Date.now() - missionState.started_at) / 1000)
      const min = Math.floor(diff / 60)
      const sec = String(diff % 60).padStart(2, '0')
      setElapsed(`${min}:${sec}`)
    }
  }, [isRunning])

  // PlanReview → PromptPreview transition
  const handlePlanApproved = useCallback((agents, tasks) => {
    setPromptPreview({ agents, tasks })
  }, [])

  // PromptPreview → Deploy
  const handlePromptConfirmed = useCallback(async (agentsWithPrompts, tasks) => {
    setPromptPreview(null)
    deploy(agentsWithPrompts, tasks)
  }, [deploy])

  const handleBackFromPrompt = useCallback(() => {
    setPromptPreview(null)
  }, [])

  const hasMission = missionState && missionState.status !== 'Idle'
  const isPlanReview = planReady && missionState?.phase === 'ReviewPlan'

  // Load full mission snapshot from history to view read-only
  const handleViewHistory = useCallback(async (item) => {
    if (!item.id) return
    try {
      const snapshot = await invoke('get_mission_detail', { missionId: item.id })
      setHistoryView(snapshot)
    } catch {
      // Snapshot not saved — just show the summary we already have
      setHistoryView(item)
    }
  }, [])

  // Continue from a history mission — restore context then open continue flow
  const handleContinueFromHistory = useCallback(async (item) => {
    if (!item.id) return
    try {
      const snapshot = await invoke('get_mission_detail', { missionId: item.id })
      setHistoryView(snapshot)
    } catch {
      setHistoryView(item)
    }
  }, [])

  return (
    <div className="h-screen bg-vs-bg text-vs-text flex overflow-hidden">
      <Sidebar />
      <main className="flex-1 md:ml-64 flex flex-col h-screen overflow-hidden">
        {/* Title bar drag region */}
        <div className="h-8 shrink-0 drag-region" />

        {promptPreview ? (
          <div className="flex-1 p-4 min-h-0 overflow-y-auto">
            <PromptPreview
              agents={promptPreview.agents}
              tasks={promptPreview.tasks}
              projectPath={missionState?.project_path || ''}
              onConfirm={handlePromptConfirmed}
              onBack={handleBackFromPrompt}
            />
          </div>
        ) : isPlanReview ? (
          <div className="flex-1 p-4 min-h-0 overflow-hidden">
            <div className="h-full bg-vs-bg rounded-lg border border-vs-border overflow-hidden flex flex-col">
              <PlanReview
                agents={planReady.agents}
                tasks={planReady.tasks}
                onDeploy={handlePlanApproved}
                onCancel={stop}
              />
            </div>
          </div>
        ) : historyView ? (
          <div className="flex-1 p-4 min-h-0 overflow-hidden">
            <MissionDashboard
              state={historyView}
              isRunning={false}
              isHistoryView={true}
              onStop={() => {}}
              onContinue={(msg) => {
                continueM(msg, historyView)
                setHistoryView(null)
              }}
              onNewMission={() => setHistoryView(null)}
              elapsed={''}
            />
          </div>
        ) : hasMission ? (
          <div className="flex-1 p-4 min-h-0 overflow-hidden">
            <MissionDashboard
              state={missionState}
              isRunning={isRunning}
              onStop={stop}
              onContinue={continueM}
              onNewMission={reset}
              elapsed={elapsed}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              <MissionLauncher onLaunch={launch} />
            </div>
            <MissionHistoryPanel
              onViewHistory={handleViewHistory}
              onContinueFromHistory={handleContinueFromHistory}
            />
          </div>
        )}
      </main>
    </div>
  )
}
