# QC/QA verdict parsing fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `runQcQaCheck` so it feeds `parseQcQaVerdict` the agent's real plain-text answer instead of raw `stream-json` JSONL, so QC/QA verdict gating stops reporting spurious FAIL on every real check.

**Architecture:** Add a small backend-agnostic `extractLastAssistantText(stdoutText, parseLine)` helper to `electron/lib/qcqa.cjs` that walks the JSONL stdout through an adapter's existing `parseLine()` and keeps the last `kind:'text'` event's text. Wire it into `runQcQaCheck` right before the existing (unmodified) `parseQcQaVerdict` call, accepting the adapter's `parseLine` as a new option with a Claude-adapter default. Wire the real adapter's `parseLine` into production via `mission.cjs::qcQaSpawnOpts()`.

**Tech Stack:** Node.js (CJS), Vitest, existing `electron/lib/cliAdapters/{claudeAdapter,copilotAdapter}.cjs`.

## Global Constraints

- `parseQcQaVerdict`'s regex and its own direct unit tests (`electron/lib/qcqa.test.cjs` lines 6-56) are not modified.
- No change to the QC/QA prompt templates (`electron/prompts/qc_check.md`, `qa_check.md`) — their required output format is already correct.
- No change to `nextEscalationTier` or the escalation/retry logic in `mission.cjs` that consumes `runQcQaCheck`'s result — this fix only changes what text is fed to the verdict regex, not the shape of the returned `{ verdict, responsibleAgent, reason }` object.
- Follows the existing adapter interface (`electron/lib/cliAdapters/types.md`) — `parseLine` is already part of that documented interface; this is wiring, not a new interface.
- A real end-to-end test against the actual `claude` CLI is REQUIRED (not optional/deferred) — the human partner explicitly chose this over fixture-only tests during design review, since fixture tests alone would not have caught the original bug either (the false-green in the current test suite is exactly a fixture that didn't match reality).
- Windows dev environment (`d:\Project\multiAIAgentsClaude`) — use `path.join`/`path.win32`-safe code already established in the codebase; no new shell-string concatenation.

---

### Task 1: Core extraction fix in `qcqa.cjs` + rewritten unit tests

**Files:**
- Modify: `electron/lib/qcqa.cjs:1-111` (whole file — add helper, extend `runQcQaCheck`)
- Modify: `electron/lib/qcqa.test.cjs:1-137` (rewrite the `describe('runQcQaCheck', ...)` block, lines 78-137, add new fixtures)

**Interfaces:**
- Consumes: `claudeAdapter.parseLine(rawLine)` and `copilotAdapter.parseLine(rawLine)` from `electron/lib/cliAdapters/{claudeAdapter,copilotAdapter}.cjs` — both already exist, signature `(rawLine: string) => { kind: 'text'|'tool_use'|'result'|'system'|'error'|'none', text?: string, ... }`.
- Produces: `runQcQaCheck(opts)` gains a new optional `opts.parseLine` field (`(line: string) => { kind, text? }`). When omitted, defaults to `require('./cliAdapters/claudeAdapter.cjs').parseLine`. Return shape of `runQcQaCheck` (`{ verdict: 'PASS' }` or `{ verdict: 'FAIL', responsibleAgent, reason }`) is UNCHANGED — Task 2 and Task 3 rely on this exact shape.

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `electron/lib/qcqa.test.cjs` from line 78 (`const { EventEmitter } = require('events')`) through the end of the file (line 137, the closing of `describe('runQcQaCheck', ...)`) with:

```js
const { EventEmitter } = require('events');
const { runQcQaCheck } = require('./qcqa.cjs');
const claudeAdapter = require('./cliAdapters/claudeAdapter.cjs');
const copilotAdapter = require('./cliAdapters/copilotAdapter.cjs');

function makeFakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = () => { proc.killed = true; };
  return proc;
}

/** One real-shaped Claude stream-json JSONL line carrying `text` as the assistant's message. */
function claudeTextLine(text) {
  return JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
}

describe('runQcQaCheck', () => {
  test('resolves PASS from a real stream-json PASS verdict line', async () => {
    const fakeProc = makeFakeProc();
    const spawnClaude = () => fakeProc;

    const resultPromise = runQcQaCheck({
      spawnClaude, parseLine: claudeAdapter.parseLine,
      prompt: 'check task X', projectPath: '/tmp/proj',
      model: 'claude-sonnet-5', stage: 'QC', timeoutMs: 5000,
    });

    fakeProc.stdout.emit('data', Buffer.from(claudeTextLine('[QC] VERDICT: PASS') + '\n'));
    fakeProc.emit('close', 0);

    await expect(resultPromise).resolves.toEqual({ verdict: 'PASS' });
  });

  test('resolves FAIL with responsible agent and reason from a real stream-json FAIL verdict', async () => {
    const fakeProc = makeFakeProc();
    const spawnClaude = () => fakeProc;

    const resultPromise = runQcQaCheck({
      spawnClaude, parseLine: claudeAdapter.parseLine,
      prompt: 'check task X', projectPath: '/tmp/proj',
      model: 'claude-sonnet-5', stage: 'QC', timeoutMs: 5000,
    });

    const text = '[QC] VERDICT: FAIL\n[QC] RESPONSIBLE_AGENT: Dev\n[QC] REASON: build broken';
    fakeProc.stdout.emit('data', Buffer.from(claudeTextLine(text) + '\n'));
    fakeProc.emit('close', 0);

    await expect(resultPromise).resolves.toEqual({
      verdict: 'FAIL', responsibleAgent: 'Dev', reason: 'build broken',
    });
  });

  test('resolves FAIL on timeout without waiting for close', async () => {
    const fakeProc = makeFakeProc();
    const spawnClaude = () => fakeProc;

    const resultPromise = runQcQaCheck({
      spawnClaude, parseLine: claudeAdapter.parseLine,
      prompt: 'check task X', projectPath: '/tmp/proj',
      model: 'claude-sonnet-5', stage: 'QC', timeoutMs: 10,
    });

    const result = await resultPromise;
    expect(result.verdict).toBe('FAIL');
    expect(result.reason).toMatch(/timed out/i);
    expect(fakeProc.killed).toBe(true);
  });

  test('a tool_use turn before the verdict text does not clobber the extracted verdict', async () => {
    const fakeProc = makeFakeProc();
    const spawnClaude = () => fakeProc;

    const resultPromise = runQcQaCheck({
      spawnClaude, parseLine: claudeAdapter.parseLine,
      prompt: 'check task X', projectPath: '/tmp/proj',
      model: 'claude-sonnet-5', stage: 'QC', timeoutMs: 5000,
    });

    const toolUseLine = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] },
    });
    fakeProc.stdout.emit('data', Buffer.from(toolUseLine + '\n'));
    fakeProc.stdout.emit('data', Buffer.from(claudeTextLine('[QC] VERDICT: PASS') + '\n'));
    fakeProc.emit('close', 0);

    await expect(resultPromise).resolves.toEqual({ verdict: 'PASS' });
  });

  test('extracts the verdict from real Copilot stream-json shape (delta then full message)', async () => {
    const fakeProc = makeFakeProc();
    const spawnClaude = () => fakeProc;

    const resultPromise = runQcQaCheck({
      spawnClaude, parseLine: copilotAdapter.parseLine,
      prompt: 'check task X', projectPath: '/tmp/proj',
      model: 'claude-sonnet-5', stage: 'QA', timeoutMs: 5000,
    });

    const deltaLine = JSON.stringify({
      type: 'assistant.message_delta',
      data: { messageId: 'm1', deltaContent: '[QA] VERDICT: P' },
    });
    const fullLine = JSON.stringify({
      type: 'assistant.message',
      data: { messageId: 'm1', model: 'claude-sonnet-4.6', content: '[QA] VERDICT: PASS', toolRequests: [], turnId: '0' },
    });
    fakeProc.stdout.emit('data', Buffer.from(deltaLine + '\n'));
    fakeProc.stdout.emit('data', Buffer.from(fullLine + '\n'));
    fakeProc.emit('close', 0);

    await expect(resultPromise).resolves.toEqual({ verdict: 'PASS' });
  });

  test('resolves FAIL with default reason when no spawn function is provided', async () => {
    const result = await runQcQaCheck({
      prompt: 'check task X', projectPath: '/tmp/proj',
      model: 'claude-sonnet-5', stage: 'QC', timeoutMs: 5000,
    });
    expect(result).toEqual({
      verdict: 'FAIL', responsibleAgent: null, reason: 'No spawn function provided for QC/QA',
    });
  });
});
```

This is a straight rewrite: it keeps the same 3 original scenarios (PASS, FAIL-with-agent-and-reason, timeout) but wraps their fake stdout in real stream-json envelopes and passes `parseLine` explicitly, and adds 3 new scenarios: tool_use interleaving, Copilot shape, and a `no spawn function provided` case (confirmed via `electron/lib/qcqa.cjs:81` — `resolve({ verdict: 'FAIL', responsibleAgent: null, reason: 'No spawn function provided for QC/QA' })` — this exact code path exists today but was previously untested; adding coverage for it here is a small, directly-related addition since Task 1 touches every other branch of the same `close`/no-op paths in this function).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run electron/lib/qcqa.test.cjs`
Expected: the 5 new/rewritten `runQcQaCheck` tests FAIL (current code passes raw JSONL stdout straight into `parseQcQaVerdict`, whose anchored regex never matches text embedded inside JSON syntax — every one of them falls through to the default `{ verdict: 'FAIL', reason: 'No verdict line found in QC/QA output' }`, which does not match any of the new expectations except coincidentally none). The `parseQcQaVerdict` direct tests (lines 6-56) and `nextEscalationTier` tests (lines 60-76) still PASS — unaffected.

- [ ] **Step 3: Implement the extraction fix**

In `electron/lib/qcqa.cjs`, insert a new `extractLastAssistantText` function directly after `parseQcQaVerdict` (i.e. right before the existing `function nextEscalationTier(qcRound) {` line):

```js
/**
 * extractLastAssistantText — turn `--output-format stream-json` JSONL stdout
 * into the agent's actual last plain-text answer, backend-agnostically.
 *
 * Runs each line through the given adapter `parseLine` and keeps the LAST
 * `kind:'text'` event's `.text`. Tool-use/system/result events never
 * overwrite the tracked text, so a tool call between the agent's reasoning
 * and its final verdict line does not clobber the real answer.
 */
function extractLastAssistantText(stdoutText, parseLine) {
  const lines = (stdoutText || '').split('\n').filter(Boolean);
  let lastText = null;
  for (const line of lines) {
    const ev = parseLine(line);
    if (ev && ev.kind === 'text' && ev.text) lastText = ev.text;
  }
  return lastText || '';
}
```

Then change `runQcQaCheck`'s destructured parameter list to add `parseLine`:

```js
function runQcQaCheck({ spawnFn, buildArgs, promptViaStdin, parseLine, spawnClaude, prompt, projectPath, model, stage, timeoutMs = 180000, backend, log }) {
```

And change the `proc.on('close', ...)` handler from:

```js
    proc.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(parseQcQaVerdict(stdoutText, stage));
    });
```

to:

```js
    proc.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const resolvedParseLine = parseLine || require('./cliAdapters/claudeAdapter.cjs').parseLine;
      const assistantText = extractLastAssistantText(stdoutText, resolvedParseLine);
      resolve(parseQcQaVerdict(assistantText, stage));
    });
```

No other lines in `qcqa.cjs` change. `parseQcQaVerdict` and `nextEscalationTier` are untouched; `module.exports` stays `{ parseQcQaVerdict, nextEscalationTier, runQcQaCheck }` (unchanged — `extractLastAssistantText` is an internal helper, not exported, since it is only reachable/testable through `runQcQaCheck` per this plan's tests).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run electron/lib/qcqa.test.cjs`
Expected: all tests in the file PASS (the 5 `runQcQaCheck` tests plus the pre-existing `parseQcQaVerdict`/`nextEscalationTier` tests).

- [ ] **Step 5: Commit**

```bash
git add electron/lib/qcqa.cjs electron/lib/qcqa.test.cjs
git commit -m "fix: extract assistant text from stream-json before QC/QA verdict parsing"
```

---

### Task 2: Wire the real adapter's `parseLine` into production (`mission.cjs`)

**Files:**
- Modify: `electron/ipc/mission.cjs:56-69` (`qcQaSpawnOpts`)
- Modify: `electron/ipc/mission.cjs:4971-4972` (add one new test-only export next to `__setQcQaRunnerForTest`)
- Test: `electron/ipc/mission.backend.test.cjs` (append a new `describe` block)

**Interfaces:**
- Consumes: `resolveAdapter(backendId)` (existing, `electron/ipc/mission.cjs:35-46`, returns an adapter object with `.parseLine` or `null`), `runQcQaCheck`'s new `parseLine` option from Task 1.
- Produces: `qcQaSpawnOpts()` now includes `parseLine: adapter.parseLine.bind(adapter)` in its adapter-based return object. A new test-only export `module.exports.__qcQaSpawnOptsForTest = () => qcQaSpawnOpts();` (gated behind the existing `NODE_ENV === 'test' || VITEST` block) lets tests call `qcQaSpawnOpts()` directly without going through a full mission launch.

- [ ] **Step 1: Write the failing test**

Append to `electron/ipc/mission.backend.test.cjs` (after the last existing `describe` block in the file — do not touch any existing block):

```js
describe('qcQaSpawnOpts — parseLine wiring (Given/When/Then)', () => {
  let mission;

  beforeEach(() => {
    mission = freshMission();
  });

  afterEach(() => {
    mission.__setMissionStateForTest(null);
  });

  test('Given backend=claude, When qcQaSpawnOpts is built, Then parseLine matches claudeAdapter.parseLine output', () => {
    mission.__setMissionStateForTest({ backend: 'claude' });
    const opts = mission.__qcQaSpawnOptsForTest();

    expect(typeof opts.parseLine).toBe('function');
    const claudeAdapter = require('../lib/cliAdapters/claudeAdapter.cjs');
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } });
    expect(opts.parseLine(line)).toEqual(claudeAdapter.parseLine(line));
  });

  test('Given backend=copilot, When qcQaSpawnOpts is built, Then parseLine matches copilotAdapter.parseLine output', () => {
    mission.__setMissionStateForTest({ backend: 'copilot' });
    const opts = mission.__qcQaSpawnOptsForTest();

    expect(typeof opts.parseLine).toBe('function');
    const copilotAdapter = require('../lib/cliAdapters/copilotAdapter.cjs');
    const line = JSON.stringify({ type: 'assistant.message', data: { content: 'hello' } });
    expect(opts.parseLine(line)).toEqual(copilotAdapter.parseLine(line));
  });

  test('Given no missionState, When qcQaSpawnOpts is built, Then it defaults to backend=claude with a working parseLine', () => {
    mission.__setMissionStateForTest(null);
    const opts = mission.__qcQaSpawnOptsForTest();

    expect(opts.backend).toBe('claude');
    expect(typeof opts.parseLine).toBe('function');
  });
});
```

This test file already `require`s `createRequire`/uses `require` from `module` at the top (line 43: `const require = createRequire(import.meta.url);`) — the inline `require('../lib/cliAdapters/claudeAdapter.cjs')` calls above resolve through that same CJS `require`, consistent with the rest of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/ipc/mission.backend.test.cjs -t "qcQaSpawnOpts"`
Expected: FAIL with `mission.__qcQaSpawnOptsForTest is not a function` (the hook does not exist yet).

- [ ] **Step 3: Implement the wiring**

In `electron/ipc/mission.cjs`, change `qcQaSpawnOpts()` (currently lines 56-69) from:

```js
function qcQaSpawnOpts() {
  const backendId = (missionState && missionState.backend) || 'claude';
  const adapter = resolveAdapter(backendId);
  if (adapter) {
    return {
      spawnFn: adapter.spawn.bind(adapter),
      buildArgs: adapter.buildLaunchArgs.bind(adapter),
      promptViaStdin: adapter.promptViaStdin !== false,
      backend: backendId,
    };
  }
  // Fallback: legacy Claude path via spawnClaude
  return { spawnClaude, backend: backendId };
}
```

to:

```js
function qcQaSpawnOpts() {
  const backendId = (missionState && missionState.backend) || 'claude';
  const adapter = resolveAdapter(backendId);
  if (adapter) {
    return {
      spawnFn: adapter.spawn.bind(adapter),
      buildArgs: adapter.buildLaunchArgs.bind(adapter),
      promptViaStdin: adapter.promptViaStdin !== false,
      parseLine: adapter.parseLine.bind(adapter),
      backend: backendId,
    };
  }
  // Fallback: legacy Claude path via spawnClaude
  // (runQcQaCheck defaults its own parseLine to claudeAdapter.parseLine when omitted,
  // which is correct here since this path's argv is always Claude's stream-json format.)
  return { spawnClaude, backend: backendId };
}
```

Then, in the test-only export block starting at line 4965 (`if (process.env.NODE_ENV === 'test' || process.env.VITEST) {`), add one line immediately after `module.exports.__setQcQaRunnerForTest = (fn) => { qcQaRunner = fn; };` (currently line 4971):

```js
  module.exports.__qcQaSpawnOptsForTest = () => qcQaSpawnOpts();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run electron/ipc/mission.backend.test.cjs`
Expected: all tests in the file PASS, including the 3 new `qcQaSpawnOpts` tests and every pre-existing test in this file (this change is additive — the new `parseLine` field does not alter `spawnFn`/`buildArgs`/`promptViaStdin`/`backend`, so no existing assertion on those fields breaks).

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/mission.cjs electron/ipc/mission.backend.test.cjs
git commit -m "fix: wire adapter parseLine into QC/QA spawn options"
```

---

### Task 3: Real end-to-end test against the actual `claude` CLI

**Files:**
- Create: `electron/lib/qcqa.e2e.test.cjs`

**Interfaces:**
- Consumes: `runQcQaCheck` from `electron/lib/qcqa.cjs` (Task 1's new `parseLine` option), `claudeAdapter.spawn`/`claudeAdapter.buildLaunchArgs`/`claudeAdapter.parseLine` from `electron/lib/cliAdapters/claudeAdapter.cjs` (all pre-existing, unmodified).
- Produces: nothing consumed by later tasks — this is the terminal proof for Issue #3.

- [ ] **Step 1: Write the CLI-availability probe and the real spawn test**

Create `electron/lib/qcqa.e2e.test.cjs`:

```js
// electron/lib/qcqa.e2e.test.cjs
//
// Real end-to-end proof that the QC/QA verdict-parsing fix works against the
// actual `claude` CLI's real stream-json output, not just structurally-realistic
// fixtures. Mirrors the convention in electron/lib/cliAdapters/copilot.e2e.test.cjs:
// probe CLI availability once in beforeAll, skip the whole suite (never fail it)
// if the CLI isn't present/usable, no fixed sleeps — every wait is driven by real
// subprocess events, bounded only by the test's own timeout.
const { describe, test, expect, beforeAll } = require('vitest');
const { execFileSync } = require('child_process');
const { runQcQaCheck } = require('./qcqa.cjs');
const claudeAdapter = require('./cliAdapters/claudeAdapter.cjs');

const CLI_TIMEOUT_MS = 60_000;

function isClaudeCliAvailable() {
  try {
    const useShell = process.platform === 'win32';
    execFileSync('claude', ['--version'], { stdio: 'ignore', shell: useShell });
    return true;
  } catch (_) {
    return false;
  }
}

function describeIfCli(name, body) {
  if (isClaudeCliAvailable()) {
    describe(name, body);
  } else {
    describe.skip(`${name} (SKIPPED — claude CLI not available)`, body);
  }
}

describeIfCli('runQcQaCheck — real claude CLI spawn', () => {
  beforeAll(() => {
    if (!isClaudeCliAvailable()) {
      throw new Error('claude CLI became unavailable between module load and beforeAll');
    }
  });

  test('resolves PASS from the real claude CLI\'s real stream-json output', async () => {
    const prompt = [
      'You are being tested by an automated harness. Respond with EXACTLY the',
      'following text and nothing else — no markdown, no explanation, no',
      'extra lines before or after it:',
      '',
      '[QC] VERDICT: PASS',
    ].join('\n');

    const result = await runQcQaCheck({
      spawnFn: claudeAdapter.spawn,
      buildArgs: claudeAdapter.buildLaunchArgs,
      parseLine: claudeAdapter.parseLine,
      promptViaStdin: true,
      prompt,
      projectPath: process.cwd(),
      model: 'haiku',
      stage: 'QC',
      timeoutMs: CLI_TIMEOUT_MS,
    });

    expect(result).toEqual({ verdict: 'PASS' });
  }, CLI_TIMEOUT_MS);
});
```

`model: 'haiku'` is used deliberately (a valid short model alias the `claude` CLI accepts directly, same alias style already exercised in `electron/lib/cliAdapters/cliAdapters.test.cjs`'s `buildLaunchArgs` tests) — it is the fastest/cheapest real model, appropriate for a deterministic smoke-test prompt like this one, keeping the e2e test's wall-clock and API cost low.

- [ ] **Step 2: Run the test to verify it passes on a machine with the `claude` CLI installed**

Run: `npx vitest run electron/lib/qcqa.e2e.test.cjs`
Expected: on a machine with a working `claude` CLI on PATH, the test PASSES, proving `runQcQaCheck({ ..., parseLine: claudeAdapter.parseLine })` correctly resolves `{ verdict: 'PASS' }` from real `claude -p ... --output-format stream-json --verbose` output — this is the fix's closing empirical proof. On a machine without the CLI, the suite reports as `SKIPPED`, never as a failure (verify by temporarily renaming/hiding `claude` from PATH if you want to confirm the skip path, then restore it — do not leave PATH altered).

- [ ] **Step 3: Commit**

```bash
git add electron/lib/qcqa.e2e.test.cjs
git commit -m "test: add real claude CLI e2e proof for QC/QA verdict parsing"
```

---

### Task 4: Update the tracking doc

**Files:**
- Modify: `docs/critical-issues-review-2026-08-08.md:19-23` (Issue #3 entry)

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing (documentation only).

- [ ] **Step 1: Mark Issue #3 as fixed**

In `docs/critical-issues-review-2026-08-08.md`, change:

```markdown
## 3. QC/QA verdict parsing likely never matches real output
- **Where:** `electron/lib/qcqa.cjs:99-105` (`parseQcQaVerdict`) vs. `claudeAdapter.buildLaunchArgs` (always appends `--output-format stream-json --verbose`)
- **Bug:** `parseQcQaVerdict` regex `^[QC] VERDICT: PASS$` is matched against raw concatenated stdout. In production, stdout is newline-delimited JSON, so the verdict line is embedded as an escaped string inside a JSON blob, never at the true start/end of a physical line — the anchors never match. Falls through to default `FAIL`. Unit tests don't catch this because they emit plain unwrapped text instead of a real stream-json envelope.
- **Effect:** QC/QA gating reports FAIL on essentially every real check, driving spurious retries/escalation regardless of actual agent output.
- [ ] Fixed
```

to:

```markdown
## 3. QC/QA verdict parsing likely never matches real output
- **Where:** `electron/lib/qcqa.cjs:99-105` (`parseQcQaVerdict`) vs. `claudeAdapter.buildLaunchArgs` (always appends `--output-format stream-json --verbose`)
- **Bug:** `parseQcQaVerdict` regex `^[QC] VERDICT: PASS$` is matched against raw concatenated stdout. In production, stdout is newline-delimited JSON, so the verdict line is embedded as an escaped string inside a JSON blob, never at the true start/end of a physical line — the anchors never match. Falls through to default `FAIL`. Unit tests don't catch this because they emit plain unwrapped text instead of a real stream-json envelope.
- **Effect:** QC/QA gating reports FAIL on essentially every real check, driving spurious retries/escalation regardless of actual agent output.
- **Fix (design doc `docs/superpowers/specs/2026-08-08-qcqa-verdict-parsing-design.md`, plan `docs/superpowers/plans/2026-08-08-qcqa-verdict-parsing.md`):** `runQcQaCheck` now extracts the agent's last real assistant text via the backend adapter's own `parseLine()` (already used elsewhere for the same purpose) before handing it to the unchanged `parseQcQaVerdict` regex. Wired into production via `mission.cjs::qcQaSpawnOpts()`. Verified with rewritten unit tests using real stream-json/Copilot fixtures plus a real end-to-end test spawning the actual `claude` CLI.
- [x] Fixed
```

- [ ] **Step 2: Commit**

```bash
git add docs/critical-issues-review-2026-08-08.md
git commit -m "docs: mark issue #3 QC/QA verdict parsing as fixed"
```

---

## Self-Review

- **Spec coverage:** Task 1 covers the spec's `qcqa.cjs` core fix + unit test rewrite section verbatim (helper function, `runQcQaCheck` wiring, all 3 rewritten scenarios plus the 2 new fixture scenarios the spec calls for). Task 2 covers the spec's `mission.cjs::qcQaSpawnOpts()` wiring section verbatim. Task 3 covers the spec's real end-to-end test section verbatim (same structure as `copilot.e2e.test.cjs`, same call shape `qcQaSpawnOpts()` builds in production, same deterministic-prompt/assert-PASS approach). Task 4 closes the loop on the tracking doc, matching the pattern already used for Issue #2.
- **Placeholder scan:** No TBD/TODO/"add appropriate handling" — every step has full, exact code. The one open design question flagged before this plan was written (whether `qcQaSpawnOpts()` needs its own test hook) is resolved in Task 2 Step 3: yes, a narrow `__qcQaSpawnOptsForTest` hook is added, following the file's existing `__setXForTest`/`__getXForTest` naming convention exactly.
- **Type consistency:** `runQcQaCheck`'s new `parseLine` option name and signature (`(line: string) => { kind, text? }`) is identical across Task 1 (definition), Task 2 (production wiring via `qcQaSpawnOpts()`), and Task 3 (e2e test's direct call) — no renaming drift. `extractLastAssistantText`'s two-argument signature is used identically everywhere it's referenced (Task 1 only; it's an internal, non-exported helper, so no other task calls it directly).
