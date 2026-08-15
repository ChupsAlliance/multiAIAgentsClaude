// electron/ipc/mission.autoResume.test.js
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

describe('autoResumeAfterFinalQaFailure', () => {
  let mission

  beforeEach(() => {
    vi.restoreAllMocks()
    delete require.cache[require.resolve('./mission.cjs')]
    mission = require('./mission.cjs')
  })

  function setupMissionState(overrides = {}) {
    mission.__setMissionStateForTest({
      id: 'm1',
      status: 'Running',
      phase: 'Executing',
      description: 'Build the app',
      project_path: '/tmp/proj',
      execution_mode: 'standard',
      session_id: 'sess-123',
      tasks: [
        { id: 't1', title: 'Implement feature', status: 'in_progress', assigned_agent: 'Dev', qcRound: 1, qcReason: 'integration mismatch' },
      ],
      agents: [{ name: 'Lead', status: 'Done', model: 'sonnet', current_task: null }],
      log: [],
      file_changes: [],
      autoResumeCount: 0,
      ...overrides,
    })
  }

  test('attempt 1 logs auto-resume message and increments autoResumeCount', () => {
    const sendToWindow = vi.fn()
    setupMissionState({ autoResumeCount: 0 })
    mission.__setSendToWindowForTest(sendToWindow)

    mission.__autoResumeAfterFinalQaFailureForTest('m1', sendToWindow, Date.now())

    const state = mission.__getMissionStateForTest()
    expect(state.autoResumeCount).toBe(1)

    // Should have logged the auto-resume attempt message
    const logCalls = sendToWindow.mock.calls.filter(c => c[0] === 'mission:log')
    expect(logCalls.some(c => c[1].message.includes('auto-resuming mission (attempt 1/3)'))).toBe(true)
  })

  test('attempt 2 increments autoResumeCount to 2', () => {
    const sendToWindow = vi.fn()
    setupMissionState({ autoResumeCount: 1 })
    mission.__setSendToWindowForTest(sendToWindow)

    mission.__autoResumeAfterFinalQaFailureForTest('m1', sendToWindow, Date.now())

    const state = mission.__getMissionStateForTest()
    expect(state.autoResumeCount).toBe(2)

    const logCalls = sendToWindow.mock.calls.filter(c => c[0] === 'mission:log')
    expect(logCalls.some(c => c[1].message.includes('auto-resuming mission (attempt 2/3)'))).toBe(true)
  })

  test('attempt 3 increments autoResumeCount to 3', () => {
    const sendToWindow = vi.fn()
    setupMissionState({ autoResumeCount: 2 })
    mission.__setSendToWindowForTest(sendToWindow)

    mission.__autoResumeAfterFinalQaFailureForTest('m1', sendToWindow, Date.now())

    const state = mission.__getMissionStateForTest()
    expect(state.autoResumeCount).toBe(3)

    const logCalls = sendToWindow.mock.calls.filter(c => c[0] === 'mission:log')
    expect(logCalls.some(c => c[1].message.includes('auto-resuming mission (attempt 3/3)'))).toBe(true)
  })

  test('attempt 4 (autoResumeCount already 3) does NOT spawn — logs manual-intervention message', () => {
    const sendToWindow = vi.fn()
    setupMissionState({ autoResumeCount: 3 })
    mission.__setSendToWindowForTest(sendToWindow)

    mission.__autoResumeAfterFinalQaFailureForTest('m1', sendToWindow, Date.now())

    const state = mission.__getMissionStateForTest()
    // Count incremented to 4 but no spawn
    expect(state.autoResumeCount).toBe(4)

    const logCalls = sendToWindow.mock.calls.filter(c => c[0] === 'mission:log')
    expect(logCalls.some(c =>
      c[1].message.includes('Auto-resume already tried 3 times') &&
      c[1].message.includes('manual intervention')
    )).toBe(true)

    // Should NOT have emitted a Running status (no spawn happened)
    const statusCalls = sendToWindow.mock.calls.filter(c =>
      c[0] === 'mission:status' && c[1].status === 'Running'
    )
    expect(statusCalls.length).toBe(0)
  })

  test('give-up branch marks status Needs Attention with stuckReason and persists a snapshot', () => {
    const sendToWindow = vi.fn()
    setupMissionState({ autoResumeCount: 3 })
    mission.__setSendToWindowForTest(sendToWindow)

    mission.__autoResumeAfterFinalQaFailureForTest('m1', sendToWindow, Date.now())

    const state = mission.__getMissionStateForTest()
    expect(state.status).toBe('Needs Attention')
    expect(state.stuckReason).toBe('final_qa_retry_exhausted')

    const statusCalls = sendToWindow.mock.calls.filter(c => c[0] === 'mission:status')
    expect(statusCalls.some(c =>
      c[1].status === 'Needs Attention' && c[1].stuck_reason === 'final_qa_retry_exhausted'
    )).toBe(true)
  })

  test('autoResumeCount resets to 0 after retryAgentCore', () => {
    const sendToWindow = vi.fn()
    setupMissionState({
      autoResumeCount: 2,
      status: 'Running',
      agents: [
        { name: 'Lead', status: 'Done', model: 'sonnet', current_task: null },
        { name: 'Dev', status: 'Working', current_task: 'Implement feature', error: null },
      ],
    })
    mission.__setSendToWindowForTest(sendToWindow)

    mission.__retryAgentForTest('Dev')

    const state = mission.__getMissionStateForTest()
    expect(state.autoResumeCount).toBe(0)
  })

  test('autoResumeCount resets to 0 when runFinalQaSweep passes', async () => {
    const sendToWindow = vi.fn()
    setupMissionState({
      autoResumeCount: 2,
      tasks: [{ id: 't1', title: 'Build it', status: 'completed', assigned_agent: 'Dev', qcRound: 0 }],
    })
    mission.__setSendToWindowForTest(sendToWindow)
    mission.__setQcQaRunnerForTest(async () => ({ verdict: 'PASS' }))

    await mission.__runFinalQaSweepForTest()

    const state = mission.__getMissionStateForTest()
    expect(state.autoResumeCount).toBe(0)
    expect(state.status).toBe('Completed')
  })
})

describe('finalizeDeployExit with auto-resume', () => {
  let mission

  beforeEach(() => {
    vi.restoreAllMocks()
    delete require.cache[require.resolve('./mission.cjs')]
    mission = require('./mission.cjs')
  })

  test('calls autoResumeAfterFinalQaFailure when status is Running (instead of old manual-intervention log)', () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      id: 'm1', status: 'Running', phase: 'Executing',
      description: 'Test mission',
      project_path: '/tmp/proj',
      execution_mode: 'standard',
      session_id: 'sess-abc',
      tasks: [{ id: 't1', title: 'A', status: 'in_progress', assigned_agent: 'Dev', qcReason: 'bug found' }],
      agents: [{ name: 'Lead', status: 'Done', model: 'sonnet' }],
      log: [], file_changes: [],
      autoResumeCount: 0,
    })
    mission.__setSendToWindowForTest(sendToWindow)

    mission.__finalizeDeployExitForTest('m1', sendToWindow, Date.now())

    const state = mission.__getMissionStateForTest()
    // Should have incremented autoResumeCount (auto-resume was attempted)
    expect(state.autoResumeCount).toBe(1)

    // Should NOT have emitted 'failed' status
    const statusEmits = sendToWindow.mock.calls.filter(c => c[0] === 'mission:status')
    expect(statusEmits.some(c => c[1].status === 'failed')).toBe(false)

    // Should have the auto-resume log message
    const logCalls = sendToWindow.mock.calls.filter(c => c[0] === 'mission:log')
    expect(logCalls.some(c => c[1].message.includes('auto-resuming mission'))).toBe(true)
  })

  test('Completed status still works normally (no auto-resume)', () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      id: 'm1', status: 'Completed', phase: 'Done',
      description: 'Test mission',
      project_path: '/tmp/proj',
      tasks: [{ id: 't1', title: 'A', status: 'completed', completed_at: Date.now() }],
      agents: [{ name: 'Lead', status: 'Done' }],
      log: [], file_changes: [],
      started_at: Date.now(),
    })
    mission.__setSendToWindowForTest(sendToWindow)

    mission.__finalizeDeployExitForTest('m1', sendToWindow, Date.now())

    const statusEmits = sendToWindow.mock.calls.filter(c => c[0] === 'mission:status')
    expect(statusEmits.some(c => c[1].status === 'completed')).toBe(true)
  })

  test('does not write a stale debrief snapshot if the mission resumed (status back to Running) before generateDebriefSummary resolves', async () => {
    const { EventEmitter } = require('events')
    const fs = require('fs')
    const os = require('os')
    const path = require('path')

    function makeFakeProc() {
      const proc = new EventEmitter()
      proc.stdout = new EventEmitter()
      proc.stderr = new EventEmitter()
      proc.stdin = { write: vi.fn(), end: vi.fn() }
      proc.kill = () => {}
      return proc
    }

    const missionId = 'm-resume-race-' + Date.now()
    const snapshotPath = path.join(os.homedir(), '.claude', 'agent-teams-snapshots', `${missionId}.json`)
    try { fs.unlinkSync(snapshotPath) } catch (_) {}

    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      id: missionId, status: 'Completed', phase: 'Done',
      description: 'Test mission',
      project_path: '/tmp/proj',
      tasks: [{ id: 't1', title: 'A', status: 'completed', completed_at: Date.now() }],
      agents: [{ name: 'Lead', status: 'Done', model: 'sonnet', backend: 'claude' }],
      log: [], file_changes: [],
      started_at: Date.now(),
    })
    mission.__setSendToWindowForTest(sendToWindow)

    const fakeProc = makeFakeProc()
    mission.__setSpawnAgentProcessForTest(() => ({ proc: fakeProc, adapter: null, backendId: 'claude', resumeDropped: false, promptViaStdin: true }))

    // finalizeDeployExit writes the initial (debrief-less) snapshot synchronously,
    // then fires off generateDebriefSummary() in the background.
    mission.__finalizeDeployExitForTest(missionId, sendToWindow, Date.now())

    // Simulate the mission being resumed (continue_mission) while the debrief
    // generation is still in flight — status flips back to Running.
    const state = mission.__getMissionStateForTest()
    expect(state.status).toBe('Completed')
    state.status = 'Running'

    // Now let generateDebriefSummary resolve.
    fakeProc.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: JSON.stringify({
        goal: 'Test mission', agents_involved: ['Lead'], key_files: [],
        issues_encountered: [], outcome: 'Completed successfully',
      }) }] },
    }) + '\n'))
    fakeProc.emit('close', 0)

    // Flush the microtask queue so the .then() callback in finalizeDeployExit runs.
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The snapshot on disk must NOT have a debrief_summary written after the
    // resume — the guard should have skipped the write since status is no
    // longer terminal.
    const saved = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'))
    expect(saved.debrief_summary).toBeUndefined()
    expect(saved.status).toBe('Completed') // snapshot from the synchronous write, not overwritten

    try { fs.unlinkSync(snapshotPath) } catch (_) {}
  })
})
