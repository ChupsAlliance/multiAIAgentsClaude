# QC/QA Per-Task Verification Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace exit-code-based mission/task completion with a real, code-enforced QC → QA verification gate so a task only becomes `completed` (and a mission only becomes `Completed`) after independent subprocess-based verification passes.

**Architecture:** A new standalone module `electron/lib/qcqa.cjs` owns QC/QA subprocess spawning, stdout verdict parsing, and escalation-round bookkeeping (pure/testable, mirrors the existing `electron/lib/recordingStore.cjs` pattern). `electron/ipc/mission.cjs` keeps owning `missionState` and wires `qcqa.cjs`'s functions into the existing `TaskCompleted` handling and the two process-exit watchers, replacing direct completion with a QC → QA → (per-task) and a final whole-picture QA sweep (mission-level).

**Tech Stack:** Node.js/CommonJS (`.cjs`), `cross-spawn`'s `spawn`, Vitest for unit tests, Playwright + fake-`claude` fixture for E2E.

## Global Constraints

- QC/QA subprocesses must reuse the existing `spawnClaude(args, cwd, useAgentTeams)` primitive (`electron/ipc/mission.cjs:812-831`), called with `useAgentTeams=false`.
- The gate is enforced in code (`electron/ipc/mission.cjs` / `electron/lib/qcqa.cjs`), never only in a prompt.
- QC runs first (technical/build-level); QA runs only if QC passes (business/requirement-level); one additional whole-picture QA pass runs at the end of the mission.
- Verdict output convention (mirrors existing `BUILD_RESULT`/`FILES_WRITTEN` convention):
  - Pass: `[QC] VERDICT: PASS` / `[QA] VERDICT: PASS`
  - Fail: `[QC] VERDICT: FAIL` + `[QC] RESPONSIBLE_AGENT: <name>` + `[QC] REASON: <text>` (same lines with `[QA]` prefix for QA).
- `task.qcRound` is a single shared counter. Rounds 1-2: resume/resubmit to the same agent. Rounds 3-8: fresh agent instance or stronger model. Round 9 (8th retry also failed): stop, set `mission.status = 'Needs Attention'`, surface to UI — never auto-retry past this without asking the user.
- A QC/QA failure blocks only the owning task (and its declared downstream dependents); other agents keep working.
- Lead never hand-fixes another agent's bug — fixes always route back through a sub-agent.
- Mission reaches `Completed` only via `runFinalQaSweep()` passing. Exit code alone never sets `Completed`. This includes the Agent Teams 90s inactivity-completion timer (`scheduleAgentTeamsCompletion`, closed in Task 12) — added after Task 7's review surfaced it as a second bypass of this same constraint.
- Out of scope: Presentation Mode, the known `useReplay.js` `mission:team-event`/`mission:task-reassigned` gap, and changing how Lead spawns sub-agents (Agent tool/Agent Teams/SendMessage untouched). Note: Task 12 changes what happens when the inactivity timer fires, not how/when Lead spawns agents via Agent Teams — the spawn mechanics themselves remain untouched.

---

## File Structure

- **Create** `electron/lib/qcqa.cjs` — QC/QA subprocess spawning (`spawnQcCheck`, `spawnQaCheck`), stdout verdict parsing (`parseQcQaVerdict`), and pure escalation-tier logic (`nextEscalationTier`). Exports plain functions; takes `spawnClaude` as an injected dependency so tests can stub it (avoids requiring `mission.cjs`, which has side effects at module load).
- **Create** `electron/lib/qcqa.test.cjs` — unit tests for the three exports above, isolated, no real subprocess spawns (stubbed `spawnClaude`).
- **Modify** `electron/ipc/mission.cjs`:
  - `handleParsedEvent`'s `TaskCompleted` case (lines 280-302): set status to `pending_qc` instead of `completed`; call `enqueueQcCheck(task, agent)`.
  - New functions `enqueueQcCheck(task, agent)`, `enqueueQaCheck(task, agent, qcVerdict)`, `handleQcQaFailure(task, stage, responsibleAgent, reason)`, `runFinalQaSweep()` — added near `watchProcessExit_deploy` since they share `missionState`/`sendToWindow` closures.
  - `watchProcessExit_launch` (line 1765) and `watchProcessExit_deploy` (line 2427): replace direct `Completed` assignment with a call into `runFinalQaSweep()`; remove the force-completion loop at lines 2438-2442.
- **Create** `electron/prompts/qc_check.md` — QC-Agent prompt template.
- **Create** `electron/prompts/qa_check.md` — QA-Agent prompt template (per-task and final whole-picture, selected via a template variable).
- **Modify** `electron/prompts/deploy_agent_teams.md:129` — remove "fix the error yourself" language.
- **Modify** `electron/prompts/deploy_standard.md` (Phase 3 step 3) — remove "Fix them directly using Edit/Write tools" language.
- **Modify** `electron/prompts/continue_agent_teams.md:48` — remove "or fix it yourself if they are no longer active" language.
- **Modify** `src/components/mission/StatusBadge.jsx` — add config entries for `pending_qc`, `failed_qc`, `pending_qa`, `failed_qa`, `AwaitingFinalQA`, `Needs Attention`.
- **Modify** `src/components/mission/TaskList.jsx` — extend `statusIcon` map and `inferPhase`/summary counts for the new task statuses.
- **Modify** `src/hooks/useMission.js` — extend the `mission:task-update` fuzzy task-matching fallback to also match tasks in `pending_qc`/`pending_qa`/`failed_qc`/`failed_qa` (not just `in_progress`), so QC/QA-originated updates for an agent replace the right task entry.
- **Test:** `electron/ipc/mission.test.cjs` (create if it doesn't exist) — unit tests for the `TaskCompleted` → `pending_qc` change and `runFinalQaSweep()` gating.
- **Test:** `tests/specs/qcqa-verification-loop.spec.ts` — Playwright E2E using the fake-`claude` harness, simulating a QC fail-then-pass and QA pass, and the final whole-picture QA sweep.

---

## Task 1: `qcqa.cjs` — verdict parsing

**Files:**
- Create: `electron/lib/qcqa.cjs`
- Test: `electron/lib/qcqa.test.cjs`

**Interfaces:**
- Produces: `parseQcQaVerdict(stdoutText, stage)` → `{ verdict: 'PASS' } | { verdict: 'FAIL', responsibleAgent: string, reason: string }`. `stage` is `'QC'` or `'QA'` and selects the `[QC]`/`[QA]` line prefix to scan for. Returns `{ verdict: 'FAIL', responsibleAgent: null, reason: 'No verdict line found in QC/QA output' }` if no verdict line is present at all (defensive default — treat missing verdict as failure, never as silent pass).

- [ ] **Step 1: Write the failing test**

```js
// electron/lib/qcqa.test.cjs
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/lib/qcqa.test.cjs`
Expected: FAIL with "Cannot find module './qcqa.cjs'" (file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

```js
// electron/lib/qcqa.cjs
'use strict';

function parseQcQaVerdict(stdoutText, stage) {
  const text = stdoutText || '';
  const passRe = new RegExp(`^\\[${stage}\\]\\s*VERDICT:\\s*PASS\\s*$`, 'im');
  const failRe = new RegExp(`^\\[${stage}\\]\\s*VERDICT:\\s*FAIL\\s*$`, 'im');
  const agentRe = new RegExp(`^\\[${stage}\\]\\s*RESPONSIBLE_AGENT:\\s*(.+)$`, 'im');
  const reasonRe = new RegExp(`^\\[${stage}\\]\\s*REASON:\\s*(.+)$`, 'im');

  if (passRe.test(text)) {
    return { verdict: 'PASS' };
  }

  if (failRe.test(text)) {
    const agentMatch = text.match(agentRe);
    const reasonMatch = text.match(reasonRe);
    return {
      verdict: 'FAIL',
      responsibleAgent: agentMatch ? agentMatch[1].trim() : null,
      reason: reasonMatch ? reasonMatch[1].trim() : null,
    };
  }

  return {
    verdict: 'FAIL',
    responsibleAgent: null,
    reason: 'No verdict line found in QC/QA output',
  };
}

module.exports = { parseQcQaVerdict };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/lib/qcqa.test.cjs`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/lib/qcqa.cjs electron/lib/qcqa.test.cjs
git commit -m "feat: add QC/QA verdict parsing"
```

---

## Task 2: `qcqa.cjs` — escalation tier logic

**Files:**
- Modify: `electron/lib/qcqa.cjs`
- Test: `electron/lib/qcqa.test.cjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `nextEscalationTier(qcRound)` → `{ tier: 'retry-same' | 'retry-fresh' | 'needs-attention' }`. Called with the round number AFTER incrementing (i.e. `qcRound` is "how many times this task has been resubmitted after a failure", starting at 1 for the first failure). Rounds 1-2 → `'retry-same'`. Rounds 3-8 → `'retry-fresh'`. Round 9+ → `'needs-attention'`.

- [ ] **Step 1: Write the failing test**

```js
// append to electron/lib/qcqa.test.cjs
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/lib/qcqa.test.cjs`
Expected: FAIL with "nextEscalationTier is not a function"

- [ ] **Step 3: Write minimal implementation**

```js
// add to electron/lib/qcqa.cjs, before module.exports
function nextEscalationTier(qcRound) {
  if (qcRound <= 2) return { tier: 'retry-same' };
  if (qcRound <= 8) return { tier: 'retry-fresh' };
  return { tier: 'needs-attention' };
}

module.exports = { parseQcQaVerdict, nextEscalationTier };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/lib/qcqa.test.cjs`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/lib/qcqa.cjs electron/lib/qcqa.test.cjs
git commit -m "feat: add QC/QA escalation tier logic"
```

---

## Task 3: `qcqa.cjs` — subprocess spawn wrapper

**Files:**
- Modify: `electron/lib/qcqa.cjs`
- Test: `electron/lib/qcqa.test.cjs`

**Interfaces:**
- Consumes: `parseQcQaVerdict` (Task 1).
- Produces: `runQcQaCheck({ spawnClaude, prompt, projectPath, model, stage, timeoutMs })` → `Promise<{ verdict: 'PASS' } | { verdict: 'FAIL', responsibleAgent, reason }>`. `spawnClaude` is injected (same signature as `mission.cjs`'s `spawnClaude(args, cwd, useAgentTeams)`) so the test can stub a fake child process instead of spawning `claude` for real. Spawns with args `['-p', prompt, '--dangerously-skip-permissions', '--model', model, '--output-format', 'stream-json', '--verbose']`, `useAgentTeams=false`, collects stdout, and on close resolves via `parseQcQaVerdict`. If the process doesn't close within `timeoutMs`, kills it and resolves `{ verdict: 'FAIL', responsibleAgent: null, reason: 'QC/QA check timed out after Xms' }` (mirrors `runClaudeForHtml`'s timeout-then-reject pattern, but resolves instead of rejecting — a timed-out check is a FAIL verdict, not a system error).

- [ ] **Step 1: Write the failing test**

```js
// append to electron/lib/qcqa.test.cjs
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/lib/qcqa.test.cjs`
Expected: FAIL with "runQcQaCheck is not a function"

- [ ] **Step 3: Write minimal implementation**

```js
// add to electron/lib/qcqa.cjs, before module.exports
function runQcQaCheck({ spawnClaude, prompt, projectPath, model, stage, timeoutMs = 180000 }) {
  return new Promise((resolve) => {
    const args = ['-p', prompt, '--dangerously-skip-permissions', '--model', model,
      '--output-format', 'stream-json', '--verbose'];
    const proc = spawnClaude(args, projectPath, false);

    let stdoutText = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill(); } catch (_) {}
      resolve({
        verdict: 'FAIL',
        responsibleAgent: null,
        reason: `QC/QA check timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    proc.stdout.on('data', (chunk) => { stdoutText += chunk.toString('utf8'); });

    proc.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(parseQcQaVerdict(stdoutText, stage));
    });
  });
}

module.exports = { parseQcQaVerdict, nextEscalationTier, runQcQaCheck };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/lib/qcqa.test.cjs`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/lib/qcqa.cjs electron/lib/qcqa.test.cjs
git commit -m "feat: add QC/QA subprocess spawn-and-verdict wrapper"
```

---

## Task 4: QC/QA prompt files

**Files:**
- Create: `electron/prompts/qc_check.md`
- Create: `electron/prompts/qa_check.md`

**Interfaces:**
- Consumes: nothing (static prompt templates loaded by `mission.cjs` in Task 6).
- Produces: template placeholders `{{PROJECT_PATH}}`, `{{TASK_TITLE}}`, `{{TASK_DETAIL}}`, `{{FILES_WRITTEN}}`, `{{BUILD_HINT}}`, `{{RESPONSIBLE_AGENT}}` for `qc_check.md`; `{{PROJECT_PATH}}`, `{{TASK_TITLE}}`, `{{TASK_WHY}}`, `{{TASK_DETAIL}}`, `{{FILES_WRITTEN}}`, `{{QC_VERDICT_SUMMARY}}`, `{{RESPONSIBLE_AGENT}}`, `{{SCOPE_NOTE}}` for `qa_check.md` (`{{SCOPE_NOTE}}` is empty for a per-task check and holds the full mission plan + full changed-file list for the final whole-picture sweep, per spec §5).

- [ ] **Step 1: Write `qc_check.md`**

```markdown
You are the QC-Agent for this project directory: {{PROJECT_PATH}}

## YOUR JOB
Independently verify — by actually running commands yourself, never by
trusting anyone's self-report — whether the following task was implemented
without technical/build errors.

## TASK BEING VERIFIED
Title: {{TASK_TITLE}}
Detail: {{TASK_DETAIL}}
Responsible agent: {{RESPONSIBLE_AGENT}}
Files reported as written/changed: {{FILES_WRITTEN}}

## HOW TO VERIFY
{{BUILD_HINT}}

1. Read the files listed above. Confirm they exist and are not stubs,
   placeholders, or empty.
2. Run the real build/test/lint command(s) for this project yourself.
   Do not just look at whether the agent claimed BUILD_RESULT: PASS —
   run it again and read the actual output.
3. Check for obvious technical defects: syntax errors, unresolved
   imports, broken function signatures, missing dependencies.

## WHAT YOU ARE NOT CHECKING
Do not judge whether the implementation satisfies the business
requirement — that is QA's job, not yours. You only check: does it build,
does it run, is it technically sound.

## REQUIRED OUTPUT (exact format, last lines of your output)
If everything is technically sound:
```
[QC] VERDICT: PASS
```

If you find a technical defect:
```
[QC] VERDICT: FAIL
[QC] RESPONSIBLE_AGENT: {{RESPONSIBLE_AGENT}}
[QC] REASON: <specific technical reason — what command failed and why>
```

Name the responsible agent exactly as given above — do not guess a
different name. Begin now.
```

- [ ] **Step 2: Write `qa_check.md`**

```markdown
You are the QA-Agent for this project directory: {{PROJECT_PATH}}

## YOUR JOB
Independently judge whether the implementation actually satisfies the
original business requirement — not just whether it builds (QC already
confirmed that; see the QC verdict below).

## TASK BEING VERIFIED
Title: {{TASK_TITLE}}
Why this task exists: {{TASK_WHY}}
Detail/requirement: {{TASK_DETAIL}}
Responsible agent: {{RESPONSIBLE_AGENT}}
Files reported as written/changed: {{FILES_WRITTEN}}
QC verdict (technical check, already passed): {{QC_VERDICT_SUMMARY}}

{{SCOPE_NOTE}}

## HOW TO VERIFY
1. Read the actual content of the changed files listed above — not just
   their names.
2. Compare what the code does against what the requirement above asks
   for. Example: if the requirement says "add email validation" and the
   code has no validation logic, that is a FAIL even though it builds.
3. Do not re-litigate technical/build correctness — QC already verified
   that. Focus only on requirement/business-logic mismatches.

## REQUIRED OUTPUT (exact format, last lines of your output)
If the implementation satisfies the requirement:
```
[QA] VERDICT: PASS
```

If it does not:
```
[QA] VERDICT: FAIL
[QA] RESPONSIBLE_AGENT: <agent responsible for the mismatch>
[QA] REASON: <specific business/requirement mismatch>
```

Name the responsible agent directly — do not make Lead infer it from file
paths. Begin now.
```

- [ ] **Step 3: No test needed — static prompt files, no code path exercises them until Task 6**

- [ ] **Step 4: Commit**

```bash
git add electron/prompts/qc_check.md electron/prompts/qa_check.md
git commit -m "feat: add QC-Agent and QA-Agent prompt templates"
```

---

## Task 5: Task state machine — `TaskCompleted` → `pending_qc`

**Files:**
- Modify: `electron/ipc/mission.cjs:280-302` (the `TaskCompleted` case in `handleParsedEvent`)
- Test: `electron/ipc/mission.test.cjs` (create)

**Interfaces:**
- Consumes: `enqueueQcCheck(task, agent)` (defined in Task 6 — for this task, stub it as a no-op export so the test can spy on the call without the full QC pipeline existing yet; Task 6 replaces the stub body).
- Produces: task objects now reach `status: 'pending_qc'` (not `'completed'`) the moment a `Completed:` line is parsed.

- [ ] **Step 1: Write the failing test**

First, check whether `electron/ipc/mission.test.cjs` exists:

Run: `ls electron/ipc/mission.test.cjs`

If it does not exist, create it with this content (if it exists, add the `describe` block below to it):

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/ipc/mission.test.cjs`
Expected: FAIL — `mission.__setMissionStateForTest is not a function` (test hooks don't exist yet) and/or `status` is `'completed'` instead of `'pending_qc'`.

- [ ] **Step 3: Write minimal implementation**

In `electron/ipc/mission.cjs`, replace the `TaskCompleted` case (lines 280-302):

```js
case 'TaskCompleted': {
  const { agent, description } = event;
  if (missionState) {
    // Find matching in-progress task for this agent
    const t = missionState.tasks.find(x =>
      x.assigned_agent === agent && x.status === 'in_progress');
    let targetTask;
    if (t) {
      t.status = 'pending_qc';
      t.qc_started_at = ts;
      targetTask = t;
    } else {
      // Task wasn't tracked; add as pending_qc
      targetTask = {
        id: `task-${ts}`, title: description,
        status: 'pending_qc', assigned_agent: agent,
        started_at: ts, qc_started_at: ts, priority: null, qcRound: 0,
      };
      missionState.tasks.push(targetTask);
    }
    const a = missionState.agents.find(x => x.name === agent);
    if (a) { a.status = 'Idle'; a.current_task = null; }
    enqueueQcCheck(targetTask, agent);
  }
  sendToWindow('mission:task-update', { agent, description, status: 'pending_qc', timestamp: ts });
  break;
}
```

Add a temporary stub above `handleParsedEvent` (Task 6 replaces this with the real implementation):

```js
function enqueueQcCheck(_task, _agent) {
  // TODO(Task 6): spawn QC-Agent subprocess and route the verdict.
}
```

Add test-only export hooks at the bottom of `electron/ipc/mission.cjs`, guarded so they never run in production. Find the existing `module.exports = { ... }` block and add:

```js
if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
  module.exports.__setMissionStateForTest = (state) => { missionState = state; };
  module.exports.__getMissionStateForTest = () => missionState;
  module.exports.__handleParsedEventForTest = (event, sendToWindow) => handleParsedEvent(event, sendToWindow);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/ipc/mission.test.cjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/mission.cjs electron/ipc/mission.test.cjs
git commit -m "feat: route TaskCompleted through pending_qc instead of completed"
```

---

## Task 6: Wire real QC → QA per-task pipeline into `mission.cjs`

**Files:**
- Modify: `electron/ipc/mission.cjs` (replace the `enqueueQcCheck` stub from Task 5; add `enqueueQaCheck`, `handleQcQaFailure`)
- Test: `electron/ipc/mission.test.cjs`

**Interfaces:**
- Consumes: `runQcQaCheck`, `nextEscalationTier` from `electron/lib/qcqa.cjs` (Tasks 2-3); `spawnClaude` (existing, `mission.cjs:812-831`); `detectProjectType` (existing, `mission.cjs:327`); the `qc_check.md`/`qa_check.md` templates (Task 4).
- Produces:
  - `enqueueQcCheck(task, agent)` — reads `qc_check.md`, fills placeholders, calls `runQcQaCheck({ spawnClaude, ..., stage: 'QC' })`, on PASS calls `enqueueQaCheck`, on FAIL calls `handleQcQaFailure(task, 'qc', verdict.responsibleAgent, verdict.reason)`.
  - `enqueueQaCheck(task, agent, qcVerdict)` — reads `qa_check.md`, fills placeholders (including `{{SCOPE_NOTE}}` = `''` for per-task calls), calls `runQcQaCheck({ ..., stage: 'QA' })`, on PASS sets `task.status = 'completed'` and emits `mission:task-update`, on FAIL calls `handleQcQaFailure(task, 'qa', verdict.responsibleAgent, verdict.reason)`.
  - `handleQcQaFailure(task, stage, responsibleAgent, reason)` — increments `task.qcRound`, calls `nextEscalationTier(task.qcRound)`, sets `task.status = stage === 'qc' ? 'failed_qc' : 'failed_qa'`, emits `mission:task-update` with the reason, then per tier: `retry-same`/`retry-fresh` → sets `task.status = 'in_progress'` and emits an update so the responsible agent can be resumed/respawned by Lead's existing DM flow (no new spawn mechanism introduced here — reuses Lead's existing resume-agent capability, consistent with the "changing how sub-agents are spawned is out of scope" boundary); `needs-attention` → sets `missionState.status = 'Needs Attention'` and emits `mission:status`.

- [ ] **Step 1: Write the failing test**

Append to `electron/ipc/mission.test.cjs`:

```js
describe('QC/QA per-task pipeline', () => {
  let mission

  beforeEach(() => {
    delete require.cache[require.resolve('./mission.cjs')]
    mission = require('./mission.cjs')
  })

  test('QC FAIL routes to handleQcQaFailure with stage "qc"', async () => {
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
    expect(state.tasks[0].status).toBe('in_progress')
    expect(state.tasks[0].qcRound).toBe(1)
    expect(sendToWindow).toHaveBeenCalledWith('mission:task-update',
      expect.objectContaining({ status: 'failed_qc' }))
  })

  test('QC PASS then QA PASS marks the task completed', async () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      tasks: [{ id: 't1', title: 'Build it', status: 'pending_qc', assigned_agent: 'Dev', qcRound: 0 }],
      agents: [{ name: 'Dev', status: 'Idle', current_task: null }],
      log: [], project_path: '/tmp/proj',
    })
    mission.__setSendToWindowForTest(sendToWindow)
    mission.__setQcQaRunnerForTest(async (opts) => ({ verdict: 'PASS' }))

    await mission.__enqueueQcCheckForTest(mission.__getMissionStateForTest().tasks[0], 'Dev')

    const state = mission.__getMissionStateForTest()
    expect(state.tasks[0].status).toBe('completed')
    expect(sendToWindow).toHaveBeenCalledWith('mission:task-update',
      expect.objectContaining({ status: 'completed' }))
  })

  test('round 9 sets mission to Needs Attention instead of retrying', async () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      status: 'Running',
      tasks: [{ id: 't1', title: 'Build it', status: 'pending_qc', assigned_agent: 'Dev', qcRound: 8 }],
      agents: [{ name: 'Dev', status: 'Idle', current_task: null }],
      log: [], project_path: '/tmp/proj',
    })
    mission.__setSendToWindowForTest(sendToWindow)
    mission.__setQcQaRunnerForTest(async () => ({
      verdict: 'FAIL', responsibleAgent: 'Dev', reason: 'still broken',
    }))

    await mission.__enqueueQcCheckForTest(mission.__getMissionStateForTest().tasks[0], 'Dev')

    const state = mission.__getMissionStateForTest()
    expect(state.tasks[0].qcRound).toBe(9)
    expect(state.status).toBe('Needs Attention')
    expect(sendToWindow).toHaveBeenCalledWith('mission:status',
      expect.objectContaining({ status: 'Needs Attention' }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/ipc/mission.test.cjs`
Expected: FAIL — `__setQcQaRunnerForTest is not a function` etc.

- [ ] **Step 3: Write minimal implementation**

In `electron/ipc/mission.cjs`, add near the top (after existing requires):

```js
const { runQcQaCheck, nextEscalationTier } = require('../lib/qcqa.cjs');
```

Add a module-level injectable runner (defaults to the real one, overridable only in tests) just above the `enqueueQcCheck` stub location from Task 5:

```js
let qcQaRunner = runQcQaCheck;

function loadPromptTemplate(filename) {
  return fs.readFileSync(path.join(__dirname, '..', 'prompts', filename), 'utf8');
}

function fillTemplate(template, values) {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{{${key}}}`).join(value == null ? '' : String(value));
  }
  return out;
}
```

Replace the Task 5 stub with the real implementation:

```js
function enqueueQcCheck(task, agent) {
  const template = loadPromptTemplate('qc_check.md');
  const prompt = fillTemplate(template, {
    PROJECT_PATH: missionState.project_path,
    TASK_TITLE: task.title,
    TASK_DETAIL: task.detail || task.title,
    FILES_WRITTEN: (task.files_written || []).join(', ') || '(none reported)',
    BUILD_HINT: detectProjectType(missionState.project_path),
    RESPONSIBLE_AGENT: agent,
  });

  qcQaRunner({
    spawnClaude, prompt, projectPath: missionState.project_path,
    model: 'claude-sonnet-5', stage: 'QC', timeoutMs: 180000,
  }).then((verdict) => {
    if (verdict.verdict === 'PASS') {
      enqueueQaCheck(task, agent, verdict);
    } else {
      handleQcQaFailure(task, 'qc', verdict.responsibleAgent || agent, verdict.reason);
    }
  });
}

function enqueueQaCheck(task, agent, qcVerdict) {
  const template = loadPromptTemplate('qa_check.md');
  const prompt = fillTemplate(template, {
    PROJECT_PATH: missionState.project_path,
    TASK_TITLE: task.title,
    TASK_WHY: task.why || '(not specified)',
    TASK_DETAIL: task.detail || task.title,
    FILES_WRITTEN: (task.files_written || []).join(', ') || '(none reported)',
    QC_VERDICT_SUMMARY: 'PASS',
    RESPONSIBLE_AGENT: agent,
    SCOPE_NOTE: '',
  });

  qcQaRunner({
    spawnClaude, prompt, projectPath: missionState.project_path,
    model: 'claude-sonnet-5', stage: 'QA', timeoutMs: 180000,
  }).then((verdict) => {
    if (verdict.verdict === 'PASS') {
      task.status = 'completed';
      task.completed_at = now();
      sendToWindowRef('mission:task-update', {
        agent, description: task.title, status: 'completed', timestamp: task.completed_at,
      });
    } else {
      handleQcQaFailure(task, 'qa', verdict.responsibleAgent || agent, verdict.reason);
    }
  });
}

function handleQcQaFailure(task, stage, responsibleAgent, reason) {
  task.qcRound = (task.qcRound || 0) + 1;
  task.status = stage === 'qc' ? 'failed_qc' : 'failed_qa';
  const ts = now();
  sendToWindowRef('mission:task-update', {
    agent: responsibleAgent, description: task.title, status: task.status,
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

  // retry-same / retry-fresh: hand back to Lead's existing agent-resume flow
  // by putting the task back in progress. Lead's own DM/resume mechanics
  // (unchanged, out of scope) pick this up the same way it already handles
  // build-failure feedback today.
  task.status = 'in_progress';
  sendToWindowRef('mission:task-update', {
    agent: responsibleAgent, description: task.title, status: 'in_progress',
    reason, timestamp: ts,
  });
}
```

`sendToWindowRef` needs to be reachable from these functions even though `sendToWindow` is normally passed as a parameter into `handleParsedEvent`'s caller chain. Add a module-level variable set once at mission start (find where `sendToWindow` is first received, e.g. in the mission IPC handler setup) — add near the top with other module-level state:

```js
let sendToWindowRef = () => {};
```

And where the mission's main IPC entry point already receives `sendToWindow` as a parameter (search for `function launchMission` / `function deployMission` signatures), add one line at the top of that function body:

```js
sendToWindowRef = sendToWindow;
```

Add test hooks alongside the Task 5 test hooks:

```js
if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
  module.exports.__setSendToWindowForTest = (fn) => { sendToWindowRef = fn; };
  module.exports.__setQcQaRunnerForTest = (fn) => { qcQaRunner = fn; };
  module.exports.__enqueueQcCheckForTest = (task, agent) => {
    return new Promise((resolve) => {
      const template = loadPromptTemplate('qc_check.md');
      const prompt = fillTemplate(template, {
        PROJECT_PATH: missionState.project_path, TASK_TITLE: task.title,
        TASK_DETAIL: task.detail || task.title,
        FILES_WRITTEN: (task.files_written || []).join(', ') || '(none reported)',
        BUILD_HINT: detectProjectType(missionState.project_path || '.'),
        RESPONSIBLE_AGENT: agent,
      });
      qcQaRunner({ spawnClaude, prompt, projectPath: missionState.project_path,
        model: 'claude-sonnet-5', stage: 'QC', timeoutMs: 180000 }).then((verdict) => {
        if (verdict.verdict === 'PASS') {
          enqueueQaCheck(task, agent, verdict);
        } else {
          handleQcQaFailure(task, 'qc', verdict.responsibleAgent || agent, verdict.reason);
        }
        resolve();
      });
    });
  };
}
```

(This test hook duplicates `enqueueQcCheck`'s body rather than awaiting it directly because `enqueueQcCheck` itself is fire-and-forget by design in production — Lead must not block on QC/QA. The test hook exists solely so tests can `await` the same code path deterministically.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/ipc/mission.test.cjs`
Expected: PASS (4 tests in this describe block)

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/mission.cjs
git commit -m "feat: wire QC then QA per-task verification pipeline"
```

---

## Task 7: Final whole-picture QA sweep + remove exit-code completion

**Files:**
- Modify: `electron/ipc/mission.cjs:1765` (`watchProcessExit_launch`)
- Modify: `electron/ipc/mission.cjs:2371-2468` (`watchProcessExit_deploy`)
- Test: `electron/ipc/mission.test.cjs`

**Interfaces:**
- Consumes: `qcQaRunner`, `nextEscalationTier`, `handleQcQaFailure` (Task 6); `qa_check.md` template (Task 4, with `{{SCOPE_NOTE}}` populated this time).
- Produces: `runFinalQaSweep()` — checked whenever a process exits successfully; only runs (and only its PASS sets `Completed`) once every task in `missionState.tasks` is `'completed'`. If any task is not yet `'completed'` when the process exits with code 0, mission stays `'Running'` (per spec §3, a discrepancy Lead's prompt must not paper over — this is deliberately not auto-fixed here, only gated).

- [ ] **Step 1: Write the failing test**

Append to `electron/ipc/mission.test.cjs`:

```js
describe('runFinalQaSweep gating', () => {
  let mission

  beforeEach(() => {
    delete require.cache[require.resolve('./mission.cjs')]
    mission = require('./mission.cjs')
  })

  test('does not set Completed while a task is still pending_qc', async () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      id: 'm1', status: 'Running', phase: 'Executing',
      tasks: [{ id: 't1', title: 'A', status: 'completed' },
              { id: 't2', title: 'B', status: 'pending_qc' }],
      agents: [{ name: 'Dev', status: 'Idle' }],
      log: [], project_path: '/tmp/proj', file_changes: [],
    })
    mission.__setSendToWindowForTest(sendToWindow)

    await mission.__runFinalQaSweepForTest()

    expect(mission.__getMissionStateForTest().status).not.toBe('Completed')
  })

  test('sets Completed only after the final whole-picture QA PASSes', async () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      id: 'm1', status: 'Running', phase: 'Executing',
      tasks: [{ id: 't1', title: 'A', status: 'completed' }],
      agents: [{ name: 'Dev', status: 'Idle' }],
      log: [], project_path: '/tmp/proj', file_changes: [],
    })
    mission.__setSendToWindowForTest(sendToWindow)
    mission.__setQcQaRunnerForTest(async () => ({ verdict: 'PASS' }))

    await mission.__runFinalQaSweepForTest()

    expect(mission.__getMissionStateForTest().status).toBe('Completed')
  })

  test('final QA FAIL keeps mission Running and routes failure to the named agent', async () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      id: 'm1', status: 'Running', phase: 'Executing',
      tasks: [{ id: 't1', title: 'A', status: 'completed', assigned_agent: 'Dev', qcRound: 0 }],
      agents: [{ name: 'Dev', status: 'Idle' }],
      log: [], project_path: '/tmp/proj', file_changes: [],
    })
    mission.__setSendToWindowForTest(sendToWindow)
    mission.__setQcQaRunnerForTest(async () => ({
      verdict: 'FAIL', responsibleAgent: 'Dev', reason: 'frontend and backend not wired together',
    }))

    await mission.__runFinalQaSweepForTest()

    const state = mission.__getMissionStateForTest()
    expect(state.status).toBe('Running')
    expect(state.tasks[0].status).toBe('in_progress')
    expect(state.tasks[0].qcRound).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/ipc/mission.test.cjs`
Expected: FAIL — `__runFinalQaSweepForTest is not a function`

- [ ] **Step 3: Write minimal implementation**

Add `runFinalQaSweep` in `electron/ipc/mission.cjs`, near `handleQcQaFailure`:

```js
function runFinalQaSweep() {
  const allCompleted = missionState.tasks.every(t => t.status === 'completed');
  if (!allCompleted) {
    // Process exited successfully but not every task reached real completion.
    // Do not force it — leave the mission Running so the gap is visible
    // rather than papered over. Lead's own narration is responsible for not
    // claiming victory here (prompt change, Task 9).
    return Promise.resolve();
  }

  missionState.status = 'AwaitingFinalQA';
  sendToWindowRef('mission:status', { mission_id: missionState.id, status: 'AwaitingFinalQA' });

  const template = loadPromptTemplate('qa_check.md');
  const changedFiles = (missionState.file_changes || []).map(f => f.path || f).join(', ');
  const taskSummaries = missionState.tasks.map(t => `- ${t.title} (owner: ${t.assigned_agent || 'unknown'})`).join('\n');
  const prompt = fillTemplate(template, {
    PROJECT_PATH: missionState.project_path,
    TASK_TITLE: '(whole mission — see scope note)',
    TASK_WHY: missionState.description || '(not specified)',
    TASK_DETAIL: taskSummaries,
    FILES_WRITTEN: changedFiles || '(none reported)',
    QC_VERDICT_SUMMARY: 'N/A — every task already passed its own QC/QA',
    RESPONSIBLE_AGENT: '(see REASON — name the specific agent at fault)',
    SCOPE_NOTE: 'This is the FINAL WHOLE-PICTURE review: judge the mission as an integrated whole, not one task in isolation. Look specifically for cross-task mismatches (e.g. backend and frontend each correct alone but not correctly wired together).',
  });

  return qcQaRunner({
    spawnClaude, prompt, projectPath: missionState.project_path,
    model: 'claude-sonnet-5', stage: 'QA', timeoutMs: 240000,
  }).then((verdict) => {
    if (verdict.verdict === 'PASS') {
      missionState.status = 'Completed';
      sendToWindowRef('mission:status', { mission_id: missionState.id, status: 'Completed' });
    } else {
      missionState.status = 'Running';
      const flagged = missionState.tasks.find(t => t.assigned_agent === verdict.responsibleAgent) || missionState.tasks[0];
      handleQcQaFailure(flagged, 'qa', verdict.responsibleAgent || flagged.assigned_agent, verdict.reason);
      sendToWindowRef('mission:status', { mission_id: missionState.id, status: 'Running' });
    }
  });
}
```

Now replace the two exit-code assignments.

In `watchProcessExit_launch`, find line 1765:

```js
const finalStatus = (code === 0 || code === null) ? 'Completed' : 'Failed';
```

This path is planning-only and has no tasks yet (plan hasn't been reviewed/deployed), so it keeps setting `Completed`/`Failed` directly — QC/QA only applies once tasks exist during Executing. No change needed here per spec §3 (this is confirmed by re-reading the design: §3 says the deploy path, not launch, is "the primary target for replacement" — `watchProcessExit_launch` covers the Planning phase before any task exists to verify). Leave line 1765 unchanged.

In `watchProcessExit_deploy`, replace lines 2426-2442:

```js
    stopWatcher();
    stopAutosave();
    stopStuckChecker();
    clearAgentTeamsTimer();
    if (missionState.status === 'Running') {
      missionState.status = code === 0 || code === null ? 'Completed' : 'Failed';
    }
    missionState.phase = 'Done';

    // Mark all agents as Done/Error now that process has actually exited
    for (const a of missionState.agents) {
      if (a.status !== 'Error') a.status = 'Done';
      if (a.name === 'Lead') a.current_task = missionState.status === 'Completed' ? 'Mission completed' : 'Mission failed';
    }

    // Mark remaining pending tasks
    if (missionState.status === 'Completed') {
      for (const task of missionState.tasks) {
        if (task.status !== 'completed') { task.status = 'completed'; task.completed_at = ts; }
      }
    }
```

with:

```js
    stopWatcher();
    stopAutosave();
    stopStuckChecker();
    clearAgentTeamsTimer();

    const finishDeployExit = () => {
      missionState.phase = 'Done';

      for (const a of missionState.agents) {
        if (a.status !== 'Error') a.status = 'Done';
        if (a.name === 'Lead') a.current_task = missionState.status === 'Completed' ? 'Mission completed' : 'Mission failed';
      }

      finalizeDeployExit(missionId, sendToWindow, ts);
    };

    if (missionState.status === 'Running') {
      if (code === 0 || code === null) {
        // Success exit code alone is no longer sufficient — the final
        // whole-picture QA sweep is the only path to 'Completed'. If any
        // task isn't 'completed' yet, runFinalQaSweep() leaves status
        // 'Running' rather than forcing it, per spec §3.
        runFinalQaSweep().then(finishDeployExit);
        return;
      }
      missionState.status = 'Failed';
    }
    finishDeployExit();
```

The trailing auto-save/history code (previously lines 2444-2467) now runs twice conceptually (once for the non-Running-status early paths, once after the sweep) — extract it into `finalizeDeployExit` so both call sites share it. Replace the remainder of the function (previously lines 2444-2467) with:

```js
}); // end proc.on('close', ...)
}

function finalizeDeployExit(missionId, sendToWindow, ts) {
  missionState.ended_at = ts;
  const statusStr = missionState.status === 'Completed' ? 'completed' : 'failed';
  const entry = {
    id: missionState.id,
    description: missionState.description,
    project_path: missionState.project_path,
    execution_mode: missionState.execution_mode || 'standard',
    team_size: missionState.team_size,
    forked_from: missionState.forked_from || null,
    forked_from_desc: missionState.forked_from_desc || null,
    status: statusStr,
    started_at: missionState.started_at,
    ended_at: ts,
    agent_count: missionState.agents.length,
    task_summary: missionState.tasks.map(t => `[${t.status}] ${t.title}`),
    file_changes: missionState.file_changes,
    log_count: missionState.log.length,
  };
  saveToHistory(entry);
  saveMissionSnapshot(missionState);

  sendToWindow('mission:status', { mission_id: missionId, status: statusStr });
}
```

Note the closing brace bookkeeping: `watchProcessExit_deploy`'s `proc.on('close', (code) => { ... })` callback body ends where `finishDeployExit()` is invoked or returned from; `finalizeDeployExit` becomes its own top-level function declared immediately after, so `watchProcessExit_deploy` itself closes one brace earlier than before. When applying this edit, diff carefully against the original 2371-2468 range and confirm brace balance with `node --check electron/ipc/mission.cjs` after editing.

Add test hooks:

```js
if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
  module.exports.__runFinalQaSweepForTest = () => runFinalQaSweep();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --check electron/ipc/mission.cjs && npx vitest run electron/ipc/mission.test.cjs`
Expected: `node --check` prints nothing (valid syntax); vitest PASS (all tests in the file, including Tasks 5-6's).

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/mission.cjs
git commit -m "feat: gate mission Completed behind the final whole-picture QA sweep"
```

---

## Task 8: Renderer — status badges and task list icons

**Files:**
- Modify: `src/components/mission/StatusBadge.jsx`
- Modify: `src/components/mission/TaskList.jsx`
- Test: `src/components/mission/StatusBadge.test.jsx` (create)

**Interfaces:**
- Consumes: the new status strings emitted by `mission.cjs` (Tasks 5-7): `pending_qc`, `failed_qc`, `pending_qa`, `failed_qa` (task-level); `AwaitingFinalQA`, `Needs Attention` (mission-level).
- Produces: visually distinct badges/icons for each.

- [ ] **Step 1: Write the failing test**

```jsx
// src/components/mission/StatusBadge.test.jsx
import { render, screen } from '@testing-library/react'
import { test, expect } from 'vitest'
import { StatusBadge } from './StatusBadge'

test('renders a distinct label for pending_qc', () => {
  render(<StatusBadge status="pending_qc" />)
  expect(screen.getByText(/QC/i)).toBeInTheDocument()
})

test('renders a distinct label for pending_qa', () => {
  render(<StatusBadge status="pending_qa" />)
  expect(screen.getByText(/QA/i)).toBeInTheDocument()
})

test('renders a distinct label for failed_qc', () => {
  render(<StatusBadge status="failed_qc" />)
  expect(screen.getByText(/QC/i)).toBeInTheDocument()
})

test('renders a distinct label for Needs Attention', () => {
  render(<StatusBadge status="Needs Attention" />)
  expect(screen.getByText('Needs Attention')).toBeInTheDocument()
})

test('renders a distinct label for AwaitingFinalQA', () => {
  render(<StatusBadge status="AwaitingFinalQA" />)
  expect(screen.getByText(/Final QA/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/mission/StatusBadge.test.jsx`
Expected: FAIL — falls back to `config.pending`, text doesn't match `/QC/i` etc.

- [ ] **Step 3: Write minimal implementation**

Read `src/components/mission/StatusBadge.jsx` first to get the exact `config` object shape, then add entries following the same shape as the existing ones (label + color classes), for example:

```jsx
pending_qc:   { label: 'In QC Review',   className: 'bg-blue-500/20 text-blue-300' },
failed_qc:    { label: 'QC Failed',      className: 'bg-red-500/20 text-red-300' },
pending_qa:   { label: 'In QA Review',   className: 'bg-purple-500/20 text-purple-300' },
failed_qa:    { label: 'QA Failed',      className: 'bg-red-500/20 text-red-300' },
AwaitingFinalQA: { label: 'Final QA Review', className: 'bg-purple-500/20 text-purple-300' },
'Needs Attention': { label: 'Needs Attention', className: 'bg-orange-500/20 text-orange-300' },
```

Match these to whatever property names the existing `config` entries actually use (confirm via the Read from Step 3 before writing — the earlier session's read of this file found entries like `Spawning`, `Working`, `Idle`, `Done`, `Error`, `pending`, `in_progress`, `completed`, `blocked`, `launching`, `running`, `completed_m`, `failed`, `stopped`, each likely `{ label, className }` or similar; use the exact same field names).

In `src/components/mission/TaskList.jsx`, extend the `statusIcon` map (lines 4-10):

```jsx
const statusIcon = {
  pending:     <Circle size={14} className="text-vs-muted" />,
  in_progress: <Loader2 size={14} className="text-vs-accent animate-spin" />,
  pending_qc:  <Loader2 size={14} className="text-blue-400 animate-spin" />,
  failed_qc:   <AlertTriangle size={14} className="text-vs-red" />,
  pending_qa:  <Loader2 size={14} className="text-purple-400 animate-spin" />,
  failed_qa:   <AlertTriangle size={14} className="text-vs-red" />,
  completed:   <CheckCircle2 size={14} className="text-vs-green" />,
  blocked:     <AlertCircle size={14} className="text-yellow-400" />,
  error:       <AlertCircle size={14} className="text-vs-red" />,
}
```

And update `inferPhase` (line 20) so QC/QA-pending tasks don't fall through to `null`:

```jsx
function inferPhase(task, agentLogs) {
  if (task.status === 'completed') return 'complete'
  if (task.status === 'pending_qc' || task.status === 'pending_qa') return 'building'
  if (task.status !== 'in_progress') return null
  ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/mission/StatusBadge.test.jsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/mission/StatusBadge.jsx src/components/mission/TaskList.jsx src/components/mission/StatusBadge.test.jsx
git commit -m "feat: render QC/QA task and mission statuses distinctly in the UI"
```

---

## Task 9: Renderer — `useMission.js` task-matching for new statuses

**Files:**
- Modify: `src/hooks/useMission.js` (the `mission:task-update` listener, ~lines 344-418)
- Test: `src/hooks/useMission.test.js` (create if it doesn't exist, else extend)

**Interfaces:**
- Consumes: `mission:task-update` events now carrying `status: 'pending_qc' | 'failed_qc' | 'pending_qa' | 'failed_qa'` in addition to the existing values.
- Produces: the same task entry (matched by `task_id` first, falling back to agent+description matching) is updated in place regardless of which of these statuses it's transitioning through, instead of only being found while `status === 'in_progress'`.

- [ ] **Step 1: Write the failing test**

First read `src/hooks/useMission.js` lines 340-418 again to get the exact current fallback-matcher conditions (already captured in the conversation summary — the matcher looks for `t.status === 'in_progress'` to find "the task this completion applies to"). Then write:

```jsx
// src/hooks/useMission.test.js (add to existing file, or create if absent)
import { renderHook, act } from '@testing-library/react'
import { test, expect, vi } from 'vitest'
import { useMission } from './useMission'

// Reuse whatever tauri event-mock pattern the existing useMission tests use
// (check for an existing useMission.test.js first — if absent, mirror the
// `listen`/`emit` mock pattern from MissionControlPage.replay-phases.test.jsx).

test('a pending_qc update replaces the matching in_progress task, not appends a duplicate', async () => {
  // ... construct via the project's existing useMission test harness,
  // seed one task in_progress for agent 'Dev', then emit:
  // { agent: 'Dev', description: 'Build it', status: 'pending_qc', timestamp: 5 }
  // assert missionState.tasks.length is still 1 and its status is 'pending_qc'
})

test('a failed_qc update on an existing pending_qc task updates it in place', async () => {
  // seed one task pending_qc for agent 'Dev', then emit:
  // { agent: 'Dev', description: 'Build it', status: 'failed_qc', reason: 'x', timestamp: 6 }
  // assert missionState.tasks.length is still 1 and its status is 'failed_qc'
})
```

(If no `useMission.test.js` exists yet, check for the harness used by `MissionControlPage.replay-phases.test.jsx` — it mocks `@tauri-apps/api/event`'s `listen` with a shared `listeners` map and an `emit` helper; reuse that exact pattern here, rendering `useMission()` via `renderHook` instead of a full page.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useMission.test.js`
Expected: FAIL — the fallback matcher only checks `status === 'in_progress'`, so a second event for the same agent+description creates a duplicate task entry instead of updating the existing `pending_qc`/`failed_qc` one.

- [ ] **Step 3: Write minimal implementation**

In `src/hooks/useMission.js`, find the fallback matcher condition inside the `mission:task-update` listener that currently reads (per the summary) something like:

```js
const idx = tasks.findIndex(t => t.id === task_id) // or similar task_id-first match
// ...fallback...
tasks.findIndex(t => t.assigned_agent === agent && t.status === 'in_progress')
```

Widen the fallback's status check to include every state that can legitimately transition into a QC/QA-related status:

```js
const IN_FLIGHT_STATUSES = ['in_progress', 'pending_qc', 'failed_qc', 'pending_qa', 'failed_qa'];
// ...
tasks.findIndex(t => t.assigned_agent === agent && IN_FLIGHT_STATUSES.includes(t.status))
```

Apply this same widened check everywhere in the listener that currently hardcodes `t.status === 'in_progress'` as the "find the task this update applies to" condition (per the summary, there are multiple such spots — update all of them, and leave the `status === 'completed'` check for `completed_at` assignment as-is since that's about the destination status, not the match condition).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/useMission.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useMission.js src/hooks/useMission.test.js
git commit -m "fix: recognize QC/QA in-flight statuses in task-update matching"
```

---

## Task 10: Prompt changes — remove Lead self-fix language

**Files:**
- Modify: `electron/prompts/deploy_agent_teams.md:129`
- Modify: `electron/prompts/deploy_standard.md` (Phase 3 step 3)
- Modify: `electron/prompts/continue_agent_teams.md:48`

**Interfaces:** None — static prompt text, no test harness exercises exact wording. Verified by direct diff review, not automated test.

- [ ] **Step 1: Edit `deploy_agent_teams.md`**

Read the file around line 129 to get exact current wording, then change the line containing:

```
If agent is no longer active, fix the error yourself or spawn a new agent for it
```

to:

```
If agent is no longer active, respawn the same role as a new agent and hand it the error — Lead never edits code to fix another agent's mistake directly
```

- [ ] **Step 2: Edit `deploy_standard.md`**

Read Phase 3 step 3 to get exact current wording, then change the line containing:

```
Fix them directly using Edit/Write tools, OR spawn a fix agent
```

to:

```
Spawn a fix agent to resolve them — Lead never edits code directly to fix another agent's mistake
```

- [ ] **Step 3: Edit `continue_agent_teams.md`**

Change line 48:

```
2. If verification fails, send the error to the responsible teammate to fix (or fix it yourself if they are no longer active)
```

to:

```
2. If verification fails, send the error to the responsible teammate to fix. If they are no longer active, spawn a new teammate for the same role and hand it the error — never fix it yourself
```

- [ ] **Step 4: No automated test — verify by reading the diff**

Run: `git diff electron/prompts/deploy_agent_teams.md electron/prompts/deploy_standard.md electron/prompts/continue_agent_teams.md`
Expected: three hunks, each replacing self-fix language with respawn-and-delegate language, no other changes.

- [ ] **Step 5: Commit**

```bash
git add electron/prompts/deploy_agent_teams.md electron/prompts/deploy_standard.md electron/prompts/continue_agent_teams.md
git commit -m "docs: remove Lead self-fix language from agent prompts"
```

---

## Task 11: Integration test — full QC/QA fix loop via fake claude harness

**Files:**
- Create: `tests/specs/qcqa-verification-loop.spec.ts`
- Reference (read, don't modify): `tests/support/electronApp.ts`, `tests/specs/replay-real-ui-fidelity.spec.ts` (for the `fakeClaudeLines`/`fakeClaudeDelayMs` harness pattern)

**Interfaces:**
- Consumes: `launchApp({ fakeClaudeLines, fakeClaudeDelayMs })` (existing harness).
- Produces: an E2E spec asserting the full status sequence `pending_qc → failed_qc → in_progress → pending_qc → pending_qa → completed`, and that the mission only reaches `Completed` after a final fake whole-picture QA also emits `PASS`.

**Note:** this test requires the fake-`claude` fixture to also emulate QC/QA subprocess invocations (since `enqueueQcCheck`/`enqueueQaCheck` call `spawnClaude` again, which resolves to the same shadowed `claude` binary via `PATH`). Read `tests/fixtures/fake-claude/claude.cjs` first to confirm how it currently branches behavior by argv/prompt content — the QC/QA prompts are distinguishable by their `-p <prompt>` argument containing the literal strings from `qc_check.md`/`qa_check.md` (e.g. `"You are the QC-Agent"` / `"You are the QA-Agent"`), so the fixture can branch on `process.argv` containing that substring and print the appropriate `[QC] VERDICT:`/`[QA] VERDICT:` line instead of the mission-script lines.

- [ ] **Step 1: Read the fake-claude fixture to confirm its branching mechanism**

Run: `cat tests/fixtures/fake-claude/claude.cjs` (or Read tool) — confirm whether it currently supports multiple distinct scripts selected by env var or argv, and how `fakeClaudeLines` reaches it (likely via an env var set by `launchApp`, e.g. `FAKE_CLAUDE_SCRIPT` or similar — confirm exact name before writing the test).

- [ ] **Step 2: Write the failing test**

```ts
// tests/specs/qcqa-verification-loop.spec.ts
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { launchApp, type LaunchedApp } from '../support/electronApp';
import { RecordingsPage } from '../pages/RecordingsPage';

const FAKE_PLAN = {
  agents: [
    { name: 'Lead', role: 'Lead Coordinator' },
    { name: 'Dev', role: 'Developer', model: 'sonnet', reason: 'implementation work' },
  ],
  tasks: [{ title: 'Build the widget', why: 'demo', agent: 'Dev', detail: 'Build a widget', priority: 'high' }],
  mission_context: 'QC/QA E2E demo mission',
};

const PLAN_LINE = JSON.stringify({
  type: 'assistant', session_id: 'fake-session-qcqa',
  message: { content: [{ type: 'text', text: `=== MISSION PLAN ===\n${JSON.stringify(FAKE_PLAN)}\n=== END PLAN ===` }] },
});

const FAKE_CLAUDE_SCRIPT = [
  PLAN_LINE,
  '[Lead] Starting: Build the widget',
  '[Dev] Starting: Build the widget',
  '[Dev] Completed: Build the widget',
];

test.describe('QC/QA verification loop', () => {
  let harness: LaunchedApp;
  let projectDir: string;

  test.beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-teams-qcqa-e2e-'));
    harness = await launchApp({ fakeClaudeLines: FAKE_CLAUDE_SCRIPT, fakeClaudeDelayMs: 200 });
  });

  test.afterEach(async () => {
    await harness.cleanup();
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  test('a task fails QC once, then passes QC and QA, then the final sweep completes the mission', async () => {
    const { window } = harness;
    const recordings = new RecordingsPage(window);

    await recordings.gotoMission();
    await window.locator('input[placeholder="D:\\\\projects\\\\my-app"]').fill(projectDir);
    await window.locator('textarea[placeholder^="Ví dụ: Build a user authentication feature"]')
      .fill('Build a tiny demo feature for the QC/QA E2E test');

    await window.getByRole('button', { name: 'Launch Mission' }).click();
    await expect(window.getByRole('button', { name: 'Deploy Team' })).toBeVisible({ timeout: 15_000 });
    await window.getByRole('button', { name: 'Deploy Team' }).click();
    await window.getByRole('button', { name: 'Deploy Mission' }).click();

    // The task should first show as pending QC review, not immediately completed.
    await expect(window.getByText(/In QC Review/i)).toBeVisible({ timeout: 15_000 });

    // Fake QC/QA fixture (Step 1's fixture change) is configured to fail QC
    // once then pass — assert the failed_qc badge appears...
    await expect(window.getByText(/QC Failed/i)).toBeVisible({ timeout: 20_000 });

    // ...then the retry cycles back through pending_qc, into pending_qa...
    await expect(window.getByText(/In QA Review/i)).toBeVisible({ timeout: 20_000 });

    // ...and the mission only reaches Completed after the final whole-picture
    // QA sweep (fixture configured to PASS it) — not merely on process exit.
    await expect(window.getByText('Completed', { exact: true })).toBeVisible({ timeout: 20_000 });
  });
});
```

- [ ] **Step 3: Update the fake-claude fixture to emit QC/QA verdicts**

Based on Step 1's findings, add branching to `tests/fixtures/fake-claude/claude.cjs`: when invoked with a `-p` prompt containing `"You are the QC-Agent"`, print `[QC] VERDICT: FAIL` + `RESPONSIBLE_AGENT`/`REASON` lines on the first invocation and `[QC] VERDICT: PASS` on subsequent invocations (track invocation count via a temp file keyed by project dir, since each invocation is a fresh process); when invoked with a prompt containing `"You are the QA-Agent"`, always print `[QA] VERDICT: PASS`. Exact implementation depends on Step 1's findings about the fixture's current structure — write this to fit the existing fixture's conventions rather than replacing it wholesale.

- [ ] **Step 4: Run the test to verify it fails, then passes**

Run: `npm run pretest:e2e && npx playwright test tests/specs/qcqa-verification-loop.spec.ts`
Expected: first run FAILS (before Step 3's fixture change lands, or before Tasks 1-10 are complete); after Tasks 1-10 and Step 3 are in place, PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/specs/qcqa-verification-loop.spec.ts tests/fixtures/fake-claude/claude.cjs
git commit -m "test: add E2E coverage for the QC/QA verification loop"
```

---

## Task 12: Fix seed-task reconciliation — close the `runFinalQaSweep()` deadlock

**Background:** Discovered during Task 11 (E2E test implementation), independently re-verified via direct code reads and git history by the plan owner before this task was authored. `applyPlanToState` (`electron/ipc/mission.cjs:1456-1517`) is the sole place that assigns `missionState.tasks = newTasks` (line 1501), seeding every planned task at `id: 'task-${i}'`, `status: 'pending'` (lines 1473-1484). The UI's "Deploy Team" button (`PlanReview.jsx`'s `canDeploy` check) requires at least one such seeded, assigned task to ever be deployable at all — so this seed row is unavoidable for every mission launched through the normal UI flow.

Once deployed, `TaskStarted` (`mission.cjs:420-434`) unconditionally `push`es a brand-new task row for the same logical task — it never looks up or reconciles against the plan-seeded row by title or id. `TaskCompleted` (`mission.cjs:436-462`) only matches an existing row via `x.assigned_agent === agent && x.status === 'in_progress'` — since the seed row's status is permanently `'pending'` (never `'in_progress'`), it can never match there either, so a *third*, separate row gets created instead. Net effect: the plan-seeded row is permanently orphaned at `status: 'pending'`, for the lifetime of the mission, disconnected from the real task-tracking machinery entirely.

This orphaning itself predates this plan (confirmed via `git show 7df2326~1:electron/ipc/mission.cjs` — the old `TaskCompleted` handler had the identical `status === 'in_progress'`-only matcher). Before Task 7, it was silently masked: the old exit watcher set `missionState.status = code === 0 || code === null ? 'Completed' : 'Failed'` unconditionally on exit code (zero dependency on task statuses), and immediately after, force-completed every task still not `'completed'` (`if (missionState.status === 'Completed') { for (const task of missionState.tasks) { if (task.status !== 'completed') { task.status = 'completed'; ... } } }`) — silently laundering the orphaned seed row right after the fact.

Task 7 (already committed, `76222c8`) kept this force-loop, now living inside `finalizeDeployExit` (`mission.cjs:2614-2620`), still gated behind `if (missionState.status === 'Completed')`. But `runFinalQaSweep()` (`mission.cjs:331-338`) gates entirely on `missionState.tasks.every(t => t.status === 'completed')` (line 332) — an unconditional `.every()` over the *entire* tasks array, including the permanently-orphaned seed row — and only if that passes does `missionState.status` ever become `'Completed'`. Since `finalizeDeployExit`'s force-loop only runs *after* `status` is already `'Completed'` (confirmed via the call chain in `watchProcessExit_deploy`, `mission.cjs:2599-2610`: `runFinalQaSweep().then(finishDeployExit)`, where `finishDeployExit` calls `finalizeDeployExit`), and `status` can only become `'Completed'` if the force-loop has *already* cleaned up the orphan — this is a genuine deadlock. **No mission deployed through the normal UI flow can ever reach `Completed` anymore.** This is a regression introduced by Task 7's restructuring (the force-loop used to be unconditionally reachable; now it is gated behind the very condition it alone can satisfy), not merely the old dormant bug resurfacing.

This must land **before** Task 13 (which also calls `runFinalQaSweep()` from the Agent Teams inactivity path, and would otherwise be built on the same broken foundation) and before Task 11's E2E test can pass.

**Files:**
- Modify: `electron/ipc/mission.cjs` (`applyPlanToState`, `TaskStarted`, `TaskCompleted`)
- Test: `electron/ipc/mission.test.cjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `TaskStarted`/`TaskCompleted` reconcile against the plan-seeded row (matched by title) instead of creating parallel/orphaned rows. The seeded row's `id` becomes the stable identity used throughout the task's lifecycle, from `'pending'` all the way through `'completed'`.

- [ ] **Step 1: Write the failing test**

Append to `electron/ipc/mission.test.cjs`:

```js
describe('seed-task reconciliation', () => {
  beforeEach(() => {
    delete require.cache[require.resolve('./mission.cjs')]
  })

  test('TaskStarted reconciles against the plan-seeded row instead of creating a duplicate', () => {
    const mission = require('./mission.cjs')
    mission.__setMissionStateForTest({
      id: 'm1', status: 'Running', phase: 'Executing',
      tasks: [{ id: 'task-0', title: 'Build the widget', status: 'pending', assigned_agent: 'Dev' }],
      agents: [{ name: 'Dev', status: 'Idle' }],
      log: [], project_path: '/tmp/proj', file_changes: [],
    })
    mission.__setSendToWindowForTest(() => {})

    mission.__handleParsedEventForTest({ type: 'TaskStarted', agent: 'Dev', description: 'Build the widget' }, () => {})

    const state = mission.__getMissionStateForTest()
    expect(state.tasks.length).toBe(1)
    expect(state.tasks[0].id).toBe('task-0')
    expect(state.tasks[0].status).toBe('in_progress')
  })

  test('TaskCompleted reconciles against the seeded row across the full QC/QA cycle to completed', () => {
    const mission = require('./mission.cjs')
    mission.__setMissionStateForTest({
      id: 'm1', status: 'Running', phase: 'Executing',
      tasks: [{ id: 'task-0', title: 'Build the widget', status: 'pending', assigned_agent: 'Dev' }],
      agents: [{ name: 'Dev', status: 'Idle' }],
      log: [], project_path: '/tmp/proj', file_changes: [],
    })
    mission.__setSendToWindowForTest(() => {})
    mission.__setQcQaRunnerForTest(async () => ({ verdict: 'PASS' }))

    mission.__handleParsedEventForTest({ type: 'TaskStarted', agent: 'Dev', description: 'Build the widget' }, () => {})
    mission.__handleParsedEventForTest({ type: 'TaskCompleted', agent: 'Dev', description: 'Build the widget' }, () => {})

    const state = mission.__getMissionStateForTest()
    expect(state.tasks.length).toBe(1)
    expect(state.tasks[0].id).toBe('task-0')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/ipc/mission.test.cjs`
Expected: FAIL — `state.tasks.length` is 2 (the seed row plus the newly-pushed row), not 1.

- [ ] **Step 3: Write minimal implementation**

In `TaskStarted` (`mission.cjs:420-434`), look up an existing `'pending'` row by title+agent before pushing a new one:

```js
case 'TaskStarted': {
  const { agent, description } = event;
  if (missionState) {
    const existing = missionState.tasks.find(x =>
      x.title === description && x.assigned_agent === agent && x.status === 'pending');
    if (existing) {
      existing.status = 'in_progress';
      existing.started_at = ts;
      const a = missionState.agents.find(x => x.name === agent);
      if (a) { a.status = 'Working'; a.current_task = description; }
      sendToWindow('mission:task-update', { task_id: existing.id, agent, description, status: 'in_progress', timestamp: ts });
      break;
    }
    const taskId = `task-${ts}`;
    missionState.tasks.push({
      id: taskId, title: description,
      status: 'in_progress', assigned_agent: agent,
      started_at: ts, completed_at: null, priority: null,
    });
    const a = missionState.agents.find(x => x.name === agent);
    if (a) { a.status = 'Working'; a.current_task = description; }
    sendToWindow('mission:task-update', { task_id: taskId, agent, description, status: 'in_progress', timestamp: ts });
  }
  break;
}
```

`TaskCompleted`'s existing matcher (`x.assigned_agent === agent && x.status === 'in_progress'`) already works correctly once `TaskStarted` reconciles the seeded row first — no change needed there, since the row it looks for now genuinely reaches `'in_progress'` under the seeded `id` instead of staying stuck at `'pending'` under a parallel row.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --check electron/ipc/mission.cjs && npx vitest run electron/ipc/mission.test.cjs`
Expected: `node --check` prints nothing; vitest PASS, `state.tasks.length` is 1 in both new tests.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/mission.cjs electron/ipc/mission.test.cjs
git commit -m "fix: reconcile TaskStarted against the plan-seeded task row instead of duplicating it"
```

---

## Task 13: Close the Agent Teams completion bypass — gate `scheduleAgentTeamsCompletion` behind `runFinalQaSweep()`

**Background:** Discovered during Task 7's code review, not part of the original design. `scheduleAgentTeamsCompletion` (`electron/ipc/mission.cjs:733-783`, scheduled from the `result`-event handler at `mission.cjs:2425-2435` whenever all non-Lead agents in an Agent Teams mission report Done/Error) force-sets `missionState.status = 'Completed'` and force-completes every task after a 90-second inactivity timer, with **zero QC/QA involvement**. This is a second, independent bypass of the plan's own Global Constraint (line 22: "Mission reaches `Completed` only via `runFinalQaSweep()` passing. Exit code alone never sets `Completed`."), reachable only in `execution_mode: 'agent_teams'`. It predates this plan and was not introduced by any prior task here — this task closes it using the same pattern Task 7 already established for the exit-code path.

**Files:**
- Modify: `electron/ipc/mission.cjs:733-783` (`scheduleAgentTeamsCompletion`)
- Test: `electron/ipc/mission.test.cjs`

**Interfaces:**
- Consumes: `runFinalQaSweep()` (Task 7).
- Produces: the 90s inactivity timer now routes through `runFinalQaSweep()` instead of directly assigning `'Completed'` and force-completing tasks. If not every task is `'completed'` yet, the sweep leaves the mission `'Running'` (visible gap, not papered over) rather than force-completing stragglers — same behavior Task 7 already established for the exit-code path. This intentionally removes the old "any task not yet `completed` gets force-completed" loop at lines 758-760, since that loop is exactly the kind of unverified completion this whole plan exists to close.

- [ ] **Step 1: Write the failing test**

Append to `electron/ipc/mission.test.cjs`:

```js
describe('scheduleAgentTeamsCompletion gating', () => {
  let mission

  beforeEach(() => {
    vi.useFakeTimers()
    delete require.cache[require.resolve('./mission.cjs')]
    mission = require('./mission.cjs')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('90s inactivity timeout routes through runFinalQaSweep, not a direct Completed assignment', async () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      id: 'm1', status: 'Running', phase: 'Executing',
      execution_mode: 'agent_teams',
      tasks: [{ id: 't1', title: 'A', status: 'completed' }],
      agents: [{ name: 'Lead', status: 'Working' }, { name: 'Dev', status: 'Done' }],
      log: [], project_path: '/tmp/proj', file_changes: [],
    })
    mission.__setSendToWindowForTest(sendToWindow)
    mission.__setQcQaRunnerForTest(async () => ({ verdict: 'PASS' }))

    mission.__scheduleAgentTeamsCompletionForTest('m1', sendToWindow)
    await vi.advanceTimersByTimeAsync(90_000)

    expect(mission.__getMissionStateForTest().status).toBe('Completed')
  })

  test('does not force-complete a still-pending task — leaves mission Running instead', async () => {
    const sendToWindow = vi.fn()
    mission.__setMissionStateForTest({
      id: 'm1', status: 'Running', phase: 'Executing',
      execution_mode: 'agent_teams',
      tasks: [{ id: 't1', title: 'A', status: 'completed' },
              { id: 't2', title: 'B', status: 'pending_qc' }],
      agents: [{ name: 'Lead', status: 'Working' }, { name: 'Dev', status: 'Done' }],
      log: [], project_path: '/tmp/proj', file_changes: [],
    })
    mission.__setSendToWindowForTest(sendToWindow)
    mission.__setQcQaRunnerForTest(async () => ({ verdict: 'PASS' }))

    mission.__scheduleAgentTeamsCompletionForTest('m1', sendToWindow)
    await vi.advanceTimersByTimeAsync(90_000)

    const state = mission.__getMissionStateForTest()
    expect(state.status).not.toBe('Completed')
    expect(state.tasks[1].status).not.toBe('completed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/ipc/mission.test.cjs`
Expected: FAIL — `__scheduleAgentTeamsCompletionForTest is not a function`, and/or the force-complete-all-tasks behavior makes the second test's `state.tasks[1].status` assertion fail.

- [ ] **Step 3: Write minimal implementation**

In `electron/ipc/mission.cjs`, replace the body of the `setTimeout` callback inside `scheduleAgentTeamsCompletion` (currently lines ~735-782) — keep the same guard clauses and logging, but replace the direct `'Completed'` assignment and the force-complete-tasks loop with a call into `runFinalQaSweep()`:

```js
function scheduleAgentTeamsCompletion(missionId, sendToWindow) {
  clearAgentTeamsTimer();
  agentTeamsCompletionTimer = setTimeout(() => {
    agentTeamsCompletionTimer = null;
    if (!missionState || missionState.status !== 'Running') return;
    if (missionState.phase !== 'Executing') return;

    const ts = now();
    const logEntry = makeLogEntry(ts, 'System',
      'All agents done — Lead process timed out after 90s, running final QA sweep', 'info');
    missionState.log.push(logEntry);
    sendToWindow('mission:log', logEntry);

    killChild();
    stopWatcher();
    stopAutosave();
    stopStuckChecker();

    runFinalQaSweep().then(() => {
      missionState.phase = 'Done';
      for (const a of missionState.agents) {
        if (a.status !== 'Error') a.status = 'Done';
        if (a.name === 'Lead') a.current_task = missionState.status === 'Completed' ? 'Mission completed' : 'Mission failed';
      }
      finalizeDeployExit(missionId, sendToWindow, ts);
    });
  }, 90_000);
}
```

This reuses `finalizeDeployExit` (Task 7) for the history/autosave/status-emit tail, so the two completion paths (process-exit and Agent-Teams-inactivity-timeout) stay consistent instead of duplicating that logic a third time. Since `scheduleAgentTeamsCompletion` is defined earlier in the file than `runFinalQaSweep`/`finalizeDeployExit` (both function declarations, so hoisting makes the forward reference safe — confirm with `node --check` same as Task 7), no reordering of function declarations is required.

Add a test hook alongside the others:

```js
if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
  module.exports.__scheduleAgentTeamsCompletionForTest = (missionId, sendToWindow) =>
    scheduleAgentTeamsCompletion(missionId, sendToWindow);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --check electron/ipc/mission.cjs && npx vitest run electron/ipc/mission.test.cjs`
Expected: `node --check` prints nothing; vitest PASS (all tests in the file, including this task's 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/mission.cjs electron/ipc/mission.test.cjs
git commit -m "fix: gate Agent Teams inactivity completion behind the final QA sweep too"
```

---

## Task 14: Full regression pass

**Files:** none (verification-only task)

- [ ] **Step 1: Run the full unit test suite**

Run: `npm test`
Expected: all tests pass, including every new `.test.cjs`/`.test.jsx`/`.test.js` file added in Tasks 1, 5, 6, 7, 8, 9, 12, 13.

- [ ] **Step 2: Run the full E2E suite**

Run: `npm run test:e2e`
Expected: all specs pass, including the existing `tests/specs/replay-real-ui-fidelity.spec.ts` (must remain green — confirms the QC/QA status changes don't break replay fidelity, consistent with the spec's Testing Strategy stating no changes are needed there) and the new `tests/specs/qcqa-verification-loop.spec.ts`.

- [ ] **Step 3: Commit (only if any fixups were needed)**

```bash
git add -A
git commit -m "test: fix findings from QC/QA verification regression pass"
```

(Skip this commit entirely if Steps 1-2 passed with no changes needed.)

---

## Testing strategy summary

- Unit: `electron/lib/qcqa.test.cjs` (parsing, escalation tiers, subprocess wrapper — all pure/stubbed, no real `claude` spawns) and `electron/ipc/mission.test.cjs` (state-machine wiring, using injected test hooks so `missionState`/`sendToWindow`/the QC-QA runner are all controllable without spawning real processes).
  - Note: the test-only exports guarded by `process.env.VITEST`/`NODE_ENV === 'test'` are the only way to reach `mission.cjs`'s internal, non-exported functions (`handleParsedEvent`, `enqueueQcCheck`, etc.) from a test file — this mirrors how the module already keeps `missionState` as private closure state with no other injection point.
- Renderer unit: `StatusBadge.test.jsx`, `useMission.test.js` — new statuses render distinctly and don't create duplicate task entries.
- E2E: `qcqa-verification-loop.spec.ts` exercises the real Electron app end-to-end via the existing fake-`claude` harness, asserting the actual UI text a user would see through a QC fail → retry → QC pass → QA pass → final sweep pass sequence.
- Existing `replay-real-ui-fidelity.spec.ts` must remain green with zero modifications — it is unaffected by task-status granularity changes per the spec, and Task 14 explicitly reverifies this. (Note: this spec was found to be broken on `main` prior to Task 12's fix, for the same seed-task-reconciliation deadlock Task 12 closes — Task 14 confirms Task 12 restores it to green.)

## Self-Review notes

- **Spec coverage:** every numbered section of the design spec (§1 architecture, §2 task state machine, §3 mission state machine, §4 fix loop/escalation, §5 final sweep, §6 subprocess details, §7 prompt changes, §8 renderer/IPC) maps to at least one task above (Tasks 5-7 cover §1-3 and §5; Task 6 covers §4; Task 4 and Tasks 1-3 cover §6; Task 10 covers §7; Tasks 8-9 cover §8).
- **File-structure open question (spec's own "Open questions" §1) resolved:** new `electron/lib/qcqa.cjs` + `qcqa.test.cjs` for spawn/parse/escalation logic (Tasks 1-3), matching the existing `recordingStore.cjs`/`replayEngine.cjs` pattern; state-machine wiring stays in `mission.cjs` (Tasks 5-7) since that's where `missionState` lives.
- **Prompt-wording open question (spec's own "Open questions" §2) resolved:** exact content for `qc_check.md`/`qa_check.md` drafted in full in Task 4, following the structural conventions of `deploy_standard.md`/`deploy_agent_teams.md`.
- **`watchProcessExit_launch` clarified:** confirmed during Task 7 drafting that this planning-phase watcher does not need a QC/QA gate change — no tasks exist yet at that point in the mission lifecycle, so `Completed`/`Failed` there refers to the planning process itself, not task completion. Left unchanged, with the reasoning recorded inline in Task 7 rather than silently skipped.
- **`deploy_standard.md`'s unnamed self-fix language:** the spec's §7 only explicitly named `deploy_agent_teams.md`/`continue_agent_teams.md`, but Task 10 includes the equivalent fix in `deploy_standard.md` Phase 3 since it violates the same "Lead never hand-fixes" constraint stated in Global Constraints — flagging this inclusion explicitly here since it extends slightly beyond the spec's literal text in service of the spec's stated principle.
- **Type/signature consistency check:** `parseQcQaVerdict` (Task 1) → consumed by `runQcQaCheck` (Task 3) → consumed by `enqueueQcCheck`/`enqueueQaCheck`/`runFinalQaSweep` (Tasks 6-7), all passing the same `{ verdict, responsibleAgent?, reason? }` shape consistently. `nextEscalationTier` (Task 2) → consumed by `handleQcQaFailure` (Task 6), same `{ tier }` shape throughout. No naming drift found.
