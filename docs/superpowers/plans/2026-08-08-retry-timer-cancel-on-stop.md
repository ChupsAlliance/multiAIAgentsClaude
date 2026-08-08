# Retry Timer Cancel-on-Stop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Critical issue #1 (`docs/critical-issues-review-2026-08-08.md`): retry-backoff timers scheduled after a transient API error or dangling-question detection are never cancelled by `stop_mission`/`reset_mission`, causing either a main-process crash (reset) or a silently-respawned `claude` child process (stop). Also add a confirm dialog so the user isn't surprised by losing an in-flight retry when they click Stop.

**Architecture:** Track the single in-flight retry `setTimeout` handle in a module-level variable (`pendingRetryTimer`) in `electron/ipc/mission.cjs`, mirroring the existing `agentTeamsCompletionTimer`/`clearAgentTeamsTimer()` pattern. Wire `clearPendingRetryTimer()` into `stop_mission`/`reset_mission`. Emit a new `mission:retry-pending` IPC event (separate from `mission:status`) whenever a retry is scheduled or fires, and consume it in `src/hooks/useMission.js` to gate `stop()` behind a native `window.confirm()`.

**Tech Stack:** Electron main-process IPC (`electron/ipc/mission.cjs`, CommonJS), React hook (`src/hooks/useMission.js`), Vitest for both backend (`require.cache`-injection harness) and frontend (`renderHook`) tests.

## Global Constraints

- Only two source files change: `electron/ipc/mission.cjs` and `src/hooks/useMission.js` (per the approved spec's Scope section). No new components, no changes to `MissionHeader.jsx` or any other UI file.
- `reset()` in `useMission.js` does **not** get a confirm dialog — out of scope per the spec's Scope Notes (the "New Mission" button is unreachable while a retry is pending).
- No visual "retrying in Ns..." indicator — only the confirm-on-Stop behavior.
- Confirm dialog message (Vietnamese, exact text): `Mission đang tự động thử lại lần {attempt}/{maxAttempts} sau lỗi tạm thời. Nếu dừng ngay bây giờ, lần thử lại sẽ bị huỷ. Bạn có chắc chắn muốn dừng mission?`
- Spec reference for all design decisions: `docs/superpowers/specs/2026-08-08-retry-timer-cancel-on-stop-design.md`.

---

## File Structure

- `electron/ipc/mission.cjs` — add `pendingRetryTimer` module state + `clearPendingRetryTimer()`; wrap the 4 existing `setTimeout(() => retrySpawn(...), delay)` call sites (lines 2245, 2390, 2994, 3047) to store the handle and emit `mission:retry-pending`; call `clearPendingRetryTimer()` from `stop_mission` and `reset_mission`.
- `electron/ipc/mission.retryTimerCancel.test.cjs` — **new file**. Backend regression tests, built on the same `require.cache`-injection fake-electron/fake-cross-spawn harness already used by `electron/ipc/mission.backend.test.cjs` (duplicated locally per that file's own stated convention — each `mission.*.test.cjs` owns its harness).
- `src/hooks/useMission.js` — add `isRetryPending`/`retryInfo` state, a `mission:retry-pending` listener, a reset of `isRetryPending` at the top of the `mission:status` handler, and a confirm-gate at the top of `stop()`.
- `src/hooks/useMission.test.jsx` — extend with tests for the new `stop()` confirm-gate behavior, using the existing `listeners`/`emit()` mock pattern already in that file.

---

### Task 1: Backend — `pendingRetryTimer` state, `clearPendingRetryTimer()`, wire into stop/reset

**Files:**
- Modify: `electron/ipc/mission.cjs:93` (module state), `:944-949` area (add function near `clearAgentTeamsTimer`), `:4487-4516` (`stop_mission`), `:4519-4538` (`reset_mission`), `:4929-4973` (test-hook exports)
- Create: `electron/ipc/mission.retryTimerCancel.test.cjs`

**Interfaces:**
- Produces: module-level `let pendingRetryTimer = null;`, `function clearPendingRetryTimer()` (no args, no return) — consumed by Tasks 2-5 (each of the 4 call sites assigns to `pendingRetryTimer`) and used internally by `stop_mission`/`reset_mission`.
- Produces (test-only, gated behind `process.env.NODE_ENV === 'test' || process.env.VITEST`): `module.exports.__setPendingRetryTimerForTest(handle)`, `module.exports.__getPendingRetryTimerForTest()` — consumed by this task's own tests and reused as an assertion point in Tasks 2-5.

- [ ] **Step 1: Write the failing test file**

Create `electron/ipc/mission.retryTimerCancel.test.cjs`:

```js
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

export { freshMission, makeFakeProc, emitLine, emitErrLine, closeProc, flush, ipcHandlers, windowSendCalls, spawnCalls };
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/ipc/mission.retryTimerCancel.test.cjs`
Expected: FAIL — `mission.__setPendingRetryTimerForTest is not a function` (the hook doesn't exist yet).

- [ ] **Step 3: Add `pendingRetryTimer` state and `clearPendingRetryTimer()`**

In `electron/ipc/mission.cjs`, find (line 93):

```js
let agentTeamsCompletionTimer = null; // safety auto-complete timer for agent_teams mode
```

Replace with:

```js
let agentTeamsCompletionTimer = null; // safety auto-complete timer for agent_teams mode
let pendingRetryTimer = null; // handle for a scheduled retrySpawn() call, if any (see docs/superpowers/specs/2026-08-08-retry-timer-cancel-on-stop-design.md)
```

Find (lines 944-949):

```js
function clearAgentTeamsTimer() {
  if (agentTeamsCompletionTimer !== null) {
    clearTimeout(agentTeamsCompletionTimer);
    agentTeamsCompletionTimer = null;
  }
}
```

Replace with:

```js
function clearAgentTeamsTimer() {
  if (agentTeamsCompletionTimer !== null) {
    clearTimeout(agentTeamsCompletionTimer);
    agentTeamsCompletionTimer = null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Pending cross-phase retry timer (transient API error / dangling-question
// safety net). Only one mission (and therefore at most one in-flight retry)
// can be active at a time — childProcess is a single module-level variable,
// not a collection — so a single scalar handle is sufficient.
// ─────────────────────────────────────────────────────────────────
function clearPendingRetryTimer() {
  if (pendingRetryTimer !== null) {
    clearTimeout(pendingRetryTimer);
    pendingRetryTimer = null;
  }
}
```

- [ ] **Step 4: Wire `clearPendingRetryTimer()` into `stop_mission`/`reset_mission`**

Find (lines 4487-4495):

```js
  ipcMain.handle('stop_mission', async () => {
    // Mission bị dừng giữa chừng → huỷ recording nửa vời (tránh file rác).
    discardActiveRecording();

    stopWatcher();
    stopAutosave();
    stopStuckChecker();
    clearAgentTeamsTimer();
    killChild();
```

Replace with:

```js
  ipcMain.handle('stop_mission', async () => {
    // Mission bị dừng giữa chừng → huỷ recording nửa vời (tránh file rác).
    discardActiveRecording();

    stopWatcher();
    stopAutosave();
    stopStuckChecker();
    clearAgentTeamsTimer();
    clearPendingRetryTimer();
    killChild();
```

Find (lines 4519-4527):

```js
  ipcMain.handle('reset_mission', async () => {
    // Mission bị reset giữa chừng → huỷ recording nửa vời (tránh file rác).
    discardActiveRecording();

    stopWatcher();
    stopAutosave();
    stopStuckChecker();
    clearAgentTeamsTimer();
    killChild();
```

Replace with:

```js
  ipcMain.handle('reset_mission', async () => {
    // Mission bị reset giữa chừng → huỷ recording nửa vời (tránh file rác).
    discardActiveRecording();

    stopWatcher();
    stopAutosave();
    stopStuckChecker();
    clearAgentTeamsTimer();
    clearPendingRetryTimer();
    killChild();
```

- [ ] **Step 5: Add test-only hooks**

Find (lines 4969-4970):

```js
  module.exports.__setChildProcessForTest = (proc) => { childProcess = proc; };
  module.exports.__getChildProcessForTest = () => childProcess;
```

Replace with:

```js
  module.exports.__setChildProcessForTest = (proc) => { childProcess = proc; };
  module.exports.__getChildProcessForTest = () => childProcess;
  module.exports.__setPendingRetryTimerForTest = (handle) => { pendingRetryTimer = handle; };
  module.exports.__getPendingRetryTimerForTest = () => pendingRetryTimer;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run electron/ipc/mission.retryTimerCancel.test.cjs`
Expected: PASS (4 tests)

- [ ] **Step 7: Commit**

```bash
git add electron/ipc/mission.cjs electron/ipc/mission.retryTimerCancel.test.cjs
git commit -m "fix: cancel pending retry timer on stop_mission/reset_mission"
```

---

### Task 2: Wrap call site 1 — `readProcessStdout_launch` dangling-question retry (line 2245)

**Files:**
- Modify: `electron/ipc/mission.cjs:2245`
- Modify: `electron/ipc/mission.retryTimerCancel.test.cjs` (add a `describe` block; import the shared harness helpers from Task 1's file — since this is the same file, no import needed, just add to it)

**Interfaces:**
- Consumes: `pendingRetryTimer` / `clearPendingRetryTimer()` from Task 1.
- Produces: nothing new — this task only changes call-site behavior, verified via the existing `mission:retry-pending` event contract (`{ pending, attempt, maxAttempts, delayMs }` on schedule, `{ pending: false }` on fire) documented in the spec.

- [ ] **Step 1: Write the failing test**

Add to `electron/ipc/mission.retryTimerCancel.test.cjs` (after the Task 1 `describe` block, before the trailing `export { ... }` line — move the `export` line to stay last in the file):

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/ipc/mission.retryTimerCancel.test.cjs`
Expected: FAIL — `mission:retry-pending` is never sent (`windowSendCalls.some(...)` is `false`), because the call site still uses a bare `setTimeout`.

- [ ] **Step 3: Wrap the call site**

In `electron/ipc/mission.cjs`, find (lines 2243-2246):

```js
                sendToWindow('mission:log', entry);
                killClaudeProcess(proc);
                setTimeout(() => retrySpawn(attempt + 1, attemptCtx.sessionId || null), delay);
                break;
```

Replace with:

```js
                sendToWindow('mission:log', entry);
                killClaudeProcess(proc);
                sendToWindow('mission:retry-pending', { pending: true, attempt: attempt + 1, maxAttempts, delayMs: delay });
                pendingRetryTimer = setTimeout(() => {
                  pendingRetryTimer = null;
                  sendToWindow('mission:retry-pending', { pending: false });
                  retrySpawn(attempt + 1, attemptCtx.sessionId || null);
                }, delay);
                break;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/ipc/mission.retryTimerCancel.test.cjs`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/mission.cjs electron/ipc/mission.retryTimerCancel.test.cjs
git commit -m "fix: track+cancel dangling-question retry timer in readProcessStdout_launch"
```

---

### Task 3: Wrap call site 2 — `watchProcessExit_launch` transient-error retry (line 2390)

**Files:**
- Modify: `electron/ipc/mission.cjs:2390`
- Modify: `electron/ipc/mission.retryTimerCancel.test.cjs`

**Interfaces:**
- Consumes: same as Task 2.

- [ ] **Step 1: Write the failing test**

Add another `describe` block to `electron/ipc/mission.retryTimerCancel.test.cjs`:

```js
describe('retry-pending wrapping — watchProcessExit_launch transient-error retry (line 2390)', () => {
  let mission;

  beforeEach(() => {
    mission = freshMission();
  });

  test('schedules a cancellable pendingRetryTimer on a transient-error exit and cancels it via stop_mission', async () => {
    const proc = makeFakeProc();
    nextFakeProc = proc;

    await ipcHandlers.get('launch_mission')(null, {
      projectPath: '/tmp/proj', prompt: 'Build a thing', description: 'demo',
      model: 'sonnet', executionMode: 'standard',
    });

    emitErrLine(proc, '429 rate limit exceeded');
    await flush();
    closeProc(proc, 1);
    await flush();

    expect(mission.__getPendingRetryTimerForTest()).not.toBeNull();
    expect(windowSendCalls.some(([ch, data]) =>
      ch === 'mission:retry-pending' && data.pending === true && data.attempt === 2 && data.delayMs === 30000
    )).toBe(true);

    const spawnCountBeforeStop = spawnCalls.length;
    await ipcHandlers.get('stop_mission')();

    expect(mission.__getPendingRetryTimerForTest()).toBeNull();
    // clearTimeout on the stored handle guarantees retrySpawn cannot fire later —
    // no further spawn() call is made as a direct result of stopping.
    expect(spawnCalls.length).toBe(spawnCountBeforeStop);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/ipc/mission.retryTimerCancel.test.cjs`
Expected: FAIL — `mission:retry-pending` never sent.

- [ ] **Step 3: Wrap the call site**

In `electron/ipc/mission.cjs`, find (lines 2386-2391):

```js
        const entry = makeLogEntry(ts, 'System',
          `⚠ Gặp lỗi tạm thời (rate limit/API), đang thử lại lần ${attempt}/${maxAttempts} sau ${delay / 1000}s...`, 'info');
        if (missionState) missionState.log.push(entry);
        sendToWindow('mission:log', entry);
        setTimeout(() => retrySpawn(attempt + 1, attemptCtx.sessionId || null), delay);
        return;
```

Replace with:

```js
        const entry = makeLogEntry(ts, 'System',
          `⚠ Gặp lỗi tạm thời (rate limit/API), đang thử lại lần ${attempt}/${maxAttempts} sau ${delay / 1000}s...`, 'info');
        if (missionState) missionState.log.push(entry);
        sendToWindow('mission:log', entry);
        sendToWindow('mission:retry-pending', { pending: true, attempt: attempt + 1, maxAttempts, delayMs: delay });
        pendingRetryTimer = setTimeout(() => {
          pendingRetryTimer = null;
          sendToWindow('mission:retry-pending', { pending: false });
          retrySpawn(attempt + 1, attemptCtx.sessionId || null);
        }, delay);
        return;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/ipc/mission.retryTimerCancel.test.cjs`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/mission.cjs electron/ipc/mission.retryTimerCancel.test.cjs
git commit -m "fix: track+cancel transient-error retry timer in watchProcessExit_launch"
```

---

### Task 4: Wrap call site 3 — `readProcessStdout_deploy` dangling-question retry (line 2994)

**Files:**
- Modify: `electron/ipc/mission.cjs:2994`
- Modify: `electron/ipc/mission.retryTimerCancel.test.cjs`

**Interfaces:**
- Consumes: same as Task 2. Uses `mission.__setMissionStateForTest(...)` (existing hook) to seed a minimal `ReviewPlan`-phase mission directly, then calls the real `deploy_mission` handler — avoids re-deriving the full launch→plan-approval pipeline just to reach the deploy phase.

- [ ] **Step 1: Write the failing test**

Add another `describe` block:

```js
describe('retry-pending wrapping — readProcessStdout_deploy dangling-question retry (line 2994)', () => {
  let mission;

  beforeEach(() => {
    mission = freshMission();
  });

  function seedReviewPlanState() {
    mission.__setMissionStateForTest({
      id: 'm1', status: 'ReviewPlan', phase: 'ReviewPlan',
      execution_mode: 'standard', backend: 'claude', permission_mode: 'auto',
      project_path: '/tmp/proj',
      agents: [{ name: 'Lead', status: 'Idle', model: 'sonnet' }],
      tasks: [], log: [], file_changes: [], raw_output: [],
    });
  }

  test('schedules a cancellable pendingRetryTimer when Lead is cut off mid-question during deploy', async () => {
    seedReviewPlanState();
    const proc = makeFakeProc();
    nextFakeProc = proc;

    await ipcHandlers.get('deploy_mission')(null, {
      agents: [{ name: 'Lead', model: 'sonnet' }], tasks: [], agentPrompts: {},
    });

    emitLine(proc, JSON.stringify({
      type: 'assistant', session_id: 'sess-1',
      message: { content: [{ type: 'text', text: '<<<QUESTION>>>\n{"from":"Lead","question":"Which appro' }] },
    }));
    await flush();
    proc.stdout.push(null); // end stdout -> readline emits 'close', driving the dangling-question check
    await flush();

    expect(mission.__getMissionStateForTest().status).toBe('RetryingDanglingQuestion');
    expect(mission.__getPendingRetryTimerForTest()).not.toBeNull();
    expect(windowSendCalls.some(([ch, data]) =>
      ch === 'mission:retry-pending' && data.pending === true && data.attempt === 2
    )).toBe(true);

    await ipcHandlers.get('stop_mission')();

    expect(mission.__getPendingRetryTimerForTest()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/ipc/mission.retryTimerCancel.test.cjs`
Expected: FAIL — `mission:retry-pending` never sent.

- [ ] **Step 3: Wrap the call site**

In `electron/ipc/mission.cjs`, find (lines 2989-2994):

```js
          const entry = makeLogEntry(ts, 'System',
            `⚠ Lead bị cắt giữa câu hỏi (thiếu marker đóng), đang thử lại lần ${attempt}/${maxAttempts} sau ${delay / 1000}s...`, 'info');
          missionState.log.push(entry);
          sendToWindow('mission:log', entry);
          missionState.status = 'RetryingDanglingQuestion'; // watchProcessExit_deploy's close handler must not mark Completed/Failed for this status
          setTimeout(() => retrySpawn(attempt + 1, attemptCtx.sessionId || null), delay);
```

Replace with:

```js
          const entry = makeLogEntry(ts, 'System',
            `⚠ Lead bị cắt giữa câu hỏi (thiếu marker đóng), đang thử lại lần ${attempt}/${maxAttempts} sau ${delay / 1000}s...`, 'info');
          missionState.log.push(entry);
          sendToWindow('mission:log', entry);
          missionState.status = 'RetryingDanglingQuestion'; // watchProcessExit_deploy's close handler must not mark Completed/Failed for this status
          sendToWindow('mission:retry-pending', { pending: true, attempt: attempt + 1, maxAttempts, delayMs: delay });
          pendingRetryTimer = setTimeout(() => {
            pendingRetryTimer = null;
            sendToWindow('mission:retry-pending', { pending: false });
            retrySpawn(attempt + 1, attemptCtx.sessionId || null);
          }, delay);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/ipc/mission.retryTimerCancel.test.cjs`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/mission.cjs electron/ipc/mission.retryTimerCancel.test.cjs
git commit -m "fix: track+cancel dangling-question retry timer in readProcessStdout_deploy"
```

---

### Task 5: Wrap call site 4 — `watchProcessExit_deploy` transient-error retry (line 3047)

**Files:**
- Modify: `electron/ipc/mission.cjs:3047`
- Modify: `electron/ipc/mission.retryTimerCancel.test.cjs`

**Interfaces:**
- Consumes: same as Task 4 (`seedReviewPlanState` helper defined inside Task 4's `describe` block — redeclare it locally in this task's `describe` block since each `describe`'s helper is scoped to its own block in the plan below, keeping the two deploy-phase describes independent and readable).

- [ ] **Step 1: Write the failing test**

Add another `describe` block:

```js
describe('retry-pending wrapping — watchProcessExit_deploy transient-error retry (line 3047)', () => {
  let mission;

  beforeEach(() => {
    mission = freshMission();
  });

  function seedReviewPlanState() {
    mission.__setMissionStateForTest({
      id: 'm1', status: 'ReviewPlan', phase: 'ReviewPlan',
      execution_mode: 'standard', backend: 'claude', permission_mode: 'auto',
      project_path: '/tmp/proj',
      agents: [{ name: 'Lead', status: 'Idle', model: 'sonnet' }],
      tasks: [], log: [], file_changes: [], raw_output: [],
    });
  }

  test('schedules a cancellable pendingRetryTimer on a transient-error exit during deploy and cancels it via reset_mission', async () => {
    seedReviewPlanState();
    const proc = makeFakeProc();
    nextFakeProc = proc;

    await ipcHandlers.get('deploy_mission')(null, {
      agents: [{ name: 'Lead', model: 'sonnet' }], tasks: [], agentPrompts: {},
    });

    emitErrLine(proc, '503 service unavailable');
    await flush();
    closeProc(proc, 1);
    await flush();

    expect(mission.__getPendingRetryTimerForTest()).not.toBeNull();
    expect(windowSendCalls.some(([ch, data]) =>
      ch === 'mission:retry-pending' && data.pending === true && data.attempt === 2 && data.delayMs === 30000
    )).toBe(true);

    await ipcHandlers.get('reset_mission')();

    expect(mission.__getPendingRetryTimerForTest()).toBeNull();
    expect(mission.__getMissionStateForTest()).toBeNull();
  });
});

export { freshMission, makeFakeProc, emitLine, emitErrLine, closeProc, flush, ipcHandlers, windowSendCalls, spawnCalls };
```

(This `export` statement replaces the one placed at the end of Task 1's initial file — it must appear exactly once, as the last statement in the file. If Task 1's original trailing `export { ... }` line still exists above this new `describe` block, delete it so there is only one, at the very end.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/ipc/mission.retryTimerCancel.test.cjs`
Expected: FAIL — `mission:retry-pending` never sent.

- [ ] **Step 3: Wrap the call site**

In `electron/ipc/mission.cjs`, find (lines 3043-3048):

```js
        const entry = makeLogEntry(ts, 'System',
          `⚠ Gặp lỗi tạm thời (rate limit/API), đang thử lại lần ${attempt}/${maxAttempts} sau ${delay / 1000}s...`, 'info');
        missionState.log.push(entry);
        sendToWindow('mission:log', entry);
        setTimeout(() => retrySpawn(attempt + 1, attemptCtx.sessionId || null), delay);
        return;
```

Replace with:

```js
        const entry = makeLogEntry(ts, 'System',
          `⚠ Gặp lỗi tạm thời (rate limit/API), đang thử lại lần ${attempt}/${maxAttempts} sau ${delay / 1000}s...`, 'info');
        missionState.log.push(entry);
        sendToWindow('mission:log', entry);
        sendToWindow('mission:retry-pending', { pending: true, attempt: attempt + 1, maxAttempts, delayMs: delay });
        pendingRetryTimer = setTimeout(() => {
          pendingRetryTimer = null;
          sendToWindow('mission:retry-pending', { pending: false });
          retrySpawn(attempt + 1, attemptCtx.sessionId || null);
        }, delay);
        return;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/ipc/mission.retryTimerCancel.test.cjs`
Expected: PASS (8 tests)

- [ ] **Step 5: Run the full backend suite to confirm no regressions**

Run: `npx vitest run electron/ipc/`
Expected: PASS (all existing + new tests — in particular `mission.backend.test.cjs`, `mission.test.cjs`, `mission.retryTransientSpawn.test.js`, `mission.tryRecoverDanglingQuestion.test.js` unaffected)

- [ ] **Step 6: Commit**

```bash
git add electron/ipc/mission.cjs electron/ipc/mission.retryTimerCancel.test.cjs
git commit -m "fix: track+cancel transient-error retry timer in watchProcessExit_deploy"
```

---

### Task 6: Frontend — `isRetryPending` state, `mission:retry-pending` listener, confirm-gate in `stop()`

**Files:**
- Modify: `src/hooks/useMission.js:26` (state), `:173-174` (mission:status handler reset), `:568-569` (listener array), `:780-801` (`stop()`)
- Modify: `src/hooks/useMission.test.jsx` (add tests using the existing `listeners`/`emit()` mock pattern)

**Interfaces:**
- Consumes: `mission:retry-pending` event payload `{ pending, attempt, maxAttempts, delayMs }` / `{ pending: false }`, produced by Tasks 2-5.
- Produces: no new public return value from `useMission()` — `isRetryPending`/`retryInfo` are internal to the hook and only observed indirectly through `stop()`'s behavior, per the spec's Scope Notes (not exposed to `MissionHeader.jsx` or any other consumer).

- [ ] **Step 1: Write the failing tests**

Add to `src/hooks/useMission.test.jsx` (after the existing `test(...)` blocks, before the final closing of the file):

```js
test('stop() shows a confirm dialog and does not call stop_mission when a retry is pending and the user cancels', async () => {
  const { invoke } = await import('@tauri-apps/api/core')
  invoke.mockClear()
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

  const { result } = renderHook(() => useMission())
  await act(async () => { await Promise.resolve() })

  act(() => {
    emit('mission:retry-pending', { pending: true, attempt: 2, maxAttempts: 3, delayMs: 60000 })
  })

  await act(async () => {
    await result.current.stop()
  })

  expect(confirmSpy).toHaveBeenCalledWith(
    'Mission đang tự động thử lại lần 2/3 sau lỗi tạm thời. Nếu dừng ngay bây giờ, lần thử lại sẽ bị huỷ. Bạn có chắc chắn muốn dừng mission?'
  )
  expect(invoke).not.toHaveBeenCalledWith('stop_mission')

  confirmSpy.mockRestore()
})

test('stop() calls stop_mission after the user confirms, when a retry is pending', async () => {
  const { invoke } = await import('@tauri-apps/api/core')
  invoke.mockClear()
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

  const { result } = renderHook(() => useMission())
  await act(async () => { await Promise.resolve() })

  act(() => {
    emit('mission:retry-pending', { pending: true, attempt: 1, maxAttempts: 3, delayMs: 30000 })
  })

  await act(async () => {
    await result.current.stop()
  })

  expect(confirmSpy).toHaveBeenCalled()
  expect(invoke).toHaveBeenCalledWith('stop_mission')

  confirmSpy.mockRestore()
})

test('stop() does not show a confirm dialog when no retry is pending', async () => {
  const { invoke } = await import('@tauri-apps/api/core')
  invoke.mockClear()
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

  const { result } = renderHook(() => useMission())
  await act(async () => { await Promise.resolve() })

  await act(async () => {
    await result.current.stop()
  })

  expect(confirmSpy).not.toHaveBeenCalled()
  expect(invoke).toHaveBeenCalledWith('stop_mission')

  confirmSpy.mockRestore()
})

test('a mission:status event clears a pending-retry flag, so a later stop() does not prompt', async () => {
  const { invoke } = await import('@tauri-apps/api/core')
  invoke.mockClear()
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

  const { result } = renderHook(() => useMission())
  await act(async () => { await Promise.resolve() })

  act(() => {
    emit('mission:retry-pending', { pending: true, attempt: 1, maxAttempts: 3, delayMs: 30000 })
  })
  act(() => {
    emit('mission:status', { status: 'running' })
  })

  await act(async () => {
    await result.current.stop()
  })

  expect(confirmSpy).not.toHaveBeenCalled()
  expect(invoke).toHaveBeenCalledWith('stop_mission')

  confirmSpy.mockRestore()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useMission.test.jsx`
Expected: FAIL — `window.confirm` is never called; `stop()` calls `invoke('stop_mission')` unconditionally in all four new tests (the first one fails because `stop_mission` IS called despite `pending:true`; the confirm-based ones fail because `confirmSpy` was never invoked).

- [ ] **Step 3: Add `isRetryPending`/`retryInfo` state**

In `src/hooks/useMission.js`, find (line 26):

```js
  const [isRecording, setIsRecording] = useState(false)
```

Replace with:

```js
  const [isRecording, setIsRecording] = useState(false)
  const [isRetryPending, setIsRetryPending] = useState(false)
  const [retryInfo, setRetryInfo] = useState(null) // { attempt, maxAttempts } | null
```

- [ ] **Step 4: Reset `isRetryPending` at the top of the `mission:status` handler**

Find (lines 173-174):

```js
        listen('mission:status', (e) => {
          const { status } = e.payload
```

Replace with:

```js
        listen('mission:status', (e) => {
          // Any status transition supersedes a pending-retry signal — safety
          // net against ever missing a cancel and showing a stale flag.
          setIsRetryPending(false)
          const { status } = e.payload
```

- [ ] **Step 5: Add the `mission:retry-pending` listener**

Find (lines 566-569):

```js
          setMissionState(prev => {
            if (!prev) return prev
            return {
              ...prev,
              agents: prev.agents.map(a =>
                a.name === agent ? { ...a, stuckWarning: true } : a
              ),
            }
          })
        }),
      ])
```

Replace with:

```js
          setMissionState(prev => {
            if (!prev) return prev
            return {
              ...prev,
              agents: prev.agents.map(a =>
                a.name === agent ? { ...a, stuckWarning: true } : a
              ),
            }
          })
        }),

        // ── Retry-pending signal (backend timer scheduled/fired) ──
        listen('mission:retry-pending', (e) => {
          const { pending, attempt, maxAttempts } = e.payload
          setIsRetryPending(!!pending)
          setRetryInfo(pending ? { attempt, maxAttempts } : null)
        }),
      ])
```

- [ ] **Step 6: Add the confirm-gate to `stop()`**

Find (lines 780-792):

```js
  const stop = useCallback(async () => {
    // Recording phải trọn vẹn từ đầu đến cuối — nếu Stop giữa chừng khi đang ghi,
    // tự động huỷ bản ghi (không lưu bản ghi dang dở) và báo cho user.
    if (isRecording) {
      try {
        await invoke('recording_discard')
      } catch (_) {
        // best-effort — vẫn tiếp tục stop mission dù discard lỗi
      }
      setIsRecording(false)
      toast.warn('Đã huỷ bản ghi', 'Mission bị dừng giữa chừng nên bản ghi không được lưu')
    }
```

Replace with:

```js
  const stop = useCallback(async () => {
    if (isRetryPending) {
      const attempt = retryInfo?.attempt ?? '?'
      const maxAttempts = retryInfo?.maxAttempts ?? '?'
      const confirmed = window.confirm(
        `Mission đang tự động thử lại lần ${attempt}/${maxAttempts} sau lỗi tạm thời. Nếu dừng ngay bây giờ, lần thử lại sẽ bị huỷ. Bạn có chắc chắn muốn dừng mission?`
      )
      if (!confirmed) return
    }

    // Recording phải trọn vẹn từ đầu đến cuối — nếu Stop giữa chừng khi đang ghi,
    // tự động huỷ bản ghi (không lưu bản ghi dang dở) và báo cho user.
    if (isRecording) {
      try {
        await invoke('recording_discard')
      } catch (_) {
        // best-effort — vẫn tiếp tục stop mission dù discard lỗi
      }
      setIsRecording(false)
      toast.warn('Đã huỷ bản ghi', 'Mission bị dừng giữa chừng nên bản ghi không được lưu')
    }
```

Find the `stop` callback's dependency array (line 801):

```js
  }, [toast, clearPlanningTimer, isRecording])
```

Replace with:

```js
  }, [toast, clearPlanningTimer, isRecording, isRetryPending, retryInfo])
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/hooks/useMission.test.jsx`
Expected: PASS (all tests, including the 4 new ones)

- [ ] **Step 8: Run the full frontend hook suite to confirm no regressions**

Run: `npx vitest run src/hooks/`
Expected: PASS (in particular `useMission.ipc-errors.test.jsx` unaffected — it doesn't touch `stop()`)

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useMission.js src/hooks/useMission.test.jsx
git commit -m "feat: confirm before stopping a mission with a pending retry"
```

---

## What does NOT change

- The four retry call sites' actual retry logic (attempt/backoff counting, transient-error detection, session resumption) — untouched, only the scheduling call itself is wrapped.
- `mission:status` event semantics and everything downstream of it in `useMission.js`, beyond the new `setIsRetryPending(false)` line.
- `reset()`'s behavior in `useMission.js` — unchanged, no confirm dialog added (per spec Scope Notes).
- `MissionHeader.jsx` and every other UI file.

## Self-Review

**Spec coverage:** All 6 acceptance criteria from `docs/superpowers/specs/2026-08-08-retry-timer-cancel-on-stop-design.md` are covered — Task 1 (core cancel wiring + no-crash), Tasks 2-5 (all 4 call sites, one test each), Task 6 (confirm dialog shown/cancelled/confirmed, and the no-retry-pending pass-through case).

**Placeholder scan:** No TBD/TODO — every step has literal, exact code matching the current file contents (verified via direct `Read` of every touched line range before writing this plan).

**Type/signature consistency:** `pendingRetryTimer` (Task 1) is referenced identically in Tasks 2-5. `__setPendingRetryTimerForTest`/`__getPendingRetryTimerForTest` (Task 1) are used identically in Tasks 1-5's tests. `mission:retry-pending` payload shape (`{ pending, attempt, maxAttempts, delayMs }` / `{ pending: false }`) is identical across Tasks 2-5's implementation and Task 6's listener. `isRetryPending`/`retryInfo` (Task 6) are used consistently between the listener, the `mission:status` reset, and `stop()`.

## Execution Handoff

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session, batch execution with checkpoints for review.
