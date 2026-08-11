// tests/specs/qcqa-verification-loop.spec.ts
//
// End-to-end coverage for the full QC/QA per-task verification loop plus
// the final whole-picture QA sweep (Tasks 1-10 of the QC/QA verification
// plan): a task completes, goes to QC review, FAILS QC once, the (fake)
// Lead retries the same work, QC passes on retry, the task goes to QA
// review and passes, and only THEN — once every task is 'completed' and a
// separate final whole-picture QA sweep also emits PASS — does the mission
// itself reach 'Completed'. A successful process exit code alone is no
// longer sufficient (electron/ipc/mission.cjs's runFinalQaSweep()).
//
// electron/lib/qcqa.cjs's runQcQaCheck() spawns a NEW `claude -p <prompt>
// ... --output-format stream-json --verbose` process for every QC/QA check
// — same `claude` binary shadowed on PATH by tests/fixtures/fake-claude, so
// that fixture must also emulate QC/QA subprocess invocations (not just the
// main mission transcript). See tests/fixtures/fake-claude/claude.cjs's
// "QC/QA verdict emulation" section: it detects a QC/QA invocation by
// scanning the `-p <prompt>` argument for the literal opening line of
// electron/prompts/qc_check.md / qa_check.md ("You are the QC-Agent" /
// "You are the QA-Agent"), and tracks a first-attempt counter on disk (keyed
// by FAKE_QCQA_STATE_DIR, set by tests/support/electronApp.ts to this test's
// isolated recordings dir) so the FIRST QC check for the run fails and every
// subsequent one (retry, or the final sweep's QA check) passes.
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { launchApp, ciTimeout, type LaunchedApp } from '../support/electronApp';
import { RecordingsPage } from '../pages/RecordingsPage';

const FAKE_PLAN = {
  agents: [
    { name: 'Lead', role: 'Lead Coordinator' },
    { name: 'Dev', role: 'Developer', model: 'sonnet', reason: 'implementation work' },
  ],
  tasks: [{ title: 'Build the widget', why: 'demo', agent: 'Dev', detail: 'Build a widget', priority: 'high' }],
  mission_context: 'QC/QA E2E demo mission',
};

// launch_mission's Planning-phase reader (tryParsePlanFromBuffer) only scans
// parsed stream-json `assistant` message text for the
// `=== MISSION PLAN === {...} === END PLAN ===` marker block — mirrors
// replay-real-ui-fidelity.spec.ts's PLAN_LINE exactly.
const PLAN_LINE = JSON.stringify({
  type: 'assistant',
  session_id: 'fake-session-qcqa',
  message: { content: [{ type: 'text', text: `=== MISSION PLAN ===\n${JSON.stringify(FAKE_PLAN)}\n=== END PLAN ===` }] },
});

// The deploy-phase script. Both `launch_mission` and `deploy_mission` spawn
// fresh `claude` processes but SHARE the same FAKE_CLAUDE_SCRIPT file
// (electronApp.ts writes it once per launchApp() call) — launch's reader
// stops as soon as it detects the plan (before the plain-text lines below
// are ever reached), deploy's reader re-runs the whole script from line 1.
//
// Two "[Dev] Completed: Build the widget" lines are deliberate, not a typo:
// mission.cjs's handleQcQaFailure() only flips the task back to
// 'in_progress' on QC failure — in the real app, Lead would notice the QC
// feedback and have Dev redo the work, eventually emitting a SECOND
// "Completed:" line for the same task, which is what actually drives the
// task from 'in_progress' back through 'pending_qc' into the retry's QC
// check. Since this fixture's mission script is a fixed scripted transcript
// (not a reactive Lead), that second Completed line has to be scripted in
// directly to exercise the retry path at all.
//
// The "__WAIT_QCQA__:<stage>:<attempt>" lines below are directives
// (claude.cjs's waitForQcQaDone), not transcript text — OutputParser never
// sees them. They keep this deploy `claude` process alive until the real
// QC-fail -> retry -> QC-pass -> QA-pass chain has genuinely finished
// before this process exits — runFinalQaSweep() only runs (and only flips
// the mission to 'Completed') when the deploy process closes, and it
// no-ops silently (leaving the mission stuck at 'Running') if not every
// task has reached 'completed' yet at that moment.
const FAKE_CLAUDE_SCRIPT = [
  PLAN_LINE,
  // NOTE: deliberately no "[Lead] Starting: Build the widget" line here.
  // OutputParser's STARTING_RE matches ANY "[Agent] Starting: ..." line
  // regardless of agent, and mission.cjs's case 'TaskStarted' only
  // reconciles against the plan-seeded row when assigned_agent also matches
  // (Task 12's fix). The plan only assigns this task to Dev, so a "[Lead]
  // Starting: ..." line would push a brand-new, permanently orphaned
  // 'in_progress' task row for Lead (no Completed: line ever retires it),
  // which would deadlock runFinalQaSweep()'s `.every(t => t.status ===
  // 'completed')` gate forever. Only Dev's Starting/Completed lines should
  // touch the tracked task lifecycle.
  '[Lead] Assigning the widget task to Dev.',
  '[Dev] Starting: Build the widget',
  '[Dev] Completed: Build the widget',
  // Between the two "Completed:" lines: sending the retry's "Completed:"
  // line while the FIRST QC check is still in flight would make
  // mission.cjs's TaskCompleted handler call enqueueQcCheck() a second time
  // concurrently (it re-matches any non-'completed' status, not just
  // 'in_progress' — see that handler's own comment), spawning two QC
  // subprocesses at once and desyncing the fixture's FAIL-then-PASS attempt
  // counter. "__WAIT_QCQA__:qc:1" is a directive (see claude.cjs's
  // waitForQcQaDone) that blocks this fixture process until the first QC
  // invocation has actually written its verdict and exited — a real
  // synchronization signal, not a guessed number of filler lines timed to
  // fakeClaudeDelayMs, so it's correct regardless of how slow the CI runner
  // is.
  '__WAIT_QCQA__:qc:1',
  '[Dev] Completed: Build the widget',
  // Likewise, wait for the retry's QA check (the only QA invocation this
  // task goes through) to actually finish before this process exits.
  // runFinalQaSweep() only runs once the deploy process closes, and
  // silently no-ops (mission stuck at 'Running' forever) if not every task
  // is 'completed' yet at that moment — QA attempt 1 only fires after QC
  // attempt 2 (the retry) has already passed, so waiting on it also proves
  // the retry landed.
  '__WAIT_QCQA__:qa:1',
];

test.describe('QC/QA verification loop', () => {
  let harness: LaunchedApp;
  let projectDir: string;

  test.beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-teams-qcqa-e2e-'));
    harness = await launchApp({ fakeClaudeLines: FAKE_CLAUDE_SCRIPT, fakeClaudeDelayMs: 500 });
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
    await expect(window.getByRole('button', { name: 'Deploy Team' })).toBeVisible({ timeout: ciTimeout(15_000) });
    await window.getByRole('button', { name: 'Deploy Team' }).click();
    await window.getByRole('button', { name: 'Deploy Mission' }).click();

    // The task should first show as pending QC review, not immediately completed.
    await expect(window.getByText(/In QC Review/i)).toBeVisible({ timeout: ciTimeout(15_000) });

    // Fake-claude fixture (see claude.cjs's QC/QA verdict emulation) is
    // configured to fail the first QC check for the run, then pass — assert
    // the failed_qc badge appears...
    await expect(window.getByText(/QC Failed/i)).toBeVisible({ timeout: ciTimeout(20_000) });

    // ...then the retry cycles back through pending_qc (2nd "Completed:" line
    // in the script re-triggers TaskCompleted -> pending_qc -> QC check,
    // which now passes), into pending_qa...
    await expect(window.getByText(/In QA Review/i)).toBeVisible({ timeout: ciTimeout(20_000) });

    // ...and the mission only reaches Completed after the final
    // whole-picture QA sweep (fixture always PASSes QA-Agent prompts) runs
    // once the deploy process exits and every task is 'completed' — not
    // merely on process exit code.
    await expect(window.getByText('Completed', { exact: true })).toBeVisible({ timeout: ciTimeout(20_000) });
  });
});
