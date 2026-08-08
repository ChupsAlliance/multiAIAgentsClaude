// electron/ipc/mission.retryTimerCancel.test.cjs
//
// Regression tests for Critical issue #1
// (docs/critical-issues-review-2026-08-08.md): the four
// `setTimeout(() => retrySpawn(...), delay)` retry-scheduling call sites in
// mission.cjs never stored their timer handle, so stop_mission/reset_mission
// had nothing to cancel — a pending retry would still fire after the user
// stopped/reset the mission (crash on reset, silent respawn on stop).
// See docs/superpowers/specs/2026-08-08-retry-timer-cancel-on-stop-design.md.
//
// Harness: same require.cache-injection technique as mission.backend.test.cjs
// (fakes `electron`'s ipcMain.handle to record handlers into a Map, fakes
// `cross-spawn` to return a deterministic fake ChildProcess). Duplicated here
// rather than imported — mission.backend.test.cjs's harness functions are
// module-local, matching the existing convention of each mission.*.test.cjs
// file owning its own harness.

import { describe, test, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { EventEmitter } from 'events';
import { Readable } from 'stream';

const require = createRequire(import.meta.url);

// ── Fake `electron` ───────────────────────────────────────────────────────
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
const spawnCalls = [];
let nextFakeProc = null;
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

function makeFakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new Readable({ read() {} });
  proc.stderr = new Readable({ read() {} });
  proc.stdin = { write: () => {}, end: () => {} };
  proc.pid = 9999;
  proc.kill = () => { proc.killed = true; };
  return proc;
}

function emitLine(proc, line) { proc.stdout.push(line + '\n'); }
function emitErrLine(proc, line) { proc.stderr.push(line + '\n'); }
function closeProc(proc, code = 0) { proc.emit('close', code); }
function flush() { return new Promise((r) => setImmediate(r)); }

describe('pendingRetryTimer — core wiring (Task 1)', () => {
  let mission;

  beforeEach(() => {
    mission = freshMission();
  });

  test('stop_mission clears a pending retry timer', async () => {
    const fakeHandle = setTimeout(() => {}, 100_000);
    mission.__setPendingRetryTimerForTest(fakeHandle);

    await ipcHandlers.get('stop_mission')();

    expect(mission.__getPendingRetryTimerForTest()).toBeNull();
    clearTimeout(fakeHandle); // safety net in case the assertion above ever fails
  });

  test('reset_mission clears a pending retry timer', async () => {
    const fakeHandle = setTimeout(() => {}, 100_000);
    mission.__setPendingRetryTimerForTest(fakeHandle);

    await ipcHandlers.get('reset_mission')();

    expect(mission.__getPendingRetryTimerForTest()).toBeNull();
    clearTimeout(fakeHandle);
  });

  test('stop_mission does not throw when no retry is pending', async () => {
    mission.__setPendingRetryTimerForTest(null);

    await expect(ipcHandlers.get('stop_mission')()).resolves.not.toThrow();
    expect(mission.__getPendingRetryTimerForTest()).toBeNull();
  });

  test('reset_mission does not throw when no retry is pending', async () => {
    mission.__setPendingRetryTimerForTest(null);

    await expect(ipcHandlers.get('reset_mission')()).resolves.not.toThrow();
    expect(mission.__getPendingRetryTimerForTest()).toBeNull();
  });
});

describe('retry-pending wrapping — readProcessStdout_launch dangling-question retry (line 2245)', () => {
  let mission;

  beforeEach(() => {
    mission = freshMission();
  });

  test('schedules a cancellable pendingRetryTimer and emits mission:retry-pending when Lead is cut off mid-question', async () => {
    const proc = makeFakeProc();
    nextFakeProc = proc;

    await ipcHandlers.get('launch_mission')(null, {
      projectPath: '/tmp/proj', prompt: 'Build a thing', description: 'demo',
      model: 'sonnet', executionMode: 'standard',
    });

    emitLine(proc, JSON.stringify({
      type: 'assistant', session_id: 'sess-1',
      message: { content: [{ type: 'text', text: '<<<QUESTION>>>\n{"from":"Lead","question":"Which appro' }] },
    }));
    await flush();
    emitLine(proc, JSON.stringify({ type: 'result', result: '' }));
    await flush();

    expect(mission.__getMissionStateForTest().status).toBe('RetryingDanglingQuestion');
    expect(mission.__getPendingRetryTimerForTest()).not.toBeNull();
    expect(windowSendCalls.some(([ch, data]) =>
      ch === 'mission:retry-pending' && data.pending === true && data.attempt === 2 && data.maxAttempts === 3
    )).toBe(true);

    await ipcHandlers.get('stop_mission')();

    expect(mission.__getPendingRetryTimerForTest()).toBeNull();
  });
});

export { freshMission, makeFakeProc, emitLine, emitErrLine, closeProc, flush, ipcHandlers, windowSendCalls, spawnCalls };
