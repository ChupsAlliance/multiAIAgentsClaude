#!/usr/bin/env node
'use strict';

// ─── fake-claude/claude.cjs ─────────────────────────────────────
// Drop-in replacement for the real `claude` CLI binary, used ONLY by
// Playwright E2E tests so that a "mission" can be run end-to-end
// without ever invoking the real Claude Code CLI or spending real
// API tokens / making real network calls.
//
// electron/ipc/mission.cjs's spawnClaude() does:
//   spawn('claude', args, { cwd, env, stdio: ['pipe','pipe','pipe'] })
// and then parses stdout line-by-line with OutputParser, matching:
//   AGENT_MSG_RE   = /^\[([^\]]+)\]\s*(.+)$/         → "[AgentName] message"
//   SPAWN_RE       = /spawn(?:ing|ed)?\s+(?:teammate\s+)?'([^']+)'/i
//   STARTING_RE    = /^Starting:\s*(.+)$/i            (inside an agent message)
//   COMPLETED_RE   = /^Completed:\s*(.+)$/i            (inside an agent message)
//
// This fixture is put first on PATH by tests/support/electronApp.ts
// (as a shim named `claude` / `claude.cmd` on Windows) so that any
// `spawn('claude', ...)` call in the app under test resolves here
// instead of the real CLI. It prints a short, deterministic, valid
// Vietnamese-friendly mission transcript, then exits 0.
//
// Control via env vars (set by the test that launches Electron):
//   FAKE_CLAUDE_SCRIPT   optional path to a JSON file describing custom
//                        lines to emit instead of the default script
//                        (array of strings, each written as one stdout line)
//   FAKE_CLAUDE_DELAY_MS optional per-line delay in ms (default 20ms) —
//                        keeps the fake mission fast (<1s total) while still
//                        exercising the real async stdout readline pipeline.
//
// QC/QA subprocess emulation:
// electron/lib/qcqa.cjs's runQcQaCheck() calls the SAME spawnClaude() as the
// main mission script (it's the identical `claude` binary shadowed on PATH),
// invoked as: `claude -p <prompt> --dangerously-skip-permissions --model
// <model> --output-format stream-json --verbose`. Its verdict parser
// (parseQcQaVerdict) just regexes the raw accumulated stdout text for
// `[QC] VERDICT: PASS|FAIL` / `[QA] VERDICT: PASS|FAIL` lines — it does NOT
// require valid stream-json, so plain text output is fine here.
//
// We distinguish a QC/QA invocation from a main-mission-script invocation by
// scanning argv for the literal prompt-template substrings
// "You are the QC-Agent" / "You are the QA-Agent" (from electron/prompts/
// qc_check.md and qa_check.md respectively) that fillTemplate() leaves
// untouched in the filled-in prompt. When detected, this fixture SKIPS
// FAKE_CLAUDE_SCRIPT entirely (that env var is for the mission transcript
// only) and prints a verdict line instead.
//
// QC needs to FAIL once then PASS on retry for the same task (to exercise
// mission.cjs's handleQcQaFailure → back to in_progress → enqueueQcCheck
// retry loop), but each invocation is a fresh subprocess with no shared
// memory. State is tracked via a small counter file on disk, keyed by
// FAKE_QCQA_STATE_DIR (set by tests/support/electronApp.ts to a directory
// unique to that launched app instance, so parallel/sequential test runs
// never collide).

const fs = require('fs');
const path = require('path');

// electron/ipc/system.cjs's check_claude_available/get_system_info run
// `claude --version` synchronously (execSync) to decide whether to show
// the onboarding/setup screen. Answer that here so E2E runs never depend
// on whether the real Claude CLI happens to be installed on the test
// machine.
if (process.argv.includes('--version')) {
  process.stdout.write('1.0.0 (fake-claude test fixture)\n');
  process.exit(0);
}

// ── QC/QA verdict emulation ─────────────────────────────────────
// Find the `-p <prompt>` argument (argv layout: [node, claude.cjs, '-p',
// prompt, ...more flags]) and check it for the QC/QA prompt templates'
// literal opening lines.
//
// Since the backend-adapter refactor (commit 1f48086), runQcQaCheck
// (electron/lib/qcqa.cjs) builds its argv via the adapter's buildLaunchArgs
// with NO maxTurns and NO prompt text in argv at all — the prompt is always
// written to stdin instead (qcqa.cjs's `viaStdin` is true by default for the
// Claude adapter). So `-p` is now immediately followed by
// '--dangerously-skip-permissions', identical in shape to the Mission
// Companion Ask/Chat/Debrief stdin-prompt-mode calls below, and the QC/QA
// prompt text ("You are the QC-Agent"/"You are the QA-Agent") only shows up
// on stdin, never in argv. Read stdin once, upfront, and check BOTH argv and
// stdin content for the QC/QA markers so this detection still works
// regardless of which delivery mechanism actually carried the prompt.
const promptArgIndex = process.argv.indexOf('-p');
const promptArg = promptArgIndex >= 0 ? process.argv[promptArgIndex + 1] : null;
const isStdinPromptModeEarly = promptArg === '--dangerously-skip-permissions';

// A single fs.readFileSync(0) is NOT reliable here: the parent
// (mission.cjs/qcqa.cjs) writes the prompt to stdin asynchronously, right
// after spawning — this child can start running before any bytes (or an
// EOF) have actually arrived on the pipe. A sync read at that moment can
// come back empty even though the parent goes on to write and close stdin
// moments later, which silently defeated QC/QA content detection below
// (empty promptText -> falls through to the main-script replay path,
// producing duplicate "Starting:"/"Completed:" lines). Retry the sync read
// until it stops growing (a full EOF read returns '' once drained) or a
// generous timeout elapses, so this always captures the whole prompt
// regardless of parent-write timing.
function readStdinSync(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let text = '';
  while (Date.now() < deadline) {
    try {
      const chunk = fs.readFileSync(0, 'utf8');
      if (chunk) {
        text += chunk;
        continue; // more may follow; keep draining without delay
      }
      if (text) return text; // prior reads got data, this read hit EOF
    } catch {
      // EAGAIN (no data yet) or EOF-with-no-data — fall through to retry/backoff
    }
    sleepSync(10);
  }
  return text;
}

let earlyStdinText = '';
if (isStdinPromptModeEarly) {
  earlyStdinText = readStdinSync(5000);
}
// When -p is immediately followed by '--dangerously-skip-permissions',
// promptArg IS that flag string (truthy but not the real prompt) — the
// actual prompt only lives on stdin. Only trust promptArg as the prompt
// text in the legacy argv-delivered case (isStdinPromptModeEarly === false).
const promptText = isStdinPromptModeEarly ? earlyStdinText : promptArg;

function nextInvocationCount(stage) {
  const stateDir = process.env.FAKE_QCQA_STATE_DIR;
  if (!stateDir) return 1; // no shared state configured — always act as "first" invocation
  try {
    fs.mkdirSync(stateDir, { recursive: true });
  } catch {
    // ignore — best effort
  }
  const counterFile = path.join(stateDir, `__qcqa-count-${stage}.json`);
  let count = 0;
  try {
    count = JSON.parse(fs.readFileSync(counterFile, 'utf8'));
    if (typeof count !== 'number') count = 0;
  } catch {
    count = 0;
  }
  count += 1;
  try {
    fs.writeFileSync(counterFile, JSON.stringify(count), 'utf8');
  } catch {
    // ignore — best effort
  }
  return count;
}

// QC/QA verdicts are emitted synchronously and near-instantly (just Node
// process-startup overhead) unless we deliberately slow them down. Without
// this, mission.cjs's pending_qc/failed_qc/pending_qa states each last only
// a few tens of milliseconds in the real app's DOM — far too short for
// Playwright's toBeVisible polling (or a human) to reliably observe, even
// though the state transitions are logically correct. Reuse
// FAKE_CLAUDE_DELAY_MS (same knob the main transcript loop uses below) so
// E2E specs can widen this window by passing a larger fakeClaudeDelayMs to
// launchApp() — the QC/QA check itself doesn't print multiple lines, so we
// only need one delay before exiting, not a per-line one.
const qcqaDelayMs = Number(process.env.FAKE_CLAUDE_DELAY_MS || 20);

function sleepSync(ms) {
  const sab = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(sab, 0, 0, ms);
}

if (promptText && promptText.includes('You are the QC-Agent')) {
  // First QC attempt for a given task: FAIL once, so mission.cjs's
  // handleQcQaFailure() routes the task back through in_progress → pending_qc
  // (the retry loop). Every subsequent QC attempt (retry, or the mission's
  // other tasks/rounds): PASS.
  const attempt = nextInvocationCount('qc');
  sleepSync(qcqaDelayMs);
  if (attempt === 1) {
    process.stdout.write('[QC] VERDICT: FAIL\n');
    process.stdout.write('[QC] RESPONSIBLE_AGENT: Dev\n');
    process.stdout.write('[QC] REASON: fake-claude fixture forcing one QC failure to exercise the retry loop\n');
  } else {
    process.stdout.write('[QC] VERDICT: PASS\n');
  }
  process.exit(0);
}

if (promptText && promptText.includes('You are the QA-Agent')) {
  // Both per-task QA and the final whole-picture QA sweep use this same
  // template/prompt opening line — always PASS so the loop can reach
  // 'completed' / the mission can reach 'Completed'.
  sleepSync(qcqaDelayMs);
  process.stdout.write('[QA] VERDICT: PASS\n');
  process.exit(0);
}

// ── Mission Companion (Ask/Chat/Debrief) stdin-echo emulation ───────────
// electron/ipc/mission.cjs's askMissionLive (maxTurns:10) and
// generateDebriefSummary (maxTurns:5), and electron/ipc/history.cjs's
// askMissionChat (maxTurns:20), all spawn via spawnAgentProcess with
// promptViaStdin=true — meaning `-p` is followed immediately by
// '--dangerously-skip-permissions' (no prompt text in argv at all), and the
// real prompt is written to this process's stdin instead. This is what
// distinguishes these three call sites from the main mission script's
// launch/deploy spawns (maxTurns 200/null) and from resume/replan/QC/QA
// invocations, all of which use different maxTurns values or the argv-prompt
// QC/QA path handled above.
//
// If this fixture just replayed FAKE_CLAUDE_SCRIPT here like the main
// mission path below, an E2E test could never prove that the prompt written
// to stdin was actually delivered and used — the Critical bug fixed in this
// codebase (three handlers that built a prompt, spawned a process, but never
// wrote it to stdin) would have produced IDENTICAL fixture output either way.
// So instead: read stdin synchronously, and echo a fragment of exactly what
// was received back inside a valid stream-json 'assistant' message, which
// extractAssistantText() (mission.cjs) / parseLine() (claudeAdapter.cjs) both
// know how to parse. If stdin was never written (the bug), reading it here
// yields '' and the echoed answer is conspicuously empty — visible to any
// test asserting on real answer content.
const maxTurnsIdx = process.argv.indexOf('--max-turns');
const maxTurnsVal = maxTurnsIdx >= 0 ? Number(process.argv[maxTurnsIdx + 1]) : NaN;
const isStdinPromptMode = isStdinPromptModeEarly;
if (isStdinPromptMode && maxTurnsVal > 0 && maxTurnsVal <= 20) {
  // stdin was already drained upfront (see earlyStdinText above) so QC/QA
  // detection could inspect its content — reuse it rather than reading fd 0
  // a second time, which would yield nothing (the pipe is already closed).
  const stdinText = earlyStdinText;
  sleepSync(qcqaDelayMs);
  const trimmed = stdinText.trim();
  // generateDebriefSummary (mission.cjs) is the ONLY one of these three call
  // sites that uses maxTurns:5, and it JSON.parses the echoed text as a
  // structured debrief object ({goal, agents_involved, key_files,
  // issues_encountered, outcome}) — a plain prose echo (used for Ask/Chat,
  // maxTurns 10/20) would fail that JSON.parse and silently resolve null,
  // so debrief_summary would never attach to the mission snapshot even
  // though stdin was delivered correctly. Emit valid debrief JSON here,
  // still derived from the received prompt so the test can prove stdin
  // delivery worked (non-empty stdin -> non-empty outcome string).
  if (maxTurnsVal === 5) {
    const debriefJson = JSON.stringify({
      goal: 'fake debrief goal',
      agents_involved: ['Lead', 'Dev'],
      key_files: [],
      issues_encountered: [],
      outcome: trimmed
        ? `Fake debrief outcome based on received prompt (${trimmed.length} chars)`
        : '(fake-claude received no stdin)',
    });
    process.stdout.write(JSON.stringify({
      type: 'assistant',
      session_id: 'fake-session-companion',
      message: { content: [{ type: 'text', text: debriefJson }] },
    }) + '\n');
    process.exit(0);
  }
  const echoedAnswer = trimmed
    ? `Fake answer based on received prompt (${trimmed.length} chars). Prompt tail: ${trimmed.slice(-120)}`
    : '(fake-claude received no stdin)';
  process.stdout.write(JSON.stringify({
    type: 'assistant',
    session_id: 'fake-session-companion',
    message: { content: [{ type: 'text', text: echoedAnswer }] },
  }) + '\n');
  process.exit(0);
}

const DEFAULT_SCRIPT = [
  "[Lead] Đang khởi tạo nhóm agent cho nhiệm vụ demo ghi hình.",
  "[Lead] Starting: Phân tích yêu cầu",
  "[Lead] Đang spawning teammate 'Dev'",
  "[Dev] Đã sẵn sàng, bắt đầu triển khai.",
  "[Dev] Starting: Tạo file cấu hình mẫu",
  "[Dev] Completed: Tạo file cấu hình mẫu",
  "[Lead] Completed: Phân tích yêu cầu",
  "[Lead] Nhiệm vụ demo đã hoàn thành thành công.",
];

function loadScript() {
  const scriptPath = process.env.FAKE_CLAUDE_SCRIPT;
  if (scriptPath) {
    try {
      const raw = fs.readFileSync(scriptPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // fall through to default script on any read/parse error
    }
  }
  return DEFAULT_SCRIPT;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// electron/ipc/mission.cjs spawns `claude` for TWO distinct phases that both
// read the SAME FAKE_CLAUDE_SCRIPT file (electronApp.ts only wires up one
// static script per launched app instance):
//   - launch_mission (Planning phase): spawnArgs has NO '--max-turns' flag.
//     Once the real Lead's plan JSON is detected in its stdout,
//     readProcessStdout_launch's handler calls proc.kill() to stop this
//     process immediately (so Lead can't proceed to spawning teammates
//     before the user reviews/approves the plan).
//   - deploy_mission (Executing phase): spawnArgs DOES include '--max-turns'
//     (see deploy_mission's attemptSpawnDeploy in mission.cjs) and is the
//     one that should actually run the full mission transcript (Starting/
//     Completed lines, etc).
//
// On Windows, `spawn('claude', ...)` resolves through claude.cmd (a batch
// wrapper invoking `node claude.cjs`), so proc.kill() only terminates the
// cmd.exe wrapper — the actual `node claude.cjs` grandchild process is left
// running, orphaned, still writing to the same stdout pipe. If this fixture
// kept emitting the REST of the mission script after the plan line in that
// orphaned launch-phase process, readProcessStdout_launch's OutputParser
// would double-process every Starting:/Completed: line (once from the
// leftover launch process, once for real from the deploy process),
// producing duplicate/orphaned task rows that can permanently deadlock
// mission.cjs's runFinalQaSweep() `.every(status === 'completed')` gate.
//
// Workaround entirely within this fixture (can't touch mission.cjs itself):
// detect a launch-phase invocation by the ABSENCE of '--max-turns' in argv,
// and in that case only emit the script's leading lines up to and including
// the first one containing the plan marker, then exit — never emit the
// mission-transcript lines (Starting:/Completed:/etc) from that invocation
// at all, regardless of whether the real kill() landed in time.
const isLaunchPhaseInvocation = !process.argv.includes('--max-turns');

async function main() {
  const lines = loadScript();
  const delayMs = Number(process.env.FAKE_CLAUDE_DELAY_MS || 20);
  const planMarkerIndex = lines.findIndex(l => l.includes('=== END PLAN ==='));
  const effectiveLines = (isLaunchPhaseInvocation && planMarkerIndex >= 0)
    ? lines.slice(0, planMarkerIndex + 1)
    : lines;

  for (const line of effectiveLines) {
    process.stdout.write(line + '\n');
    // Small delay so the app's async readline-based stdout parsing has
    // discrete ticks to process, keeping ordering deterministic without
    // making the overall mission run slow (whole script finishes in well
    // under 1s with the default 8-line script at 20ms/line).
    if (delayMs > 0) await sleep(delayMs);
  }

  process.exit(0);
}

main();
