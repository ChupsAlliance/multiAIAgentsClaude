import { describe, it, expect } from 'vitest'
import { buildFlowModel, agentColor } from './businessFlow'

const AGENTS = [{ name: 'backend-api' }, { name: 'frontend-ui' }]

const FULL = {
  what_it_does: 'Cho phép đăng nhập',
  what_you_get: 'Người dùng có phiên đăng nhập',
  how_it_works: 'Nhập email/mật khẩu, hệ thống xác thực, trả về phiên.',
  flow: {
    input: 'Người dùng nhập email + mật khẩu',
    steps: [
      { label: 'Xác thực thông tin', by: 'backend-api' },
      { label: 'Hiển thị màn hình chính', by: 'frontend-ui' },
    ],
    output: 'Người dùng vào được dashboard',
  },
}

describe('agentColor', () => {
  it('is deterministic for the same name', () => {
    expect(agentColor('backend-api')).toBe(agentColor('backend-api'))
  })
  it('returns a default color for empty name', () => {
    expect(typeof agentColor('')).toBe('string')
    expect(agentColor('')).toBe(agentColor(null))
  })
})

describe('buildFlowModel', () => {
  it('builds a full model with input + steps + output nodes', () => {
    const m = buildFlowModel(FULL, AGENTS)
    expect(m.visible).toBe(true)
    expect(m.hasFlow).toBe(true)
    expect(m.summary).toEqual({
      whatItDoes: 'Cho phép đăng nhập',
      whatYouGet: 'Người dùng có phiên đăng nhập',
      howItWorks: 'Nhập email/mật khẩu, hệ thống xác thực, trả về phiên.',
    })
    expect(m.nodes.map(n => n.kind)).toEqual(['input', 'step', 'step', 'output'])
    expect(m.nodes[1].agentName).toBe('backend-api')
    expect(m.nodes[1].color).toBe(agentColor('backend-api'))
    expect(m.edges).toEqual([{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }])
  })

  it('returns hasFlow=false when flow is missing but keeps summary', () => {
    const m = buildFlowModel({ what_it_does: 'X', what_you_get: '', how_it_works: '' }, AGENTS)
    expect(m.visible).toBe(true)
    expect(m.hasFlow).toBe(false)
    expect(m.summary.whatItDoes).toBe('X')
    expect(m.nodes).toEqual([])
  })

  it('keeps agentName but default color when agent is unknown', () => {
    const b = { flow: { input: 'A', steps: [{ label: 'B', by: 'ghost' }], output: 'C' } }
    const m = buildFlowModel(b, AGENTS)
    const step = m.nodes.find(n => n.kind === 'step')
    expect(step.agentName).toBe('ghost')
    expect(step.color).toBe(agentColor(''))
  })

  it('sets agentName null when step.by is missing', () => {
    const b = { flow: { input: 'A', steps: [{ label: 'B' }], output: 'C' } }
    const m = buildFlowModel(b, AGENTS)
    const step = m.nodes.find(n => n.kind === 'step')
    expect(step.agentName).toBe(null)
  })

  it('returns visible=false when business is absent', () => {
    expect(buildFlowModel(null, AGENTS).visible).toBe(false)
    expect(buildFlowModel(undefined, []).visible).toBe(false)
    expect(buildFlowModel({}, []).visible).toBe(false)
  })

  it('builds chain over only the nodes that exist (no input/output)', () => {
    const b = { flow: { steps: [{ label: 'Only step', by: 'backend-api' }] } }
    const m = buildFlowModel(b, AGENTS)
    expect(m.hasFlow).toBe(true)
    expect(m.nodes.map(n => n.kind)).toEqual(['step'])
    expect(m.edges).toEqual([])
  })
})
