# Final QA Sweep Auto-Resume — Design

## Problem

`finalizeDeployExit()` (`electron/ipc/mission.cjs:2932`) already detects a
specific stuck state: the final whole-picture QA sweep (`runFinalQaSweep()`,
`mission.cjs:436`) failed and — via `handleQcQaFailure()` — pushed the
flagged task back to `in_progress`, leaving `missionState.status` at
`'Running'`. But by the time `finalizeDeployExit()` runs, the `claude`
process that was driving the mission has already exited (that's *why*
`proc.on('close', ...)` fired in the first place). Nothing is left to act on
the retried task. Today the code recognizes this precisely and logs an
explanatory message asking the user to press **Retry** manually:

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

This is the "follow-up" referenced in that comment: spawn a fresh/resumed
`claude` process automatically instead of stopping and waiting for the user.

## Goals

- When the final QA sweep fails after the driving process has exited,
  automatically resume the mission — no manual **Retry** click required in
  the common case.
- Reuse the existing resume machinery (`spawnAgentProcess` +
  `--resume <session_id>`), the same pattern `answer_question` and
  `mockup_respond` already use — not a parallel, bespoke spawn path.
- Bound the auto-resume loop: if the mission keeps landing back in this same
  stuck state, stop after a fixed number of consecutive attempts and fall
  back to today's manual-intervention message, rather than silently burning
  API calls forever.
- If no `session_id` is available to resume (backend doesn't support resume,
  or none was ever captured), auto-resume degrades to a **fresh launch**
  (no `--resume`) carrying enough context to continue, instead of giving up.

## Out of scope

- Any change to `runFinalQaSweep()`, `handleQcQaFailure()`, or the per-task
  QC/QA gate itself (`docs/superpowers/specs/2026-07-30-qc-qa-verification-design.md`)
  — those already do the right thing; this design only fixes what happens
  *after* they leave the mission in `Running` with no active process.
- The transient-API-error retry mechanism
  (`docs/superpowers/specs/2026-07-22-cross-phase-retry-design.md`,
  `isTransientApiError`/`retryTransientSpawn`) — unrelated failure class
  (API-level errors during a live spawn attempt), untouched.
- The manual **Retry** button / `retry_agent` IPC handler — stays exactly as
  is, still available as a fallback once the auto-resume ceiling is hit.
- Any UI/renderer change beyond the existing `mission:log`/`mission:status`
  events already wired up — no new IPC channel, no new task/mission status
  value.

## Design

### 1. Trigger point

`finalizeDeployExit()` currently has one branch that fires exactly in this
situation:

```js
if (missionState.status === 'Running') {
  // ...log-only, return
}
```

This branch is replaced with a call to a new function,
`autoResumeAfterFinalQaFailure(missionId, sendToWindow, ts)`, which decides
whether to auto-resume or fall back to the existing manual-intervention log
message.

### 2. Attempt counter (mission-level, not task-level)

A new field on mission state: `missionState.autoResumeCount` (starts
undefined/0). This is deliberately **separate** from `task.qcRound` — the
existing QC/QA escalation counter tracks "how many times has this task been
kicked back for a *content* problem," which is a different axis from "how
many times has the mission had to be auto-relaunched because the process
died with no driver." Reusing `qcRound` here would conflate two independent
failure modes and make each counter's remaining budget harder to reason
about.

- Incremented by 1 each time `autoResumeAfterFinalQaFailure` decides to
  actually spawn a resume/fresh attempt.
- Reset to `0` whenever the mission reaches `Completed`
  (`runFinalQaSweep()`'s PASS branch) and whenever the user triggers the
  existing manual `retry_agent` flow (`retryAgentCore`, `mission.cjs:390`) —
  a manual retry is a fresh vote of confidence from the user, so it gets its
  own fresh budget.
- Ceiling: **3**. On the 4th consecutive occurrence (i.e.
  `autoResumeCount >= 3` at decision time), do NOT spawn again — fall back
  to exactly today's behavior: set `missionState.status` unchanged
  (`'Running'`), log the existing manual-intervention message, and return.
  This mirrors the round-9 safety ceiling pattern already established in
  `handleQcQaFailure`/`nextEscalationTier` (fail-safe over fail-silent, stop
  and ask rather than loop forever).

### 3. Shared resume/fresh-launch helper

`answer_question` (`mission.cjs:3656`) and `mockup_respond`
(`mission.cjs:3775`, via `restartLeadAfterMockup`) each already implement
the same shape of logic: kill any lingering process, call
`spawnAgentProcess({ resumeSessionId, ... })`, wire up
`readProcessStdout_deploy`/`readProcessStderr`/`watchProcessExit_deploy` (or
the `_launch` variants during planning), restart the file watcher for
Agent Teams, flip `missionState.status` back to `'Running'`, and start
autosave/stuck-checker timers.

This design extracts that shared shape into one function:

```js
function spawnResumeOrFreshAttempt({
  missionId, sendToWindow, promptOverride, reasonForLog,
}) {
  // ...kills any lingering process, then:
  const sessionId = missionState.session_id || null; // null → fresh launch
  const leadModel = missionState.agents.find(a => a.name === 'Lead')?.model || 'sonnet';
  const projectPath = missionState.project_path;
  const execMode = missionState.execution_mode || 'standard';
  const backend = agentBackendOf(missionState.agents.find(a => a.name === 'Lead'));

  const prompt = promptOverride || buildContinuationPrompt(reasonForLog);

  const attempt = (attemptNum) => {
    killChild();
    const { proc, promptViaStdin } = spawnAgentProcess({
      backendId: backend, model: leadModel, prompt,
      resumeSessionId: sessionId, maxTurns: 200,
      useAgentTeams: execMode === 'agent_teams',
      cwd: projectPath, sendToWindow,
    });
    // ...same stdin-write / readers / watchProcessExit_deploy / status flip
    // / autosave+stuck-checker start already done in answer_question today
  };
  return attempt(1);
}
```

`spawnAgentProcess` (`mission.cjs:1148`) already handles the "no session to
resume" case on its own: if `resumeSessionId` is falsy, the built launch
args simply omit `--resume` (see the no-adapter fallback branch,
`mission.cjs:1160-1172`, and the adapter branch which only drops
`resumeSessionId` when it was truthy but unsupported,
`mission.cjs:1176-1189`). So passing `missionState.session_id || null`
straight through is sufficient to get "resume if possible, fresh launch
otherwise" for free — no separate fresh-launch code path needs to be
written.

`answer_question` and `mockup_respond`/`restartLeadAfterMockup` are
refactored to call this shared helper instead of their current inline
duplicated spawn blocks. Behavior for both is unchanged (same args, same
session-id source, same reader wiring) — this is a pure extraction.

### 4. What `autoResumeAfterFinalQaFailure` actually does

```js
function autoResumeAfterFinalQaFailure(missionId, sendToWindow, ts) {
  missionState.autoResumeCount = (missionState.autoResumeCount || 0) + 1;

  if (missionState.autoResumeCount > 3) {
    const entry = makeLogEntry(ts, 'System',
      'Final QA sweep scheduled a retry after the driving process already exited — ' +
      'mission is awaiting that retry, but no process is currently driving it. ' +
      'Auto-resume already tried 3 times without reaching Completed — stopping. ' +
      'This requires manual intervention (see Retry).',
      'info');
    missionState.log.push(entry);
    sendToWindow('mission:log', entry);
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

### 5. Prompt content on resume

Two cases, distinguished by whether `missionState.session_id` is available:

- **Resume case (session_id present):** matches the decision from
  brainstorming — reuse the same QC/QA-failure template already used
  elsewhere, no bespoke prompt. Concretely: a short system nudge, the same
  shape as the one `retryAgentCore` already writes to stdin
  (`mission.cjs:423-425`, `"\n[System] ...\n"`), stating that the final QA
  sweep flagged an issue and naming the flagged task plus the `reason`
  captured on it (the last QC/QA `REASON` recorded by
  `handleQcQaFailure`/`runFinalQaSweep`'s FAIL branch, `mission.cjs:472-473`)
  — the resumed session already has the flagged task sitting at
  `in_progress`, so this nudge is just enough for Lead to pick the thread
  back up without re-deriving what happened from scratch.
- **Fresh-launch case (no session_id):** since there's no prior
  conversation to resume, the prompt must stand on its own. Build it from
  the same ingredients `deploy_mission`/`continue_mission` already use to
  launch a mission (`missionState.description`, the task list from
  `missionState.tasks`, `missionState.project_path`), plus one additional
  paragraph: "This is a continuation after the final whole-picture QA sweep
  found an issue: `<reason>`. The following task needs another pass:
  `<task.title>` (owner: `<task.assigned_agent>`)." This reuses the existing
  `continue_mission` prompt-building shape rather than inventing a new
  template.

### 6. Recursion / repeated failure

Because `spawnResumeOrFreshAttempt` wires the new process through the exact
same `watchProcessExit_deploy` → `finalizeDeployExit` path as every other
deploy-phase spawn, if the auto-resumed process later exits into this same
stuck state again, `autoResumeAfterFinalQaFailure` runs again naturally —
no special-cased recursive branch is needed. The count check in §2 is what
prevents this from looping unboundedly; by attempt 4 it stops and defers to
manual **Retry**, which itself resets the counter for a clean fresh start.

### 7. Interaction with `WaitingForAnswer` / `RetryingDanglingQuestion` / QC-QA transient retry

`finalizeDeployExit` is only reached via the tail of `watchProcessExit_deploy`
after the existing early-return guards for `WaitingForAnswer` and
`RetryingDanglingQuestion` (`mission.cjs:2861-2874`), and only on the
`missionState.status === 'Running'` branch that calls `runFinalQaSweep()`
(`mission.cjs:2917-2924`) — i.e. only after a **successful** exit code. The
transient-API-error retry (`isTransientApiError`/`retrySpawn`,
`mission.cjs:2876-2894`) only applies to non-zero, non-null exit codes, so
it and this feature are mutually exclusive by construction: a process
either exited with a real failure code (transient-retry's territory) or
exited cleanly and then failed the final QA sweep (this feature's
territory). No ordering conflict to resolve.

## Testing strategy

- Unit-level: drive `autoResumeAfterFinalQaFailure` directly against a
  fake `missionState` (mirroring the existing test harness style for
  `handleQcQaFailure`/`nextEscalationTier`).
  - Assert attempts 1–3 call `spawnResumeOrFreshAttempt` and increment
    `autoResumeCount`.
  - Assert attempt 4 does NOT spawn, logs the manual-intervention message,
    and leaves `missionState.status` untouched.
  - Assert `autoResumeCount` resets to `0` after a `Completed` transition
    and after `retryAgentCore` is invoked.
- Integration-level (same fake-`claude`-subprocess harness used for the
  QC/QA verification spec): simulate a deploy process exiting 0 with the
  final QA sweep faking a `FAIL` verdict; assert a new fake subprocess is
  spawned automatically (with `--resume` when a `session_id` was captured,
  without it otherwise) instead of the mission sitting idle in `Running`.
- Regression: `answer_question` and `mockup_respond` still produce
  identical spawn args/reader-wiring/status transitions after being
  refactored onto the shared `spawnResumeOrFreshAttempt` helper — existing
  tests for those two IPC handlers must continue passing unchanged.

## Open questions for the implementation plan

- Exact wording/placement of the fresh-launch continuation prompt (§5) —
  to be drafted during implementation, following the existing
  `continue_mission` prompt-building code as a template.
- Whether `spawnResumeOrFreshAttempt` lives inline in `mission.cjs` next to
  `answer_question`/`finalizeDeployExit`, or is extracted into
  `electron/lib/` alongside `qcqa.cjs` — a file-layout decision for
  `superpowers:writing-plans` to make.
