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

const { EventEmitter } = require('events');
const { runQcQaCheck } = require('./qcqa.cjs');
const claudeAdapter = require('./cliAdapters/claudeAdapter.cjs');
const copilotAdapter = require('./cliAdapters/copilotAdapter.cjs');

function makeFakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = () => { proc.killed = true; };
  return proc;
}

/** One real-shaped Claude stream-json JSONL line carrying `text` as the assistant's message. */
function claudeTextLine(text) {
  return JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
}

describe('runQcQaCheck', () => {
  test('resolves PASS from a real stream-json PASS verdict line', async () => {
    const fakeProc = makeFakeProc();
    const spawnClaude = () => fakeProc;

    const resultPromise = runQcQaCheck({
      spawnClaude, parseLine: claudeAdapter.parseLine,
      prompt: 'check task X', projectPath: '/tmp/proj',
      model: 'claude-sonnet-5', stage: 'QC', timeoutMs: 5000,
    });

    fakeProc.stdout.emit('data', Buffer.from(claudeTextLine('[QC] VERDICT: PASS') + '\n'));
    fakeProc.emit('close', 0);

    await expect(resultPromise).resolves.toEqual({ verdict: 'PASS' });
  });

  test('resolves FAIL with responsible agent and reason from a real stream-json FAIL verdict', async () => {
    const fakeProc = makeFakeProc();
    const spawnClaude = () => fakeProc;

    const resultPromise = runQcQaCheck({
      spawnClaude, parseLine: claudeAdapter.parseLine,
      prompt: 'check task X', projectPath: '/tmp/proj',
      model: 'claude-sonnet-5', stage: 'QC', timeoutMs: 5000,
    });

    const text = '[QC] VERDICT: FAIL\n[QC] RESPONSIBLE_AGENT: Dev\n[QC] REASON: build broken';
    fakeProc.stdout.emit('data', Buffer.from(claudeTextLine(text) + '\n'));
    fakeProc.emit('close', 0);

    await expect(resultPromise).resolves.toEqual({
      verdict: 'FAIL', responsibleAgent: 'Dev', reason: 'build broken',
    });
  });

  test('resolves FAIL on timeout without waiting for close', async () => {
    const fakeProc = makeFakeProc();
    const spawnClaude = () => fakeProc;

    const resultPromise = runQcQaCheck({
      spawnClaude, parseLine: claudeAdapter.parseLine,
      prompt: 'check task X', projectPath: '/tmp/proj',
      model: 'claude-sonnet-5', stage: 'QC', timeoutMs: 10,
    });

    const result = await resultPromise;
    expect(result.verdict).toBe('FAIL');
    expect(result.reason).toMatch(/timed out/i);
    expect(fakeProc.killed).toBe(true);
  });

  test('resolves FAIL when the subprocess emits an error instead of closing', async () => {
    const fakeProc = makeFakeProc();
    const spawnClaude = () => fakeProc;

    const resultPromise = runQcQaCheck({
      spawnClaude, parseLine: claudeAdapter.parseLine,
      prompt: 'check task X', projectPath: '/tmp/proj',
      model: 'claude-sonnet-5', stage: 'QC', timeoutMs: 5000,
    });

    fakeProc.emit('error', new Error('spawn ENOENT'));

    await expect(resultPromise).resolves.toEqual({
      verdict: 'FAIL',
      responsibleAgent: null,
      reason: 'QC/QA process error: spawn ENOENT',
    });
  });

  test('an error emitted after close is ignored (no double-resolve)', async () => {
    const fakeProc = makeFakeProc();
    const spawnClaude = () => fakeProc;

    const resultPromise = runQcQaCheck({
      spawnClaude, parseLine: claudeAdapter.parseLine,
      prompt: 'check task X', projectPath: '/tmp/proj',
      model: 'claude-sonnet-5', stage: 'QC', timeoutMs: 5000,
    });

    fakeProc.stdout.emit('data', Buffer.from(claudeTextLine('[QC] VERDICT: PASS') + '\n'));
    fakeProc.emit('close', 0);
    // Emitting 'error' after 'close' must not throw or change the already-resolved result.
    expect(() => fakeProc.emit('error', new Error('late error'))).not.toThrow();

    await expect(resultPromise).resolves.toEqual({ verdict: 'PASS' });
  });

  test('a tool_use turn before the verdict text does not clobber the extracted verdict', async () => {
    const fakeProc = makeFakeProc();
    const spawnClaude = () => fakeProc;

    const resultPromise = runQcQaCheck({
      spawnClaude, parseLine: claudeAdapter.parseLine,
      prompt: 'check task X', projectPath: '/tmp/proj',
      model: 'claude-sonnet-5', stage: 'QC', timeoutMs: 5000,
    });

    const toolUseLine = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] },
    });
    fakeProc.stdout.emit('data', Buffer.from(toolUseLine + '\n'));
    fakeProc.stdout.emit('data', Buffer.from(claudeTextLine('[QC] VERDICT: PASS') + '\n'));
    fakeProc.emit('close', 0);

    await expect(resultPromise).resolves.toEqual({ verdict: 'PASS' });
  });

  test('ignores content_block_delta fragments appearing after the complete assistant message', async () => {
    const fakeProc = makeFakeProc();
    const spawnClaude = () => fakeProc;

    const resultPromise = runQcQaCheck({
      spawnClaude, parseLine: claudeAdapter.parseLine,
      prompt: 'check task X', projectPath: '/tmp/proj',
      model: 'claude-sonnet-5', stage: 'QC', timeoutMs: 5000,
    });

    // Complete assistant message with the verdict.
    const completeLine = claudeTextLine('[QC] VERDICT: PASS');
    // A trailing delta fragment that does NOT contain the verdict (simulating
    // a message stream that was interrupted or incomplete). If the old logic
    // were in place (tracking ANY kind:'text'), this would clobber the verdict.
    const deltaLine = JSON.stringify({
      type: 'content_block_delta',
      delta: { text: 'some trailing text' },
    });
    fakeProc.stdout.emit('data', Buffer.from(completeLine + '\n'));
    fakeProc.stdout.emit('data', Buffer.from(deltaLine + '\n'));
    fakeProc.emit('close', 0);

    // Should resolve PASS because the extraction correctly restricted
    // to the complete message, not the trailing delta.
    await expect(resultPromise).resolves.toEqual({ verdict: 'PASS' });
  });

  test('extracts the verdict from real Copilot stream-json shape (delta then full message)', async () => {
    const fakeProc = makeFakeProc();
    const spawnClaude = () => fakeProc;

    const resultPromise = runQcQaCheck({
      spawnClaude, parseLine: copilotAdapter.parseLine,
      prompt: 'check task X', projectPath: '/tmp/proj',
      model: 'claude-sonnet-5', stage: 'QA', timeoutMs: 5000,
    });

    const deltaLine = JSON.stringify({
      type: 'assistant.message_delta',
      data: { messageId: 'm1', deltaContent: '[QA] VERDICT: P' },
    });
    const fullLine = JSON.stringify({
      type: 'assistant.message',
      data: { messageId: 'm1', model: 'claude-sonnet-4.6', content: '[QA] VERDICT: PASS', toolRequests: [], turnId: '0' },
    });
    fakeProc.stdout.emit('data', Buffer.from(deltaLine + '\n'));
    fakeProc.stdout.emit('data', Buffer.from(fullLine + '\n'));
    fakeProc.emit('close', 0);

    await expect(resultPromise).resolves.toEqual({ verdict: 'PASS' });
  });

  test('resolves FAIL with default reason when no spawn function is provided', async () => {
    const result = await runQcQaCheck({
      prompt: 'check task X', projectPath: '/tmp/proj',
      model: 'claude-sonnet-5', stage: 'QC', timeoutMs: 5000,
    });
    expect(result).toEqual({
      verdict: 'FAIL', responsibleAgent: null, reason: 'No spawn function provided for QC/QA',
    });
  });
});
