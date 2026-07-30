// electron/ipc/mission.test.cjs
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

describe('TaskCompleted handling', () => {
  let mission

  beforeEach(() => {
    delete require.cache[require.resolve('./mission.cjs')]
    mission = require('./mission.cjs')
  })

  test('a Completed: line moves the task to pending_qc, not completed', () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      tasks: [{ id: 't1', title: 'Build it', status: 'in_progress', assigned_agent: 'Dev' }],
      agents: [{ name: 'Dev', status: 'Working', current_task: 'Build it' }],
      log: [],
    })

    mission.__handleParsedEventForTest(
      { type: 'TaskCompleted', agent: 'Dev', description: 'Build it' },
      sendToWindow
    )

    const state = mission.__getMissionStateForTest()
    expect(state.tasks[0].status).toBe('pending_qc')
    expect(sendToWindow).toHaveBeenCalledWith('mission:task-update',
      expect.objectContaining({ agent: 'Dev', status: 'pending_qc' }))
  })
})

describe('QC/QA per-task pipeline', () => {
  let mission

  beforeEach(() => {
    delete require.cache[require.resolve('./mission.cjs')]
    mission = require('./mission.cjs')
  })

  test('QC FAIL routes to handleQcQaFailure with stage "qc"', async () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      tasks: [{ id: 't1', title: 'Build it', status: 'pending_qc', assigned_agent: 'Dev', qcRound: 0 }],
      agents: [{ name: 'Dev', status: 'Idle', current_task: null }],
      log: [], project_path: '/tmp/proj',
    })
    mission.__setSendToWindowForTest(sendToWindow)
    mission.__setQcQaRunnerForTest(async () => ({
      verdict: 'FAIL', responsibleAgent: 'Dev', reason: 'build broke',
    }))

    await mission.__enqueueQcCheckForTest(mission.__getMissionStateForTest().tasks[0], 'Dev')

    const state = mission.__getMissionStateForTest()
    expect(state.tasks[0].status).toBe('in_progress')
    expect(state.tasks[0].qcRound).toBe(1)
    expect(sendToWindow).toHaveBeenCalledWith('mission:task-update',
      expect.objectContaining({ status: 'failed_qc' }))
  })

  test('QC PASS then QA PASS marks the task completed', async () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      tasks: [{ id: 't1', title: 'Build it', status: 'pending_qc', assigned_agent: 'Dev', qcRound: 0 }],
      agents: [{ name: 'Dev', status: 'Idle', current_task: null }],
      log: [], project_path: '/tmp/proj',
    })
    mission.__setSendToWindowForTest(sendToWindow)
    mission.__setQcQaRunnerForTest(async (opts) => ({ verdict: 'PASS' }))

    await mission.__enqueueQcCheckForTest(mission.__getMissionStateForTest().tasks[0], 'Dev')

    const state = mission.__getMissionStateForTest()
    expect(state.tasks[0].status).toBe('completed')
    expect(sendToWindow).toHaveBeenCalledWith('mission:task-update',
      expect.objectContaining({ status: 'completed' }))
  })

  test('round 9 sets mission to Needs Attention instead of retrying', async () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      status: 'Running',
      tasks: [{ id: 't1', title: 'Build it', status: 'pending_qc', assigned_agent: 'Dev', qcRound: 8 }],
      agents: [{ name: 'Dev', status: 'Idle', current_task: null }],
      log: [], project_path: '/tmp/proj',
    })
    mission.__setSendToWindowForTest(sendToWindow)
    mission.__setQcQaRunnerForTest(async () => ({
      verdict: 'FAIL', responsibleAgent: 'Dev', reason: 'still broken',
    }))

    await mission.__enqueueQcCheckForTest(mission.__getMissionStateForTest().tasks[0], 'Dev')

    const state = mission.__getMissionStateForTest()
    expect(state.tasks[0].qcRound).toBe(9)
    expect(state.status).toBe('Needs Attention')
    expect(sendToWindow).toHaveBeenCalledWith('mission:status',
      expect.objectContaining({ status: 'Needs Attention' }))
  })
})

describe('runFinalQaSweep gating', () => {
  let mission

  beforeEach(() => {
    delete require.cache[require.resolve('./mission.cjs')]
    mission = require('./mission.cjs')
  })

  test('does not set Completed while a task is still pending_qc', async () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      id: 'm1', status: 'Running', phase: 'Executing',
      tasks: [{ id: 't1', title: 'A', status: 'completed' },
              { id: 't2', title: 'B', status: 'pending_qc' }],
      agents: [{ name: 'Dev', status: 'Idle' }],
      log: [], project_path: '/tmp/proj', file_changes: [],
    })
    mission.__setSendToWindowForTest(sendToWindow)

    await mission.__runFinalQaSweepForTest()

    expect(mission.__getMissionStateForTest().status).not.toBe('Completed')
  })

  test('sets Completed only after the final whole-picture QA PASSes', async () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      id: 'm1', status: 'Running', phase: 'Executing',
      tasks: [{ id: 't1', title: 'A', status: 'completed' }],
      agents: [{ name: 'Dev', status: 'Idle' }],
      log: [], project_path: '/tmp/proj', file_changes: [],
    })
    mission.__setSendToWindowForTest(sendToWindow)
    mission.__setQcQaRunnerForTest(async () => ({ verdict: 'PASS' }))

    await mission.__runFinalQaSweepForTest()

    expect(mission.__getMissionStateForTest().status).toBe('Completed')
  })

  test('final QA FAIL keeps mission Running and routes failure to the named agent', async () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      id: 'm1', status: 'Running', phase: 'Executing',
      tasks: [{ id: 't1', title: 'A', status: 'completed', assigned_agent: 'Dev', qcRound: 0 }],
      agents: [{ name: 'Dev', status: 'Idle' }],
      log: [], project_path: '/tmp/proj', file_changes: [],
    })
    mission.__setSendToWindowForTest(sendToWindow)
    mission.__setQcQaRunnerForTest(async () => ({
      verdict: 'FAIL', responsibleAgent: 'Dev', reason: 'frontend and backend not wired together',
    }))

    await mission.__runFinalQaSweepForTest()

    const state = mission.__getMissionStateForTest()
    expect(state.status).toBe('Running')
    expect(state.tasks[0].status).toBe('in_progress')
    expect(state.tasks[0].qcRound).toBe(1)
  })
})
