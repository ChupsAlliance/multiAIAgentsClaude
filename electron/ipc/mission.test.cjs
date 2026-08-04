// electron/ipc/mission.test.cjs
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
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
      // have fired yet -- it must be scheduled behind a real delay
      // (QC_QA_FAILURE_VISIBILITY_DELAY_MS); advance comfortably past it.
      await vi.advanceTimersByTimeAsync(1000)
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
    mission.__setPendingQcQaTimeoutForTest(100)  // short timeout for test
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

describe('scheduleAgentTeamsCompletion gating', () => {
  let mission

  beforeEach(() => {
    vi.useFakeTimers()
    delete require.cache[require.resolve('./mission.cjs')]
    mission = require('./mission.cjs')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('90s inactivity timeout routes through runFinalQaSweep, not a direct Completed assignment', async () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      id: 'm1', status: 'Running', phase: 'Executing',
      execution_mode: 'agent_teams',
      tasks: [{ id: 't1', title: 'A', status: 'completed' }],
      agents: [{ name: 'Lead', status: 'Working' }, { name: 'Dev', status: 'Done' }],
      log: [], project_path: '/tmp/proj', file_changes: [],
    })
    mission.__setSendToWindowForTest(sendToWindow)
    mission.__setQcQaRunnerForTest(async () => ({ verdict: 'PASS' }))

    mission.__scheduleAgentTeamsCompletionForTest('m1', sendToWindow)
    await vi.advanceTimersByTimeAsync(90_000)

    expect(mission.__getMissionStateForTest().status).toBe('Completed')
  })

  test('does not force-complete a still-pending task — leaves mission Running instead', async () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      id: 'm1', status: 'Running', phase: 'Executing',
      execution_mode: 'agent_teams',
      tasks: [{ id: 't1', title: 'A', status: 'completed' },
              { id: 't2', title: 'B', status: 'pending_qc' }],
      agents: [{ name: 'Lead', status: 'Working' }, { name: 'Dev', status: 'Done' }],
      log: [], project_path: '/tmp/proj', file_changes: [],
    })
    mission.__setSendToWindowForTest(sendToWindow)
    mission.__setQcQaRunnerForTest(async () => ({ verdict: 'PASS' }))

    mission.__scheduleAgentTeamsCompletionForTest('m1', sendToWindow)
    await vi.advanceTimersByTimeAsync(90_000)

    const state = mission.__getMissionStateForTest()
    expect(state.status).not.toBe('Completed')
    expect(state.tasks[1].status).not.toBe('completed')
  })
})

describe('Needs Attention recovery', () => {
  let mission

  beforeEach(() => {
    delete require.cache[require.resolve('./mission.cjs')]
    mission = require('./mission.cjs')
  })

  test('retry_agent resumes a task stuck at failed_qc/failed_qa (Needs Attention)', async () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      id: 'm1', status: 'Needs Attention', phase: 'Executing',
      tasks: [{ id: 't1', title: 'A', status: 'failed_qc', qcRound: 9, assigned_agent: 'Dev' }],
      agents: [{ name: 'Dev', status: 'Error' }],
      log: [], project_path: '/tmp/proj', file_changes: [],
    })
    mission.__setSendToWindowForTest(sendToWindow)

    const result = await mission.__retryAgentForTest('Dev')

    expect(result.ok).toBe(true)
    const state = mission.__getMissionStateForTest()
    expect(state.tasks[0].status).toBe('pending')
    expect(state.tasks[0].qcRound).toBe(0)
    expect(state.status).toBe('Running')
  })
})

describe('final sweep FAIL after process exit does not report a false Failed', () => {
  let mission

  beforeEach(() => {
    delete require.cache[require.resolve('./mission.cjs')]
    mission = require('./mission.cjs')
  })

  test('finalizeDeployExit does not send a completion status when the sweep left the mission Running', () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      id: 'm1', status: 'Running', phase: 'Executing',
      tasks: [{ id: 't1', title: 'A', status: 'in_progress' }],
      agents: [{ name: 'Dev', status: 'Working' }],
      log: [], project_path: '/tmp/proj', file_changes: [],
    })
    mission.__setSendToWindowForTest(sendToWindow)

    mission.__finalizeDeployExitForTest('m1', sendToWindow, Date.now())

    const statusEmits = sendToWindow.mock.calls.filter(c => c[0] === 'mission:status')
    expect(statusEmits.some(c => c[1].status === 'failed')).toBe(false)
  })
})

describe('fillTemplate substitution safety', () => {
  test('does not re-substitute placeholder-shaped text introduced by an earlier substitution', () => {
    const mission = require('./mission.cjs')
    const out = mission.__fillTemplateForTest('A={{A}} B={{B}}', {
      A: '{{B}}',
      B: 'real-b-value',
    })
    expect(out).toBe('A={{B}} B=real-b-value')
  })
})

describe('QC/QA task-update emits include task_id', () => {
  let mission

  beforeEach(() => {
    delete require.cache[require.resolve('./mission.cjs')]
    mission = require('./mission.cjs')
  })

  test('enqueueQcCheck -> QC PASS -> enqueueQaCheck -> QA PASS: every task-update emit carries task_id', async () => {
    const sendToWindow = vi.fn()
    const task = { id: 't1', title: 'Build it', status: 'pending_qc', assigned_agent: 'Dev', qcRound: 0 }
    mission.__setMissionStateForTest({
      tasks: [task],
      agents: [{ name: 'Dev', status: 'Idle', current_task: null }],
      log: [], project_path: '/tmp/proj',
    })
    mission.__setSendToWindowForTest(sendToWindow)
    mission.__setQcQaRunnerForTest(async () => ({ verdict: 'PASS' }))

    await mission.__enqueueQcCheckForTest(task, 'Dev')

    const taskUpdateCalls = sendToWindow.mock.calls.filter(c => c[0] === 'mission:task-update')
    expect(taskUpdateCalls.length).toBeGreaterThan(0)
    for (const call of taskUpdateCalls) {
      expect(call[1].task_id).toBe(task.id)
    }
  })

  test('enqueueQcCheck -> QC FAIL -> handleQcQaFailure: failed_qc and in_progress emits carry task_id', async () => {
    vi.useFakeTimers()
    try {
      const sendToWindow = vi.fn()
      const task = { id: 't1', title: 'Build it', status: 'pending_qc', assigned_agent: 'Dev', qcRound: 0 }
      mission.__setMissionStateForTest({
        tasks: [task],
        agents: [{ name: 'Dev', status: 'Idle', current_task: null }],
        log: [], project_path: '/tmp/proj',
      })
      mission.__setSendToWindowForTest(sendToWindow)
      mission.__setQcQaRunnerForTest(async () => ({
        verdict: 'FAIL', responsibleAgent: 'Dev', reason: 'build broke',
      }))

      const donePromise = mission.__enqueueQcCheckForTest(task, 'Dev')
      await vi.advanceTimersByTimeAsync(1000)
      await donePromise

      const taskUpdateCalls = sendToWindow.mock.calls.filter(c => c[0] === 'mission:task-update')
      const failedCall = taskUpdateCalls.find(c => c[1].status === 'failed_qc')
      const inProgressCall = taskUpdateCalls.find(c => c[1].status === 'in_progress')
      expect(failedCall).toBeTruthy()
      expect(inProgressCall).toBeTruthy()
      expect(failedCall[1].task_id).toBe(task.id)
      expect(inProgressCall[1].task_id).toBe(task.id)
    } finally {
      vi.useRealTimers()
    }
  })

  test('QC PASS -> QA FAIL: failed_qa and follow-up in_progress emits carry task_id', async () => {
    vi.useFakeTimers()
    try {
      const sendToWindow = vi.fn()
      const task = { id: 't1', title: 'Build it', status: 'pending_qc', assigned_agent: 'Dev', qcRound: 0 }
      mission.__setMissionStateForTest({
        tasks: [task],
        agents: [{ name: 'Dev', status: 'Idle', current_task: null }],
        log: [], project_path: '/tmp/proj',
      })
      mission.__setSendToWindowForTest(sendToWindow)
      let stage = 'qc'
      mission.__setQcQaRunnerForTest(async () => {
        if (stage === 'qc') {
          stage = 'qa'
          return { verdict: 'PASS' }
        }
        return { verdict: 'FAIL', responsibleAgent: 'Dev', reason: 'wrong behavior' }
      })

      const donePromise = mission.__enqueueQcCheckForTest(task, 'Dev')
      await vi.advanceTimersByTimeAsync(1000)
      await donePromise

      const taskUpdateCalls = sendToWindow.mock.calls.filter(c => c[0] === 'mission:task-update')
      const failedCall = taskUpdateCalls.find(c => c[1].status === 'failed_qa')
      const inProgressCall = taskUpdateCalls.find(c => c[1].status === 'in_progress')
      expect(failedCall).toBeTruthy()
      expect(inProgressCall).toBeTruthy()
      expect(failedCall[1].task_id).toBe(task.id)
      expect(inProgressCall[1].task_id).toBe(task.id)
    } finally {
      vi.useRealTimers()
    }
  })
})
