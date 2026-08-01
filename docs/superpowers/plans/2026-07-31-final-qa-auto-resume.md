# Final QA Sweep Auto-Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the final whole-picture QA sweep fails after the driving `claude` process has already exited, automatically spawn a resumed (or fresh) process to continue the mission instead of requiring the user to click **Retry** manually.

**Architecture:** Extract the resume/fresh-spawn logic already duplicated in `answer_question` and `mockup_respond`'s `restartLeadAfterMockup` into one shared helper, `spawnResumeOrFreshAttempt`. Add a mission-level `autoResumeCount` counter with a ceiling of 3. Replace `finalizeDeployExit`'s current log-only branch (when `missionState.status === 'Running'` after the sweep) with a call into a new `autoResumeAfterFinalQaFailure` function that either calls the shared helper or falls back to today's manual-intervention message once the ceiling is hit.

**Tech Stack:** Node.js CommonJS (`electron/ipc/mission.cjs`), Vitest for tests (`electron/ipc/mission.test.cjs`).

## Global Constraints

- Ceiling: auto-resume stops after **3** consecutive attempts for the same mission, then falls back to the existing manual-intervention log message (per `docs/superpowers/specs/2026-07-31-final-qa-auto-resume-design.md` §2).
- `missionState.autoResumeCount` resets to `0` on: (a) mission reaching `Completed`, (b) manual `retry_agent` invocation (`retryAgentCore`).
- No new IPC channels, no new task/mission status values, no renderer/UI changes — reuse `mission:log`/`mission:status` exactly as today (spec, "Out of scope").
- `spawnResumeOrFreshAttempt` must produce byte-for-byte identical spawn args / reader wiring / status transitions for `answer_question` and `mockup_respond` as before the refactor — this is a pure extraction for those two call sites, not a behavior change.
- QC/QA gate itself (`runFinalQaSweep`, `handleQcQaFailure`), the transient-API-error retry (`isTransientApiError`/`retryTransientSpawn`), and the manual **Retry** button (`retry_agent`) are all untouched.

---

## File Structure

- **Modify:** `electron/ipc/mission.cjs`
  - New: `spawnResumeOrFreshAttempt(opts)` — shared resume/fresh-launch spawn helper.
  - New: `buildContinuationPrompt(reason, task)` — builds the fresh-launch continuation prompt (§5 of the design, fresh-launch case only; the resume case uses a short stdin nudge, not this builder).
  - New: `autoResumeAfterFinalQaFailure(missionId, sendToWindow, ts)` — decides resume-vs-give-up and drives the counter.
  - Modify: `finalizeDeployExit` — replace the log-only `if (missionState.status === 'Running')` branch with a call to `autoResumeAfterFinalQaFailure`.
  - Modify: `answer_question` IPC handler — replace its inline spawn block with a call to `spawnResumeOrFreshAttempt`.
  - Modify: `restartLeadAfterMockup` — replace its inline spawn block with a call to `spawnResumeOrFreshAttempt`.
  - Modify: `retryAgentCore` — reset `missionState.autoResumeCount = 0`.
  - Modify: `runFinalQaSweep` — reset `missionState.autoResumeCount = 0` in the PASS branch.
  - New test-only export: `module.exports.__autoResumeAfterFinalQaFailureForTest`.
- **Modify:** `electron/ipc/mission.test.cjs` — new `describe` blocks for `autoResumeAfterFinalQaFailure` and updated coverage for the `finalizeDeployExit` branch it replaces.

---

### Task 1: Add `autoResumeCount` field and reset points

**Files:**
- Modify: `electron/ipc/mission.cjs` (`retryAgentCore`, `runFinalQaSweep`)
- Test: `electron/ipc/mission.test.cjs`

**Interfaces:**
- Consumes: nothing new — `missionState` already exists as a module-level mutable object.
- Produces: `missionState.autoResumeCount` (`number`, absent/undefined treated as `0` by later tasks) — later tasks read and increment this field.

- [ ] **Step 1: Write the failing test for reset-on-manual-retry**

Add to `electron/ipc/mission.test.cjs`, inside a new `describe` block placed after the existing `describe('final sweep FAIL after process exit does not report a false Failed', ...)` block (around line 391):

```js
describe('autoResumeCount resets', () => {
  let mission

  beforeEach(() => {
    delete require.cache[require.resolve('./mission.cjs')]
    mission = require('./mission.cjs')
  })

  test('retryAgentCore resets autoResumeCount to 0', async () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      id: 'm1', status: 'Needs Attention', autoResumeCount: 2,
      tasks: [{ id: 't1', title: 'A', status: 'failed_qa', assigned_agent: 'Dev', qcRound: 3 }],
      agents: [{ name: 'Dev', status: 'Error', error: 'boom' }],
      log: [], project_path: '/tmp/proj', process: null,
    })
    mission.__setSendToWindowForTest(sendToWindow)

    await mission.__retryAgentForTest('Dev')

    const state = mission.__getMissionStateForTest()
    expect(state.autoResumeCount).toBe(0)
  })

  test('runFinalQaSweep PASS resets autoResumeCount to 0', async () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      id: 'm1', status: 'Running', autoResumeCount: 2,
      tasks: [{ id: 't1', title: 'A', status: 'completed', assigned_agent: 'Dev' }],
      agents: [{ name: 'Dev', status: 'Idle' }],
      log: [], project_path: '/tmp/proj', file_changes: [],
    })
    mission.__setSendToWindowForTest(sendToWindow)
    mission.__setQcQaRunnerForTest(async () => ({ verdict: 'PASS' }))

    await mission.__runFinalQaSweepForTest()

    const state = mission.__getMissionStateForTest()
    expect(state.status).toBe('Completed')
    expect(state.autoResumeCount).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run electron/ipc/mission.test.cjs -t "autoResumeCount resets"`
Expected: FAIL — `state.autoResumeCount` is `2` (unchanged) in both tests, since nothing resets it yet.

- [ ] **Step 3: Implement the reset in `retryAgentCore`**

In `electron/ipc/mission.cjs`, inside `retryAgentCore` (starts at line 390), add the reset right after the existing `agent.status = 'Idle';` / `task.status = 'pending';` block and before the `if (missionState.status === 'Needs Attention')` check:

```js
  agent.status = 'Idle';
  agent.error = null;
  task.status = 'pending';
  if (wasQcQaFailure) {
    task.qcRound = 0;
  }
  missionState.autoResumeCount = 0;
```

- [ ] **Step 4: Implement the reset in `runFinalQaSweep`'s PASS branch**

In `runFinalQaSweep` (starts at line 436), inside the `.then((verdict) => { if (verdict.verdict === 'PASS') { ... } })` block (line 467-469), add the reset:

```js
    if (verdict.verdict === 'PASS') {
      missionState.status = 'Completed';
      missionState.autoResumeCount = 0;
      sendToWindowRef('mission:status', { mission_id: missionState.id, status: 'Completed' });
    } else {
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run electron/ipc/mission.test.cjs -t "autoResumeCount resets"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add electron/ipc/mission.cjs electron/ipc/mission.test.cjs
git commit -m "feat: reset autoResumeCount on manual retry and final QA pass"
```

---

### Task 2: Extract `spawnResumeOrFreshAttempt` shared helper

This is a pure extraction: `answer_question` (starting at the `ipcMain.handle('answer_question', ...)` block) and `restartLeadAfterMockup` both build a resumed/fresh `claude` process the same way. This task creates one function that does that, then repoints both call sites at it with no behavior change. Task 3 will be the first caller that needs genuinely new behavior (the auto-resume path).

**Files:**
- Modify: `electron/ipc/mission.cjs`
- Test: `electron/ipc/mission.test.cjs`

**Interfaces:**
- Consumes: `spawnAgentProcess` (existing, `mission.cjs:1148`), `killChild` (existing, `mission.cjs:885`), `startAutosave`/`startStuckChecker` (existing, `mission.cjs:765`/`786`), `agentBackendOf` (existing, `mission.cjs:45`), `readProcessStdout_deploy`/`readProcessStdout_launch`, `readProcessStderr`, `watchProcessExit_deploy`/`watchProcessExit_launch`, `startFileWatcher`, `isTransientApiError` (all existing, unchanged).
- Produces:
  ```js
  function spawnResumeOrFreshAttempt({
    prompt,           // string — full prompt text for this continuation
    sendToWindow,     // function
    maxAttempts = 3,  // number — passed straight to the existing per-attempt backoff retry wiring
  }) // => boolean (true if the first spawn attempt succeeded, matching answer_question's existing `spawnOk` return convention)
  ```
  Reads `missionState.session_id`, `missionState.project_path`, `missionState.execution_mode`, `missionState.phase`, and `missionState.agents` (to find `Lead`'s `model`) directly off the module-level `missionState` — it does not take those as separate params, matching how `answer_question`/`restartLeadAfterMockup` already read them today.

- [ ] **Step 1: Write the failing test — behavior-preservation for `answer_question`**

This step captures a regression baseline *before* touching `answer_question`, so the refactor in Step 3 is provably behavior-preserving. Add to `electron/ipc/mission.test.cjs`:

```js
describe('spawnResumeOrFreshAttempt extraction preserves answer_question behavior', () => {
  let mission

  beforeEach(() => {
    delete require.cache[require.resolve('./mission.cjs')]
    mission = require('./mission.cjs')
  })

  test('answer_question spawns with --resume using the captured session_id', async () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      id: 'm1', status: 'WaitingForAnswer', phase: 'Executing',
      session_id: 'sess-abc', execution_mode: 'standard',
      tasks: [], agents: [{ name: 'Lead', model: 'sonnet', status: 'Idle' }],
      log: [], project_path: '/tmp/proj', process: null,
      _lastQuestions: [{ question: 'Use REST or GraphQL?' }],
      pendingQuestions: [0],
    })
    mission.__setSendToWindowForTest(sendToWindow)

    const spawnArgsSeen = []
    mission.__setSpawnAgentProcessForTest((spec) => {
      spawnArgsSeen.push(spec)
      const fakeProc = mission.__makeFakeChildProcessForTest()
      return { proc: fakeProc, promptViaStdin: true }
    })

    await mission.__answerQuestionForTest({
      answers: [{ question_index: 0, answer: 'REST' }],
    }, sendToWindow)

    expect(spawnArgsSeen).toHaveLength(1)
    expect(spawnArgsSeen[0].resumeSessionId).toBe('sess-abc')
    expect(spawnArgsSeen[0].model).toBe('sonnet')
    expect(spawnArgsSeen[0].cwd).toBe('/tmp/proj')
  })
})
```

This test introduces two new test hooks needed to make `answer_question` (an `ipcMain.handle` callback, not currently exported directly) and process spawning testable in isolation: `__setSpawnAgentProcessForTest`, `__makeFakeChildProcessForTest`, and `__answerQuestionForTest`. These are added in Step 2 below alongside the refactor, since a pure "write the test first" step is not meaningful without a seam to inject the fake spawn — the test and the seam are added together, then Step 3 confirms the seam works by running it.

- [ ] **Step 2: Add test seams and the shared helper**

In `electron/ipc/mission.cjs`, add the shared helper function near `spawnAgentProcess` (after its closing brace, i.e. after line 1220):

```js
// ─────────────────────────────────────────────────────────────────
// spawnResumeOrFreshAttempt — shared resume-or-fresh-launch spawn used by
// answer_question, restartLeadAfterMockup, and auto-resume after a final
// QA sweep failure. Resumes missionState.session_id when present;
// spawnAgentProcess itself drops resumeSessionId to produce a fresh
// launch when it's null or the backend doesn't support resume — no
// separate fresh-launch branch is needed here.
// ─────────────────────────────────────────────────────────────────
function spawnResumeOrFreshAttempt({ prompt, sendToWindow, maxAttempts = 3 }) {
  const sessionId = missionState.session_id || null;
  const leadModel = missionState.agents.find(a => a.name === 'Lead')?.model || 'sonnet';
  const projectPath = missionState.project_path;
  const execMode = missionState.execution_mode || 'standard';
  const backend = agentBackendOf(missionState.agents.find(a => a.name === 'Lead'));
  const isPlanning = missionState.phase === 'Planning';

  const spawnAttempt = (attempt) => {
    killChild();
    const { proc, promptViaStdin } = spawnAgentProcess({
      backendId: backend, model: leadModel, prompt,
      resumeSessionId: sessionId, maxTurns: 200,
      useAgentTeams: execMode === 'agent_teams',
      cwd: projectPath, sendToWindow,
    });

    try {
      if (promptViaStdin) proc.stdin.write(prompt, 'utf8');
      proc.stdin.end();
    } catch (e) {
      const entry = makeLogEntry(now(), 'System', `Failed to write continuation prompt: ${e.message}`, 'error');
      if (missionState) missionState.log.push(entry);
      sendToWindow('mission:log', entry);
      return false;
    }

    childProcess = proc;
    if (missionState) missionState.status = 'Running';
    startAutosave();
    startStuckChecker(sendToWindow, false);

    const attemptCtx = { stdoutText: '', stderrText: '', sessionId: null, backend };
    const retryInfo = {
      attemptCtx, attempt, maxAttempts, backoffMs: [30000, 60000, 120000],
      retrySpawn: (nextAttempt) => spawnAttempt(nextAttempt),
    };
    attemptCtx.retryInfo = retryInfo;

    if (isPlanning) {
      readProcessStdout_launch(proc, missionState.id, sendToWindow, attemptCtx);
      readProcessStderr(proc, sendToWindow, attemptCtx);
      watchProcessExit_launch(proc, missionState.id, sendToWindow, retryInfo);
    } else {
      readProcessStdout_deploy(proc, sendToWindow, false, attemptCtx);
      readProcessStderr(proc, sendToWindow, attemptCtx);
      watchProcessExit_deploy(proc, missionState.id, sendToWindow, retryInfo);
      if (execMode === 'agent_teams' && projectPath) {
        startFileWatcher(projectPath, sendToWindow);
      }
    }

    return true;
  };

  return spawnAttempt(1);
}
```

Then add the test-only seams in the `if (process.env.NODE_ENV === 'test' || process.env.VITEST)` block (around line 4424), right after `__setQcQaRunnerForTest`:

```js
  let _spawnAgentProcessOverride = null;
  module.exports.__setSpawnAgentProcessForTest = (fn) => { _spawnAgentProcessOverride = fn; };
  module.exports.__makeFakeChildProcessForTest = () => {
    const { EventEmitter } = require('events');
    const proc = new EventEmitter();
    proc.stdin = { write: () => {}, end: () => {} };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => {};
    return proc;
  };
```

Because `spawnAgentProcess` is called directly (not through an injectable field) throughout the file, add the override check at the very top of the real `spawnAgentProcess` function body (line 1148), so tests can intercept it without changing any call site:

```js
function spawnAgentProcess(spec = {}) {
  if ((process.env.NODE_ENV === 'test' || process.env.VITEST) && typeof _spawnAgentProcessOverride === 'function') {
    return _spawnAgentProcessOverride(spec);
  }
  const backendId       = spec.backendId || (missionState && missionState.backend) || 'claude';
  // ...rest unchanged
```

Finally, add `__answerQuestionForTest` next to the other test hooks — it must invoke the exact same logic the real `ipcMain.handle('answer_question', ...)` callback runs. Since that callback is currently defined inline inside `registerMission`, extract its body into a standalone named function `answerQuestionCore(args, sendToWindow)` (Task 3 does this extraction as part of repointing it at the shared helper), then export:

```js
  module.exports.__answerQuestionForTest = (args, sendToWindow) => answerQuestionCore(args, sendToWindow);
```

- [ ] **Step 3: Run test to verify it fails for the right reason**

Run: `npx vitest run electron/ipc/mission.test.cjs -t "spawnResumeOrFreshAttempt extraction preserves answer_question behavior"`
Expected: FAIL — `mission.__answerQuestionForTest is not a function` (it doesn't exist yet; `answer_question`'s body hasn't been extracted into `answerQuestionCore` yet). This confirms the test is exercising real wiring, not a stub.

- [ ] **Step 4: Commit the helper and test seams (extraction of `answer_question` itself happens in Task 3)**

```bash
git add electron/ipc/mission.cjs electron/ipc/mission.test.cjs
git commit -m "feat: add spawnResumeOrFreshAttempt shared helper and test seams"
```

---

### Task 3: Repoint `answer_question` and `restartLeadAfterMockup` at the shared helper

**Files:**
- Modify: `electron/ipc/mission.cjs`
- Test: `electron/ipc/mission.test.cjs`

**Interfaces:**
- Consumes: `spawnResumeOrFreshAttempt` (from Task 2).
- Produces: `answerQuestionCore(args, sendToWindow)` — standalone function, body extracted from the current inline `ipcMain.handle('answer_question', ...)` callback, called both by the real handler and by `__answerQuestionForTest`.

- [ ] **Step 1: Extract `answer_question`'s handler body into `answerQuestionCore`**

Locate the current handler (`electron/ipc/mission.cjs:3656-3770`). Extract everything between `const { answers = [] } = args || {};` and the final `return null;` into a new top-level function:

```js
async function answerQuestionCore(args, sendToWindow) {
  const { answers = [] } = args || {};

  if (!missionState) {
    return 'No active mission';
  }
  if (!missionState.session_id) {
    return 'No session ID captured — cannot resume Claude session';
  }
  if (missionState.status !== 'WaitingForAnswer') {
    return 'Mission is not waiting for an answer';
  }

  const ts = now();

  const answerLines = answers.map(a => {
    const qObj = missionState._lastQuestions && missionState._lastQuestions[a.question_index];
    const qText = qObj ? qObj.question : `Question #${a.question_index}`;
    return `**Q:** ${qText}\n**A:** ${a.answer}${a.note ? ` (Note: ${a.note})` : ''}`;
  });
  const answerPrompt = `The user has answered your questions:\n\n${answerLines.join('\n\n')}\n\nPlease continue with the mission based on these answers.`;

  if (!missionState.question_history) missionState.question_history = [];
  for (const a of answers) {
    const qObj = missionState._lastQuestions && missionState._lastQuestions[a.question_index];
    missionState.question_history.push({
      question: qObj ? qObj.question : `Question #${a.question_index}`,
      answer: a.answer,
      note: a.note || '',
      timestamp: ts,
    });
  }
  missionState._lastQuestions = null;
  missionState.pendingQuestions = null;

  const spawnOk = spawnResumeOrFreshAttempt({ prompt: answerPrompt, sendToWindow });
  if (!spawnOk) {
    return 'Failed to send answer to Claude process';
  }

  sendToWindow('mission:answer-sent', { answers });
  sendToWindow('mission:status', { status: 'running' });

  const entry = makeLogEntry(ts, 'User',
    `Answered ${answers.length} question(s) — resuming session`, 'info');
  missionState.log.push(entry);
  sendToWindow('mission:log', entry);

  return null;
}
```

Replace the original `ipcMain.handle('answer_question', ...)` block with:

```js
  ipcMain.handle('answer_question', async (_event, args) => answerQuestionCore(args, sendToWindow));
```

- [ ] **Step 2: Run the Task 2 regression test to verify it passes**

Run: `npx vitest run electron/ipc/mission.test.cjs -t "spawnResumeOrFreshAttempt extraction preserves answer_question behavior"`
Expected: PASS — `spawnArgsSeen[0].resumeSessionId` is `'sess-abc'`, `model` is `'sonnet'`, `cwd` is `'/tmp/proj'`.

- [ ] **Step 3: Write a fresh-launch regression test (no session_id case)**

Add to the same `describe` block from Task 2:

```js
  test('spawnResumeOrFreshAttempt omits resumeSessionId when session_id is absent (fresh launch)', () => {
    mission.__setMissionStateForTest({
      id: 'm1', status: 'Running', phase: 'Executing',
      session_id: null, execution_mode: 'standard',
      tasks: [], agents: [{ name: 'Lead', model: 'sonnet', status: 'Idle' }],
      log: [], project_path: '/tmp/proj', process: null,
    })
    const sendToWindow = vi.fn()
    mission.__setSendToWindowForTest(sendToWindow)

    const spawnArgsSeen = []
    mission.__setSpawnAgentProcessForTest((spec) => {
      spawnArgsSeen.push(spec)
      return { proc: mission.__makeFakeChildProcessForTest(), promptViaStdin: true }
    })

    const ok = mission.__spawnResumeOrFreshAttemptForTest({ prompt: 'continue please', sendToWindow })

    expect(ok).toBe(true)
    expect(spawnArgsSeen[0].resumeSessionId).toBe(null)
  })
```

Add the corresponding test hook next to `__answerQuestionForTest`:

```js
  module.exports.__spawnResumeOrFreshAttemptForTest = (opts) => spawnResumeOrFreshAttempt(opts);
```

- [ ] **Step 4: Run test to verify it fails, then passes**

Run: `npx vitest run electron/ipc/mission.test.cjs -t "spawnResumeOrFreshAttempt omits resumeSessionId"`
Expected first run: FAIL — `mission.__spawnResumeOrFreshAttemptForTest is not a function`.
Add the export line from Step 3, then re-run.
Expected: PASS.

- [ ] **Step 5: Repoint `restartLeadAfterMockup` at the shared helper**

Find `restartLeadAfterMockup` (referenced at `mission.cjs:978` per the spec's citation — locate via `grep -n "function restartLeadAfterMockup" electron/ipc/mission.cjs`). Replace its inline `spawnAgentProcess`/reader-wiring block with a call to `spawnResumeOrFreshAttempt({ prompt: injection, sendToWindow })`, preserving whatever mockup-specific setup (e.g. closing `mockupServers[missionId]`) precedes the spawn — only the spawn-and-wire block itself is replaced, not the whole function.

- [ ] **Step 6: Write a regression test for `restartLeadAfterMockup`**

```js
describe('restartLeadAfterMockup uses spawnResumeOrFreshAttempt', () => {
  let mission

  beforeEach(() => {
    delete require.cache[require.resolve('./mission.cjs')]
    mission = require('./mission.cjs')
  })

  test('mockup_respond approval resumes with the injected approval prompt', async () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      id: 'm1', status: 'WaitingForMockup', phase: 'Planning',
      session_id: 'sess-mockup', execution_mode: 'standard',
      tasks: [], agents: [{ name: 'Lead', model: 'sonnet', status: 'Idle' }],
      log: [], project_path: '/tmp/proj', process: null,
    })
    mission.__setSendToWindowForTest(sendToWindow)

    const spawnArgsSeen = []
    mission.__setSpawnAgentProcessForTest((spec) => {
      spawnArgsSeen.push(spec)
      return { proc: mission.__makeFakeChildProcessForTest(), promptViaStdin: true }
    })

    mission.__restartLeadAfterMockupForTest('m1',
      'MOCKUP APPROVED: The user approved the mockup design. Continue planning and output the final plan JSON.',
      sendToWindow)

    expect(spawnArgsSeen).toHaveLength(1)
    expect(spawnArgsSeen[0].resumeSessionId).toBe('sess-mockup')
    expect(spawnArgsSeen[0].prompt).toContain('MOCKUP APPROVED')
  })
})
```

Add the test hook: `module.exports.__restartLeadAfterMockupForTest = (missionId, injection, sendToWindow) => restartLeadAfterMockup(missionId, injection, sendToWindow);`

- [ ] **Step 7: Run test to verify it fails, then passes**

Run: `npx vitest run electron/ipc/mission.test.cjs -t "restartLeadAfterMockup uses spawnResumeOrFreshAttempt"`
Expected first run: FAIL — hook missing. After adding it: PASS.

- [ ] **Step 8: Run the full existing test suite to confirm no regression**

Run: `npx vitest run electron/ipc/mission.test.cjs electron/ipc/mission.backend.test.cjs electron/ipc/mission.retryTransientSpawn.test.js electron/ipc/mission.tryRecoverDanglingQuestion.test.js`
Expected: all PASS — no existing test's assertions about `answer_question`/`mockup_respond` spawn args changed.

- [ ] **Step 9: Commit**

```bash
git add electron/ipc/mission.cjs electron/ipc/mission.test.cjs
git commit -m "refactor: repoint answer_question and restartLeadAfterMockup onto spawnResumeOrFreshAttempt"
```

---

### Task 4: Build the fresh-launch continuation prompt

**Files:**
- Modify: `electron/ipc/mission.cjs`
- Test: `electron/ipc/mission.test.cjs`

**Interfaces:**
- Consumes: `missionState.description`, `missionState.tasks`, `missionState.project_path` (all existing fields).
- Produces:
  ```js
  function buildContinuationPrompt(reason, task) // reason: string, task: {title, assigned_agent} | null => string
  ```
  Used only by `autoResumeAfterFinalQaFailure` (Task 5) for the fresh-launch case (no `session_id`). The resume case does not call this — it uses a short inline stdin-style nudge string built directly in Task 5.

- [ ] **Step 1: Write the failing test**

```js
describe('buildContinuationPrompt', () => {
  let mission

  beforeEach(() => {
    delete require.cache[require.resolve('./mission.cjs')]
    mission = require('./mission.cjs')
  })

  test('includes mission description, task list, and the QA failure reason', () => {
    mission.__setMissionStateForTest({
      id: 'm1', description: 'Build a todo app with auth',
      project_path: '/tmp/proj',
      tasks: [
        { id: 't1', title: 'Add login form', assigned_agent: 'Dev-Frontend', status: 'in_progress' },
        { id: 't2', title: 'Add JWT middleware', assigned_agent: 'Dev-Backend', status: 'completed' },
      ],
      agents: [], log: [],
    })

    const prompt = mission.__buildContinuationPromptForTest(
      'Login form does not actually call the auth endpoint',
      { title: 'Add login form', assigned_agent: 'Dev-Frontend' }
    )

    expect(prompt).toContain('Build a todo app with auth')
    expect(prompt).toContain('/tmp/proj')
    expect(prompt).toContain('Add login form')
    expect(prompt).toContain('Dev-Frontend')
    expect(prompt).toContain('Login form does not actually call the auth endpoint')
  })
})
```

Add the test hook: `module.exports.__buildContinuationPromptForTest = (reason, task) => buildContinuationPrompt(reason, task);`

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/ipc/mission.test.cjs -t "buildContinuationPrompt"`
Expected: FAIL — `buildContinuationPrompt is not defined`.

- [ ] **Step 3: Implement `buildContinuationPrompt`**

Add near `spawnResumeOrFreshAttempt` in `electron/ipc/mission.cjs`:

```js
// ─────────────────────────────────────────────────────────────────
// buildContinuationPrompt — builds a self-contained continuation prompt
// for the fresh-launch case of autoResumeAfterFinalQaFailure (no
// session_id available to --resume). Mirrors the ingredients
// deploy_mission/continue_mission already use to launch a mission.
// ─────────────────────────────────────────────────────────────────
function buildContinuationPrompt(reason, task) {
  const taskSummaries = (missionState.tasks || [])
    .map(t => `- [${t.status}] ${t.title} (owner: ${t.assigned_agent || 'unassigned'})`)
    .join('\n');

  const flaggedLine = task
    ? `The following task needs another pass: "${task.title}" (owner: ${task.assigned_agent || 'unassigned'}).`
    : '';

  return `This is a continuation of an existing mission after the final whole-picture QA ` +
    `sweep found an issue: ${reason}\n\n` +
    `Mission: ${missionState.description || '(not specified)'}\n` +
    `Project path: ${missionState.project_path || '.'}\n\n` +
    `Current tasks:\n${taskSummaries}\n\n` +
    `${flaggedLine}\n` +
    `Please continue the mission and address the flagged issue.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/ipc/mission.test.cjs -t "buildContinuationPrompt"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/mission.cjs electron/ipc/mission.test.cjs
git commit -m "feat: add buildContinuationPrompt for fresh-launch auto-resume"
```

---

### Task 5: Implement `autoResumeAfterFinalQaFailure` and wire it into `finalizeDeployExit`

**Files:**
- Modify: `electron/ipc/mission.cjs`
- Test: `electron/ipc/mission.test.cjs`

**Interfaces:**
- Consumes: `spawnResumeOrFreshAttempt` (Task 2/3), `buildContinuationPrompt` (Task 4), `makeLogEntry`/`now` (existing).
- Produces:
  ```js
  function autoResumeAfterFinalQaFailure(missionId, sendToWindow, ts) // void
  ```
  Called from `finalizeDeployExit` in place of the current log-only branch.

- [ ] **Step 1: Write the failing test — attempts 1-3 spawn, attempt 4 falls back**

```js
describe('autoResumeAfterFinalQaFailure', () => {
  let mission

  beforeEach(() => {
    delete require.cache[require.resolve('./mission.cjs')]
    mission = require('./mission.cjs')
  })

  function baseMissionState(overrides = {}) {
    return {
      id: 'm1', status: 'Running', phase: 'Executing',
      session_id: 'sess-xyz', execution_mode: 'standard',
      tasks: [{ id: 't1', title: 'Add login form', status: 'in_progress', assigned_agent: 'Dev-Frontend', reason: 'auth call missing' }],
      agents: [{ name: 'Lead', model: 'sonnet', status: 'Working' }],
      log: [], project_path: '/tmp/proj', process: null,
      ...overrides,
    }
  }

  test('attempt 1: spawns a resume attempt and increments the counter', () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest(baseMissionState({ autoResumeCount: 0 }))
    mission.__setSendToWindowForTest(sendToWindow)

    const spawnArgsSeen = []
    mission.__setSpawnAgentProcessForTest((spec) => {
      spawnArgsSeen.push(spec)
      return { proc: mission.__makeFakeChildProcessForTest(), promptViaStdin: true }
    })

    mission.__autoResumeAfterFinalQaFailureForTest('m1', sendToWindow, Date.now())

    const state = mission.__getMissionStateForTest()
    expect(state.autoResumeCount).toBe(1)
    expect(spawnArgsSeen).toHaveLength(1)
    expect(spawnArgsSeen[0].resumeSessionId).toBe('sess-xyz')
    expect(sendToWindow).toHaveBeenCalledWith('mission:log',
      expect.objectContaining({ message: expect.stringContaining('auto-resuming mission (attempt 1/3)') }))
  })

  test('attempt 4: does not spawn, logs manual-intervention message, leaves status Running', () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest(baseMissionState({ autoResumeCount: 3 }))
    mission.__setSendToWindowForTest(sendToWindow)

    const spawnArgsSeen = []
    mission.__setSpawnAgentProcessForTest((spec) => {
      spawnArgsSeen.push(spec)
      return { proc: mission.__makeFakeChildProcessForTest(), promptViaStdin: true }
    })

    mission.__autoResumeAfterFinalQaFailureForTest('m1', sendToWindow, Date.now())

    const state = mission.__getMissionStateForTest()
    expect(spawnArgsSeen).toHaveLength(0)
    expect(state.status).toBe('Running')
    expect(sendToWindow).toHaveBeenCalledWith('mission:log',
      expect.objectContaining({ message: expect.stringContaining('manual intervention') }))
  })

  test('fresh-launch case: builds continuation prompt when session_id is absent', () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest(baseMissionState({ autoResumeCount: 0, session_id: null }))
    mission.__setSendToWindowForTest(sendToWindow)

    const spawnArgsSeen = []
    mission.__setSpawnAgentProcessForTest((spec) => {
      spawnArgsSeen.push(spec)
      return { proc: mission.__makeFakeChildProcessForTest(), promptViaStdin: true }
    })

    mission.__autoResumeAfterFinalQaFailureForTest('m1', sendToWindow, Date.now())

    expect(spawnArgsSeen[0].resumeSessionId).toBe(null)
    expect(spawnArgsSeen[0].prompt).toContain('Add login form')
  })
})
```

Add the test hook: `module.exports.__autoResumeAfterFinalQaFailureForTest = (missionId, sendToWindow, ts) => autoResumeAfterFinalQaFailure(missionId, sendToWindow, ts);`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run electron/ipc/mission.test.cjs -t "autoResumeAfterFinalQaFailure"`
Expected: FAIL — `autoResumeAfterFinalQaFailure is not defined`.

- [ ] **Step 3: Implement `autoResumeAfterFinalQaFailure`**

Add in `electron/ipc/mission.cjs`, near `finalizeDeployExit` (before its definition, i.e. before line 2932):

```js
// ─────────────────────────────────────────────────────────────────
// autoResumeAfterFinalQaFailure — called when finalizeDeployExit finds
// the mission left 'Running' by a final-QA-sweep failure after the
// driving process already exited (see design doc
// docs/superpowers/specs/2026-07-31-final-qa-auto-resume-design.md).
// Bounded at 3 consecutive attempts (missionState.autoResumeCount) to
// avoid looping forever if the mission keeps landing back here.
// ─────────────────────────────────────────────────────────────────
const AUTO_RESUME_MAX_ATTEMPTS = 3;

function autoResumeAfterFinalQaFailure(missionId, sendToWindow, ts) {
  missionState.autoResumeCount = (missionState.autoResumeCount || 0) + 1;

  if (missionState.autoResumeCount > AUTO_RESUME_MAX_ATTEMPTS) {
    const entry = makeLogEntry(ts, 'System',
      'Final QA sweep scheduled a retry after the driving process already exited — ' +
      'mission is awaiting that retry, but no process is currently driving it. ' +
      `Auto-resume already tried ${AUTO_RESUME_MAX_ATTEMPTS} times without reaching Completed — stopping. ` +
      'This requires manual intervention (see Retry).',
      'info');
    missionState.log.push(entry);
    sendToWindow('mission:log', entry);
    return;
  }

  const entry = makeLogEntry(ts, 'System',
    'Final QA sweep scheduled a retry after the driving process already exited — ' +
    `auto-resuming mission (attempt ${missionState.autoResumeCount}/${AUTO_RESUME_MAX_ATTEMPTS})...`,
    'info');
  missionState.log.push(entry);
  sendToWindow('mission:log', entry);

  const flaggedTask = missionState.tasks.find(t => t.status === 'in_progress' && t.reason) || null;
  const reason = (flaggedTask && flaggedTask.reason) || 'see task history for details';

  const prompt = missionState.session_id
    ? `\n[System] Final QA sweep flagged an issue: ${reason}` +
      (flaggedTask ? ` (task: "${flaggedTask.title}", owner: ${flaggedTask.assigned_agent || 'unassigned'})` : '') +
      `. Please continue addressing it.\n`
    : buildContinuationPrompt(reason, flaggedTask);

  spawnResumeOrFreshAttempt({ prompt, sendToWindow });
}
```

- [ ] **Step 4: Wire it into `finalizeDeployExit`**

In `finalizeDeployExit` (`mission.cjs:2932`), replace:

```js
  if (missionState.status === 'Running') {
    const entry = makeLogEntry(ts, 'System',
      'Final QA sweep scheduled a retry after the driving process already exited — ' +
      'mission is awaiting that retry, but no process is currently driving it. ' +
      'This requires manual intervention (see Retry) or a follow-up to auto-resume it.',
      'info');
    missionState.log.push(entry);
    sendToWindow('mission:log', entry);
    return;
  }
```

with:

```js
  if (missionState.status === 'Running') {
    autoResumeAfterFinalQaFailure(missionId, sendToWindow, ts);
    return;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run electron/ipc/mission.test.cjs -t "autoResumeAfterFinalQaFailure"`
Expected: PASS

- [ ] **Step 6: Update the existing `finalizeDeployExit` regression test**

The existing test `'finalizeDeployExit does not send a completion status when the sweep left the mission Running'` (`mission.test.cjs:375`) must still pass unchanged in spirit (no `Failed` status emitted), but now it will also trigger an auto-resume spawn attempt as a side effect. Update it to stub the spawn so it doesn't try to launch a real process, and add an assertion that auto-resume was attempted:

```js
  test('finalizeDeployExit does not send a completion status when the sweep left the mission Running', () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      id: 'm1', status: 'Running', phase: 'Executing',
      session_id: 'sess-1', execution_mode: 'standard', autoResumeCount: 0,
      tasks: [{ id: 't1', title: 'A', status: 'in_progress', assigned_agent: 'Dev' }],
      agents: [{ name: 'Dev', status: 'Working' }, { name: 'Lead', model: 'sonnet', status: 'Working' }],
      log: [], project_path: '/tmp/proj', file_changes: [],
    })
    mission.__setSendToWindowForTest(sendToWindow)
    mission.__setSpawnAgentProcessForTest(() => ({
      proc: mission.__makeFakeChildProcessForTest(), promptViaStdin: true,
    }))

    mission.__finalizeDeployExitForTest('m1', sendToWindow, Date.now())

    const statusEmits = sendToWindow.mock.calls.filter(c => c[0] === 'mission:status')
    expect(statusEmits.some(c => c[1].status === 'failed')).toBe(false)
    const state = mission.__getMissionStateForTest()
    expect(state.autoResumeCount).toBe(1)
  })
```

- [ ] **Step 7: Run the updated test to verify it passes**

Run: `npx vitest run electron/ipc/mission.test.cjs -t "finalizeDeployExit does not send a completion status"`
Expected: PASS

- [ ] **Step 8: Run the full test suite**

Run: `npx vitest run electron/ipc/mission.test.cjs electron/ipc/mission.backend.test.cjs electron/ipc/mission.retryTransientSpawn.test.js electron/ipc/mission.retryMockupGeneration.test.js electron/ipc/mission.tryRecoverDanglingQuestion.test.js`
Expected: all PASS

- [ ] **Step 9: Commit**

```bash
git add electron/ipc/mission.cjs electron/ipc/mission.test.cjs
git commit -m "feat: auto-resume mission after final QA sweep fails post-exit"
```

---

### Task 6: Integration test — simulated end-to-end auto-resume via fake subprocess

**Files:**
- Test: `electron/ipc/mission.test.cjs` (or a new file `electron/ipc/mission.autoResume.integration.test.cjs` if the existing file has grown large enough to warrant a split — check line count first)

**Interfaces:**
- Consumes: `__setQcQaRunnerForTest`, `__setSpawnAgentProcessForTest`, `__handleParsedEventForTest`, `__finalizeDeployExitForTest`, `__runFinalQaSweepForTest` (all existing/added in prior tasks).
- Produces: no new interfaces — this task only adds test coverage tying the pieces together end-to-end.

- [ ] **Step 1: Check file size and decide on file placement**

Run: `wc -l electron/ipc/mission.test.cjs`
If over ~600 lines, create `electron/ipc/mission.autoResume.integration.test.cjs` with the same `import`/`require` header as `mission.test.cjs`; otherwise add a new `describe` block at the end of `mission.test.cjs`.

- [ ] **Step 2: Write the integration test**

```js
describe('end-to-end: final QA sweep failure after exit triggers auto-resume', () => {
  let mission

  beforeEach(() => {
    delete require.cache[require.resolve('./mission.cjs')]
    mission = require('./mission.cjs')
  })

  test('deploy process exits 0, final sweep FAILs, mission auto-resumes without user action', async () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      id: 'm1', status: 'Running', phase: 'Executing',
      session_id: 'sess-e2e', execution_mode: 'standard', autoResumeCount: 0,
      tasks: [{ id: 't1', title: 'Wire up checkout button', status: 'completed', assigned_agent: 'Dev-Frontend' }],
      agents: [{ name: 'Dev-Frontend', status: 'Idle' }, { name: 'Lead', model: 'sonnet', status: 'Working' }],
      log: [], project_path: '/tmp/proj', file_changes: [],
    })
    mission.__setSendToWindowForTest(sendToWindow)
    mission.__setQcQaRunnerForTest(async () => ({
      verdict: 'FAIL', responsibleAgent: 'Dev-Frontend', reason: 'checkout button does not call the payment API',
    }))

    const spawnArgsSeen = []
    mission.__setSpawnAgentProcessForTest((spec) => {
      spawnArgsSeen.push(spec)
      return { proc: mission.__makeFakeChildProcessForTest(), promptViaStdin: true }
    })

    await mission.__runFinalQaSweepForTest()
    const stateAfterSweep = mission.__getMissionStateForTest()
    expect(stateAfterSweep.status).toBe('Running')
    expect(stateAfterSweep.tasks[0].status).toBe('failed_qa')

    // finalizeDeployExit runs after the (already-exited) process's close handler
    mission.__finalizeDeployExitForTest('m1', sendToWindow, Date.now())

    expect(spawnArgsSeen).toHaveLength(1)
    expect(spawnArgsSeen[0].resumeSessionId).toBe('sess-e2e')
    const state = mission.__getMissionStateForTest()
    expect(state.autoResumeCount).toBe(1)
    expect(sendToWindow).toHaveBeenCalledWith('mission:log',
      expect.objectContaining({ message: expect.stringContaining('auto-resuming mission') }))
  })
})
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run electron/ipc/mission.test.cjs -t "final QA sweep failure after exit triggers auto-resume"`
Expected: PASS. (No "run to see it fail first" step here — this test exercises functionality already fully implemented in Tasks 1-5; its purpose is integration coverage, not driving new production code.)

- [ ] **Step 4: Run the entire mission test suite one more time**

Run: `npx vitest run electron/ipc/mission.test.cjs electron/ipc/mission.backend.test.cjs electron/ipc/mission.retryTransientSpawn.test.js electron/ipc/mission.retryMockupGeneration.test.js electron/ipc/mission.tryRecoverDanglingQuestion.test.js`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/mission.test.cjs
git commit -m "test: add end-to-end coverage for final QA sweep auto-resume"
```

---

## Self-Review Notes

- **Spec coverage:** §1 (trigger point) → Task 5 Step 4. §2 (counter + ceiling + resets) → Tasks 1 & 5. §3 (shared helper) → Tasks 2-3. §4 (`autoResumeAfterFinalQaFailure` body) → Task 5. §5 (prompt content, both cases) → Tasks 4 & 5. §6 (recursion via natural re-entry) → covered implicitly by Task 5's wiring through the existing `watchProcessExit_deploy`/`finalizeDeployExit` path — no dedicated task needed since no new code branch exists for it. §7 (no conflict with `WaitingForAnswer`/transient-retry) → no code change needed, verified by existing guards remaining untouched; Task 6's integration test confirms the sweep-FAIL path specifically.
- **Type consistency:** `spawnResumeOrFreshAttempt({ prompt, sendToWindow, maxAttempts })` signature is consistent across Tasks 2, 3, 4, 5. `autoResumeAfterFinalQaFailure(missionId, sendToWindow, ts)` signature matches `finalizeDeployExit`'s existing call-site parameters exactly (`missionId, sendToWindow, ts` already in scope there). `buildContinuationPrompt(reason, task)` signature consistent between Task 4's definition and Task 5's call site.
- **No placeholders:** every step includes literal code, not descriptions of code.
