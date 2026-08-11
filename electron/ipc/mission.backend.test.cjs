// electron/ipc/mission.backend.test.cjs
//
// Integration tests for the CLI-backend-aware spawn flow added to mission.cjs
// (spawnAgentProcess / resolveAdapter / agentBackendOf / killBackendProcess /
// normalizedEventToClaudeShape / the update_agent_backend IPC handler).
//
// Approach: mission.cjs registers all its IPC handlers via `ipcMain.handle`
// from the real `electron` module at `registerMission(getMainWindow)` time.
// Under Vitest (plain Node, no real Electron runtime) `require('electron')`
// does not resolve to the real API, so we `vi.mock('electron', ...)` with a
// minimal fake that records every `ipcMain.handle(channel, fn)` registration
// into a Map we can invoke directly — this exercises the REAL handler code
// (real spawnAgentProcess, real resolveAdapter, real adapter modules under
// electron/lib/cliAdapters/) with no guessed interfaces.
//
// The only other seam we fake is `cross-spawn`'s `spawn()` — both
// claudeAdapter.cjs and copilotAdapter.cjs (and mission.cjs's legacy
// fallback path) import `{ spawn } from 'cross-spawn'`, so mocking that one
// module intercepts every real subprocess launch and lets us hand back a
// deterministic fake ChildProcess (EventEmitter-based stdout/stderr/stdin),
// matching the pattern already used for qcQaRunner injection in
// electron/lib/qcqa.test.cjs (makeFakeProc).
//
// Structure: every test builds its own missionState via the real
// launch_mission handler (or __setMissionStateForTest for narrower unit-y
// checks), uses its own fake ChildProcess, and cleans up any real files it
// writes (mission snapshots land in a real ~/.claude/agent-teams-snapshots/
// dir — cleaned up in afterEach so tests never leak state). No shared
// module-level mutable fixtures between tests; deterministic; zero
// waitForTimeout (we don't use any wall-clock waits at all — either the
// EventEmitter-based fake process settles synchronously per `data`/`close`
// emit, or we use vi.useFakeTimers()+advanceTimersByTimeAsync for the one
// scenario that goes through a real setTimeout-based retry path).

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);

// ── Fake `electron` module ──────────────────────────────────────────────
// mission.cjs loads `electron` via a plain CJS `require('electron')` deep in
// its own module scope (`const { ipcMain, shell, dialog, BrowserWindow } =
// require('electron')`). Vitest's `vi.mock()` only intercepts modules loaded
// through its own transformed module graph — it does NOT intercept a plain
// Node `require()` obtained via `createRequire(import.meta.url)` (verified:
// `vi.mock('electron', ...)` left `require('electron')` resolving to the
// real electron shim, which under plain Node returns a path string, not
// `{ ipcMain, ... }`, causing `ipcMain.handle` to throw "Cannot read
// properties of undefined"). The reliable fix is to directly populate
// `require.cache` for electron's resolved absolute path with a fake module
// record BEFORE requiring mission.cjs, so Node's native CJS loader returns
// our fake `exports` object to mission.cjs's own `require('electron')` call.
//
// ipcMain.handle(channel, fn) records fn in a Map so tests can invoke real
// handlers directly. BrowserWindow / shell / dialog are unused by the
// scenarios below but stubbed so any incidental reference doesn't throw.
const ipcHandlers = new Map();
const ELECTRON_PATH = require.resolve('electron');
function installFakeElectron() {
  require.cache[ELECTRON_PATH] = {
    id: ELECTRON_PATH,
    filename: ELECTRON_PATH,
    loaded: true,
    exports: {
      ipcMain: {
        handle: (channel, fn) => { ipcHandlers.set(channel, fn); },
        on: () => {},
      },
      shell: { openExternal: async () => {}, openPath: async () => {} },
      dialog: { showSaveDialog: async () => ({ canceled: true }) },
      BrowserWindow: class FakeBrowserWindow {
        constructor() { this.webContents = { send: () => {}, printToPDF: async () => Buffer.from('') }; }
        loadURL() { return Promise.resolve(); }
        isDestroyed() { return false; }
      },
    },
  };
}

// ── Fake `cross-spawn` ───────────────────────────────────────────────────
// Every adapter.spawn() (Claude, Copilot) and the legacy fallback path in
// mission.cjs route through this single `spawn` import — also a plain CJS
// `require('cross-spawn')`, so the same require.cache-injection technique
// applies. We replace it with a spy that returns a fresh fake ChildProcess
// and records every (binary, args, options) call so tests can assert
// exactly what was spawned.
const spawnCalls = [];
let nextFakeProc = null; // test sets this right before triggering a spawn
const CROSS_SPAWN_PATH = require.resolve('cross-spawn');
function installFakeCrossSpawn() {
  require.cache[CROSS_SPAWN_PATH] = {
    id: CROSS_SPAWN_PATH,
    filename: CROSS_SPAWN_PATH,
    loaded: true,
    exports: {
      spawn: (...callArgs) => {
        spawnCalls.push(callArgs);
        return nextFakeProc || makeFakeProc();
      },
    },
  };
}

// Fresh-require mission.cjs (and the adapter modules it pulls in) with the
// fake electron/cross-spawn installed in require.cache, then register its
// IPC handlers against our fake ipcMain. Called from every beforeEach so
// each test gets an isolated module instance (module-level state like
// `missionState`/`childProcess` inside mission.cjs must not leak).
//
// IMPORTANT: registerMission's internal `sendToWindow` closure (used by
// e.g. answer_question's spawnAnswerAttempt) calls
// `getMainWindow().webContents.send(channel, data)` directly — it does NOT
// go through the module-level `sendToWindowRef` that `__setSendToWindowForTest`
// overrides (that ref is only consulted by code living outside registerMission's
// closure, like the QC/QA pipeline). So to observe real log messages emitted
// via the closure-local `sendToWindow`, we must supply a fake window whose
// `webContents.send` records into `windowSendCalls`.
const windowSendCalls = [];
function freshMission() {
  installFakeElectron();
  installFakeCrossSpawn();
  delete require.cache[require.resolve('./mission.cjs')];
  delete require.cache[require.resolve('../lib/cliAdapters/index.cjs')];
  delete require.cache[require.resolve('../lib/cliAdapters/claudeAdapter.cjs')];
  delete require.cache[require.resolve('../lib/cliAdapters/copilotAdapter.cjs')];
  const mission = require('./mission.cjs');
  mission.__setMissionStateForTest(null);
  spawnCalls.length = 0;
  nextFakeProc = null;
  windowSendCalls.length = 0;
  ipcHandlers.clear();
  const fakeWindow = {
    isDestroyed: () => false,
    webContents: { send: (channel, data) => { windowSendCalls.push([channel, data]); } },
  };
  mission(() => fakeWindow); // registerMission — populates ipcHandlers
  return mission;
}

// mission.cjs's stdout readers use `readline.createInterface({ input:
// proc.stdout })`, which requires a real Readable stream (readline calls
// stream methods like `.resume()`/`.pause()` that a plain EventEmitter
// doesn't have) — a plain EventEmitter (as used in electron/lib/qcqa.test.cjs,
// which only does proc.stdout.on('data', ...) directly) is NOT sufficient
// here. We use Node's real `stream.Readable` in object-less/paused mode and
// push lines through it.
function makeFakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new Readable({ read() {} });
  proc.stderr = new Readable({ read() {} });
  proc.stdin = { write: () => {}, end: () => {} };
  proc.pid = 9999;
  proc.kill = () => { proc.killed = true; };
  return proc;
}

/** Emit one stdout line (readline splits on \n). */
function emitLine(proc, line) {
  proc.stdout.push(line + '\n');
}

function closeProc(proc, code = 0) {
  proc.emit('close', code);
}

const SNAPSHOTS_DIR = path.join(os.homedir(), '.claude', 'agent-teams-snapshots');

function readSnapshot(missionId) {
  const p = path.join(SNAPSHOTS_DIR, `${missionId}.json`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function cleanupSnapshot(missionId) {
  try { fs.unlinkSync(path.join(SNAPSHOTS_DIR, `${missionId}.json`)); } catch (_) {}
}

// Minimal plan payload the Lead "outputs" to trigger applyPlanToState via the
// `=== MISSION PLAN ===` marker path (see tryParsePlanFromBuffer). This is
// the Claude stream-json shape (`type:'assistant'` + `message.content[]`).
function planStreamJsonLine(planObj, sessionId = 'sess-plan-1') {
  const planText = `=== MISSION PLAN ===\n${JSON.stringify(planObj)}\n=== END PLAN ===`;
  return JSON.stringify({
    type: 'assistant',
    session_id: sessionId,
    message: { content: [{ type: 'text', text: planText }] },
  });
}

// Same plan-marker payload but in Copilot's JSONL event shape
// (`assistant.message` / `data.content`) — see copilotAdapter.cjs parseLine.
// Using the Claude shape against a backend='copilot' mission gets dropped by
// copilotAdapter.parseLine (falls into `default: kind:'none'`), so any test
// driving a copilot-backend plan through the Lead's stdout MUST use this
// shape instead of planStreamJsonLine.
function planCopilotLine(planObj) {
  const planText = `=== MISSION PLAN ===\n${JSON.stringify(planObj)}\n=== END PLAN ===`;
  return JSON.stringify({ type: 'assistant.message', data: { content: planText } });
}

describe('spawnAgentProcess — backend routing (Given/When/Then)', () => {
  let mission;
  const missionIds = [];

  beforeEach(() => {
    mission = freshMission();
  });

  afterEach(() => {
    for (const id of missionIds.splice(0)) cleanupSnapshot(id);
    mission.__setMissionStateForTest(null);
  });

  test('Given backend mặc định (không truyền), When launch_mission, Then Claude adapter được chọn và args giống baseline', async () => {
    const proc = makeFakeProc();
    nextFakeProc = proc;

    const handler = ipcHandlers.get('launch_mission');
    expect(handler).toBeTypeOf('function');

    const resultPromise = handler(null, {
      projectPath: '/tmp/proj', prompt: 'Build a thing', description: 'demo',
      model: 'sonnet', executionMode: 'standard',
    });
    const state = await resultPromise;
    missionIds.push(state.id);

    expect(state.backend).toBe('claude');
    expect(state.agents[0].backend).toBe('claude');

    // spawnCalls[0] = [binary, args, opts] passed to cross-spawn's spawn()
    expect(spawnCalls.length).toBe(1);
    const [binary, args] = spawnCalls[0];
    expect(binary).toBe('claude');
    expect(args).toEqual([
      '-p', '--dangerously-skip-permissions', '--model', 'sonnet',
      '--output-format', 'stream-json', '--verbose',
    ]);

    closeProc(proc, 0);
  });

  test('Given backend=copilot, When launch_mission, Then binary + args từ CopilotAdapter được dùng và output text hiển thị', async () => {
    const proc = makeFakeProc();
    nextFakeProc = proc;

    const handler = ipcHandlers.get('launch_mission');
    const resultPromise = handler(null, {
      projectPath: '/tmp/proj', prompt: 'Build with copilot', description: 'demo',
      model: 'sonnet', executionMode: 'standard', backend: 'copilot',
    });
    const state = await resultPromise;
    missionIds.push(state.id);

    expect(state.backend).toBe('copilot');
    expect(state.agents[0].backend).toBe('copilot');

    expect(spawnCalls.length).toBe(1);
    const [binary, args] = spawnCalls[0];
    expect(binary).toBe('copilot');
    // Copilot's prompt travels via argv (-p <prompt>), not stdin.
    expect(args[0]).toBe('-p');
    expect(args[1]).toBe('Build with copilot' /* + no history section for a fresh launch */);
    expect(args).toContain('--allow-all-tools');
    expect(args).toContain('--no-ask-user');
    expect(args).toContain('--output-format');
    expect(args).toContain('json');
    expect(args).not.toContain('--resume');

    // Simulate Copilot emitting assistant.message text and verify it reaches
    // the renderer as a normalized Claude-shaped assistant text event via
    // normalizedEventToClaudeShape (mission:raw-line always fires; the
    // marker/plan-detection pipeline consumes the extracted text).
    emitLine(proc, JSON.stringify({
      type: 'assistant.message',
      data: { content: 'Xin chào từ Copilot CLI.', model: 'claude-sonnet-4.6' },
    }));

    // mission:raw-line fires unconditionally per line (Claude and Copilot
    // alike) — this is the "output text hiển thị" contract for the UI.
    await new Promise((r) => setImmediate(r));

    closeProc(proc, 0);
  });

  test('Given plan có agent backend=copilot còn lại claude, When spawn từng agent, Then mỗi agent dùng đúng adapter', async () => {
    const leadProc = makeFakeProc();
    nextFakeProc = leadProc;

    const handler = ipcHandlers.get('launch_mission');
    const state = await handler(null, {
      projectPath: '/tmp/proj', prompt: 'Build a team', description: 'demo',
      model: 'sonnet', executionMode: 'standard', backend: 'claude',
    });
    missionIds.push(state.id);
    spawnCalls.length = 0; // only care about post-plan spawns from here

    // Lead outputs a plan where one agent overrides to 'copilot'.
    const plan = {
      agents: [
        { name: 'Dev-Backend', role: 'Backend Dev', model: 'sonnet' },
        { name: 'Dev-Frontend', role: 'Frontend Dev', model: 'sonnet', backend: 'copilot' },
      ],
      tasks: [
        { id: 't1', title: 'Build API', assigned_agent: 'Dev-Backend' },
        { id: 't2', title: 'Build UI', assigned_agent: 'Dev-Frontend' },
      ],
    };
    emitLine(leadProc, planStreamJsonLine(plan));
    await new Promise((r) => setImmediate(r));

    const finalState = mission.__getMissionStateForTest();
    const backendDev = finalState.agents.find(a => a.name === 'Dev-Backend');
    const frontendDev = finalState.agents.find(a => a.name === 'Dev-Frontend');
    expect(backendDev.backend).toBe('claude');       // inherits mission-wide default
    expect(frontendDev.backend).toBe('copilot');      // explicit per-agent override

    closeProc(leadProc, 0);
  });

  test('Given mission backend=copilot (supportsResume=false), When answer_question resumes, Then fallback launch mới + log rõ ràng (không --resume)', async () => {
    // Drive resume through the REAL public entrypoint (answer_question),
    // which is one of spawnAgentProcess's actual call sites, rather than a
    // guessed internal test hook.
    //
    // NOTE: answer_question's spawnAnswerAttempt calls
    // `getMainWindow().webContents.send(channel, data)` directly through a
    // closure-local `sendToWindow` (mission.cjs ~3057-3068) — it does NOT go
    // through the module-level `sendToWindowRef` that `__setSendToWindowForTest`
    // overrides. So the real seam to observe 'mission:log' messages emitted
    // from this call path is `windowSendCalls` (populated by the fake
    // window's `webContents.send` — see freshMission() above), not a
    // `__setSendToWindowForTest` callback.
    mission.__setMissionStateForTest({
      id: 'mission-resume-copilot', backend: 'copilot', project_path: '/tmp/proj',
      status: 'WaitingForAnswer', session_id: 'some-session-id', phase: 'Planning',
      agents: [{ name: 'Lead', backend: 'copilot', model: 'sonnet' }],
      tasks: [], log: [], execution_mode: 'standard', _lastQuestions: [{ question: 'Which DB?' }],
    });

    const proc = makeFakeProc();
    nextFakeProc = proc;

    const handler = ipcHandlers.get('answer_question');
    expect(handler).toBeTypeOf('function');
    await handler(null, { answers: [{ question_index: 0, answer: 'Postgres' }] });

    // Copilot must NOT receive --resume / the stale session id.
    expect(spawnCalls.length).toBeGreaterThan(0);
    const [binary, args] = spawnCalls[spawnCalls.length - 1];
    expect(binary).toBe('copilot');
    expect(args).not.toContain('--resume');
    expect(args).not.toContain('some-session-id');

    // A clear, non-silent log entry must explain the fresh-launch fallback.
    const logMsgs = windowSendCalls
      .filter(([channel]) => channel === 'mission:log')
      .map(([, payload]) => payload.message);
    expect(logMsgs.some(m => /không hỗ trợ resume|resume/i.test(m))).toBe(true);

    closeProc(proc, 0);
  });

  test('Given mission backend=claude, When answer_question resumes, Then --resume vẫn dùng (không hồi quy)', async () => {
    mission.__setMissionStateForTest({
      id: 'mission-resume-claude', backend: 'claude', project_path: '/tmp/proj',
      status: 'WaitingForAnswer', session_id: 'S123', phase: 'Planning',
      agents: [{ name: 'Lead', backend: 'claude', model: 'sonnet' }],
      tasks: [], log: [], execution_mode: 'standard', _lastQuestions: [{ question: 'Which DB?' }],
    });
    mission.__setSendToWindowForTest(() => {});

    const proc = makeFakeProc();
    nextFakeProc = proc;

    const handler = ipcHandlers.get('answer_question');
    await handler(null, { answers: [{ question_index: 0, answer: 'Postgres' }] });

    expect(spawnCalls.length).toBeGreaterThan(0);
    const [binary, args] = spawnCalls[spawnCalls.length - 1];
    expect(binary).toBe('claude');
    expect(args).toEqual([
      '-p', '--resume', 'S123', '--dangerously-skip-permissions', '--model', 'sonnet',
      '--output-format', 'stream-json', '--verbose', '--max-turns', '200',
    ]);

    closeProc(proc, 0);
  });
});

describe('snapshot save/load — backend fields round-trip (Given/When/Then)', () => {
  let mission;
  const missionIds = [];

  beforeEach(() => {
    mission = freshMission();
  });

  afterEach(() => {
    for (const id of missionIds.splice(0)) cleanupSnapshot(id);
    mission.__setMissionStateForTest(null);
  });

  test('Given mission có backend=copilot + agent override, When plan-ready triggers a snapshot save, Then backend toàn cục + per-agent khôi phục đúng khi đọc lại file', async () => {
    const leadProc = makeFakeProc();
    nextFakeProc = leadProc;

    const handler = ipcHandlers.get('launch_mission');
    const state = await handler(null, {
      projectPath: '/tmp/proj', prompt: 'Build a team', description: 'demo',
      model: 'sonnet', executionMode: 'standard', backend: 'copilot',
    });
    missionIds.push(state.id);

    const plan = {
      agents: [
        { name: 'Dev-Backend', role: 'Backend Dev', model: 'sonnet' },       // inherits copilot
        { name: 'Dev-Frontend', role: 'Frontend Dev', model: 'sonnet', backend: 'claude' }, // override back to claude
      ],
      tasks: [{ id: 't1', title: 'Build API', assigned_agent: 'Dev-Backend' }],
    };
    // Mission backend is 'copilot' — the Lead's plan output must be emitted
    // in Copilot's JSONL event shape (assistant.message/data.content), not
    // Claude's, or copilotAdapter.parseLine drops the line (kind:'none') and
    // the plan marker is never detected.
    emitLine(leadProc, planCopilotLine(plan));
    await new Promise((r) => setImmediate(r));

    // applyPlanToState calls saveMissionSnapshot(missionState) as a milestone
    // save — read the real file back from disk (round-trip, not in-memory).
    const snap = readSnapshot(state.id);
    expect(snap.backend).toBe('copilot');
    expect(snap.agents.find(a => a.name === 'Dev-Backend').backend).toBe('copilot');
    expect(snap.agents.find(a => a.name === 'Dev-Frontend').backend).toBe('claude');

    closeProc(leadProc, 0);
  });
});

describe('update_agent_backend handler (Given/When/Then)', () => {
  let mission;

  beforeEach(() => {
    mission = freshMission();
  });

  afterEach(() => {
    mission.__setMissionStateForTest(null);
  });

  test('Given một agent với backend claude, When gọi update_agent_backend(copilot), Then agent.backend đổi thành copilot', async () => {
    mission.__setMissionStateForTest({
      id: 'm1', backend: 'claude',
      agents: [{ name: 'Dev-Backend', backend: 'claude' }],
      tasks: [], log: [],
    });

    const handler = ipcHandlers.get('update_agent_backend');
    expect(handler).toBeTypeOf('function');
    await handler(null, { agentName: 'Dev-Backend', backend: 'copilot' });

    const state = mission.__getMissionStateForTest();
    expect(state.agents.find(a => a.name === 'Dev-Backend').backend).toBe('copilot');
  });

  test('Given backend rỗng/undefined, When update_agent_backend, Then fallback về mission-wide backend', async () => {
    mission.__setMissionStateForTest({
      id: 'm1', backend: 'copilot',
      agents: [{ name: 'Dev-Backend', backend: 'claude' }],
      tasks: [], log: [],
    });

    const handler = ipcHandlers.get('update_agent_backend');
    await handler(null, { agentName: 'Dev-Backend', backend: undefined });

    const state = mission.__getMissionStateForTest();
    expect(state.agents.find(a => a.name === 'Dev-Backend').backend).toBe('copilot');
  });

  test('Given agentName không tồn tại, When update_agent_backend, Then không throw và state không đổi', async () => {
    const initialState = {
      id: 'm1', backend: 'claude',
      agents: [{ name: 'Dev-Backend', backend: 'claude' }],
      tasks: [], log: [],
    };
    mission.__setMissionStateForTest(initialState);

    const handler = ipcHandlers.get('update_agent_backend');
    await expect(handler(null, { agentName: 'Nope', backend: 'copilot' })).resolves.not.toThrow();

    const state = mission.__getMissionStateForTest();
    expect(state.agents[0].backend).toBe('claude');
  });

  test('there is exactly ONE update_agent_backend handler registered', () => {
    // ipcHandlers is a Map keyed by channel name — ipcMain.handle throws on a
    // duplicate registration in real Electron, but a silent second
    // registerMission() call (or a stray duplicate handler block) would
    // simply overwrite the entry here without failing. Assert the module
    // only calls ipcMain.handle('update_agent_backend', ...) once by
    // counting occurrences in the source text as a structural guard.
    const src = fs.readFileSync(require.resolve('./mission.cjs'), 'utf8');
    const matches = src.match(/ipcMain\.handle\(\s*['"]update_agent_backend['"]/g) || [];
    expect(matches.length).toBe(1);
  });
});

describe('Claude regression guard — no behavioral change for backend=claude', () => {
  let mission;
  const missionIds = [];

  beforeEach(() => {
    mission = freshMission();
  });

  afterEach(() => {
    for (const id of missionIds.splice(0)) cleanupSnapshot(id);
    mission.__setMissionStateForTest(null);
  });

  test('omitting backend entirely produces the exact same argv as explicit backend="claude"', async () => {
    const procA = makeFakeProc();
    nextFakeProc = procA;
    const handler = ipcHandlers.get('launch_mission');

    const stateA = await handler(null, {
      projectPath: '/tmp/proj', prompt: 'p', description: 'd', model: 'sonnet', executionMode: 'standard',
    });
    missionIds.push(stateA.id);
    const argsNoBackend = spawnCalls[spawnCalls.length - 1][1];
    closeProc(procA, 0);

    const procB = makeFakeProc();
    nextFakeProc = procB;
    const stateB = await handler(null, {
      projectPath: '/tmp/proj', prompt: 'p', description: 'd', model: 'sonnet', executionMode: 'standard',
      backend: 'claude',
    });
    missionIds.push(stateB.id);
    const argsExplicitClaude = spawnCalls[spawnCalls.length - 1][1];
    closeProc(procB, 0);

    expect(argsNoBackend).toEqual(argsExplicitClaude);
    expect(argsNoBackend).toEqual([
      '-p', '--dangerously-skip-permissions', '--model', 'sonnet',
      '--output-format', 'stream-json', '--verbose',
    ]);
  });

  test('prompt is still written to stdin (not argv) for Claude', async () => {
    const proc = makeFakeProc();
    const writeSpy = vi.spyOn(proc.stdin, 'write');
    nextFakeProc = proc;

    const handler = ipcHandlers.get('launch_mission');
    const state = await handler(null, {
      projectPath: '/tmp/proj', prompt: 'secret prompt text', description: 'd',
      model: 'sonnet', executionMode: 'standard',
    });
    missionIds.push(state.id);

    expect(writeSpy).toHaveBeenCalledWith('secret prompt text', 'utf8');
    const [, args] = spawnCalls[spawnCalls.length - 1];
    expect(args.join(' ')).not.toContain('secret prompt text');

    closeProc(proc, 0);
  });
});

describe('qcQaSpawnOpts — parseLine wiring (Given/When/Then)', () => {
  let mission;

  beforeEach(() => {
    mission = freshMission();
  });

  afterEach(() => {
    mission.__setMissionStateForTest(null);
  });

  test('Given backend=claude, When qcQaSpawnOpts is built, Then parseLine matches claudeAdapter.parseLine output', () => {
    mission.__setMissionStateForTest({ backend: 'claude' });
    const opts = mission.__qcQaSpawnOptsForTest();

    expect(typeof opts.parseLine).toBe('function');
    const claudeAdapter = require('../lib/cliAdapters/claudeAdapter.cjs');
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } });
    expect(opts.parseLine(line)).toEqual(claudeAdapter.parseLine(line));
  });

  test('Given backend=copilot, When qcQaSpawnOpts is built, Then parseLine matches copilotAdapter.parseLine output', () => {
    mission.__setMissionStateForTest({ backend: 'copilot' });
    const opts = mission.__qcQaSpawnOptsForTest();

    expect(typeof opts.parseLine).toBe('function');
    const copilotAdapter = require('../lib/cliAdapters/copilotAdapter.cjs');
    const line = JSON.stringify({ type: 'assistant.message', data: { content: 'hello' } });
    expect(opts.parseLine(line)).toEqual(copilotAdapter.parseLine(line));
  });

  test('Given no missionState, When qcQaSpawnOpts is built, Then it defaults to backend=claude with a working parseLine', () => {
    mission.__setMissionStateForTest(null);
    const opts = mission.__qcQaSpawnOptsForTest();

    expect(opts.backend).toBe('claude');
    expect(typeof opts.parseLine).toBe('function');
    const claudeAdapter = require('../lib/cliAdapters/claudeAdapter.cjs');
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } });
    expect(opts.parseLine(line)).toEqual(claudeAdapter.parseLine(line));
  });
});
