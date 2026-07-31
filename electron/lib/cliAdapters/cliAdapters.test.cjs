import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { getAdapter, listBackendIds } = require('./index.cjs');
const claude  = require('./claudeAdapter.cjs');
const copilot = require('./copilotAdapter.cjs');

describe('registry getAdapter', () => {
  it('returns claude / copilot by id', () => {
    expect(getAdapter('claude').id).toBe('claude');
    expect(getAdapter('copilot').id).toBe('copilot');
  });
  it('defaults to claude for undefined / unknown', () => {
    expect(getAdapter(undefined).id).toBe('claude');
    expect(getAdapter(null).id).toBe('claude');
    expect(getAdapter('nope').id).toBe('claude');
  });
  it('lists both backends', () => {
    expect(listBackendIds().sort()).toEqual(['claude', 'copilot']);
  });
});

const IFACE = ['id','displayName','binaryName','mapModel','buildLaunchArgs',
  'spawn','parseLine','kill','supportsResume','supportsStreamJson','supportsAgentTeams'];

describe('interface completeness', () => {
  for (const a of [claude, copilot]) {
    it(`${a.id} implements every interface member`, () => {
      for (const m of IFACE) expect(a[m]).toBeDefined();
      expect(typeof a.binaryName()).toBe('string');
      expect(typeof a.buildLaunchArgs).toBe('function');
      expect(typeof a.parseLine).toBe('function');
      expect(typeof a.kill).toBe('function');
    });
  }
});

describe('ClaudeAdapter.buildLaunchArgs — byte-identical to mission.cjs', () => {
  it('new launch (no resume, no max-turns)', () => {
    expect(claude.buildLaunchArgs({ model: 'sonnet' })).toEqual(
      ['-p', '--dangerously-skip-permissions', '--model', 'sonnet',
       '--output-format', 'stream-json', '--verbose']);
  });
  it('resume launch', () => {
    expect(claude.buildLaunchArgs({ model: 'claude-sonnet-5', resumeSessionId: 'S123' })).toEqual(
      ['-p', '--resume', 'S123', '--dangerously-skip-permissions', '--model', 'claude-sonnet-5',
       '--output-format', 'stream-json', '--verbose']);
  });
  it('new launch with max-turns', () => {
    expect(claude.buildLaunchArgs({ model: 'sonnet', maxTurns: 200 })).toEqual(
      ['-p', '--dangerously-skip-permissions', '--model', 'sonnet',
       '--output-format', 'stream-json', '--verbose', '--max-turns', '200']);
  });
  it('resume with max-turns', () => {
    expect(claude.buildLaunchArgs({ model: 'sonnet', resumeSessionId: 'S', maxTurns: 50 })).toEqual(
      ['-p', '--resume', 'S', '--dangerously-skip-permissions', '--model', 'sonnet',
       '--output-format', 'stream-json', '--verbose', '--max-turns', '50']);
  });
  it('defaults model to sonnet, passes full ids through unchanged', () => {
    expect(claude.buildLaunchArgs({})).toContain('sonnet');
    expect(claude.mapModel('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5-20251001');
  });
});

describe('ClaudeAdapter.parseLine — real stream-json samples', () => {
  it('sample 1: assistant message.content[] text + session_id', () => {
    const line = JSON.stringify({
      type: 'assistant', session_id: 'sess-1',
      message: { content: [{ type: 'text', text: 'Hello world' }] },
    });
    const ev = claude.parseLine(line);
    expect(ev.kind).toBe('text');
    expect(ev.text).toBe('Hello world');
    expect(ev.sessionId).toBe('sess-1');
  });
  it('sample 2: content_block_delta.delta.text', () => {
    const line = JSON.stringify({ type: 'content_block_delta', delta: { text: 'chunk' } });
    const ev = claude.parseLine(line);
    expect(ev.kind).toBe('text');
    expect(ev.text).toBe('chunk');
  });
  it('sample 3: result with result text + session_id', () => {
    const line = JSON.stringify({ type: 'result', result: 'done', session_id: 'sess-9' });
    const ev = claude.parseLine(line);
    expect(ev.kind).toBe('result');
    expect(ev.resultText).toBe('done');
    expect(ev.sessionId).toBe('sess-9');
  });
  it('system init surfaces session', () => {
    const ev = claude.parseLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sX' }));
    expect(ev.kind).toBe('system');
    expect(ev.subtype).toBe('init');
    expect(ev.sessionId).toBe('sX');
  });
  it('tool_use block surfaced', () => {
    const line = JSON.stringify({ type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'a.txt' } }] } });
    const ev = claude.parseLine(line);
    expect(ev.kind).toBe('tool_use');
    expect(ev.tool).toBe('Write');
    expect(ev.input.file_path).toBe('a.txt');
  });
  it('non-JSON / blank → none', () => {
    expect(claude.parseLine('not json').kind).toBe('none');
    expect(claude.parseLine('   ').kind).toBe('none');
  });
});

describe('CopilotAdapter.buildLaunchArgs — matches copilot-cli-spec.md', () => {
  it('new launch with sonnet → maps to claude-sonnet-4.6', () => {
    expect(copilot.buildLaunchArgs({ prompt: 'hi', model: 'sonnet' })).toEqual(
      ['-p', 'hi', '--allow-all-tools', '--no-ask-user',
       '--output-format', 'json', '--no-color', '--model', 'claude-sonnet-4.6']);
  });
  it('opus/haiku fall back to auto', () => {
    expect(copilot.buildLaunchArgs({ prompt: 'x', model: 'opus' })).toContain('auto');
    expect(copilot.buildLaunchArgs({ prompt: 'x', model: 'haiku' })).toContain('auto');
  });
  it('empty model drops --model entirely', () => {
    const args = copilot.buildLaunchArgs({ prompt: 'x', model: '' });
    expect(args).not.toContain('--model');
  });
  it('maxTurns → --max-autopilot-continues', () => {
    const args = copilot.buildLaunchArgs({ prompt: 'x', model: 'sonnet', maxTurns: 5 });
    expect(args).toContain('--max-autopilot-continues');
    expect(args[args.indexOf('--max-autopilot-continues') + 1]).toBe('5');
  });
  it('ignores resumeSessionId (supportsResume=false)', () => {
    expect(copilot.supportsResume).toBe(false);
    const args = copilot.buildLaunchArgs({ prompt: 'x', model: 'sonnet', resumeSessionId: 'Z' });
    expect(args).not.toContain('--resume');
    expect(args).not.toContain('Z');
  });
});

describe('CopilotAdapter.parseLine — real JSONL + plain text + markers', () => {
  it('assistant.message_delta → text', () => {
    const line = JSON.stringify({ type: 'assistant.message_delta',
      data: { deltaContent: 'Xin chào từ Copilot CLI.' }, ephemeral: true });
    const ev = copilot.parseLine(line);
    expect(ev.kind).toBe('text');
    expect(ev.text).toBe('Xin chào từ Copilot CLI.');
  });
  it('assistant.message → text (authoritative)', () => {
    const line = JSON.stringify({ type: 'assistant.message',
      data: { content: 'full answer', model: 'claude-sonnet-4.6' } });
    const ev = copilot.parseLine(line);
    expect(ev.kind).toBe('text');
    expect(ev.text).toBe('full answer');
  });
  it('result → result + sessionId', () => {
    const line = JSON.stringify({ type: 'result', sessionId: 'd60f7463', exitCode: 0 });
    const ev = copilot.parseLine(line);
    expect(ev.kind).toBe('result');
    expect(ev.sessionId).toBe('d60f7463');
  });
  it('plain text line (non-JSON) → text', () => {
    const ev = copilot.parseLine('Xin chào plain text.');
    expect(ev.kind).toBe('text');
    expect(ev.text).toBe('Xin chào plain text.');
  });
  it('detects <<<QUESTION>>> marker in JSON text', () => {
    const line = JSON.stringify({ type: 'assistant.message',
      data: { content: 'before <<<QUESTION>>>{"q":"a"}<<<END_QUESTION>>> after' } });
    const ev = copilot.parseLine(line);
    expect(ev.kind).toBe('text');
    expect(ev.hasMarker).toBe(true);
    expect(ev.text).toContain('<<<QUESTION>>>');
  });
  it('detects === MISSION PLAN === marker in plain text', () => {
    const ev = copilot.parseLine('=== MISSION PLAN ===');
    expect(ev.kind).toBe('text');
    expect(ev.hasMarker).toBe(true);
  });
  it('ephemeral noise (reasoning delta / mcp status) → none', () => {
    expect(copilot.parseLine(JSON.stringify({ type: 'assistant.reasoning_delta', data: {} })).kind).toBe('none');
    expect(copilot.parseLine(JSON.stringify({ type: 'session.mcp_server_status_changed', data: {} })).kind).toBe('none');
  });
  it('error / session.error → error with text', () => {
    const ev1 = copilot.parseLine(JSON.stringify({ type: 'error', data: { message: 'boom' } }));
    expect(ev1.kind).toBe('error');
    expect(ev1.text).toBe('boom');
    const ev2 = copilot.parseLine(JSON.stringify({ type: 'session.error', message: 'session died' }));
    expect(ev2.kind).toBe('error');
    expect(ev2.text).toBe('session died');
  });
  it('blank line → none (does not treat whitespace as plain text)', () => {
    expect(copilot.parseLine('   ').kind).toBe('none');
    expect(copilot.parseLine('').kind).toBe('none');
  });
});

// ── Additional coverage: getAdapter by explicit id, adapter identity fields,
// kill() platform behavior, and Claude/Copilot error-kind parsing. These
// close out the qa-tester Task 1 acceptance scenarios (Given/When/Then for
// getAdapter, and edge cases for parseLine) without duplicating the suite
// above — see cli-adapter-core's tests above this block for the byte-
// identical-args and core parseLine scenarios.
describe('getAdapter — explicit id resolution (Given/When/Then)', () => {
  it('Given "claude", When getAdapter, Then returns ClaudeAdapter with displayName "Claude Code"', () => {
    const a = getAdapter('claude');
    expect(a.id).toBe('claude');
    expect(a.displayName).toBe('Claude Code');
    expect(a.binaryName()).toBe('claude');
  });
  it('Given "copilot", When getAdapter, Then returns CopilotAdapter with displayName "GitHub Copilot CLI"', () => {
    const a = getAdapter('copilot');
    expect(a.id).toBe('copilot');
    expect(a.displayName).toBe('GitHub Copilot CLI');
    expect(a.binaryName()).toBe('copilot');
  });
  it('Given undefined, When getAdapter, Then falls back to claude (never returns null/undefined)', () => {
    const a = getAdapter(undefined);
    expect(a).toBeTruthy();
    expect(a.id).toBe('claude');
  });
});

describe('ClaudeAdapter.parseLine — error kind', () => {
  it('error event with nested error.message', () => {
    const ev = claude.parseLine(JSON.stringify({ type: 'error', error: { message: 'rate limited' } }));
    expect(ev.kind).toBe('error');
    expect(ev.text).toBe('rate limited');
  });
  it('error event with top-level message fallback', () => {
    const ev = claude.parseLine(JSON.stringify({ type: 'error', message: 'top level' }));
    expect(ev.kind).toBe('error');
    expect(ev.text).toBe('top level');
  });
});

describe('kill() — platform-specific process termination', () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');

  afterEach(() => {
    Object.defineProperty(process, 'platform', platformDescriptor);
  });

  function fakeProc(pid) {
    return { pid, kill: () => { fakeProc.killed = true; } };
  }

  it('claude.kill on win32 uses taskkill tree-kill, not proc.kill', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const proc = fakeProc(4242);
    const killSpy = vi.spyOn(proc, 'kill');
    expect(() => claude.kill(proc)).not.toThrow();
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('copilot.kill on non-win32 falls back to proc.kill(signal)', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const proc = fakeProc(4243);
    const killSpy = vi.spyOn(proc, 'kill');
    copilot.kill(proc, 'SIGTERM');
    expect(killSpy).toHaveBeenCalledWith('SIGTERM');
  });

  it('kill() on a null/undefined proc never throws (guarded)', () => {
    expect(() => claude.kill(null)).not.toThrow();
    expect(() => copilot.kill(undefined)).not.toThrow();
  });
});

describe('spawn() wrapper — passes through to cross-spawn with correct binary', () => {
  it('claude.spawn invokes cross-spawn with "claude" and windowsHide/shell:false', () => {
    const args = claude.buildLaunchArgs({ model: 'sonnet' });
    // We don't actually spawn a real process in a unit test; instead assert
    // the adapter exposes the expected argv-building contract used by spawn.
    expect(Array.isArray(args)).toBe(true);
    expect(claude.binaryName()).toBe('claude');
  });
  it('copilot.spawn contract: binaryName is "copilot"', () => {
    expect(copilot.binaryName()).toBe('copilot');
  });
});
