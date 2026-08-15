# QA-Stuck Mission Unstick Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When final-QA auto-resume exhausts its 3 attempts, correctly mark the mission as stuck (not silently left "Running"), record *why* QA failed on each task, and give the user a "Stop & create fix mission" action that spawns a fresh, minimal mission scoped only to fixing the listed QA failures.

**Architecture:** Four small, mostly-independent changes to `electron/ipc/mission.cjs` plus matching frontend wiring: (1) the auto-resume give-up branch now sets `status: 'Needs Attention'` + `stuckReason: 'final_qa_retry_exhausted'` and persists a snapshot; (2) `handleQcQaFailure` records `task.lastFailureDetail` and `buildMissionSummary` surfaces it; (3) a new `create_qa_fix_mission` IPC handler composes `stop_mission`'s cleanup with `continue_mission`'s fork-a-new-`missionState` shape, seeded via a new prompt template; (4) `MissionHeader.jsx` gets a new button, gated on the new `stuckReason`, wired down through `MissionDashboard.jsx` → `MissionControlPage.jsx` → `useMission.js`.

**Tech Stack:** Node.js/Electron (CommonJS, `electron/ipc/mission.cjs`), Vitest for both backend (`.cjs`/`.js` test files, two harness styles — see Global Constraints) and frontend (React Testing Library) tests, React (`src/components/mission/*.jsx`, `src/hooks/useMission.js`).

**Spec:** docs/superpowers/specs/2026-08-15-qa-stuck-mission-unstick-design.md

## Global Constraints

- Out of scope, do not implement: headed/headless Playwright toggle, live QA-retry reporting UI, full QC/QA failure-detail viewer UI (per spec "Out of scope" section).
- Do not touch: `runFinalQaSweep()`, the per-task QC/QA escalation ladder's own `'Needs Attention'` dead end (`nextEscalationTier`, `mission.cjs:381-388`), `retryAgentCore`'s existing behavior beyond the one added `stuckReason` clear line, `spawnResumeOrFreshAttempt`/the auto-resume loop's own bound (stays 3).
- Two backend test-harness styles exist in `electron/ipc/` — use the right one per task:
  - **Light harness** (no fake `electron`, plain `require('./mission.cjs')`, test-only `__xForTest` exports) — use for module-internal functions: `handleQcQaFailure`, `retryAgentCore`, `autoResumeAfterFinalQaFailure`, `buildMissionSummary`.
  - **Heavy harness** (fake `electron`/`cross-spawn` installed into `require.cache`, `registerMission` invoked via `mission(() => fakeWindow)` to populate an `ipcHandlers` Map) — required for anything only reachable through `ipcMain.handle(...)`: `create_qa_fix_mission`, the modified `get_incomplete_missions`.
- `saveMissionSnapshot(state, extra = {})` (mission.cjs:818-838) does a shallow `Object.assign` clone of the whole `missionState` — any new field added directly to `missionState` or a `task` object is persisted automatically; no snapshot-shape change is needed.
- New IPC handlers/props must not alter unrelated `<MissionDashboard>` render sites (history/replay views at `MissionControlPage.jsx` lines ~232 and ~390) — only the live-mission render block (~452-466) gets the new prop.

---

### Task 1: Record per-task QA/QC failure detail (`lastFailureDetail`)

**Files:**
- Modify: `electron/ipc/mission.cjs:371-404` (`handleQcQaFailure`)
- Test: `electron/ipc/mission.test.cjs`

**Interfaces:**
- Consumes: none new.
- Produces: `task.lastFailureDetail = { stage, reason, responsibleAgent, timestamp }` on any task that fails QC or QA — consumed by Task 2 (`buildMissionSummary`) and Task 6 (`create_qa_fix_mission`'s QA_FAILURES section).

- [ ] **Step 1: Write the failing tests**

Add to the existing `describe('QC/QA per-task pipeline', ...)` block in `electron/ipc/mission.test.cjs` (same file/pattern as the existing `'QC FAIL routes to handleQcQaFailure with stage "qc"'` test):

```js
test('QC FAIL records lastFailureDetail on the task', async () => {
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

    const state = mission.__getMissionStateForTest()
    expect(state.tasks[0].lastFailureDetail).toEqual({
      stage: 'qc',
      reason: 'build broke',
      responsibleAgent: 'Dev',
      timestamp: expect.any(Number),
    })
  } finally {
    vi.useRealTimers()
  }
})

test('a second QC/QA failure overwrites lastFailureDetail rather than accumulating', async () => {
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
      verdict: 'FAIL', responsibleAgent: 'Dev', reason: 'first failure',
    }))

    await mission.__enqueueQcCheckForTest(mission.__getMissionStateForTest().tasks[0], 'Dev')
    await vi.advanceTimersByTimeAsync(1000)

    mission.__setQcQaRunnerForTest(async () => ({
      verdict: 'FAIL', responsibleAgent: 'Dev', reason: 'second failure',
    }))
    await mission.__enqueueQcCheckForTest(mission.__getMissionStateForTest().tasks[0], 'Dev')

    const state = mission.__getMissionStateForTest()
    expect(state.tasks[0].lastFailureDetail.reason).toBe('second failure')
  } finally {
    vi.useRealTimers()
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run electron/ipc/mission.test.cjs -t "lastFailureDetail"`
Expected: FAIL — `state.tasks[0].lastFailureDetail` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `electron/ipc/mission.cjs`, modify `handleQcQaFailure` (lines 371-404):

```js
function handleQcQaFailure(task, stage, responsibleAgent, reason) {
  task.qcRound = (task.qcRound || 0) + 1;
  task.status = stage === 'qc' ? 'failed_qc' : 'failed_qa';
  const ts = now();
  task.lastFailureDetail = { stage, reason, responsibleAgent, timestamp: ts };
  sendToWindowRef('mission:task-update', {
    task_id: task.id, agent: responsibleAgent, description: task.title, status: task.status,
    reason, timestamp: ts,
  });

  const { tier } = nextEscalationTier(task.qcRound);
  if (tier === 'needs-attention') {
    missionState.status = 'Needs Attention';
    sendToWindowRef('mission:status', {
      mission_id: missionState.id, status: 'Needs Attention',
      task_id: task.id, reason,
    });
    return;
  }

  setTimeout(() => {
    task.status = 'in_progress';
    sendToWindowRef('mission:task-update', {
      task_id: task.id, agent: responsibleAgent, description: task.title, status: 'in_progress',
      reason, timestamp: now(),
    });
  }, QC_QA_FAILURE_VISIBILITY_DELAY_MS);
}
```

(Only the added `task.lastFailureDetail = ...` line changes; everything else is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run electron/ipc/mission.test.cjs -t "lastFailureDetail"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/mission.cjs electron/ipc/mission.test.cjs
git commit -m "feat: record per-task QC/QA failure detail on the task"
```

---

### Task 2: Surface `lastFailureDetail` in `buildMissionSummary`

**Files:**
- Modify: `electron/ipc/mission.cjs:1039-1061` (`buildMissionSummary`), `electron/ipc/mission.cjs` test-only-exports guard block (~4976-5024)
- Test: `electron/ipc/mission.buildMissionSummary.test.js` (new file)

**Interfaces:**
- Consumes: `task.lastFailureDetail` (from Task 1).
- Produces: `module.exports.__buildMissionSummaryForTest(state, logLimit)` test export; `buildMissionSummary`'s returned string now includes a "QA/QC failures" section — consumed by Task 6's `{{SUMMARY}}` placeholder and by `continue_mission`'s existing `{{SUMMARY}}` usage (unchanged call site, richer output).

- [ ] **Step 1: Write the failing test**

Create `electron/ipc/mission.buildMissionSummary.test.js`:

```js
import { describe, test, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const mission = require('./mission.cjs');

describe('buildMissionSummary — surfaces lastFailureDetail for failed_qc/failed_qa tasks', () => {
  beforeEach(() => {
    mission.__setMissionStateForTest(null);
  });

  test('includes a QA/QC failures section for tasks currently failed_qc or failed_qa', () => {
    const state = {
      tasks: [
        {
          id: 't1', title: 'Wire up checkout', status: 'failed_qa', assigned_agent: 'Dev',
          lastFailureDetail: {
            stage: 'qa', reason: 'fails 6/7 Playwright specs, no detail given',
            responsibleAgent: 'Dev', timestamp: 1000,
          },
        },
        { id: 't2', title: 'Add logging', status: 'completed', assigned_agent: 'Dev2' },
      ],
      log: [], file_changes: [],
    };

    const summary = mission.__buildMissionSummaryForTest(state);

    expect(summary).toContain('QA/QC failures');
    expect(summary).toContain('Wire up checkout');
    expect(summary).toContain('fails 6/7 Playwright specs, no detail given');
  });

  test('omits the section entirely when no task currently has a failed_qc/failed_qa status', () => {
    const state = {
      tasks: [{ id: 't1', title: 'Add logging', status: 'completed', assigned_agent: 'Dev2' }],
      log: [], file_changes: [],
    };

    const summary = mission.__buildMissionSummaryForTest(state);

    expect(summary).not.toContain('QA/QC failures');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/ipc/mission.buildMissionSummary.test.js`
Expected: FAIL — `mission.__buildMissionSummaryForTest is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `electron/ipc/mission.cjs`, modify `buildMissionSummary` (lines 1039-1061):

```js
function buildMissionSummary(state, logLimit = 30) {
  const parts = [];
  const tasks = state.tasks || [];
  const done   = tasks.filter(t => t.status === 'completed')
    .map(t => `- [DONE] ${t.title} (by ${t.assigned_agent || 'unknown'})`);
  const inProg = tasks.filter(t => t.status === 'in_progress')
    .map(t => `- [IN PROGRESS] ${t.title} (by ${t.assigned_agent || 'unknown'})`);
  const pend   = tasks.filter(t => t.status === 'pending')
    .map(t => `- [PENDING] ${t.title}`);
  if (done.length)   parts.push(`Completed:\n${done.join('\n')}`);
  if (inProg.length) parts.push(`In Progress:\n${inProg.join('\n')}`);
  if (pend.length)   parts.push(`Pending:\n${pend.join('\n')}`);

  const failedQa = tasks.filter(t =>
    (t.status === 'failed_qc' || t.status === 'failed_qa') && t.lastFailureDetail
  ).map(t =>
    `- ${t.title} (owner: ${t.lastFailureDetail.responsibleAgent || 'unknown'}, stage: ${t.lastFailureDetail.stage}): ${t.lastFailureDetail.reason || '(no reason given)'}`
  );
  if (failedQa.length) parts.push(`QA/QC failures:\n${failedQa.join('\n')}`);

  const logs = (state.log || []).filter(l => l.log_type !== 'raw').slice(-logLimit)
    .map(l => `[${l.agent}] ${(l.message || '').slice(0, 300)}`);
  if (logs.length) parts.push(`Recent activity:\n${logs.join('\n')}`);

  const files = (state.file_changes || []).slice(0, 50)
    .map(f => `- ${f.path} (${f.action})`);
  if (files.length) parts.push(`Files created/modified:\n${files.join('\n')}`);

  return parts.join('\n\n');
}
```

Then add to the test-only-exports guard block (near line 5024, alongside `module.exports.__runMockupHtmlForTest = runMockupHtml;`):

```js
module.exports.__buildMissionSummaryForTest = (state, logLimit) => buildMissionSummary(state, logLimit);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/ipc/mission.buildMissionSummary.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/mission.cjs electron/ipc/mission.buildMissionSummary.test.js
git commit -m "feat: surface per-task QA/QC failure detail in mission summaries"
```

---

### Task 3: Correctly mark the stuck state on final-QA auto-resume exhaustion

**Files:**
- Modify: `electron/ipc/mission.cjs:3255-3281` (`autoResumeAfterFinalQaFailure`)
- Test: `electron/ipc/mission.autoResume.test.js`

**Interfaces:**
- Consumes: `saveMissionSnapshot` (existing, unchanged).
- Produces: `missionState.status = 'Needs Attention'`, `missionState.stuckReason = 'final_qa_retry_exhausted'` — consumed by Task 4 (`retryAgentCore`'s clear), Task 5 (`get_incomplete_missions` exclusion), Task 7 (`MissionHeader.jsx`'s `isStuckOnQaRetry`), Task 9 (`create_qa_fix_mission`'s server-side re-check).

- [ ] **Step 1: Write the failing test**

Add to `electron/ipc/mission.autoResume.test.js` (same file, reusing the existing `setupMissionState` helper):

```js
test('give-up branch marks status Needs Attention with stuckReason and persists a snapshot', () => {
  const sendToWindow = vi.fn()
  setupMissionState({ autoResumeCount: 3 })
  mission.__setSendToWindowForTest(sendToWindow)

  mission.__autoResumeAfterFinalQaFailureForTest('m1', sendToWindow, Date.now())

  const state = mission.__getMissionStateForTest()
  expect(state.status).toBe('Needs Attention')
  expect(state.stuckReason).toBe('final_qa_retry_exhausted')

  const statusCalls = sendToWindow.mock.calls.filter(c => c[0] === 'mission:status')
  expect(statusCalls.some(c =>
    c[1].status === 'Needs Attention' && c[1].stuck_reason === 'final_qa_retry_exhausted'
  )).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/ipc/mission.autoResume.test.js -t "Needs Attention"`
Expected: FAIL — `state.status` is still `'Running'`, `state.stuckReason` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `electron/ipc/mission.cjs`, modify `autoResumeAfterFinalQaFailure` (lines 3255-3281):

```js
function autoResumeAfterFinalQaFailure(missionId, sendToWindow, ts) {
  missionState.autoResumeCount = (missionState.autoResumeCount || 0) + 1;

  if (missionState.autoResumeCount > 3) {
    missionState.status = 'Needs Attention';
    missionState.stuckReason = 'final_qa_retry_exhausted';
    const entry = makeLogEntry(ts, 'System',
      'Final QA sweep scheduled a retry after the driving process already exited — ' +
      'mission is awaiting that retry, but no process is currently driving it. ' +
      'Auto-resume already tried 3 times without reaching Completed — stopping. ' +
      'This requires manual intervention (see Retry).',
      'info');
    missionState.log.push(entry);
    sendToWindow('mission:log', entry);
    sendToWindow('mission:status', {
      mission_id: missionState.id, status: 'Needs Attention',
      stuck_reason: 'final_qa_retry_exhausted',
    });
    saveMissionSnapshot(missionState);
    return;
  }

  const entry = makeLogEntry(ts, 'System',
    `Final QA sweep scheduled a retry after the driving process already exited — ` +
    `auto-resuming mission (attempt ${missionState.autoResumeCount}/3)...`,
    'info');
  missionState.log.push(entry);
  sendToWindow('mission:log', entry);

  spawnResumeOrFreshAttempt({
    missionId, sendToWindow,
    reasonForLog: 'final QA sweep failure after process exit',
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/ipc/mission.autoResume.test.js`
Expected: PASS (all tests in the file, including the pre-existing ones — confirm no regression).

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/mission.cjs electron/ipc/mission.autoResume.test.js
git commit -m "fix: mark mission Needs Attention when final-QA auto-resume is exhausted"
```

---

### Task 4: Clear `stuckReason` on manual retry

**Files:**
- Modify: `electron/ipc/mission.cjs:415-457` (`retryAgentCore`)
- Test: `electron/ipc/mission.autoResume.test.js`

**Interfaces:**
- Consumes: `missionState.stuckReason` (from Task 3).
- Produces: `missionState.stuckReason === null` after any manual retry — keeps stale `stuckReason` from lingering once the user has acted.

- [ ] **Step 1: Write the failing test**

Add to `electron/ipc/mission.autoResume.test.js`:

```js
test('retryAgentCore clears stuckReason set by the auto-resume give-up branch', () => {
  const sendToWindow = vi.fn()
  setupMissionState({
    autoResumeCount: 4,
    status: 'Needs Attention',
    stuckReason: 'final_qa_retry_exhausted',
    agents: [
      { name: 'Lead', status: 'Done', model: 'sonnet', current_task: null },
      { name: 'Dev', status: 'Working', current_task: 'Implement feature', error: null },
    ],
  })
  mission.__setSendToWindowForTest(sendToWindow)

  mission.__retryAgentForTest('Dev')

  const state = mission.__getMissionStateForTest()
  expect(state.stuckReason).toBe(null)
  expect(state.status).toBe('Running')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/ipc/mission.autoResume.test.js -t "clears stuckReason"`
Expected: FAIL — `state.stuckReason` is still `'final_qa_retry_exhausted'`.

- [ ] **Step 3: Write minimal implementation**

In `electron/ipc/mission.cjs`, modify `retryAgentCore` (lines 415-457) — change only the `Needs Attention` block:

```js
if (missionState.status === 'Needs Attention') {
  missionState.status = 'Running';
  missionState.stuckReason = null;
  sendToWindow('mission:status', { mission_id: missionState.id, status: 'Running' });
}
```

(Rest of the function unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/ipc/mission.autoResume.test.js`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/mission.cjs electron/ipc/mission.autoResume.test.js
git commit -m "fix: clear stuckReason when a mission is manually retried"
```

---

### Task 5: Exclude `'Needs Attention'` missions from crash-recovery scan

**Files:**
- Modify: `electron/ipc/mission.cjs:4642-4680` (`get_incomplete_missions`)
- Test: `electron/ipc/mission.getIncompleteMissions.test.cjs` (new file)

**Interfaces:**
- Consumes: snapshot files under `~/.claude/agent-teams-snapshots/*.json` with a `status` field (unchanged shape).
- Produces: no interface change — same return shape, just a stricter filter.

- [ ] **Step 1: Write the failing test**

Create `electron/ipc/mission.getIncompleteMissions.test.cjs`:

```js
// electron/ipc/mission.getIncompleteMissions.test.cjs
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import os from 'os';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);

const ELECTRON_PATH = require.resolve('electron');
const ipcHandlers = new Map();
function installFakeElectron() {
  require.cache[ELECTRON_PATH] = {
    id: ELECTRON_PATH, filename: ELECTRON_PATH, loaded: true,
    exports: {
      ipcMain: { handle: (channel, fn) => { ipcHandlers.set(channel, fn); }, on: () => {} },
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

const CROSS_SPAWN_PATH = require.resolve('cross-spawn');
function installFakeCrossSpawn() {
  require.cache[CROSS_SPAWN_PATH] = {
    id: CROSS_SPAWN_PATH, filename: CROSS_SPAWN_PATH, loaded: true,
    exports: { spawn: () => { throw new Error('not used in this test'); } },
  };
}

function freshMission() {
  installFakeElectron();
  installFakeCrossSpawn();
  delete require.cache[require.resolve('./mission.cjs')];
  delete require.cache[require.resolve('../lib/cliAdapters/index.cjs')];
  delete require.cache[require.resolve('../lib/cliAdapters/claudeAdapter.cjs')];
  delete require.cache[require.resolve('../lib/cliAdapters/copilotAdapter.cjs')];
  const mission = require('./mission.cjs');
  mission.__setMissionStateForTest(null);
  ipcHandlers.clear();
  const fakeWindow = { isDestroyed: () => false, webContents: { send: () => {} } };
  mission(() => fakeWindow);
  return mission;
}

const snapshotsDir = path.join(os.homedir(), '.claude', 'agent-teams-snapshots');
const testSnapshotPath = path.join(snapshotsDir, 'test-needs-attention-mission.json');

describe('get_incomplete_missions — excludes Needs Attention snapshots', () => {
  beforeEach(() => {
    freshMission();
    fs.mkdirSync(snapshotsDir, { recursive: true });
  });

  afterEach(() => {
    try { fs.unlinkSync(testSnapshotPath); } catch (_) {}
  });

  test('a snapshot with status Needs Attention is not returned', async () => {
    fs.writeFileSync(testSnapshotPath, JSON.stringify({
      id: 'test-needs-attention-mission',
      description: 'stuck on QA retry',
      project_path: '/tmp/proj',
      status: 'Needs Attention',
      phase: 'Executing',
      started_at: Date.now(),
      agents: [], tasks: [], log: [],
    }));

    const handler = ipcHandlers.get('get_incomplete_missions');
    const result = await handler(null);

    expect(result.some(m => m.id === 'test-needs-attention-mission')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/ipc/mission.getIncompleteMissions.test.cjs`
Expected: FAIL — the `Needs Attention` snapshot is included in the result.

- [ ] **Step 3: Write minimal implementation**

In `electron/ipc/mission.cjs`, modify the condition inside `get_incomplete_missions` (line ~4656):

```js
if (status !== 'Completed' && status !== 'Failed' && status !== 'Stopped'
    && status !== 'Needs Attention') {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/ipc/mission.getIncompleteMissions.test.cjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/mission.cjs electron/ipc/mission.getIncompleteMissions.test.cjs
git commit -m "fix: exclude Needs Attention missions from crash-recovery scan"
```

---

### Task 6: `fix_qa_failures.md` prompt template

**Files:**
- Create: `electron/prompts/fix_qa_failures.md`

**Interfaces:**
- Consumes: nothing (static template file).
- Produces: a template with placeholders `{{PROJECT_PATH}}`, `{{PROJECT_TYPE}}`, `{{SUMMARY}}`, `{{QA_FAILURES}}`, `{{PRIOR_ROSTER}}`, `{{PERMISSION_MODE}}` — consumed by Task 9's `create_qa_fix_mission` handler via `PROMPT_FIX_QA_FAILURES`.

This template has no test of its own (it's static content rendered and asserted on on the *consuming* side, in Task 9's test) — write it directly.

- [ ] **Step 1: Write the file**

Create `electron/prompts/fix_qa_failures.md`:

```markdown
You are fixing QA failures in an existing project in this directory: {{PROJECT_PATH}}
Project type: {{PROJECT_TYPE}}

**Do NOT re-plan or redesign the project. Your only job is to make the listed QA
failures below pass. The prior mission already built this project — you are not
starting over.**

## PREVIOUS WORK STATUS
{{SUMMARY}}

## QA FAILURES TO FIX
{{QA_FAILURES}}

## PRIOR AGENT ROSTER
{{PRIOR_ROSTER}}

## EXECUTION PROTOCOL (Agent Teams)

### Step 1: Team Setup
1. Create a team via TeamCreate with team_name="qa-fix"
2. Recreate the roster listed in PRIOR AGENT ROSTER above — do not add agents
   beyond what's needed to fix the listed failures. Do not invent new roles.
3. Spawn agents via Agent tool with team_name="qa-fix" and subagent_type="general-purpose"
4. mode: "bypassPermissions" for each agent
5. Spawn agents in parallel when possible

### Step 2: Agent Work Instructions
Each agent prompt MUST include:
1. cd into working directory: {{PROJECT_PATH}}
2. Focus ONLY on the QA FAILURES TO FIX listed above — do not touch unrelated code
3. Install dependencies if needed: {{PROJECT_TYPE}}
4. After making a fix, BUILD AND VERIFY: {{PROJECT_TYPE}}
5. If build fails, READ the error, FIX the code, re-run until passing
6. Re-run the specific failing check(s) described in QA FAILURES TO FIX, not just a build
7. Use SendMessage to notify Lead and teammates of progress
8. Print '[<name>] VERIFIED: <evidence>' with actual output showing the failure is fixed

### Step 3: Active Monitoring (CRITICAL)
After spawning, ACTIVELY monitor:
1. Read messages from teammates as they are auto-delivered
2. **When a teammate ASKS a question** (via SendMessage):
   - If you know the answer from project context, docs, or reference materials → reply directly
   - If the question requires a decision only the user can make → escalate to the user using the QUESTION PROTOCOL (if in interactive mode)
   - ALWAYS reply promptly — teammates are BLOCKED waiting for your answer
3. When a teammate reports BUILD_RESULT: PASS, mark them as **done** — even if they go silent after that, do NOT wait for further messages from them
4. If a teammate reports errors or is stuck, send them specific fix guidance via SendMessage
   - If no progress after 2 SendMessage exchanges → **reassign their remaining tasks to another active teammate**
   - **Do NOT shut down the mission** because one agent is stuck or unresponsive
5. If a teammate goes silent WITHOUT printing BUILD_RESULT:
   - Send one status-check message. If no response, assume stuck.
   - Reassign their incomplete tasks to another teammate and continue
6. Track completion — each teammate should report verification evidence tied to a specific listed failure

### Step 4: Final Verification & Shutdown
When all teammates have reported completion OR been reassigned/timed out:
1. Run final build verification yourself: {{PROJECT_TYPE}}
2. Re-verify every failure listed in QA FAILURES TO FIX is actually resolved
3. If verification fails, send the error to the responsible teammate to fix. If they are no longer active, spawn a new teammate for the same role and hand it the error — never fix it yourself
4. Only after PASSING: send shutdown_request to each teammate
   - **Do NOT wait for acknowledgement** — agents that completed their work may have gone idle, that is normal
   - Proceed to cleanup after sending shutdown_request regardless of response
5. Print final summary with evidence, mapped to each fixed failure

⚠ **CRITICAL — NEVER end the mission early:**
- One agent failing or going idle does NOT mean the mission fails
- Always reassign incomplete work and continue with other agents
- Only consider the mission done when every listed QA failure is verified fixed

## QUALITY GATES
- Every failure listed in QA FAILURES TO FIX is verified fixed, not just "build passes"
- All code must be COMPLETE (no TODO/placeholder/stub)
- Dependencies installed and importable
- Build/compile passes with 0 errors
- App is runnable

{{PERMISSION_MODE}}

Begin now.
```

- [ ] **Step 2: Commit**

```bash
git add electron/prompts/fix_qa_failures.md
git commit -m "feat: add fix-only prompt template for QA-fix missions"
```

---

### Task 7: `buildQaFailuresSection` / `buildPriorRosterSection` helpers

**Files:**
- Modify: `electron/ipc/mission.cjs` (add after `buildMissionSummary`, ~line 1062), test-only-exports guard block
- Test: `electron/ipc/mission.qaFixSections.test.js` (new file)

**Interfaces:**
- Consumes: `state.tasks` (with `lastFailureDetail` from Task 1), `agents` array (existing shape: `{name, role, model, backend}`).
- Produces: `buildQaFailuresSection(tasks): string`, `buildPriorRosterSection(agents): string` — consumed by Task 9's `create_qa_fix_mission` handler.

- [ ] **Step 1: Write the failing test**

Create `electron/ipc/mission.qaFixSections.test.js`:

```js
import { describe, test, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const mission = require('./mission.cjs');

describe('buildQaFailuresSection', () => {
  test('renders one bullet per task with a lastFailureDetail', () => {
    const tasks = [
      { title: 'Checkout flow', lastFailureDetail: { responsibleAgent: 'Dev', reason: 'fails 6/7 specs' } },
      { title: 'Add logging', status: 'completed' },
    ];
    const section = mission.__buildQaFailuresSectionForTest(tasks);
    expect(section).toContain('Checkout flow');
    expect(section).toContain('Dev');
    expect(section).toContain('fails 6/7 specs');
    expect(section).not.toContain('Add logging');
  });

  test('falls back to a note when no task has a lastFailureDetail', () => {
    const section = mission.__buildQaFailuresSectionForTest([{ title: 'Add logging', status: 'completed' }]);
    expect(section).toContain('No per-task failure reason was captured');
  });
});

describe('buildPriorRosterSection', () => {
  test('lists every non-Lead agent with model and backend', () => {
    const agents = [
      { name: 'Lead', role: 'Orchestrator', model: 'opus', backend: 'claude' },
      { name: 'Dev', role: 'Developer', model: 'sonnet', backend: 'claude' },
    ];
    const section = mission.__buildPriorRosterSectionForTest(agents);
    expect(section).toContain('Dev');
    expect(section).toContain('sonnet');
    expect(section).not.toContain('Lead (Orchestrator)');
  });

  test('falls back to a note when there are no non-Lead agents', () => {
    const section = mission.__buildPriorRosterSectionForTest([{ name: 'Lead', role: 'Orchestrator' }]);
    expect(section).toContain('No prior Dev agents recorded');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/ipc/mission.qaFixSections.test.js`
Expected: FAIL — `mission.__buildQaFailuresSectionForTest is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `electron/ipc/mission.cjs`, immediately after `buildMissionSummary` (after its closing `}`, ~line 1062):

```js
function buildQaFailuresSection(tasks) {
  const withDetail = (tasks || []).filter(t => t.lastFailureDetail);
  if (!withDetail.length) {
    return '- (No per-task failure reason was captured — the final QA sweep itself ' +
      'reported failures. Re-run or re-derive what is failing before assuming success.)';
  }
  return withDetail
    .map(t => `- ${t.title} (owner: ${t.lastFailureDetail.responsibleAgent || 'unknown'}): ${t.lastFailureDetail.reason || '(no reason given)'}`)
    .join('\n');
}

function buildPriorRosterSection(agents) {
  const devs = (agents || []).filter(a => a.name !== 'Lead');
  if (!devs.length) {
    return '- (No prior Dev agents recorded — Lead worked alone.)';
  }
  return devs
    .map(a => `- ${a.name} (${a.role || 'Dev'}), model: ${a.model || 'sonnet'}, backend: ${a.backend || 'claude'}`)
    .join('\n');
}
```

Then add to the test-only-exports guard block:

```js
module.exports.__buildQaFailuresSectionForTest = (tasks) => buildQaFailuresSection(tasks);
module.exports.__buildPriorRosterSectionForTest = (agents) => buildPriorRosterSection(agents);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/ipc/mission.qaFixSections.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/mission.cjs electron/ipc/mission.qaFixSections.test.js
git commit -m "feat: add QA-failures and prior-roster prompt section builders"
```

---

### Task 8: `create_qa_fix_mission` IPC handler

**Files:**
- Modify: `electron/ipc/mission.cjs` — add `PROMPT_FIX_QA_FAILURES` constant (~line 88), add new `ipcMain.handle('create_qa_fix_mission', ...)` immediately after the `continue_mission` handler (after line 4185)
- Test: `electron/ipc/mission.createQaFixMission.test.cjs` (new file)

**Interfaces:**
- Consumes: `buildMissionSummary`, `buildQaFailuresSection`, `buildPriorRosterSection` (Tasks 2 & 7), `PROMPT_FIX_QA_FAILURES` (Task 6's file), existing `stop_mission`-style cleanup functions (`stopWatcher`, `stopAutosave`, `stopStuckChecker`, `clearAgentTeamsTimer`, `clearPendingRetryTimer`, `killChild`, `discardActiveRecording`, `mockupServers`, `saveMissionSnapshot`, `makeLogEntry`, `now`), existing `continue_mission`-style spawn helpers (`detectProjectTypeCont`, `buildPermissionModeSection`, `agentBackendOf`, `spawnAgentProcess`, `startAutosave`, `startStuckChecker`, `startFileWatcher`, `readProcessStdout_deploy`, `readProcessStderr`, `watchProcessExit_deploy`).
- Produces: new `missionState` with `forked_from` set to the old mission's id — consumed by `MissionHistoryPanel.jsx`'s existing "↳ từ:" badge (no changes needed there) and by Task 10's frontend button.

- [ ] **Step 1: Write the failing test**

Create `electron/ipc/mission.createQaFixMission.test.cjs`:

```js
// electron/ipc/mission.createQaFixMission.test.cjs
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import { EventEmitter } from 'events';
import { Readable } from 'stream';

const require = createRequire(import.meta.url);

const ELECTRON_PATH = require.resolve('electron');
const ipcHandlers = new Map();
const windowSendCalls = [];
function installFakeElectron() {
  require.cache[ELECTRON_PATH] = {
    id: ELECTRON_PATH, filename: ELECTRON_PATH, loaded: true,
    exports: {
      ipcMain: { handle: (channel, fn) => { ipcHandlers.set(channel, fn); }, on: () => {} },
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

const spawnCalls = [];
let nextFakeProc = null;
const CROSS_SPAWN_PATH = require.resolve('cross-spawn');
function installFakeCrossSpawn() {
  require.cache[CROSS_SPAWN_PATH] = {
    id: CROSS_SPAWN_PATH, filename: CROSS_SPAWN_PATH, loaded: true,
    exports: {
      spawn: (...callArgs) => {
        spawnCalls.push(callArgs);
        return nextFakeProc || makeFakeProc();
      },
    },
  };
}

function makeFakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new Readable({ read() {} });
  proc.stderr = new Readable({ read() {} });
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.pid = 9999;
  proc.kill = () => { proc.killed = true; };
  return proc;
}

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
  mission(() => fakeWindow);
  return mission;
}

function stuckMissionState() {
  return {
    id: 'old-mission-1', description: 'Build the checkout flow',
    project_path: '/tmp/proj', status: 'Needs Attention', phase: 'Executing',
    execution_mode: 'agent_teams', permission_mode: 'auto', backend: 'claude',
    autoResumeCount: 4, stuckReason: 'final_qa_retry_exhausted',
    question_history: [], started_at: 1000, ended_at: null,
    agents: [
      { name: 'Lead', role: 'Orchestrator', status: 'Idle', model: 'opus', backend: 'claude', current_task: null },
      { name: 'Dev', role: 'Developer', status: 'Idle', model: 'sonnet', backend: 'claude', current_task: null },
    ],
    tasks: [
      {
        id: 't1', title: 'Checkout flow', status: 'failed_qa', assigned_agent: 'Dev', qcRound: 3,
        lastFailureDetail: { stage: 'qa', reason: 'fails 6/7 Playwright specs', responsibleAgent: 'Dev', timestamp: 900 },
      },
    ],
    log: [], file_changes: [], raw_output: [], messages: [], team_name: 'qa-fix',
  };
}

describe('create_qa_fix_mission', () => {
  let mission;

  beforeEach(() => {
    mission = freshMission();
  });

  afterEach(() => {
    mission.__setMissionStateForTest(null);
  });

  test('rejects when mission is not in the exact stuck state', async () => {
    mission.__setMissionStateForTest({ id: 'm1', status: 'Running' });
    const handler = ipcHandlers.get('create_qa_fix_mission');

    const result = await handler(null, {});

    expect(result.ok).toBe(false);
  });

  test('stops the old mission, forks a new one, and seeds the prompt with QA failures and roster', async () => {
    const proc = makeFakeProc();
    nextFakeProc = proc;
    mission.__setMissionStateForTest(stuckMissionState());

    const handler = ipcHandlers.get('create_qa_fix_mission');
    const result = await handler(null, {});

    expect(result.ok).toBe(true);
    expect(spawnCalls.length).toBe(1);

    const newState = mission.__getMissionStateForTest();
    expect(newState.id).not.toBe('old-mission-1');
    expect(newState.forked_from).toBe('old-mission-1');
    expect(newState.status).toBe('Running');
    expect(newState.agents.map(a => a.name)).toEqual(['Lead']);

    const writtenPrompt = proc.stdin.write.mock.calls[0][0];
    expect(writtenPrompt).toContain('Checkout flow');
    expect(writtenPrompt).toContain('fails 6/7 Playwright specs');
    expect(writtenPrompt).toContain('Dev (Developer), model: sonnet, backend: claude');
    expect(writtenPrompt).toContain('Do NOT re-plan or redesign the project');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run electron/ipc/mission.createQaFixMission.test.cjs`
Expected: FAIL — `ipcHandlers.get('create_qa_fix_mission')` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `electron/ipc/mission.cjs`, add the new prompt-template constant near the existing template constants (after the `PROMPT_REPLAN` block, ~line 88):

```js
const PROMPT_FIX_QA_FAILURES = fs.readFileSync(promptPath('fix_qa_failures.md'), 'utf8');
```

Then add the new handler immediately after the `continue_mission` handler's closing `});` (after line 4185):

```js
ipcMain.handle('create_qa_fix_mission', async () => {
  if (!missionState || missionState.status !== 'Needs Attention' ||
      missionState.stuckReason !== 'final_qa_retry_exhausted') {
    return { ok: false, error: 'Mission is not in the final-QA-retry-exhausted stuck state' };
  }

  // 1. Snapshot the old mission's relevant fields before cleanup mutates them.
  const oldState = missionState;
  const oldId = oldState.id;
  const oldDesc = oldState.description || '';
  const oldProjectPath = oldState.project_path || '';
  const oldExecMode = oldState.execution_mode || 'standard';
  const oldPermissionMode = oldState.permission_mode || 'auto';
  const oldBackend = oldState.backend || 'claude';
  const oldAgents = oldState.agents || [];
  const oldLeadAgent = oldAgents.find(a => a.name === 'Lead') || {};
  const oldLeadModel = oldLeadAgent.model || 'sonnet';
  const oldLeadBackend = oldLeadAgent.backend || oldBackend;
  let oldSummary = buildMissionSummary(oldState);
  if (oldSummary.length > 40_000) {
    oldSummary = oldSummary.slice(0, 40_000) + '\n... (context truncated to fit API limits)';
  }
  const qaFailuresSection = buildQaFailuresSection(oldState.tasks);
  const priorRosterSection = buildPriorRosterSection(oldAgents);

  // 2. Reuse stop_mission's cleanup; mark the OLD mission Stopped and snapshot it.
  discardActiveRecording();
  stopWatcher();
  stopAutosave();
  stopStuckChecker();
  clearAgentTeamsTimer();
  clearPendingRetryTimer();
  killChild();
  for (const server of Object.values(mockupServers)) {
    try { server.close(); } catch { /* ignore */ }
  }
  Object.keys(mockupServers).forEach(k => delete mockupServers[k]);

  oldState.status = 'Stopped';
  for (const a of oldState.agents) {
    if (a.status === 'Working' || a.status === 'Spawning') {
      a.status = 'Idle';
      a.current_task = null;
    }
  }
  saveMissionSnapshot(oldState);

  // 5. Create the new missionState, forked from the old one.
  const ts = now();
  missionState = {
    id:              `mission-${ts}`,
    description:     oldDesc,
    project_path:    oldProjectPath,
    status:          'Running',
    phase:           'Deploying',
    execution_mode:  oldExecMode,
    permission_mode: oldPermissionMode,
    backend:         oldBackend,
    question_history: [],
    started_at:      ts,
    ended_at:        null,
    forked_from:     oldId,
    forked_from_desc: oldDesc,
    agents: [{
      name: 'Lead', role: 'Orchestrator',
      status: 'Working', current_task: 'Starting QA fix mission...',
      model: oldLeadModel, spawned_at: ts, model_reason: null,
      backend: oldLeadBackend,
    }],
    tasks:           [],
    log:             [makeLogEntry(ts, 'System', `QA fix mission forked from stuck mission: ${oldId}`, 'info')],
    file_changes:    [],
    raw_output:      [],
    messages:        [],
    team_name:       null,
  };

  sendToWindow('mission:agent-spawned', {
    agent_name: 'Lead', role: 'Orchestrator', timestamp: ts, reset: true,
  });
  sendToWindow('mission:log', {
    timestamp: ts, agent: 'System',
    message: `QA fix mission forked from stuck mission: ${oldId}`, log_type: 'info',
  });
  sendToWindow('mission:status', { status: 'running', mission_id: missionState.id, forked_from: oldId });

  // 6. Build the fix-only prompt and spawn.
  const projectTypeHint = detectProjectTypeCont(oldProjectPath);
  const permModeSection = buildPermissionModeSection(oldPermissionMode);
  const fixPrompt = PROMPT_FIX_QA_FAILURES
    .replace('{{PROJECT_PATH}}', oldProjectPath.replace(/\\/g, '/'))
    .replace('{{PROJECT_TYPE}}', projectTypeHint)
    .replace('{{PERMISSION_MODE}}', permModeSection)
    .replace('{{SUMMARY}}', oldSummary || 'No previous work recorded.')
    .replace('{{QA_FAILURES}}', qaFailuresSection)
    .replace('{{PRIOR_ROSTER}}', priorRosterSection);

  const fixBackend = agentBackendOf(missionState.agents.find(a => a.name === 'Lead'));
  const attemptSpawnFix = (attempt, resumeSessionId) => {
    const { proc, promptViaStdin } = spawnAgentProcess({
      backendId: fixBackend, model: oldLeadModel, prompt: fixPrompt,
      resumeSessionId, maxTurns: 200, useAgentTeams: true,
      cwd: oldProjectPath, sendToWindow,
    });

    try {
      if (!resumeSessionId && promptViaStdin) {
        proc.stdin.write(fixPrompt, 'utf8');
      }
      proc.stdin.end();
    } catch (e) {
      const entry = makeLogEntry(now(), 'System', `Failed to write QA fix prompt: ${e.message}`, 'error');
      if (missionState) missionState.log.push(entry);
      sendToWindow('mission:log', entry);
      return;
    }

    childProcess = proc;
    if (missionState) missionState.phase = 'Executing';
    startAutosave();
    startStuckChecker(sendToWindow, false);
    startFileWatcher(oldProjectPath, sendToWindow);

    const attemptCtx = { stdoutText: '', stderrText: '', sessionId: null, backend: fixBackend };
    const missionIdForWatch = missionState ? missionState.id : 'unknown';
    const retryInfo = {
      attemptCtx, attempt, maxAttempts: 3, backoffMs: [30000, 60000, 120000],
      retrySpawn: (nextAttempt, nextSessionId) => attemptSpawnFix(nextAttempt, nextSessionId),
    };
    attemptCtx.retryInfo = retryInfo;

    readProcessStdout_deploy(proc, sendToWindow, true, attemptCtx);
    readProcessStderr(proc, sendToWindow, attemptCtx);
    watchProcessExit_deploy(proc, missionIdForWatch, sendToWindow, retryInfo);
  };
  attemptSpawnFix(1, null);

  return { ok: true, mission_id: missionState.id };
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run electron/ipc/mission.createQaFixMission.test.cjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full backend regression suite**

Run: `npx vitest run electron/ipc/mission.backend.test.cjs electron/ipc/mission.autoResume.test.js electron/ipc/mission.test.cjs electron/ipc/mission.retryMockupGeneration.test.js`
Expected: PASS — no shared code path broken by the new handler or constant.

- [ ] **Step 6: Commit**

```bash
git add electron/ipc/mission.cjs electron/ipc/mission.createQaFixMission.test.cjs
git commit -m "feat: add create_qa_fix_mission handler to fork a fix-only mission"
```

---

### Task 9: "Stop & create fix mission" button in `MissionHeader.jsx`

**Files:**
- Modify: `src/components/mission/MissionHeader.jsx`
- Test: `src/components/mission/MissionHeader.test.jsx` (new file)

**Interfaces:**
- Consumes: `state.status`, `state.stuckReason` (from Task 3), a new `onCreateQaFixMission` prop.
- Produces: renders a button calling `onCreateQaFixMission()` when clicked, only when `state.status === 'Needs Attention' && state.stuckReason === 'final_qa_retry_exhausted'` — consumed by Task 11's wiring.

- [ ] **Step 1: Write the failing tests**

Create `src/components/mission/MissionHeader.test.jsx` (modeled on `src/components/mission/StatusBadge.test.jsx`'s plain-props RTL pattern):

```jsx
import { describe, test, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MissionHeader } from './MissionHeader'

function baseState(overrides = {}) {
  return {
    id: 'm1', description: 'Build the checkout flow', status: 'Running',
    ...overrides,
  }
}

describe('MissionHeader — Stop & create fix mission button', () => {
  test('renders when stuck on exhausted final-QA retry', () => {
    const onCreateQaFixMission = vi.fn()
    render(
      <MissionHeader
        state={baseState({ status: 'Needs Attention', stuckReason: 'final_qa_retry_exhausted' })}
        onStop={vi.fn()} onNewMission={vi.fn()} elapsed={0}
        onCreateQaFixMission={onCreateQaFixMission}
      />
    )

    const button = screen.getByRole('button', { name: /fix mission/i })
    fireEvent.click(button)
    expect(onCreateQaFixMission).toHaveBeenCalledTimes(1)
  })

  test('does not render for the other Needs Attention cause (per-task escalation ceiling)', () => {
    render(
      <MissionHeader
        state={baseState({ status: 'Needs Attention', stuckReason: null })}
        onStop={vi.fn()} onNewMission={vi.fn()} elapsed={0}
        onCreateQaFixMission={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: /fix mission/i })).toBeNull()
  })

  test('does not render while Running', () => {
    render(
      <MissionHeader
        state={baseState({ status: 'Running' })}
        onStop={vi.fn()} onNewMission={vi.fn()} elapsed={0}
        onCreateQaFixMission={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: /fix mission/i })).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/mission/MissionHeader.test.jsx`
Expected: FAIL — no element matches `/fix mission/i`.

- [ ] **Step 3: Write minimal implementation**

Read `src/components/mission/MissionHeader.jsx` first, then add, right after the existing Stop button's closing tag and before the New Mission button:

```jsx
const isStuckOnQaRetry = state.status === 'Needs Attention'
  && state.stuckReason === 'final_qa_retry_exhausted'
```

(placed near the top of the component body, alongside any other derived booleans), and in the JSX button row:

```jsx
{isStuckOnQaRetry && (
  <button
    onClick={onCreateQaFixMission}
    className="px-3 py-1.5 text-sm rounded-md bg-amber-600 hover:bg-amber-700 text-white"
  >
    Stop &amp; create fix mission
  </button>
)}
```

Add `onCreateQaFixMission` to the component's destructured props list.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/mission/MissionHeader.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/mission/MissionHeader.jsx src/components/mission/MissionHeader.test.jsx
git commit -m "feat: add Stop & create fix mission button for exhausted final-QA retry"
```

---

### Task 10: `createQaFixMission` in `useMission.js`

**Files:**
- Modify: `src/hooks/useMission.js`
- Test: `src/hooks/useMission.test.jsx`, `src/hooks/useMission.ipc-errors.test.jsx`

**Interfaces:**
- Consumes: `invoke('create_qa_fix_mission')` (Task 8's IPC handler, no args).
- Produces: `createQaFixMission()` function returned from `useMission()` — consumed by Task 11's wiring.

- [ ] **Step 1: Write the failing tests**

In `src/hooks/useMission.test.jsx`, add (following the file's existing success-path pattern for `retryAgent`/`stop`):

```js
test('createQaFixMission calls create_qa_fix_mission and shows a success toast', async () => {
  invoke.mockResolvedValueOnce({ ok: true, mission_id: 'mission-999' })
  const { result } = renderHook(() => useMission(), { wrapper })

  await act(async () => { await result.current.createQaFixMission() })

  expect(invoke).toHaveBeenCalledWith('create_qa_fix_mission', undefined)
})
```

(Adjust the `invoke` call-signature assertion to match this file's existing convention for no-arg calls, e.g. `invoke).toHaveBeenCalledWith('create_qa_fix_mission')` if that's how other no-arg handlers like `stop_mission` are asserted in this same file — check the existing `stop` test for the exact pattern before finalizing.)

In `src/hooks/useMission.ipc-errors.test.jsx`, add (following the exact `stop failure shows toast error` pattern already in that file):

```js
test('createQaFixMission failure shows toast error', async () => {
  const { result } = renderHook(() => useMission(), { wrapper })
  await act(async () => { await result.current.createQaFixMission() })
  const alerts = document.querySelectorAll('[role="alert"]')
  expect(alerts.length).toBeGreaterThan(0)
  expect(alerts[0].textContent).toContain('Không thể tạo fix mission')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/useMission.test.jsx src/hooks/useMission.ipc-errors.test.jsx -t "createQaFixMission"`
Expected: FAIL — `result.current.createQaFixMission is not a function`.

- [ ] **Step 3: Write minimal implementation**

Read `src/hooks/useMission.js` first, then add, right after the existing `retryAgent` function (before the final `return`):

```js
const createQaFixMission = useCallback(async () => {
  try {
    const result = await invoke('create_qa_fix_mission')
    if (result?.ok === false) {
      toast.error('Không thể tạo fix mission', result.error)
    } else {
      toast.info('Đang tạo mission mới để fix các lỗi QA...')
    }
  } catch (err) {
    toast.error('Không thể tạo fix mission', err?.message)
  }
}, [toast])
```

Add `createQaFixMission` to the final return object:

```js
return {
  missionState, isRunning, planReady, setPlanReady, isReplanning, pendingQuestions, mockupInfo,
  recoverableMission, setRecoverableMission,
  isRecording, startRecording, stopRecordingAndSave, discardRecording,
  launch, deploy, continueM, stop, reset, replan, answerQuestion, respondToMockup, retryAgent,
  createQaFixMission,
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/useMission.test.jsx src/hooks/useMission.ipc-errors.test.jsx`
Expected: PASS (full files, no regression).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useMission.js src/hooks/useMission.test.jsx src/hooks/useMission.ipc-errors.test.jsx
git commit -m "feat: add createQaFixMission to useMission hook"
```

---

### Task 11: Thread `onCreateQaFixMission` through `MissionDashboard.jsx` → `MissionControlPage.jsx`

**Files:**
- Modify: `src/components/mission/MissionDashboard.jsx`, `src/pages/MissionControlPage.jsx`

**Interfaces:**
- Consumes: `createQaFixMission` from `useMission()` (Task 10).
- Produces: `onCreateQaFixMission` prop reaching `<MissionHeader>` only on the live-mission dashboard render (not history/replay views).

No dedicated test for this task — confirmed via `grep -n "onRetryAgent|retryAgent" src/pages/MissionControlPage.replay-phases.test.jsx` that this codebase has no precedent for a dedicated prop-threading assertion test for this class of change (the equivalent existing `onRetryAgent` threading has none either); this is a lightweight wiring step verified by the existing test suites continuing to pass.

- [ ] **Step 1: Wire `MissionDashboard.jsx`**

In `src/components/mission/MissionDashboard.jsx`, add `onCreateQaFixMission` to the destructured props (line 28):

```jsx
export const MissionDashboard = memo(function MissionDashboard({ state, isRunning, onStop, onContinue, onNewMission, elapsed, isHistoryView, pendingQuestions, onAnswerQuestion, onRetryAgent, onCreateQaFixMission }) {
```

and pass it to `<MissionHeader>` (line 184):

```jsx
<MissionHeader state={state} onStop={isHistoryView ? null : onStop} onNewMission={onNewMission} elapsed={elapsed} onCreateQaFixMission={isHistoryView ? null : onCreateQaFixMission} />
```

- [ ] **Step 2: Wire `MissionControlPage.jsx`**

In `src/pages/MissionControlPage.jsx`, add `createQaFixMission` to the `useMission()` destructuring (line 25):

```jsx
const { missionState, isRunning, planReady, setPlanReady, isReplanning, pendingQuestions,
        mockupInfo, recoverableMission, setRecoverableMission,
        isRecording, startRecording, stopRecordingAndSave, discardRecording,
        launch, deploy, continueM, stop, reset, replan, answerQuestion, respondToMockup, retryAgent,
        createQaFixMission } = useMission()
```

and add `onCreateQaFixMission={createQaFixMission}` ONLY to the live-mission `<MissionDashboard>` render block (lines ~452-466):

```jsx
<MissionDashboard
  state={missionState}
  isRunning={isRunning}
  onStop={stop}
  onContinue={continueM}
  onNewMission={reset}
  elapsed={elapsed}
  pendingQuestions={pendingQuestions}
  onAnswerQuestion={answerQuestion}
  onRetryAgent={retryAgent}
  onCreateQaFixMission={createQaFixMission}
/>
```

Do NOT add this prop to the other `<MissionDashboard>` render sites (~line 232, ~line 390 — replay/history views).

- [ ] **Step 3: Run the full frontend regression suite**

Run: `npx vitest run src/components/mission src/pages/MissionControlPage.replay-phases.test.jsx src/hooks/useMission.test.jsx`
Expected: PASS — no regression in replay/history rendering or hook wiring.

- [ ] **Step 4: Commit**

```bash
git add src/components/mission/MissionDashboard.jsx src/pages/MissionControlPage.jsx
git commit -m "feat: wire Stop & create fix mission action into the live mission dashboard"
```

---

## Self-Review

**Spec coverage:**
- §1 (durably mark stuck state) → Tasks 3, 4, 5. ✅
- §2 (button, gating, prop threading) → Tasks 9, 11. ✅
- §3 (capture why QA failed, surface in summary) → Tasks 1, 2. ✅
- §4 (new IPC handler, prompt template, fork+cleanup) → Tasks 6, 7, 8, 10. ✅
- Testing strategy's five bullets (auto-resume give-up unit test, `handleQcQaFailure` unit test, `get_incomplete_missions` unit test, `create_qa_fix_mission` handler test, `MissionHeader.jsx` gating test) → Tasks 3, 1, 5, 8, 9 respectively. ✅
- Regression bullet (`mission.backend.test.cjs`, `mission.retryMockupGeneration.test.js` keep passing) → Task 8 Step 5. ✅

**Placeholder scan:** No "TBD"/"TODO"/"similar to Task N" — every step has real, complete code. Task 10's test includes one explicit note to double-check the exact `invoke` no-arg call-signature convention against the existing `stop` test before finalizing — this is a verification instruction, not a placeholder, since the fallback code itself (`await invoke('create_qa_fix_mission')`) is already concrete and correct either way.

**Type consistency:** `task.lastFailureDetail` shape (`{stage, reason, responsibleAgent, timestamp}`) is identical across Tasks 1, 2, 7, 8. `missionState.stuckReason` string literal `'final_qa_retry_exhausted'` is identical across Tasks 3, 4, 8, 9. Function names (`buildQaFailuresSection`, `buildPriorRosterSection`, `buildMissionSummary`, `PROMPT_FIX_QA_FAILURES`) are consistent between their defining task and every consuming task.

---

Plan complete and saved to `docs/superpowers/plans/2026-08-15-qa-stuck-mission-unstick.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
