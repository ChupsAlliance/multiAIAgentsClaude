import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { Sidebar } from '../components/Sidebar'
import { MissionLauncher } from '../components/mission/MissionLauncher'
import { MissionDashboard } from '../components/mission/MissionDashboard'
import { PlanningStream } from '../components/mission/PlanningStream'
import { PlanReview } from '../components/mission/PlanReview'
import { PlanDocument } from '../components/mission/PlanDocument'
import { PromptPreview } from '../components/mission/PromptPreview'
import { MissionHistoryPanel } from '../components/mission/MissionHistoryPanel'
import { RecordingSaveDialog } from '../components/mission/RecordingSaveDialog'
import { ReplayControls } from '../components/mission/ReplayControls'
import { useMission } from '../hooks/useMission'
import { useReplay } from '../hooks/useReplay'
import { buildMissionPrompt } from '../data/promptWrapper'
import { ShortcutsHelpModal } from '../components/common/ShortcutsHelpModal'
import { useAppHotkeys } from '../hooks/useAppHotkeys'
import { Radio } from 'lucide-react'

export function MissionControlPage() {
  const { missionState, isRunning, planReady, setPlanReady, isReplanning, pendingQuestions,
          mockupInfo, recoverableMission, setRecoverableMission,
          isRecording, startRecording, stopRecordingAndSave, discardRecording,
          launch, deploy, continueM, stop, reset, replan, answerQuestion, respondToMockup, retryAgent } = useMission()
  const [elapsed, setElapsed] = useState('0:00')
  const [promptPreview, setPromptPreview] = useState(null) // { agents, tasks }
  const [planViewTab, setPlanViewTab] = useState('visual') // 'visual' | 'document'
  const [replayPlanViewTab, setReplayPlanViewTab] = useState('plan') // 'plan' | 'prompts' — replay-only tab
  const [historyView, setHistoryView] = useState(null)     // full MissionState snapshot from history
  const [historyViewMode, setHistoryViewMode] = useState('view') // 'view' | 'continue'
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showSaveRecordingDialog, setShowSaveRecordingDialog] = useState(false)
  const recordingSaveHandledRef = useRef(false) // tránh mở dialog lặp lại cho cùng 1 lần Completed

  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const replayRecordingId = searchParams.get('replay')
  const isReplayMode = !!replayRecordingId

  const replay = useReplay(isReplayMode ? replayRecordingId : null)

  useAppHotkeys({
    scope: 'global',
    handlers: {
      '?': () => setShowShortcuts(prev => !prev),
      'escape': () => setShowShortcuts(false),
    },
  })

  // ── Recording: khi mission hoàn thành (status Completed) và đang ghi, tự mở dialog lưu tên ──
  useEffect(() => {
    if (isReplayMode) return
    if (isRecording && missionState?.status === 'Completed' && !recordingSaveHandledRef.current) {
      recordingSaveHandledRef.current = true
      setShowSaveRecordingDialog(true)
    }
    if (missionState?.status !== 'Completed') {
      recordingSaveHandledRef.current = false
    }
  }, [isRecording, missionState?.status, isReplayMode])

  const handleToggleRecording = useCallback(() => {
    if (isRecording) {
      discardRecording()
    } else {
      startRecording()
    }
  }, [isRecording, discardRecording, startRecording])

  const handleSaveRecording = useCallback(async (name) => {
    const ok = await stopRecordingAndSave(name)
    if (ok) setShowSaveRecordingDialog(false)
  }, [stopRecordingAndSave])

  const handleDiscardRecording = useCallback(async () => {
    await discardRecording()
    setShowSaveRecordingDialog(false)
  }, [discardRecording])

  const handleExitReplay = useCallback(async () => {
    await replay.stopReplay()
    navigate('/recordings')
  }, [replay, navigate])

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
  const handleDocumentApply = useCallback((updatedAgents, updatedTasks, updatedMissionContext) => {
    setPlanReady(prev => ({
      agents: updatedAgents,
      tasks: updatedTasks,
      mission_context: updatedMissionContext !== undefined ? updatedMissionContext : prev?.mission_context || null,
    }))
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

  // ── Replay-on-real-UI mode: read-only, switches UI by recorded phase ──
  if (isReplayMode) {
    const replayPhase = replay.replayMissionState?.phase
    const isReplayPlanning = replayPhase === 'Planning'
    const isReplayReviewPlan = replayPhase === 'ReviewPlan' && replay.replayPlanReady

    return (
      <div className="h-screen bg-vs-bg text-vs-text flex overflow-hidden">
        <Sidebar />
        <main className="flex-1 md:ml-64 flex flex-col h-screen overflow-hidden relative">
          <div className="h-8 shrink-0 drag-region" />

          {/* Banner: đang phát lại bản ghi */}
          <div className="mx-4 mt-1 mb-2 shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg border border-purple-500/40 bg-purple-500/10">
            <Radio size={13} className="text-purple-300 shrink-0 animate-pulse" />
            <span className="text-xs font-mono text-purple-200">
              Đang phát lại bản ghi: <strong>{replay.recordingMeta?.name || replay.replayMissionState?.description || replayRecordingId}</strong>
            </span>
            {replay.loading && (
              <span className="text-[10px] text-purple-300/60 ml-auto">Đang tải...</span>
            )}
          </div>

          <div className="flex-1 px-4 pb-28 min-h-0 overflow-hidden">
            {isReplayPlanning && (
              <PlanningStream
                state={replay.replayMissionState}
                isRunning={true}
                onStop={undefined}
                mockupInfo={replay.mockupInfo}
                onMockupRespond={replay.mockupInfo ? () => Promise.resolve() : undefined}
              />
            )}

            {isReplayReviewPlan && (
              <div data-testid="replay-readonly-overlay" className="relative h-full min-h-0">
                <div className="absolute inset-0 z-10" />
                {replayPlanViewTab === 'plan' ? (
                  <div className="h-full min-h-0 bg-vs-bg rounded-lg border border-vs-border overflow-hidden flex flex-col">
                    <PlanReview
                      agents={replay.replayPlanReady.agents}
                      tasks={replay.replayPlanReady.tasks}
                      onDeploy={() => {}}
                      onCancel={() => {}}
                      onReplan={undefined}
                      isReplanning={false}
                    />
                  </div>
                ) : (
                  <div className="h-full min-h-0 overflow-y-auto">
                    <PromptPreview
                      agents={replay.replayPlanReady.agents}
                      tasks={replay.replayPlanReady.tasks}
                      projectPath={replay.replayMissionState?.project_path || ''}
                      onConfirm={() => {}}
                      onBack={() => {}}
                    />
                  </div>
                )}
              </div>
            )}

            {!isReplayPlanning && !isReplayReviewPlan && (
              <div data-testid="mission-dashboard-replay-mode" className="h-full min-h-0">
                <MissionDashboard
                  state={replay.replayMissionState}
                  isRunning={true}
                  isHistoryView={true}
                  onStop={() => {}}
                  onContinue={async () => {}}
                  onNewMission={handleExitReplay}
                  elapsed=""
                />
              </div>
            )}
          </div>

          {/* Tab bar for ReviewPlan phase — mirrors live mode's PlanReview/PromptPreview split */}
          {isReplayReviewPlan && (
            <div className="absolute left-4 top-16 z-20 flex items-center gap-0.5">
              <button
                onClick={() => setReplayPlanViewTab('plan')}
                className={`px-3 py-1.5 rounded-t-md text-xs font-mono transition-colors ${
                  replayPlanViewTab === 'plan'
                    ? 'bg-vs-panel text-vs-heading border-t border-x border-vs-border'
                    : 'text-vs-muted hover:text-vs-heading hover:bg-vs-overlay/5'
                }`}
              >
                Kế hoạch
              </button>
              <button
                onClick={() => setReplayPlanViewTab('prompts')}
                className={`px-3 py-1.5 rounded-t-md text-xs font-mono transition-colors ${
                  replayPlanViewTab === 'prompts'
                    ? 'bg-vs-panel text-vs-heading border-t border-x border-vs-border'
                    : 'text-vs-muted hover:text-vs-heading hover:bg-vs-overlay/5'
                }`}
              >
                Prompts
              </button>
            </div>
          )}

          {/* ReplayControls overlay cố định ở đáy */}
          <div className="absolute left-0 right-0 bottom-0 px-4 pb-4 md:pl-4 pointer-events-none">
            <div className="pointer-events-auto max-w-3xl mx-auto">
              <ReplayControls
                isPlaying={replay.isPlaying}
                speed={replay.speed}
                currentMs={replay.currentMs}
                totalMs={replay.totalMs}
                stepMarkers={replay.stepMarkers}
                onPlayPause={replay.togglePlayPause}
                onSpeedChange={replay.changeSpeed}
                onSeek={replay.seek}
                onExit={handleExitReplay}
              />
            </div>
          </div>
        </main>
      </div>
    )
  }

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
                  globalBackend={missionState?.backend || 'claude'}
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
              <MissionLauncher
                onLaunch={launch}
                isRecording={isRecording}
                onToggleRecording={handleToggleRecording}
              />
            </div>
            <MissionHistoryPanel
              onViewHistory={handleViewHistory}
              onContinueFromHistory={handleContinueFromHistory}
            />
          </div>
        )}
      </main>
      <ShortcutsHelpModal isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />
      <RecordingSaveDialog
        open={showSaveRecordingDialog}
        defaultName={missionState?.description || ''}
        onSave={handleSaveRecording}
        onDiscard={handleDiscardRecording}
      />
    </div>
  )
}
