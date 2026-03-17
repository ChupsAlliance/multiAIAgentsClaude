import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Sidebar } from '../components/Sidebar'
import { MissionLauncher } from '../components/mission/MissionLauncher'
import { MissionDashboard } from '../components/mission/MissionDashboard'
import { PlanReview } from '../components/mission/PlanReview'
import { PromptPreview } from '../components/mission/PromptPreview'
import { MissionHistoryPanel } from '../components/mission/MissionHistoryPanel'
import { useMission } from '../hooks/useMission'
import { buildMissionPrompt } from '../data/promptWrapper'

export function MissionControlPage() {
  const { missionState, isRunning, planReady, isReplanning, launch, deploy, continueM, stop, reset, replan } = useMission()
  const [elapsed, setElapsed] = useState('0:00')
  const [promptPreview, setPromptPreview] = useState(null) // { agents, tasks }
  const [historyView, setHistoryView] = useState(null)     // full MissionState snapshot from history
  const [historyViewMode, setHistoryViewMode] = useState('view') // 'view' | 'continue'

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
      setHistoryViewMode('view')
    } catch {
      setHistoryView(item)
      setHistoryViewMode('view')
    }
  }, [])

  // Continue from a history mission — show snapshot with intervention panel enabled
  const handleContinueFromHistory = useCallback(async (item) => {
    if (!item.id) return
    try {
      const snapshot = await invoke('get_mission_detail', { missionId: item.id })
      setHistoryView(snapshot)
      setHistoryViewMode('continue')
    } catch {
      setHistoryView(item)
      setHistoryViewMode('continue')
    }
  }, [])

  return (
    <div className="h-screen bg-vs-bg text-vs-text flex overflow-hidden">
      <Sidebar />
      <main className="flex-1 md:ml-64 flex flex-col h-screen overflow-hidden">
        {/* Title bar drag region */}
        <div className="h-8 shrink-0 drag-region" />

        {/* PromptPreview overlay (shown on top of PlanReview) */}
        {promptPreview && (
          <div className="flex-1 p-4 min-h-0 overflow-y-auto">
            <PromptPreview
              agents={promptPreview.agents}
              tasks={promptPreview.tasks}
              projectPath={missionState?.project_path || ''}
              onConfirm={handlePromptConfirmed}
              onBack={handleBackFromPrompt}
            />
          </div>
        )}

        {/* PlanReview: keep mounted (hidden) while PromptPreview is shown so local state survives Back */}
        {isPlanReview && (
          <div className={`flex-1 p-4 min-h-0 overflow-hidden ${promptPreview ? 'hidden' : ''}`}>
            <div className="h-full bg-vs-bg rounded-lg border border-vs-border overflow-hidden flex flex-col">
              <PlanReview
                agents={planReady.agents}
                tasks={planReady.tasks}
                onDeploy={handlePlanApproved}
                onCancel={stop}
                onReplan={replan}
                isReplanning={isReplanning}
              />
            </div>
          </div>
        )}

        {/* History view / Continue from history */}
        {!promptPreview && !isPlanReview && historyView && (
          <div className="flex-1 p-4 min-h-0 overflow-hidden flex flex-col">
            {/* Continue-from-history banner */}
            {historyViewMode === 'continue' && (
              <div className="flex items-center justify-between px-4 py-2 mb-2 rounded-md bg-vs-accent/10 border border-vs-accent/30 shrink-0">
                <span className="text-[11px] font-mono text-vs-accent">
                  🔀 Tiếp tục từ mission cũ — nhập yêu cầu mới bên dưới → Lead sẽ lên plan mới → bạn review trước khi deploy
                </span>
                <button
                  onClick={() => { setHistoryView(null); setHistoryViewMode('view') }}
                  className="text-[10px] font-mono text-vs-muted hover:text-white transition-colors px-2 py-0.5 rounded border border-vs-border hover:border-vs-accent shrink-0"
                >
                  ← Hủy
                </button>
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-hidden">
              <MissionDashboard
                state={historyView}
                isRunning={false}
                isHistoryView={historyViewMode === 'view'}
                onStop={() => {}}
                onContinue={async (msg) => {
                  // Full lifecycle: build planning prompt → launch new mission with history context
                  const projectPath = historyView.project_path || ''
                  const histModel = (historyView.agents || []).find(a => a.name === 'Lead')?.model || 'sonnet'
                  const histExecMode = historyView.execution_mode || 'standard'
                  try {
                    const prompt = await buildMissionPrompt(msg, {
                      projectPath,
                      teamHint: 'Use 3-4 teammates for this task',
                    })
                    setHistoryView(null)
                    setHistoryViewMode('view')
                    await launch({
                      projectPath,
                      prompt,
                      description: msg,
                      model: histModel,
                      executionMode: histExecMode,
                      historyContext: JSON.stringify(historyView),
                    })
                  } catch (err) {
                    console.error('[continueFromHistory] Error:', err)
                    setHistoryView(null)
                    setHistoryViewMode('view')
                  }
                }}
                onNewMission={() => {
                  setHistoryView(null)
                  setHistoryViewMode('view')
                }}
                elapsed={(() => {
                  const s = historyView.started_at
                  const e = historyView.ended_at
                  if (!s || !e) return ''
                  const diff = Math.floor((e - s) / 1000)
                  const m = Math.floor(diff / 60)
                  const sec = String(diff % 60).padStart(2, '0')
                  return `${m}:${sec}`
                })()}
              />
            </div>
          </div>
        )}

        {/* Active mission dashboard */}
        {!promptPreview && !isPlanReview && !historyView && hasMission && (
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
        )}

        {/* Launcher (no active mission) */}
        {!promptPreview && !isPlanReview && !historyView && !hasMission && (
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
