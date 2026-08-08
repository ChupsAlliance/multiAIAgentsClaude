# QC/QA verdict parsing fix — design

**Tracked issue:** #3 in `docs/critical-issues-review-2026-08-08.md` — "QC/QA verdict parsing likely never matches real output"

## Problem

`runQcQaCheck` (`electron/lib/qcqa.cjs`) spawns a QC or QA verification subprocess with `--output-format stream-json --verbose` (both the adapter-based path via `buildLaunchArgs` and the legacy `spawnClaude` fallback always pass this flag). It accumulates the subprocess's raw stdout into a single string and passes that raw string straight into `parseQcQaVerdict`.

`--output-format stream-json` means stdout is JSONL: one JSON object per line, e.g.

```json
{"type":"assistant","message":{"content":[{"type":"text","text":"[QC] VERDICT: PASS"}]}}
```

`parseQcQaVerdict` matches with an anchored, per-line regex (`^\[${stage}\]\s*VERDICT:\s*PASS\s*$` with the `m` flag) that requires the ENTIRE physical line to be exactly `[QC] VERDICT: PASS` (optionally with surrounding whitespace). In real stream-json output, that text is always embedded inside a JSON object alongside other syntax (`{"type":...,"text":"..."}...}`), so the anchors never match the physical line as a whole. Every real QC/QA run therefore falls through to the default:

```js
{ verdict: 'FAIL', responsibleAgent: null, reason: 'No verdict line found in QC/QA output' }
```

...regardless of what the agent actually decided. This makes QC/QA gating report FAIL on essentially every real check, driving spurious retries/escalation.

The existing unit tests for `runQcQaCheck` in `electron/lib/qcqa.test.cjs` don't catch this because they feed plain unwrapped text (`'[QC] VERDICT: PASS\n'`) as the fake subprocess's stdout, instead of a real stream-json envelope — a false-green in the test itself, not just the production code.

## Root cause vs. fix boundary

The bug is NOT in `parseQcQaVerdict`'s regex — that regex correctly expects a bare `[QC] VERDICT: PASS` line, which is exactly what the QC/QA prompt templates (`electron/prompts/qc_check.md`, `qa_check.md`) instruct the agent to produce as the literal last lines of its plain-text answer. The bug is that `runQcQaCheck` hands `parseQcQaVerdict` the wrong input: raw JSONL instead of the agent's extracted plain-text answer.

This codebase already solves exactly this extraction problem twice, independently:
- `electron/ipc/mission.cjs::extractAssistantText(stdoutText)` — parses each JSONL line, keeps the LAST `assistant` message's text (Claude-specific shape).
- `electron/ipc/history.cjs::extractAssistantTextLocal(stdoutText)` — same pattern, also Claude-specific.

Both take "the last assistant text block" as the effective final answer, matching how a single-shot `-p` invocation works: the model may emit tool-use turns and intermediate text along the way, but the QC/QA prompt asks it to end with the verdict lines, so the last real text block is the one that matters.

Both CLI adapters (`electron/lib/cliAdapters/claudeAdapter.cjs`, `copilotAdapter.cjs`) already expose a `parseLine(rawLine)` function that normalizes one JSONL line into `{ kind: 'text'|'tool_use'|'result'|'system'|'error'|'none', text?, ... }`, backend-agnostically. `kind: 'tool_use'` is returned (not `'text'`) when an assistant message is a tool call, so tool-use turns never clobber the tracked "last text."

## Design

Extract the last assistant text via the adapter's own `parseLine`, backend-agnostically, before running the (unchanged) verdict regex.

### `electron/lib/qcqa.cjs`

Add a helper:

```js
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

`runQcQaCheck` accepts a new `parseLine` option. On `proc.on('close', ...)`, instead of:

```js
resolve(parseQcQaVerdict(stdoutText, stage));
```

do:

```js
const resolvedParseLine = parseLine || require('./cliAdapters/claudeAdapter.cjs').parseLine;
resolve(parseQcQaVerdict(extractLastAssistantText(stdoutText, resolvedParseLine), stage));
```

The lazy `require` fallback only fires on the legacy `spawnClaude` path (reachable only if adapter registry load itself throws — a defensive fallback that's effectively unreachable in normal operation, per `mission.cjs::resolveAdapter`). That path's argv is always Claude's own stream-json format, so `claudeAdapter.parseLine` is the correct default.

`parseQcQaVerdict` itself is unchanged — it already does the right thing once given the agent's real plain-text answer instead of raw JSONL.

### `electron/ipc/mission.cjs`

`qcQaSpawnOpts()` currently returns, for the adapter-based path:

```js
return {
  spawnFn: adapter.spawn.bind(adapter),
  buildArgs: adapter.buildLaunchArgs.bind(adapter),
  promptViaStdin: adapter.promptViaStdin !== false,
  backend: backendId,
};
```

Add `parseLine: adapter.parseLine.bind(adapter)` to this object. The legacy fallback branch (`return { spawnClaude, backend: backendId }`) is left as-is — `runQcQaCheck`'s own default (`claudeAdapter.parseLine`) covers it.

## Testing

### Unit tests (`electron/lib/qcqa.test.cjs`)

Rewrite the two existing `runQcQaCheck` PASS/FAIL tests to feed stdout shaped like real stream-json — `JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '[QC] VERDICT: PASS' }] } })` — with a real `claudeAdapter.parseLine` passed in, instead of bare text. This is the regression proof: reverting the fix (going back to feeding raw `stdoutText` into `parseQcQaVerdict`) must make these tests fail, the same way the current tests silently didn't.

Add:
- A Copilot-shaped fixture test (`assistant.message_delta` line followed by `assistant.message` line, both from `copilotAdapter.parseLine`), proving the extraction is backend-agnostic and that a full non-ephemeral message correctly supersedes its own preceding delta.
- A test with a `tool_use`-shaped assistant line preceding the final verdict text line, confirming the tool-use event does not clobber the tracked "last text."

The timeout test is unaffected (no stdout emitted → `extractLastAssistantText` returns `''` → same FAIL-default behavior as today).

`parseQcQaVerdict`'s own direct unit tests (lines 6-56 of the current test file) are unaffected — that boundary already receives plain text and stays that way.

### Real end-to-end test (new file: `electron/lib/qcqa.e2e.test.cjs`)

Mirrors the existing convention in `electron/lib/cliAdapters/copilot.e2e.test.cjs`:
- A `describeIfCli`-equivalent helper probes `claude --version` via `execFileSync` in a `beforeAll`; if the CLI isn't present/usable, the whole suite registers as `describe.skip(...)` (visible as skipped, never a failure) so this file is safe on machines/CI without the Claude CLI installed.
- No fixed sleeps — every wait is driven by real subprocess events (`data`, `close`), bounded only by the outer Vitest test-timeout ceiling.
- Calls `runQcQaCheck` directly (not just `claudeAdapter.spawn`) with `spawnFn: claudeAdapter.spawn`, `buildArgs: claudeAdapter.buildLaunchArgs`, `parseLine: claudeAdapter.parseLine`, `promptViaStdin: true` — i.e. the exact same shape `qcQaSpawnOpts()` builds in production — so the test proves the full integration path, not just the adapter in isolation.
- Prompt asks Claude to produce deterministic output: something equivalent to `qc_check.md`'s required format, phrased so the real CLI reliably ends its answer with `[QC] VERDICT: PASS` and nothing else that could confuse the regex.
- Asserts `runQcQaCheck(...)` resolves `{ verdict: 'PASS' }` against the real CLI's real stream-json output — this is the proof that closes the gap the false-green mocked tests left open.

## Global constraints

- `parseQcQaVerdict`'s regex and its own direct unit tests are not modified.
- No change to the QC/QA prompt templates (`qc_check.md`, `qa_check.md`) — the required output format they specify is already correct; only the extraction step was broken.
- No change to `nextEscalationTier` or the escalation/retry logic in `mission.cjs` that consumes `runQcQaCheck`'s result — this fix only changes what text gets fed to the verdict regex, not the shape of the returned `{ verdict, responsibleAgent, reason }` object.
- Follows the existing adapter interface (`electron/lib/cliAdapters/types.md`) — `parseLine` is already part of that documented interface; this design is wiring, not a new interface.
