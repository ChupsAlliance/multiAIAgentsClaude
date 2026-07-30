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
