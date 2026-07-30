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
    vi.useFakeTimers()
    try {
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
      // The failed_qc -> in_progress retry transition is now behind an
      // observability delay (see handleQcQaFailure); advance past it.
      await vi.advanceTimersByTimeAsync(1000)

      const state = mission.__getMissionStateForTest()
      expect(state.tasks[0].status).toBe('in_progress')
      expect(state.tasks[0].qcRound).toBe(1)
      expect(sendToWindow).toHaveBeenCalledWith('mission:task-update',
        expect.objectContaining({ status: 'failed_qc' }))
    } finally {
      vi.useRealTimers()
    }
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

  test('QC PASS emits pending_qa before the QA stage settles to completed or failed_qa', async () => {
    const statusesSeen = []
    const sendToWindow = vi.fn((channel, payload) => {
      if (channel === 'mission:task-update') statusesSeen.push(payload.status)
    })
    mission.__setMissionStateForTest({
      tasks: [{ id: 't1', title: 'Build it', status: 'pending_qc', assigned_agent: 'Dev', qcRound: 0 }],
      agents: [{ name: 'Dev', status: 'Idle', current_task: null }],
      log: [], project_path: '/tmp/proj',
    })
    mission.__setSendToWindowForTest(sendToWindow)
    mission.__setQcQaRunnerForTest(async (opts) => ({ verdict: 'PASS' }))

    await mission.__enqueueQcCheckForTest(mission.__getMissionStateForTest().tasks[0], 'Dev')

    expect(statusesSeen).toContain('pending_qa')
    const pendingQaIndex = statusesSeen.indexOf('pending_qa')
    const terminalIndex = statusesSeen.findIndex((s) => s === 'completed' || s === 'failed_qa')
    expect(terminalIndex).toBeGreaterThan(-1)
    expect(pendingQaIndex).toBeLessThan(terminalIndex)
  })

  test('failed_qc -> in_progress retry transition is separated by an observable delay, not synchronous', async () => {
    vi.useFakeTimers()
    try {
      const events = []
      const sendToWindow = vi.fn((channel, payload) => {
        if (channel === 'mission:task-update') events.push({ status: payload.status, t: Date.now() })
      })
      mission.__setMissionStateForTest({
        tasks: [{ id: 't1', title: 'Build it', status: 'pending_qc', assigned_agent: 'Dev', qcRound: 0 }],
        agents: [{ name: 'Dev', status: 'Idle', current_task: null }],
        log: [], project_path: '/tmp/proj',
      })
      mission.__setSendToWindowForTest(sendToWindow)
      mission.__setQcQaRunnerForTest(async () => ({
        verdict: 'FAIL', responsibleAgent: 'Dev', reason: 'build broke',
      }))

      const donePromise = mission.__enqueueQcCheckForTest(mission.__getMissionStateForTest().tasks[0], 'Dev')
      // Let the QC-runner microtask resolve so handleQcQaFailure fires and emits failed_qc.
      await vi.advanceTimersByTimeAsync(0)

      expect(events.some((e) => e.status === 'failed_qc')).toBe(true)
      expect(events.some((e) => e.status === 'in_progress')).toBe(false)

      // Without advancing the timer further, the in_progress follow-up must not
      // have fired yet -- it must be scheduled behind a real delay.
      await vi.advanceTimersByTimeAsync(500)
      await donePromise

      const failedIndex = events.findIndex((e) => e.status === 'failed_qc')
      const inProgressIndex = events.findIndex((e) => e.status === 'in_progress')
      expect(inProgressIndex).toBeGreaterThan(failedIndex)
      expect(events[inProgressIndex].t - events[failedIndex].t).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
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
    vi.useFakeTimers()
    try {
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
      // The failed_qc/failed_qa -> in_progress retry transition is now behind
      // an observability delay (see handleQcQaFailure); advance past it.
      await vi.advanceTimersByTimeAsync(1000)

      const state = mission.__getMissionStateForTest()
      expect(state.status).toBe('Running')
      expect(state.tasks[0].status).toBe('in_progress')
      expect(state.tasks[0].qcRound).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('seed-task reconciliation', () => {
  beforeEach(() => {
    delete require.cache[require.resolve('./mission.cjs')]
  })

  test('TaskStarted reconciles against the plan-seeded row instead of creating a duplicate', () => {
    const mission = require('./mission.cjs')
    mission.__setMissionStateForTest({
      id: 'm1', status: 'Running', phase: 'Executing',
      tasks: [{ id: 'task-0', title: 'Build the widget', status: 'pending', assigned_agent: 'Dev' }],
      agents: [{ name: 'Dev', status: 'Idle' }],
      log: [], project_path: '/tmp/proj', file_changes: [],
    })
    mission.__setSendToWindowForTest(() => {})

    mission.__handleParsedEventForTest({ type: 'TaskStarted', agent: 'Dev', description: 'Build the widget' }, () => {})

    const state = mission.__getMissionStateForTest()
    expect(state.tasks.length).toBe(1)
    expect(state.tasks[0].id).toBe('task-0')
    expect(state.tasks[0].status).toBe('in_progress')
  })

  test('TaskCompleted reconciles against the seeded row across the full QC/QA cycle to completed', () => {
    const mission = require('./mission.cjs')
    mission.__setMissionStateForTest({
      id: 'm1', status: 'Running', phase: 'Executing',
      tasks: [{ id: 'task-0', title: 'Build the widget', status: 'pending', assigned_agent: 'Dev' }],
      agents: [{ name: 'Dev', status: 'Idle' }],
      log: [], project_path: '/tmp/proj', file_changes: [],
    })
    mission.__setSendToWindowForTest(() => {})
    mission.__setQcQaRunnerForTest(async () => ({ verdict: 'PASS' }))

    mission.__handleParsedEventForTest({ type: 'TaskStarted', agent: 'Dev', description: 'Build the widget' }, () => {})
    mission.__handleParsedEventForTest({ type: 'TaskCompleted', agent: 'Dev', description: 'Build the widget' }, () => {})

    const state = mission.__getMissionStateForTest()
    expect(state.tasks.length).toBe(1)
    expect(state.tasks[0].id).toBe('task-0')
  })
})
