// tests/specs/replay-real-ui-fidelity.spec.ts
//
// End-to-end coverage for the "Phát trên UI thật" (Play on Real UI) replay
// mode: record a live mission through Planning → ReviewPlan → Executing →
// Done, then replay it and assert the UI actually switches screens to match
// each recorded phase (PlanningStream / read-only PlanReview / Mission
// Dashboard), instead of staying frozen on the dashboard the whole time.
//
// This exercises real code paths (useReplay.js phase tracking + the
// MissionControlPage.jsx replay-mode phase switch) against a real recording
// produced by a real (fake) `claude` process — not synthetic events crafted
// to match what the code happens to expect.
//
// Presentation Mode is explicitly out of scope and is not touched here.
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { launchApp, type LaunchedApp } from '../support/electronApp';
import { RecordingsPage } from '../pages/RecordingsPage';
import { ReplayControlsPage } from '../pages/ReplayControlsPage';

// The plan JSON the fake Lead "emits" during the Planning phase. Marker-
// wrapped per tryParsePlanFromBuffer's primary matching strategy in
// electron/ipc/mission.cjs (`=== MISSION PLAN === {...} === END PLAN ===`).
const FAKE_PLAN = {
  agents: [
    { name: 'Lead', role: 'Lead Coordinator' },
    { name: 'Dev', role: 'Developer', model: 'sonnet', reason: 'implementation work' },
  ],
  tasks: [
    {
      title: 'Tao file cau hinh mau',
      why: 'demo task',
      agent: 'Dev',
      detail: 'Create a sample config file',
      priority: 'high',
    },
  ],
  mission_context: 'E2E replay fidelity demo mission',
};

// launch_mission and deploy_mission both spawn `claude` with
// `--output-format stream-json`, so the Planning-phase line that carries the
// plan must be a real stream-json `assistant` message (readProcessStdout_launch
// only feeds `fullTextBuf` — what tryParsePlanFromBuffer scans — from parsed
// JSON lines, never from plain text). The lines after it are plain
// "[Agent] Starting: X" / "[Agent] Completed: X" text, which
// readProcessStdout_deploy's OutputParser fallback turns into TaskStarted/
// TaskCompleted → mission:task-update events (confirmed in
// electron/ipc/mission.cjs's handleParsedEvent). One fake-claude script file
// is shared by both the launch and deploy spawns, so it must be valid for
// both: launch's reader kills the process the instant the plan is detected
// (before the plain-text lines are ever reached), and deploy re-runs the
// same script from line 1 (the plan line is harmless noise there — deploy's
// reader doesn't look for plan markers).
const PLAN_LINE = JSON.stringify({
  type: 'assistant',
  session_id: 'fake-session-e2e',
  message: { content: [{ type: 'text', text: `=== MISSION PLAN ===\n${JSON.stringify(FAKE_PLAN)}\n=== END PLAN ===` }] },
});

const FAKE_CLAUDE_SCRIPT = [
  PLAN_LINE,
  '[Lead] Starting: Tao file cau hinh mau',
  "[Lead] Đang spawning teammate 'Dev'",
  '[Dev] Starting: Tao file cau hinh mau',
  '[Dev] Completed: Tao file cau hinh mau',
  '[Lead] Nhiem vu da hoan thanh thanh cong.',
];

test.describe('Replay on Real UI — full phase fidelity', () => {
  let harness: LaunchedApp;
  let projectDir: string;

  test.beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-teams-replay-e2e-project-'));
    // A larger per-line delay stretches the recording's real elapsed time
    // (recordingStore captures wall-clock timestamps as the mission runs
    // live) so that ratio-based seeks below land reliably inside the right
    // phase window — at the default ~10ms delay the whole 6-line script
    // completes in ~1s total, too short for seekToRatio(0.4) to reliably
    // distinguish "still in ReviewPlan" from "already Done".
    harness = await launchApp({ fakeClaudeLines: FAKE_CLAUDE_SCRIPT, fakeClaudeDelayMs: 400 });
  });

  test.afterEach(async () => {
    await harness.cleanup();
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  test('records a full mission and replays every phase with the correct screen', async () => {
    const { window } = harness;
    const recordings = new RecordingsPage(window);
    const replayControls = new ReplayControlsPage(window);

    // ── Record a live mission through all four phases ──────────────────
    await recordings.gotoMission();

    await window.locator('input[placeholder="D:\\\\projects\\\\my-app"]').fill(projectDir);
    await window
      .locator('textarea[placeholder^="Ví dụ: Build a user authentication feature"]')
      .fill('Build a tiny demo feature for the replay fidelity E2E test');

    await recordings.enableRecording();

    await window.getByRole('button', { name: 'Launch Mission' }).click();

    // Planning phase: plan-ready arrives once the fake Lead's stream-json
    // line is parsed (tryParsePlanFromBuffer finds the marker + JSON block).
    await expect(window.getByRole('button', { name: 'Deploy Team' })).toBeVisible({ timeout: 15_000 });

    await window.getByRole('button', { name: 'Deploy Team' }).click();

    // "Deploy Team" navigates to the Prompt Preview screen (PromptPreview.jsx)
    // first — a read-only look at each agent's resolved prompt before the
    // mission actually launches. The real "Deploy Mission" button there is
    // what triggers deployment (PlanReview.jsx's "Deploy Team" is just the
    // nav step, not the trigger).
    await window.getByRole('button', { name: 'Deploy Mission' }).click();

    // Executing phase → mission completes → save-recording dialog opens
    // automatically (MissionControlPage.jsx: isRecording && status===Completed).
    await recordings.waitForSaveDialog();
    await recordings.saveRecordingAs('replay-fidelity-e2e');

    // ── Replay it and verify phase-driven UI switching ──────────────────
    await recordings.goto();
    await recordings.refresh();
    const card = recordings.recordingCardByName('replay-fidelity-e2e');
    await expect(card).toBeVisible();
    const recordingId = (await card.getAttribute('data-testid'))!.replace('recording-card-', '');

    await recordings.playOnRealUi(recordingId);
    await replayControls.expectVisible();

    // replay_start auto-plays (useReplay.js sets isPlaying(true) on start),
    // and playback keeps advancing in real time as the test performs
    // subsequent seeks/assertions — pause immediately so every seek below
    // lands deterministically instead of racing a moving playhead.
    await replayControls.pause();

    // Seek to the very start: the recording opens on the Planning phase.
    // PlanningStream has no dedicated testid, but MissionControlPage.jsx's
    // isReplayPlanning/isReplayReviewPlan conditions are mutually exclusive
    // with both the dashboard wrapper and the ReviewPlan overlay — asserting
    // both are absent (while ReplayControls stays mounted) positively proves
    // we're in Planning specifically, not just "the app didn't crash".
    await replayControls.seekToRatio(0);
    await expect(replayControls.missionDashboardReplayMode).toBeHidden();
    await expect(window.getByTestId('replay-readonly-overlay')).toBeHidden();

    // The ReviewPlan window is the gap between the recorded mission:plan-ready
    // event and the first mission:task-update event (useReplay.js flips phase
    // ReviewPlan → Executing on that first task-update) — NOT a fixed fraction
    // of total duration. task-update events fire almost immediately after
    // plan-ready once the fake Lead starts "Working", so a fixed ratio like
    // 0.4 lands past the end of ReviewPlan regardless of fakeClaudeDelayMs
    // tuning (confirmed: at ratio 0.4 the dashboard was already in
    // Executing/Deploying state, not ReviewPlan). Read the saved recording
    // file directly (real event timestamps, not a proportional guess) and
    // seek just after plan-ready, strictly before the first task-update.
    const recordingFilePath = path.join(harness.recordingsDir, `${recordingId}.json`);
    const recordingJson = JSON.parse(fs.readFileSync(recordingFilePath, 'utf8'));
    const recordedEvents: Array<{ relativeTimestamp: number; channel: string }> = recordingJson.events;
    const planReadyMs = recordedEvents.find(e => e.channel === 'mission:plan-ready')!.relativeTimestamp;
    const firstTaskUpdateMs = recordedEvents.find(e => e.channel === 'mission:task-update')!.relativeTimestamp;
    const totalMs = recordedEvents[recordedEvents.length - 1].relativeTimestamp;
    const reviewPlanMs = Math.round((planReadyMs + firstTaskUpdateMs) / 2);
    const reviewPlanRatio = reviewPlanMs / totalMs;

    // Seek forward into ReviewPlan: PlanReview should render, read-only, and
    // inert — the Deploy button in the replayed UI must not exist/act since
    // MissionControlPage.jsx forces onDeploy to a no-op for the replay branch.
    await replayControls.seekToRatio(reviewPlanRatio);
    await expect(window.getByTestId('replay-readonly-overlay')).toBeVisible({ timeout: 10_000 });
    await expect(window.getByText('Tao file cau hinh mau').first()).toBeVisible();

    // Seek to the end: mission is Done, MissionDashboard replay wrapper shows.
    // seekToEnd() clicks the track clamped to ratio 0.99 (dodging the
    // elementFromPoint edge-pixel bug), which lands before the recording's
    // final mission:status:completed event — still inside Executing, not
    // Done. Exercise the real click path first (proves clicking near the
    // end works and switches to the dashboard), then use the exact-ms IPC
    // seek to reach the literal last event and assert the header's status
    // badge reads "Completed" (StatusBadge renders {status} verbatim;
    // useReplay.js capitalizes the recorded 'completed' mission:status into
    // 'Completed' only once the phase has actually reached Done) — proving
    // Done, not just Executing, was really reached.
    await replayControls.seekToEnd();
    await replayControls.expectMissionDashboardInReplayMode();
    await replayControls.expectFinishedAtEnd();

    await replayControls.seekToPositionMs(totalMs);
    await expect(window.getByText('Completed', { exact: true })).toBeVisible({ timeout: 10_000 });

    // Seek backward again: the UI must switch back to the ReviewPlan screen,
    // proving phase state isn't a one-way ratchet and scrubbing works.
    await replayControls.seekToRatio(reviewPlanRatio);
    await expect(window.getByTestId('replay-readonly-overlay')).toBeVisible({ timeout: 10_000 });
    await expect(replayControls.missionDashboardReplayMode).toBeHidden();

    // ReplayControls stays mounted throughout every phase.
    await replayControls.expectVisible();
  });
});
