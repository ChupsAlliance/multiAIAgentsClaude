# Unstick a Mission Stuck on Final-QA Auto-Resume — Design

## Problem

`autoResumeAfterFinalQaFailure()` (`electron/ipc/mission.cjs:3255-3281`, added by
`docs/superpowers/specs/2026-07-31-final-qa-auto-resume-design.md`) auto-resumes
a mission whose final QA sweep failed after the driving process exited, but
bounds itself to 3 consecutive attempts. On the 4th occurrence it gives up:

```js
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
```

This give-up branch has three real problems reported by the user:

1. **The message lies.** `missionState.status` is left at `'Running'` (never
   touched by this branch). The existing Retry button
   (`src/components/mission/AgentCard.jsx:79`) only renders when
   `status === 'Error'` or `missionStatus === 'Needs Attention'` — neither is
   true here — so the button the log message points to ("see Retry") does not
   actually appear. The user is told to click something that isn't there.
2. **No path forward when the underlying issue is a real, un-fixable-by-retry
   bug.** If the final QA sweep keeps failing because of an actual defect
   (the user's own example: Lead reports "fail 6/7" with no detail), clicking
   Retry just re-runs the same Lead conversation into the same wall. There is
   no way to hand a *fresh, smaller* mission the job of fixing just the
   flagged failures once the original mission's context is exhausted.
3. **The give-up moment isn't even durably recorded.** `stopAutosave()` has
   already fired by this point (`watchProcessExit_deploy`,
   `mission.cjs:3103-3106`), and the give-up branch never calls
   `saveMissionSnapshot()` — so `autoResumeCount` and the fact that the
   mission is stuck are not guaranteed to be on disk. A stuck mission is also
   currently misclassified by `get_incomplete_missions`
   (`mission.cjs:4642-4683`, exclusion list at line 4656) as a "crashed,
   incomplete" mission (its `status` is `'Running'`, which isn't `'Completed'`,
   `'Failed'`, or `'Stopped'`), surfacing confusingly in crash-recovery UI even
   though it didn't crash — it deliberately stopped.

This design fixes the **unstick** path only: correctly mark the stuck state,
add a "Stop & create fix mission" action that is available exactly then, and
make the resulting fix-only mission carry enough real context (including *why*
QA failed) to actually work on the right problem.

## Out of scope (deferred, per user request — to be designed and shipped
separately, in this order)

1. A user-facing toggle for headed/headless Playwright execution during QA.
2. A live "reporting" surface so the user can watch QA retries in progress
   (today: a terse `Lead reports X/Y failed` with no way to see what failed).
3. A full UI for browsing QC/QA failure detail after the fact (a "View
   details" modal, history-view support, etc.) — this design adds the
   *minimum backend data capture* needed to seed a fix mission (see Design
   §3), but does not build any new user-facing detail viewer. That viewer is
   a natural follow-up once this field exists, but is not part of this spec.

Also explicitly unchanged: `runFinalQaSweep()`, the per-task QC/QA escalation
ladder (`nextEscalationTier`, the *other* `'Needs Attention'` dead end at
`mission.cjs:381-388` for a single task's own escalation ceiling), the manual
`retry_agent` handler itself (`retryAgentCore`, `mission.cjs:415-457`), and
`spawnResumeOrFreshAttempt`/the auto-resume attempt loop's own bound (still 3).

## Design

### 1. Durably and correctly mark the stuck state

In the give-up branch of `autoResumeAfterFinalQaFailure`
(`mission.cjs:3258-3268`):

```js
if (missionState.autoResumeCount > 3) {
  missionState.status = 'Needs Attention';
  missionState.stuckReason = 'final_qa_retry_exhausted';
  const entry = makeLogEntry(ts, 'System', /* same message text, unchanged */ 'info');
  missionState.log.push(entry);
  sendToWindow('mission:log', entry);
  sendToWindow('mission:status', {
    mission_id: missionState.id, status: 'Needs Attention',
    stuck_reason: 'final_qa_retry_exhausted',
  });
  saveMissionSnapshot(missionState);
  return;
}
```

`'Needs Attention'` is the existing status value already used for the
per-task escalation ceiling (`mission.cjs:381-388`) and already understood by
`retryAgentCore` (resets it back to `'Running'` and zeroes
`autoResumeCount`, `mission.cjs:436-442`) and by the existing Retry button
condition. Reusing it means the existing Retry button **starts correctly
appearing** in this state as a side effect of this fix — the "(see Retry)"
message stops lying. The new `stuckReason` field is what distinguishes *this*
specific dead end (final-QA auto-resume exhausted) from the other one
(per-task escalation exhausted) so the new button in §2 can target precisely
the state the user described, not "any Needs Attention."

`get_incomplete_missions` (`mission.cjs:4656`) exclusion list is extended in
the same spec:

```js
if (status !== 'Completed' && status !== 'Failed' && status !== 'Stopped'
    && status !== 'Needs Attention') {
```

`'Needs Attention'` (either cause) means the mission deliberately stopped
itself waiting on the user — not an orphaned/crashed process — so it belongs
outside the crash-recovery list either way.

`retryAgentCore` (`mission.cjs:436-442`, unchanged logic otherwise) gets one
added line clearing `missionState.stuckReason = null` alongside its existing
`status` flip back to `'Running'` and `autoResumeCount = 0` reset — otherwise
a stale `stuckReason` would linger on a mission that has since moved on,
which is harmless today (the button in §2 also requires `status ===
'Needs Attention'`) but is cheap to keep tidy and avoids relying on that
conjunction never changing.

### 2. "Stop & create fix mission" button

Added to `MissionHeader.jsx` (`src/components/mission/MissionHeader.jsx`),
next to the existing Stop button — this is a mission-level action, not a
per-agent one, so it belongs here rather than in `AgentCard.jsx`:

```js
const isStuckOnQaRetry = state.status === 'Needs Attention'
  && state.stuckReason === 'final_qa_retry_exhausted'
```

Rendered only when `isStuckOnQaRetry` is true, calling a new
`onCreateQaFixMission` prop threaded down the same way `onStop`/`onNewMission`
already are (`MissionDashboard.jsx` → `MissionControlPage.jsx` →
`useMission.js`). This satisfies the "only in the exact stuck state, next to
Retry" requirement precisely — it will not appear for the other
`'Needs Attention'` cause (single task's own escalation ceiling), where a
manual Retry on that one agent is still the right and sufficient action.

### 3. Capture *why* QA failed, so the fix mission has something to act on

Today `handleQcQaFailure` (`mission.cjs:371-404`) sends `reason` over the
`mission:task-update` IPC event and then discards it — it's never written
onto `task` or into `missionState`, so neither the snapshot nor
`buildMissionSummary()` (used to seed any continuation) ever sees it. Fixed
here, minimally:

```js
function handleQcQaFailure(task, stage, responsibleAgent, reason) {
  task.qcRound = (task.qcRound || 0) + 1;
  task.status = stage === 'qc' ? 'failed_qc' : 'failed_qa';
  const ts = now();
  task.lastFailureDetail = { stage, reason, responsibleAgent, timestamp: ts };
  // ...unchanged from here (mission:task-update emit, escalation tier, etc.)
```

Overwritten each time a task fails again — this is "last known reason," not a
growing log, so it can't bloat the snapshot. Since `saveMissionSnapshot`
already does a shallow `Object.assign` clone of the whole `missionState`
(`mission.cjs:825`), `task.lastFailureDetail` is persisted automatically —
no snapshot-shape change needed beyond this field existing on the task.

`buildMissionSummary()` is extended to surface it for any task currently
`failed_qc`/`failed_qa` (or that has a `lastFailureDetail` at all), so the
existing summary text used by `continue_mission`'s `{{SUMMARY}}` also
benefits from this fix, not just the new fix-mission path.

### 4. Creating the fix mission and retiring the old one

New IPC handler `create_qa_fix_mission` (no args — like `stop_mission` and
`retry_agent`, it acts on the current global `missionState`, which the
button's own visibility condition already guarantees is in the right state;
the handler re-checks `status === 'Needs Attention' && stuckReason ===
'final_qa_retry_exhausted'` server-side too, returning an error otherwise, as
defense against a stale UI).

Steps, combining `stop_mission`'s cleanup with `continue_mission`'s
fork-from-history branch (`mission.cjs:4013-4074`):

1. Snapshot the old mission's relevant fields **before** any cleanup mutates
   them: `id`, `description`, `project_path`, `execution_mode`,
   `permission_mode`, `backend`, `agents` (full roster — Lead + every Dev,
   each with its own `model`/`backend`), and `tasks` (for the
   `lastFailureDetail`s from §3 plus `buildMissionSummary()`'s existing
   completed/pending grouping).
2. Run the same cleanup `stop_mission` already does (`stopWatcher`,
   `stopAutosave`, `stopStuckChecker`, `clearAgentTeamsTimer`,
   `clearPendingRetryTimer`, `killChild`, close mockup servers), set
   `missionState.status = 'Stopped'` on the **old** state, and
   `saveMissionSnapshot()` it — this is exactly the "mark Stopped, keep
   history" behavior already confirmed for the old mission; nothing on disk
   is deleted.
3. Build `{{QA_FAILURES}}`: for every old task with a `lastFailureDetail`,
   render `- <task.title> (owner: <responsibleAgent>): <reason>`. If no task
   has one (edge case — e.g. mission had already been retried manually since
   the last real QC/QA failure), fall back to a line noting the final QA
   sweep itself reported failures without a captured per-task reason, so the
   new Lead knows to re-run/re-derive rather than assuming success.
4. Build `{{PRIOR_ROSTER}}` from the old `agents` array (every entry except
   Lead): `- <name> (<role>), model: <model>, backend: <backend>`.
5. Create a brand-new `missionState`, identical in shape to
   `continue_mission`'s fork branch (`mission.cjs:4032-4062`): fresh `id`,
   inherited `project_path`/`execution_mode`/`permission_mode`/`backend`,
   `forked_from` = old mission's `id`, `forked_from_desc` = old mission's
   `description` (so it shows up via the existing `MissionHistoryPanel.jsx:47-50`
   "↳ từ:" badge, with no new UI work needed for linking), single `Lead`
   agent entry reusing the old Lead's `model`/`backend`.
6. Spawn using a new prompt template, `electron/prompts/fix_qa_failures.md`
   (agent-teams flavored, modeled on `continue_agent_teams.md` but narrowed):
   placeholders `{{PROJECT_PATH}}`, `{{PROJECT_TYPE}}`, `{{SUMMARY}}` (from
   `buildMissionSummary(oldState)`, same 40,000-char cap as
   `continue_mission`), `{{QA_FAILURES}}`, `{{PRIOR_ROSTER}}`,
   `{{PERMISSION_MODE}}`. Framing differs from the generic continue template
   in the parts that matter: Team Setup step is rewritten from "decide what
   agents are needed" to "recreate the roster listed in PRIOR AGENT ROSTER —
   do not add agents beyond what's needed to fix the listed failures"; the
   mission is explicitly framed as fix-only ("Do NOT re-plan or redesign the
   project. Your only job is to make the listed QA failures pass."). Spawn
   mechanics (no session resume, `useAgentTeams: true`,
   `readProcessStdout_deploy`/`readProcessStderr`/`watchProcessExit_deploy`
   wiring) are identical to `continue_mission`'s fork branch — this is a
   reuse, not a new spawn path.
7. Frontend: button click calls `create_qa_fix_mission` directly (no
   client-side context to gather — unlike `continue_mission`'s fork path,
   which is invoked from the History panel and needs the frontend to fetch
   the snapshot via `get_mission_detail` first, this action already has
   everything server-side in the live `missionState`). The existing
   `mission:agent-spawned` / `mission:log` / `mission:status` events the
   handler already emits (matching `continue_mission`'s fork branch) are
   sufficient for the UI to switch over to showing the new mission — no new
   renderer-side state management needed.

### Why a new IPC handler instead of extending `continue_mission`

`continue_mission` already carries meaningful, non-QA-specific complexity
(the non-fork "mutate in place" branch, the plain free-text `{{MESSAGE}}`
path used by the History panel's "Continue" action). Threading a
`mode: 'qa_fix'` special case through it would make an already-large handler
harder to reason about for two barely-related callers. A dedicated handler
that composes `stop_mission`'s cleanup + the fork-creation shape already
proven in `continue_mission` keeps both call sites simple and keeps this
feature's blast radius contained to new code plus the two small, targeted
edits in §1 and §3.

## Testing strategy

- Unit: `autoResumeAfterFinalQaFailure`'s give-up branch — assert
  `status === 'Needs Attention'`, `stuckReason === 'final_qa_retry_exhausted'`,
  and that `saveMissionSnapshot` is invoked (mirrors the existing test style
  for this function, `mission.cjs`'s `__autoResumeAfterFinalQaFailureForTest`).
- Unit: `handleQcQaFailure` — assert `task.lastFailureDetail` is set with the
  right shape and is overwritten (not accumulated) on repeated failures.
- Unit: `get_incomplete_missions` — a fixture snapshot with
  `status: 'Needs Attention'` is excluded from the returned list.
- Unit: `create_qa_fix_mission` — using the same fake-`electron`/fake-
  `cross-spawn` harness as `mission.backend.test.cjs`: seed a `missionState`
  in the exact stuck shape (status/stuckReason/agents/tasks with
  `lastFailureDetail`), invoke the handler, assert: old snapshot written with
  `status: 'Stopped'`; a new `missionState` exists with `forked_from` pointing
  at the old id; the spawned process's prompt (written to stdin) contains the
  rendered `{{QA_FAILURES}}` and `{{PRIOR_ROSTER}}` content; reject/no-op when
  called while not in the exact stuck state.
- Frontend: `MissionHeader.jsx` — button renders only when
  `status === 'Needs Attention' && stuckReason === 'final_qa_retry_exhausted'`,
  not for the other `'Needs Attention'` cause, not for `'Running'`/`'Stopped'`/etc.
- Regression: existing `mission.backend.test.cjs` and
  `mission.retryMockupGeneration.test.js` suites continue passing unchanged
  (no shared code path touched besides the additive fields above).

## Open questions for the implementation plan

- Exact copy/wording for `fix_qa_failures.md`'s fix-only framing — to be
  drafted during implementation using `continue_agent_teams.md` as the base,
  per §4.6.
- Whether `create_qa_fix_mission`'s handler body lives inline in
  `mission.cjs` next to `stop_mission`/`continue_mission`, or factored into a
  small shared helper the two handlers both call for the "build fork
  missionState from a source state" step (`mission.cjs:4032-4062` today) —
  a file-layout decision for `superpowers:writing-plans`.
- `buildMissionSummary()`'s extension in §3 to surface `lastFailureDetail` for
  `continue_mission`'s ordinary (non-fix) path too — confirm this doesn't
  make already-long summaries blow past the existing 40,000-char cap in
  realistic cases; if it risks that, prefer showing it only for tasks
  currently sitting at `failed_qc`/`failed_qa`, not every task that ever
  failed once and later passed.
