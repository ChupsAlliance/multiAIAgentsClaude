// tests/specs/mission-companion-real-usage.spec.ts
//
// End-to-end coverage proving the Mission Companion Ask/Chat/Debrief features
// actually work against a REAL (fake-but-spawned) child process — not just
// against the vi.fn()-mocked child process objects the unit tests substitute.
//
// Context: the final whole-branch review of the Mission Companion plan
// (docs/superpowers/plans/2026-08-04-mission-companion.md) found a Critical
// bug where askMissionLive, generateDebriefSummary (mission.cjs), and
// askMissionChat (history.cjs) all built a prompt, spawned a process, and
// attached stdout listeners — but never wrote the prompt to the spawned
// process's stdin. Every unit test passed anyway, because each one
// substitutes a fake `proc` whose stdout/close events are emitted manually,
// independent of whether stdin.write() was ever called. The fix (commit
// 9a9f409) added `proc.stdin.write(prompt); proc.stdin.end();` at all three
// call sites.
//
// tests/fixtures/fake-claude/claude.cjs was extended (see its "Mission
// Companion stdin-echo emulation" section) to actually read(0) its own
// stdin and echo a fragment of what it received back as the "answer", for
// exactly these three call sites (detected via maxTurns 5/10/20 + the
// stdin-prompt-delivery convention). If the stdin-write regressed, the
// echoed answer would revert to the fixture's own
// "(fake-claude received no stdin)" sentinel — which the assertions below
// explicitly rule out — so this spec fails loudly if the Critical bug ever
// reappears, instead of silently passing like the mocked unit tests did.
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
  tasks: [{ title: 'Write the report', why: 'demo', agent: 'Dev', detail: 'Write a short report', priority: 'high' }],
  mission_context: 'Mission Companion real-usage E2E demo mission',
};

const PLAN_LINE = JSON.stringify({
  type: 'assistant',
  session_id: 'fake-session-companion-e2e',
  message: { content: [{ type: 'text', text: `=== MISSION PLAN ===\n${JSON.stringify(FAKE_PLAN)}\n=== END PLAN ===` }] },
});

// Deploy-phase script — mirrors qcqa-verification-loop.spec.ts's proven
// FAKE_CLAUDE_SCRIPT shape exactly (same comments there explain each
// constraint): no "[Lead] Starting: ..." line (would create an orphaned
// task row for Lead since the plan only assigns the task to Dev), and two
// "[Dev] Completed: ..." lines (first reaches pending_qc and fails QC/flips
// back to in_progress; the retry's second Completed line drives it through
// QC-pass -> QA-pass -> completed -> final sweep -> mission Completed) with
// real "__WAIT_QCQA__:<stage>:<attempt>" sync directives (claude.cjs's
// waitForQcQaDone) in between instead of guessed filler-line delays.
const FAKE_CLAUDE_SCRIPT = [
  PLAN_LINE,
  '[Lead] Assigning the report task to Dev.',
  '[Dev] Starting: Write the report',
  '[Dev] Completed: Write the report',
  '__WAIT_QCQA__:qc:1',
  '[Dev] Completed: Write the report',
  '__WAIT_QCQA__:qa:1',
];

test.describe('Mission Companion — real usage against a real spawned process', () => {
  let harness: LaunchedApp;
  let projectDir: string;

  test.beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-teams-companion-e2e-'));
    // A wider per-line delay than the QC/QA spec's 500ms: this spec's Ask-tab
    // interaction (click, fill, press Enter) needs enough real wall-clock time
    // to land while the mission is still 'running' (pending_qc), before the
    // scripted transcript finishes and the mission flips to 'Completed' —
    // which unmounts the Ask tab (MissionDashboard's showAskTab = !isHistoryView
    // && isRunning). fakeClaudeDelayMs also drives qcqaDelayMs (claude.cjs
    // reuses the same env var for the QC/QA verdict-emission delay), so a
    // wider value here directly widens the pending_qc window the Ask-tab
    // interaction has to land in — independent of the
    // "__WAIT_QCQA__" sync directives above, which just make the deploy
    // script wait exactly as long as that round-trip actually takes rather
    // than guessing.
    harness = await launchApp({ fakeClaudeLines: FAKE_CLAUDE_SCRIPT, fakeClaudeDelayMs: 1500 });
  });

  test.afterEach(async () => {
    await harness.cleanup();
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  test('Ask tab gets a real answer while running, and Chat tab works from history after completion', async ({}, testInfo) => {
    // Longer than the default 60s (playwright.config.ts): this spec chains a
    // full mission run (16 scripted deploy lines at fakeClaudeDelayMs each),
    // an Ask round-trip, a completion wait, a debrief_summary poll (up to
    // 20s), and a second history-Chat round-trip, all in one test.
    testInfo.setTimeout(ciTimeout(120_000));
    const { window } = harness;
    const recordings = new RecordingsPage(window);

    await recordings.gotoMission();
    await window.locator('input[placeholder="D:\\\\projects\\\\my-app"]').fill(projectDir);
    await window.locator('textarea[placeholder^="Ví dụ: Build a user authentication feature"]')
      .fill('Write a short status report for the Mission Companion E2E test');

    await window.getByRole('button', { name: 'Launch Mission' }).click();
    await expect(window.getByRole('button', { name: 'Deploy Team' })).toBeVisible({ timeout: ciTimeout(15_000) });
    await window.getByRole('button', { name: 'Deploy Team' }).click();
    await window.getByRole('button', { name: 'Deploy Mission' }).click();

    // Confirm the mission is genuinely running and mid-QC (same first
    // checkpoint qcqa-verification-loop.spec.ts uses) before touching the
    // Ask tab — asserting this early avoids racing the Ask-tab interaction
    // against the QC-fail/retry cycle and any process-exit/auto-resume path.
    // Deliberately don't add any extra waiting/polling here: the fake-claude
    // deploy process is a fixed-length scripted transcript that keeps running
    // to completion on its own clock (see FAKE_CLAUDE_SCRIPT above) — adding
    // seconds of delay here just eats into the window the Ask tab is
    // guaranteed to be visible (isRunning) before the mission reaches
    // 'Completed'.
    await expect(window.getByText(/In QC Review/i)).toBeVisible({ timeout: ciTimeout(15_000) });

    // Mission is now running — the Ask tab should be visible (showAskTab =
    // !isHistoryView && isRunning in MissionDashboard.jsx). Use exact:true —
    // getByRole name matching is a case-insensitive substring match by
    // default, and "Tasks" contains "ask" as a substring, so the non-exact
    // locator resolves to two elements (Tasks tab AND Ask tab).
    await window.getByRole('button', { name: 'Ask', exact: true }).click();

    const askQuestion = 'Which agent is working on the report right now';
    await window.getByPlaceholder('Hỏi mission đang chạy...').fill(askQuestion);
    await window.getByPlaceholder('Hỏi mission đang chạy...').press('Enter');

    // Real (non-mocked) child process must actually receive the prompt on
    // stdin and echo it back — proves askMissionLive's stdin.write() fix
    // works end-to-end, not just against a mocked proc in a unit test.
    await expect(window.getByText(/Fake answer based on received prompt/)).toBeVisible({ timeout: ciTimeout(20_000) });
    // Explicitly rule out the "stdin was never delivered" sentinel — this is
    // the exact failure mode the Critical bug produced.
    await expect(window.getByText('(fake-claude received no stdin)')).not.toBeVisible();

    // Let the mission run to completion (QC fail→retry→QA→final sweep).
    await expect(window.getByText('Completed', { exact: true })).toBeVisible({ timeout: ciTimeout(25_000) });

    // ── Debrief summary: generateDebriefSummary() is fire-and-forget from
    // finalizeDeployExit, so poll get_mission_detail via the app's own IPC
    // bridge rather than asserting on a fixed timeout.
    await expect(async () => {
      const detail = await window.evaluate(async () => {
        const list = await window.electronAPI.invoke('get_mission_history');
        const latest = list[0];
        return window.electronAPI.invoke('get_mission_detail', { missionId: latest.id });
      });
      expect(detail?.debrief_summary).toBeTruthy();
      expect(detail.debrief_summary.outcome).toBeTruthy();
    }).toPass({ timeout: ciTimeout(20_000) });

    // ── History Chat tab: open the just-completed mission from history and
    // ask a question — proves askMissionChat's stdin.write() fix works too.
    // "New Mission" (MissionHeader.jsx) returns to the launcher screen, which
    // renders TWO distinct, unrelated history UIs stacked vertically
    // (MissionControlPage.jsx lines ~499-508):
    //   1. MissionLauncher.jsx's own inline "Lịch sử (N)" list — reuse-only
    //      (clicking a row just re-fills the launch form via handleReuse),
    //      no view-detail affordance at all.
    //   2. MissionHistoryPanel.jsx's separate "Mission History (N)" section
    //      — collapsed by default (local `collapsed` state, starts true) —
    //      whose *own* per-row "Xem chi tiết" button only exists here, and
    //      only appears once that specific row is expanded (each HistoryItem
    //      has independent local `expanded` state).
    // So: expand the Mission History section first, then the just-completed
    // mission's row (newest-first, unique description for this test run),
    // then its "Xem chi tiết" button becomes visible.
    // Both history UIs render the identical description text, so a bare
    // getByText(...).first() resolves to MissionLauncher's row (the first
    // one in DOM order) instead of MissionHistoryPanel's — scope to the
    // container that also has the "Mission History" section to disambiguate.
    await window.getByRole('button', { name: 'New Mission' }).click();
    const missionHistorySection = window.locator('div.border-t.border-vs-border', { has: window.getByRole('button', { name: /Mission History/i }) });
    await missionHistorySection.getByRole('button', { name: /Mission History/i }).click();
    await missionHistorySection.getByText('Write a short status report for the Mission Companion E2E test').first().click();
    await missionHistorySection.getByText('Xem chi tiết').first().click();

    await window.getByRole('button', { name: 'Chat', exact: true }).click();
    const chatQuestion = 'Summarize what happened in this mission';
    await window.getByPlaceholder('Hỏi mission này...').fill(chatQuestion);
    await window.getByPlaceholder('Hỏi mission này...').press('Enter');

    await expect(window.getByText(/Fake answer based on received prompt/)).toBeVisible({ timeout: ciTimeout(20_000) });
    await expect(window.getByText('(fake-claude received no stdin)')).not.toBeVisible();
  });
});
