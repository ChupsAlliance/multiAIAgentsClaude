# QC/QA Per-Task Verification Loop — Design

## Problem

Today a mission is marked `Completed` purely because the underlying `claude`
CLI process exited with code 0:

```js
const finalStatus = (code === 0 || code === null) ? 'Completed' : 'Failed';  // electron/ipc/mission.cjs:1765
missionState.status = code === 0 || code === null ? 'Completed' : 'Failed';  // electron/ipc/mission.cjs:2427
```

There is no independent verification of whether Lead's (or any sub-agent's)
judgment was actually correct. If Lead's own review misses a bug — or a
sub-agent silently ships something wrong — the mission still shows
`Completed`. This is a **fail-silently** gap: the status badge says success,
but nothing has actually verified success.

Individual sub-agents currently self-report completion via free-text markers
that Lead's `OutputParser` regex-matches out of stdout:

```
[<name>] BUILD_RESULT: PASS
[<name>] FILES_WRITTEN: <files>
[<name>] Completed: <task>
```

`OutputParser.parseLine()` matches `Completed:` (`COMPLETED_RE`,
`electron/ipc/mission.cjs:153`) and `handleParsedEvent()`'s `TaskCompleted`
case (`electron/ipc/mission.cjs:280-302`) immediately marks the task
`completed` — no check beyond "the agent printed a line that says so".
Waiting until Lead's final process-exit-code check to catch problems is too
late: by then every sub-agent has already gone idle and the whole pipeline
has to be re-litigated at once.

Additionally, Lead's own prompts (`deploy_agent_teams.md` Phase 4,
`continue_agent_teams.md`) currently instruct Lead to **fix build errors
itself** if the responsible agent is no longer active ("fix the error
yourself or spawn a new agent for it"). This directly conflicts with the
project's intended accountability model: whoever caused an error — the
sub-agent — must be the one responsible for fixing it, never Lead by hand.

## Goals

- Close the fail-silently gap: a task can only reach `completed`, and a
  mission can only reach `Completed`, after independent verification passes.
- Verification must be enforced **in code** (`electron/ipc/mission.cjs`), not
  just written into Lead's prompt — a prompt can be misread or ignored by
  Lead; a code-level gate cannot.
- Verification happens **per task**, the moment each sub-agent reports its
  own task done — not only once at the very end when Lead reports the whole
  mission complete. End-of-mission-only verification would still allow every
  individual task to have shipped wrong and only be caught once, at the end,
  defeating the point of eliminating fail-silently completions everywhere in
  the pipeline.
- Whoever caused the error is responsible for fixing it. Lead orchestrates
  and routes feedback; Lead never hand-fixes another agent's bug.
- Repeated failure on the same task auto-escalates (different agent instance
  or a stronger model) without stopping to ask the user — up to a safety
  ceiling, beyond which the system stops and asks.

## Out of scope

- Presentation Mode (`PresentationModePage.jsx` / `PresentationTimeline.jsx`)
  — untouched, as with all prior mission-pipeline work.
- The known, accepted `useReplay.js` gap for `mission:team-event` /
  `mission:task-reassigned` — user explicitly declined to fix this; not
  addressed here.
- Changing how sub-agents are spawned/orchestrated by Lead (Agent tool /
  Agent Teams / SendMessage) — QC/QA are spawned independently by
  `mission.cjs`, not by Lead, so Lead's existing spawn mechanics are
  untouched.

## Design

### 1. Architecture overview

QC and QA are inserted as a hard gate between "a sub-agent says it's done"
and "the task is actually marked done":

```
Sub-agent prints "[Dev-Backend] Completed: Task #3"
  → OutputParser matches COMPLETED_RE
  → handleParsedEvent({type:'TaskCompleted', agent, description})
  → task.status = 'pending_qc'   (NOT 'completed')
  → sendToWindow('mission:task-update', {status:'pending_qc'})
  → enqueueQcCheck(task)         ← new hook, runs in the background,
                                    does not block other agents

enqueueQcCheck(task):
  → spawn QC-Agent (independent claude subprocess, own prompt)
      - reads task description + FILES_WRITTEN, runs the real
        build/test/lint commands itself
      - emits [QC] VERDICT: PASS | FAIL (+ RESPONSIBLE_AGENT + REASON)
  → FAIL → handleQcQaFailure(task, 'qc', ...)
  → PASS → enqueueQaCheck(task)

enqueueQaCheck(task):
  → spawn QA-Agent (independent claude subprocess, own prompt)
      - reads the task's original requirement text + the changed files'
        actual content + the QC verdict
      - emits [QA] VERDICT: PASS | FAIL (+ RESPONSIBLE_AGENT + REASON)
  → FAIL → handleQcQaFailure(task, 'qa', ...)
  → PASS → task.status = 'completed'   ← the ONLY place a task becomes
                                          truly completed
           sendToWindow('mission:task-update', {status:'completed'})
```

Once every task has reached real `completed` and Lead's process has
finished its own work, one more QA pass runs in "whole-picture" mode before
the mission itself is allowed to become `Completed` (see §5).

### 2. Task state machine

New intermediate states replace the old direct `in_progress → completed`
jump:

```
in_progress
   │ agent prints "Completed: <task>"
   ▼
pending_qc          — QC-Agent running in the background
   │
   ├─ QC FAIL → failed_qc → (feedback routed to responsible agent,
   │                         agent fixes, reports "Completed" again)
   │                      → in_progress   (qcRound++)
   ▼ QC PASS
pending_qa          — QA-Agent running in the background
   │
   ├─ QA FAIL → failed_qa → same feedback/retry loop → in_progress (qcRound++)
   ▼ QA PASS
completed           — real, final, never reverted
```

`task.qcRound` is a single shared counter (not separate QC/QA counters) —
it counts "how many times this task has had to be resubmitted after a
verification failure," regardless of whether QC or QA caused the failure.

### 3. Mission state machine

Mission completion is no longer decided from the `claude` process exit code
alone:

```
Running              — normal operation
Running              — also covers "some task is in failed_qc/failed_qa and
                        being fixed" — mission stays Running, never flips to
                        Completed while any task is unresolved
AwaitingFinalQA       — new: every task has reached real 'completed'; the
                        final whole-picture QA pass is running
Completed             — ONLY set when the final whole-picture QA pass PASSes
Failed                — unchanged: reserved for real process crashes
                        unrelated to QC/QA (e.g. the claude process itself
                        errored out before producing any task result)
Needs Attention       — new: a task hit the safety ceiling (see §4) —
                        automatic retries stopped, user decision required
```

The two existing exit-code-based assignments
(`electron/ipc/mission.cjs:1765` and `:2427`) are replaced: exit code 0 no
longer directly sets `Completed`. Instead, once the process exits
successfully AND all tasks are `completed`, `runFinalQaSweep()` runs (§5);
only its PASS sets `Completed`. If the process exits successfully while
tasks are still incomplete or failed, that is itself a discrepancy Lead's
prompt must not paper over (see §7) — but the mechanical gate here is: no
`completed` tasks pending QC/QA ⇒ no `Completed` mission, no matter what the
exit code says.

### 4. Fix loop and escalation

On `handleQcQaFailure(task, stage, responsibleAgent, reason)`:

1. Increment `task.qcRound`.
2. **Rounds 1–2**: route `reason` back to the same agent that did the task
   (DM/resume, mirroring how Lead already DMs an agent about a build
   failure today) — same agent instance, same model. Agent fixes, reports
   `Completed` again, task re-enters `pending_qc` at the top of the loop.
3. **Rounds 3–8**: auto-escalate — spawn a fresh instance of the same role
   (or bump to a stronger model) and hand it the task plus the accumulated
   QC/QA feedback history. No user prompt at this stage; this is fully
   automatic per the earlier decision to never stop-and-ask for routine
   repeated failures.
4. **Round 9 (i.e. round 8 retry also failed)**: stop auto-retrying this
   task. Set `mission.status = 'Needs Attention'`, surface the task, the
   full failure history, and the last QC/QA `REASON` to the UI via
   `sendToWindow`. This is the one case where the user is asked to decide
   (manual fix, change the task requirement, or skip it) — a safety ceiling
   against a genuinely unsolvable or self-contradictory task burning
   unbounded tokens.

A QC/QA failure on one task never blocks other agents' unrelated work —
other agents keep working on their own tasks in parallel. It only blocks
that task's owner and that task's downstream dependents (if any are declared
in the plan).

### 5. Final whole-picture QA sweep

Once every task in `missionState.tasks` is `completed` and Lead's process
has finished, mission status becomes `AwaitingFinalQA` and one more QA-Agent
subprocess is spawned — same subprocess mechanism as the per-task QA-Agent,
but with different input: the full mission plan (`mission_context`, every
task), and every changed file across the whole mission (not just one task's
files). Its job is to catch integration-level business-logic mismatches that
no single task's isolated review could see (e.g. backend and frontend each
individually correct, but not correctly wired together).

- PASS → `mission.status = 'Completed'`.
- FAIL → mission stays `Running` (never regresses to `Failed`); the
  responsible agent(s) named in the QA verdict are identified and
  reassigned within the **current** mission (never a new mission), and the
  fix loop (§4) applies to the flagged task(s) again. This repeats until the
  final sweep passes or a flagged task hits the round-9 safety ceiling.

### 6. QC-Agent / QA-Agent subprocess details

Both are spawned as **independent `claude` subprocesses** using the same
spawn mechanism `mission.cjs` already uses for Lead/sub-agents (not the
Agent tool called from inside Lead's own session) — this is what makes the
gate a code-level enforcement rather than a Lead-obeys-the-prompt
convention.

**QC-Agent** (technical/build-level, runs first):
- Input: project path, the task's own description, the `FILES_WRITTEN` list
  the agent reported, and the project's real build/test command (reusing
  the existing `detectProjectType()` output).
- Behavior: actually runs the build/test/lint commands itself and reads
  their real output — does not just trust the sub-agent's self-reported
  `BUILD_RESULT`.
- Required output lines (mirroring the existing `BUILD_RESULT`/
  `FILES_WRITTEN` convention so the same regex-based parsing approach
  already proven in `OutputParser` can be reused):
  ```
  [QC] VERDICT: PASS
  ```
  or
  ```
  [QC] VERDICT: FAIL
  [QC] RESPONSIBLE_AGENT: <agent name>
  [QC] REASON: <specific technical reason>
  ```

**QA-Agent** (business/requirement-level, runs only if QC passed):
- Input: the task's original requirement text from the plan (title, detail,
  why), the actual content of the changed files (read, not just listed),
  and the QC verdict (so QA doesn't re-litigate technical correctness).
- Behavior: judges whether the implementation actually satisfies the stated
  requirement (e.g. "task asked for email validation" but the code has none
  → FAIL even though it builds fine).
- Required output lines, same convention:
  ```
  [QA] VERDICT: PASS
  ```
  or
  ```
  [QA] VERDICT: FAIL
  [QA] RESPONSIBLE_AGENT: <agent name>
  [QA] REASON: <specific business/requirement mismatch>
  ```

**Final whole-picture QA-Agent**: same subprocess mechanism and output
convention, different input scope (§5).

Both agents name the responsible agent directly in their own verdict — Lead
never infers responsibility by cross-referencing `FILES_WRITTEN` against
task assignments. This was an explicit design decision: QC/QA has full
context on what it just reviewed and who owns it; making Lead re-derive
that from file paths is strictly worse information.

### 7. Prompt changes (Lead)

`deploy_agent_teams.md` / `deploy_standard.md` / `continue_agent_teams.md`
need updates so Lead's own mental model matches the new mechanical
behavior:

- Lead must understand that a task showing `pending_qc`/`pending_qa` is
  **not yet done** — Lead should not report mission-level completion or
  move on as though it were, even though the sub-agent that owned it has
  gone idle. (This matters mainly for how Lead narrates progress; the
  actual completion gate is enforced in code regardless of what Lead
  believes.)
- Remove the existing Phase 4 / Integration Verification instruction that
  tells Lead to **"fix the error yourself or spawn a new agent for it"**
  when the responsible agent is no longer active. Replace it with: Lead
  must always route the fix back through a sub-agent (respawn the same role
  if the original agent is gone) — Lead is never the one editing code to
  fix another agent's mistake. This aligns Lead's own build-failure handling
  with the same accountability rule QC/QA enforces everywhere else.
- Lead no longer needs to personally run the final integration build as the
  mission's last word of truth — that responsibility now belongs to QC (per
  task) and the final whole-picture QA sweep (§5). Lead's own build check
  in Phase 4 can remain as an early sanity check, but it no longer gates
  `Completed`.

### 8. Renderer / IPC surface changes

New task statuses need to reach and render correctly in the UI:
`pending_qc`, `failed_qc`, `pending_qa`, `failed_qa` (task-level), and
`AwaitingFinalQA` / `Needs Attention` (mission-level). This touches:

- `sendToWindow('mission:task-update', ...)` payloads — already a
  free-form status string, just needs the new values threaded through.
- `useMission.js` — currently only distinguishes `in_progress`/`completed`
  for live-mission task rendering; needs to recognize and surface the new
  intermediate statuses (e.g. a distinct badge/color for "in QC review" vs.
  "in QA review" vs. "failed, being fixed").
- `MissionDashboard` (or wherever task status badges render) — same.
- Recording/replay: since capture goes through the same `sendToWindow` hook
  audited in the earlier replay-fidelity work, the new statuses are
  automatically recorded with no extra work. Replay rendering of these
  statuses is bounded by the same, already-known, user-accepted
  `useReplay.js` gap (out of scope, §"Out of scope") and does not need new
  handling beyond what generic `mission:task-update` replay already does.

## Testing strategy

- Unit-level: `handleParsedEvent`'s `TaskCompleted` case now must produce
  `pending_qc`, not `completed` — direct assertion on `missionState.tasks`
  after feeding a synthetic `Completed:` line through `OutputParser`.
  `handleQcQaFailure`'s round-counting and escalation-tier selection
  (same-agent for rounds 1–2, fresh-agent/stronger-model for rounds 3–8,
  `Needs Attention` at round 9) tested directly as a pure function over
  `task.qcRound`.
  The two exit-code-driven completion assignments
  (`electron/ipc/mission.cjs:1765`, `:2427`) are replaced by a call into
  `runFinalQaSweep()`; test that a successful exit code with incomplete
  tasks does NOT set `Completed`.
- Integration-level (fake `claude` subprocess, same harness used for the
  real-UI replay E2E spec): a task reports `Completed`, a fake QC subprocess
  emits `VERDICT: FAIL` once then `PASS`, a fake QA subprocess emits `PASS`
  — assert the task passes through `pending_qc → failed_qc → in_progress →
  pending_qc → pending_qa → completed` and the mission only reaches
  `Completed` after a final fake whole-picture QA also emits `PASS`.
- No changes needed to the existing replay-fidelity E2E coverage
  (`tests/specs/replay-real-ui-fidelity.spec.ts`) — that spec is scoped to
  phase-driven UI switching and is unaffected by task-status granularity
  changes.

## Open questions for the implementation plan

- Exact file/module layout for the new QC/QA spawn-and-parse logic (a new
  `electron/ipc/qcqa.cjs` alongside `mission.cjs`, vs. functions added
  directly to `mission.cjs`) — a file-structure decision for
  `superpowers:writing-plans` to make, not a design-level concern.
- Exact wording of `electron/prompts/qc_check.md` and
  `electron/prompts/qa_check.md` (new prompt files) — to be drafted during
  planning/implementation, following the same structure as the existing
  prompt files reviewed in this design (`deploy_standard.md`,
  `deploy_agent_teams.md`).
