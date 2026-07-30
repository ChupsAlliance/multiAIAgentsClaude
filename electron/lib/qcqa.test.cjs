import { describe, test, expect } from 'vitest'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { parseQcQaVerdict } = require('./qcqa.cjs')

describe('parseQcQaVerdict', () => {
  test('parses a PASS verdict', () => {
    const stdout = 'some build log\n[QC] VERDICT: PASS\nmore log\n'
    expect(parseQcQaVerdict(stdout, 'QC')).toEqual({ verdict: 'PASS' })
  })

  test('parses a FAIL verdict with responsible agent and reason', () => {
    const stdout = [
      'running tests...',
      '[QC] VERDICT: FAIL',
      '[QC] RESPONSIBLE_AGENT: Dev-Backend',
      '[QC] REASON: npm run build exited with code 1: missing semicolon at src/index.js:12',
    ].join('\n')
    expect(parseQcQaVerdict(stdout, 'QC')).toEqual({
      verdict: 'FAIL',
      responsibleAgent: 'Dev-Backend',
      reason: 'npm run build exited with code 1: missing semicolon at src/index.js:12',
    })
  })

  test('QA prefix does not match QC lines', () => {
    const stdout = '[QC] VERDICT: PASS\n'
    expect(parseQcQaVerdict(stdout, 'QA')).toEqual({
      verdict: 'FAIL',
      responsibleAgent: null,
      reason: 'No verdict line found in QC/QA output',
    })
  })

  test('missing verdict line defaults to FAIL, not silent PASS', () => {
    const stdout = 'agent rambled without ever printing a verdict\n'
    expect(parseQcQaVerdict(stdout, 'QC')).toEqual({
      verdict: 'FAIL',
      responsibleAgent: null,
      reason: 'No verdict line found in QC/QA output',
    })
  })

  test('REASON line can contain colons', () => {
    const stdout = [
      '[QA] VERDICT: FAIL',
      '[QA] RESPONSIBLE_AGENT: Dev-Frontend',
      '[QA] REASON: Task required: email validation, but no validation code exists.',
    ].join('\n')
    expect(parseQcQaVerdict(stdout, 'QA')).toEqual({
      verdict: 'FAIL',
      responsibleAgent: 'Dev-Frontend',
      reason: 'Task required: email validation, but no validation code exists.',
    })
  })
})

const { nextEscalationTier } = require('./qcqa.cjs')

describe('nextEscalationTier', () => {
  test('rounds 1-2 retry with the same agent', () => {
    expect(nextEscalationTier(1)).toEqual({ tier: 'retry-same' })
    expect(nextEscalationTier(2)).toEqual({ tier: 'retry-same' })
  })

  test('rounds 3-8 escalate to a fresh agent/stronger model', () => {
    for (let round = 3; round <= 8; round++) {
      expect(nextEscalationTier(round)).toEqual({ tier: 'retry-fresh' })
    }
  })

  test('round 9 and beyond hits the safety ceiling', () => {
    expect(nextEscalationTier(9)).toEqual({ tier: 'needs-attention' })
    expect(nextEscalationTier(10)).toEqual({ tier: 'needs-attention' })
  })
})

const { EventEmitter } = require('events')
const { runQcQaCheck } = require('./qcqa.cjs')

function makeFakeProc() {
  const proc = new EventEmitter()
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.kill = () => { proc.killed = true }
  return proc
}

describe('runQcQaCheck', () => {
  test('resolves PASS when the subprocess prints a PASS verdict', async () => {
    const fakeProc = makeFakeProc()
    const spawnClaude = () => fakeProc

    const resultPromise = runQcQaCheck({
      spawnClaude, prompt: 'check task X', projectPath: '/tmp/proj',
      model: 'claude-sonnet-5', stage: 'QC', timeoutMs: 5000,
    })

    fakeProc.stdout.emit('data', Buffer.from('[QC] VERDICT: PASS\n'))
    fakeProc.emit('close', 0)

    await expect(resultPromise).resolves.toEqual({ verdict: 'PASS' })
  })

  test('resolves FAIL with responsible agent when the subprocess prints a FAIL verdict', async () => {
    const fakeProc = makeFakeProc()
    const spawnClaude = () => fakeProc

    const resultPromise = runQcQaCheck({
      spawnClaude, prompt: 'check task X', projectPath: '/tmp/proj',
      model: 'claude-sonnet-5', stage: 'QC', timeoutMs: 5000,
    })

    fakeProc.stdout.emit('data', Buffer.from(
      '[QC] VERDICT: FAIL\n[QC] RESPONSIBLE_AGENT: Dev\n[QC] REASON: build broken\n'))
    fakeProc.emit('close', 0)

    await expect(resultPromise).resolves.toEqual({
      verdict: 'FAIL', responsibleAgent: 'Dev', reason: 'build broken',
    })
  })

  test('resolves FAIL on timeout without waiting for close', async () => {
    const fakeProc = makeFakeProc()
    const spawnClaude = () => fakeProc

    const resultPromise = runQcQaCheck({
      spawnClaude, prompt: 'check task X', projectPath: '/tmp/proj',
      model: 'claude-sonnet-5', stage: 'QC', timeoutMs: 10,
    })

    const result = await resultPromise
    expect(result.verdict).toBe('FAIL')
    expect(result.reason).toMatch(/timed out/i)
    expect(fakeProc.killed).toBe(true)
  })
})
