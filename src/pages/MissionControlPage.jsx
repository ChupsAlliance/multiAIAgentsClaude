import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Sidebar } from '../components/Sidebar'
import { MissionLauncher } from '../components/mission/MissionLauncher'
import { MissionDashboard } from '../components/mission/MissionDashboard'
import { PlanningStream } from '../components/mission/PlanningStream'
import { PlanReview } from '../components/mission/PlanReview'
import { PlanDocument } from '../components/mission/PlanDocument'
import { PromptPreview } from '../components/mission/PromptPreview'
import { MissionHistoryPanel } from '../components/mission/MissionHistoryPanel'
import { useMission } from '../hooks/useMission'
import { buildMissionPrompt } from '../data/promptWrapper'
import { ShortcutsHelpModal } from '../components/common/ShortcutsHelpModal'
import { useAppHotkeys } from '../hooks/useAppHotkeys'

export function MissionControlPage() {
  const { missionState, isRunning, planReady, setPlanReady, isReplanning, pendingQuestions,
          mockupInfo, recoverableMission, setRecoverableMission,
          launch, deploy, continueM, stop, reset, replan, answerQuestion, respondToMockup, retryAgent } = useMission()
  const [elapsed, setElapsed] = useState('0:00')
  const [promptPreview, setPromptPreview] = useState(null) // { agents, tasks }
  const [planViewTab, setPlanViewTab] = useState('visual') // 'visual' | 'document'
  const [historyView, setHistoryView] = useState(null)     // full MissionState snapshot from history
  const [historyViewMode, setHistoryViewMode] = useState('view') // 'view' | 'continue'
  const [showShortcuts, setShowShortcuts] = useState(false)

  useAppHotkeys({
    scope: 'global',
    handlers: {
      '?': () => setShowShortcuts(prev => !prev),
      'escape': () => setShowShortcuts(false),
    },
  })

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
  const handlePromptConfirmed = useCallback(async (agents, tasks, agentPrompts) => {
    setPromptPreview(null)
    deploy(agents, tasks, agentPrompts)
  }, [deploy])

  const handleBackFromPrompt = useCallback(() => {
    setPromptPreview(null)
  }, [])

  // PlanDocument → Apply changes → update planReady state
  const handleDocumentApply = useCallback((updatedAgents, updatedTasks) => {
    setPlanReady({ agents: updatedAgents, tasks: updatedTasks })
    setPlanViewTab('visual') // Switch to visual tab to verify
  }, [setPlanReady])

  const hasMission = missionState && missionState.status !== 'Idle'
  const isPlanReview = planReady && missionState?.phase === 'ReviewPlan'
  const isPlanningPhase = (
    (isRunning || missionState?.status === 'WaitingForMockup') &&
    missionState?.phase === 'Planning' && !isPlanReview
  )

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

        {/* PlanReview / PlanDocument: tab-switched views */}
        {isPlanReview && (
          <div className={`flex-1 p-4 min-h-0 overflow-hidden flex flex-col ${promptPreview ? 'hidden' : ''}`}>
            {/* Tab bar */}
            <div className="flex items-center gap-0.5 mb-0 shrink-0">
              <button
                onClick={() => setPlanViewTab('visual')}
                className={`px-3 py-1.5 rounded-t-md text-xs font-mono transition-colors ${
                  planViewTab === 'visual'
                    ? 'bg-vs-panel text-vs-heading border-t border-x border-vs-border'
                    : 'text-vs-muted hover:text-vs-heading hover:bg-vs-overlay/5'
                }`}
              >
                <span className="mr-1.5">&#x1F3AF;</span>Trực quan
              </button>
              <button
                onClick={() => setPlanViewTab('document')}
                className={`px-3 py-1.5 rounded-t-md text-xs font-mono transition-colors ${
                  planViewTab === 'document'
                    ? 'bg-vs-panel text-vs-heading border-t border-x border-vs-border'
                    : 'text-vs-muted hover:text-vs-heading hover:bg-vs-overlay/5'
                }`}
              >
                <span className="mr-1.5">&#x1F4C4;</span>Tài liệu
              </button>
            </div>

            {/* Visual tab (PlanReview) */}
            {planViewTab === 'visual' && (
              <div className="flex-1 min-h-0 bg-vs-bg rounded-lg border border-vs-border overflow-hidden flex flex-col">
                <PlanReview
                  agents={planReady.agents}
                  tasks={planReady.tasks}
                  onDeploy={handlePlanApproved}
                  onCancel={stop}
                  onReplan={replan}
                  isReplanning={isReplanning}
                />
              </div>
            )}

            {/* Document tab (PlanDocument) */}
            {planViewTab === 'document' && (
              <div className="flex-1 min-h-0 rounded-lg border border-vs-border overflow-hidden">
                <PlanDocument
                  agents={planReady.agents}
                  tasks={planReady.tasks}
                  missionContext={planReady.mission_context || null}
                  projectPath={missionState?.project_path || ''}
                  requirement={missionState?.requirement || ''}
                  missionId={missionState?.id || null}
                  onApply={handleDocumentApply}
                  isReplanning={isReplanning}
                />
              </div>
            )}
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
                  className="text-[10px] font-mono text-vs-muted hover:text-vs-heading transition-colors px-2 py-0.5 rounded border border-vs-border hover:border-vs-accent shrink-0"
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
                      permissionMode: historyView.permission_mode || 'auto',
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

        {/* Planning phase — live streaming terminal view */}
        {!promptPreview && !isPlanReview && !historyView && isPlanningPhase && (
          <PlanningStream
            state={missionState}
            isRunning={isRunning}
            onStop={stop}
            mockupInfo={mockupInfo}
            onMockupRespond={respondToMockup}
          />
        )}

        {/* Active mission dashboard (execution phase — not planning) */}
        {!promptPreview && !isPlanReview && !historyView && hasMission && !isPlanningPhase && (
          <div className="flex-1 p-4 min-h-0 overflow-hidden">
            <MissionDashboard
              state={missionState}
              isRunning={isRunning}
              onStop={stop}
              onContinue={continueM}
              onNewMission={reset}
              elapsed={elapsed}
              pendingQuestions={pendingQuestions}
              onAnswerQuestion={answerQuestion}
              onRetryAgent={retryAgent}
            />
          </div>
        )}

        {/* Launcher (no active mission) */}
        {!promptPreview && !isPlanReview && !historyView && !hasMission && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              {/* Crash recovery banner */}
              {recoverableMission && (
                <div className="max-w-2xl mx-auto mb-4 p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-sm">
                  <div className="font-medium text-amber-300 mb-1">Mission interrupted</div>
                  <div className="text-vs-muted mb-2">
                    "{recoverableMission.description?.slice(0, 80) || 'Unnamed mission'}" was interrupted ({recoverableMission.phase}, {recoverableMission.log_count} log entries).
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        const snap = await invoke('get_mission_detail', { missionId: recoverableMission.id }).catch(() => null)
                        if (snap) { setHistoryView(snap); setHistoryViewMode('continue') }
                        setRecoverableMission(null)
                      }}
                      className="px-3 py-1 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 text-xs font-medium"
                    >
                      View & Continue
                    </button>
                    <button
                      onClick={() => setRecoverableMission(null)}
                      className="px-3 py-1 rounded bg-vs-panel text-vs-muted hover:bg-vs-hover text-xs"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
              <MissionLauncher onLaunch={launch} />
            </div>
            <MissionHistoryPanel
              onViewHistory={handleViewHistory}
              onContinueFromHistory={handleContinueFromHistory}
            />
          </div>
        )}
      </main>
      <ShortcutsHelpModal isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </div>
  )
}
