# Cross-Phase Transient-API-Error Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all six `spawnClaude()` call sites in `electron/ipc/mission.cjs` automatically retry (with backoff) when a spawn fails due to a transient API error (rate limit / 5xx / overloaded / network reset), instead of marking the mission `Failed` on the first occurrence.

**Architecture:** Two new pure helpers — `isTransientApiError(text)` and `retryTransientSpawn(runFn, onRetry, maxAttempts, backoffMs)` — following the exact structural pattern of the existing `retryMockupGeneration()`. Because five of the six call sites (`launch_mission`, `deploy_mission`, `continue_mission`, `answer_question`, `restartLeadAfterMockup`) are fire-and-forget functions whose real success/failure signal arrives asynchronously — inside `watchProcessExit_launch`/`watchProcessExit_deploy`, long after the spawning function itself has returned — the retry decision has to live **inside those exit watchers**, which are exactly where `missionState.status = 'Failed'` is decided today. Each call site's "build args, spawn, wire up readers" logic is extracted into a small `attemptSpawn(attempt, resumeSessionId)` inner function; the exit watcher, on a failed exit, checks the accumulated stdout+stderr text via `isTransientApiError`, and if transient with attempts remaining, waits out the backoff and calls `attemptSpawn` again instead of finalizing `Failed`. The two readers (`readProcessStdout_launch`, `readProcessStdout_deploy`) and `readProcessStderr` gain a shared **attempt context** object (`{ getText(), sessionId }`) that accumulates text and exposes the locally-captured `session_id`, so the watcher can both classify the failure and decide whether to resume or spawn fresh. `replan_mission` (Group 3) is simpler — its whole self-contained `Promise` body becomes the `runFn` passed straight into `retryTransientSpawn`, since it already resolves/rejects cleanly per attempt.

**Tech Stack:** Node.js (CommonJS, `.cjs`), Vitest (`npm test` → `vitest run`) for unit tests of the two new pure helpers. No new npm dependencies.

## Global Constraints

- Detection regex (exact, do not alter): `/\b429\b|rate limit|Request rejected|overloaded|\b5\d\d\b|ECONNRESET|ETIMEDOUT|ECONNREFUSED.*api|network error/i`, applied to the **combined stdout+stderr text** accumulated during the failed attempt.
- Retry schedule: fixed at 3 total attempts, backoff `[30000, 60000, 120000]` ms between attempts 1→2, 2→3. Not configurable beyond the function parameters.
- Non-transient failures fail immediately on first occurrence — no backoff, no retry attempt, identical to today.
- Group 1 (`restartLeadAfterMockup`, `answer_question`) retries reuse the same `--resume <sessionId>` args unchanged.
- Group 2 (`launch_mission`, `deploy_mission`, `continue_mission`) retries: resume with a **locally-captured** `session_id` from the failed attempt's own `init` message if captured before failure; otherwise spawn fresh with the original args. This local capture is separate from and must not overwrite `missionState.session_id` until the sequence finally succeeds.
- Group 3 (`replan_mission`) retries by re-running the entire existing self-contained Promise body fresh each time (no resume), preserving its existing `proc.on('error')` and 120s per-attempt timeout.
- On each retry, log via the existing `makeLogEntry` + `missionState.log.push(entry)` + `sendToWindow('mission:log', entry)` pattern: `⚠ Gặp lỗi tạm thời (rate limit/API), đang thử lại lần {attempt}/{maxAttempts} sau {delay/1000}s...`
- After exhausting all attempts, behavior is unchanged from today (same `mission:status`/`Failed` path) plus one additional log line: `Đã thử lại {maxAttempts} lần nhưng vẫn gặp lỗi rate limit — dừng mission.`
- No manual retry button, no unbounded backoff, no new IPC channels, no renderer/UI changes.
- `spawnClaude()`, `retryMockupGeneration()`/`spawnMockupGenerator()`, and the `isConnErr`/`isTooLarge` classification in `readProcessStdout_launch`'s `result` case are untouched.
- Single file for production code: `electron/ipc/mission.cjs`. New test file: `electron/ipc/mission.retryTransientSpawn.test.js`.

---

### Task 1: `isTransientApiError` and `retryTransientSpawn` pure helpers

**Files:**
- Modify: `electron/ipc/mission.cjs` (add both functions immediately after `retryMockupGeneration`, currently ending around line 874; add named exports at the bottom of the file, alongside the existing `module.exports.retryMockupGeneration = retryMockupGeneration;` line ~3359)
- Create: `electron/ipc/mission.retryTransientSpawn.test.js`

**Interfaces:**
- Produces:
  - `function isTransientApiError(text)` → `boolean`. Exported as `module.exports.isTransientApiError`.
  - `async function retryTransientSpawn(runFn, onRetry, maxAttempts = 3, backoffMs = [30000, 60000, 120000])` → `Promise<any>`, resolving with whatever `runFn(attempt)` resolves with, or rejecting with the final attempt's error. Exported as `module.exports.retryTransientSpawn`.
    - `runFn: (attempt: number) => Promise<any>` — performs one attempt; `attempt` is 1-based.
    - `onRetry: (attempt: number, maxAttempts: number, err: Error, delay: number) => void` — called before waiting out the backoff, once per retried (non-final, transient) failure.
- Consumes: nothing from other tasks (first task).

- [ ] **Step 1: Write the failing test file**

Create `electron/ipc/mission.retryTransientSpawn.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isTransientApiError, retryTransientSpawn } from './mission.cjs'

describe('isTransientApiError', () => {
  it('matches a 429 rate-limit message', () => {
    expect(isTransientApiError('API Error: Request rejected (429) · rate limit exceeded')).toBe(true)
  })

  it('matches a bare "rate limit" phrase', () => {
    expect(isTransientApiError('This request would exceed your account\'s rate limit.')).toBe(true)
  })

  it('matches "overloaded"', () => {
    expect(isTransientApiError('The server is currently overloaded, please retry.')).toBe(true)
  })

  it('matches a 5xx status code', () => {
    expect(isTransientApiError('Upstream error: 503 Service Unavailable')).toBe(true)
  })

  it('matches ECONNRESET', () => {
    expect(isTransientApiError('Error: connect ECONNRESET')).toBe(true)
  })

  it('matches ETIMEDOUT', () => {
    expect(isTransientApiError('Error: ETIMEDOUT while calling api.anthropic.com')).toBe(true)
  })

  it('matches "network error"', () => {
    expect(isTransientApiError('Fetch failed: network error')).toBe(true)
  })

  it('does not match an unrelated parse error', () => {
    expect(isTransientApiError('SyntaxError: Unexpected token in JSON at position 4')).toBe(false)
  })

  it('does not match a permission/auth error', () => {
    expect(isTransientApiError('Error: invalid API key provided')).toBe(false)
  })

  it('returns false for empty/undefined text', () => {
    expect(isTransientApiError('')).toBe(false)
    expect(isTransientApiError(undefined)).toBe(false)
  })
})

describe('retryTransientSpawn', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves immediately when the first attempt succeeds', async () => {
    const runFn = vi.fn().mockResolvedValue('ok')
    const onRetry = vi.fn()

    const result = await retryTransientSpawn(runFn, onRetry, 3)

    expect(result).toBe('ok')
    expect(runFn).toHaveBeenCalledTimes(1)
    expect(runFn).toHaveBeenCalledWith(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('retries a transient error and resolves on the second attempt', async () => {
    const runFn = vi.fn()
      .mockRejectedValueOnce(new Error('API Error: Request rejected (429)'))
      .mockResolvedValueOnce('ok on retry')
    const onRetry = vi.fn()

    const promise = retryTransientSpawn(runFn, onRetry, 3, [30000, 60000, 120000])
    await vi.advanceTimersByTimeAsync(30000)
    const result = await promise

    expect(result).toBe('ok on retry')
    expect(runFn).toHaveBeenCalledTimes(2)
    expect(runFn).toHaveBeenNthCalledWith(2, 2)
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith(1, 3, expect.any(Error), 30000)
  })

  it('uses the correct backoff delay for each retry', async () => {
    const runFn = vi.fn()
      .mockRejectedValueOnce(new Error('429 rate limit'))
      .mockRejectedValueOnce(new Error('503 overloaded'))
      .mockResolvedValueOnce('ok on third')
    const onRetry = vi.fn()

    const promise = retryTransientSpawn(runFn, onRetry, 3, [30000, 60000, 120000])
    await vi.advanceTimersByTimeAsync(30000)
    await vi.advanceTimersByTimeAsync(60000)
    const result = await promise

    expect(result).toBe('ok on third')
    expect(runFn).toHaveBeenCalledTimes(3)
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, 3, expect.any(Error), 30000)
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, 3, expect.any(Error), 60000)
  })

  it('throws immediately on a non-transient error without retrying', async () => {
    const err = new Error('SyntaxError: Unexpected token')
    const runFn = vi.fn().mockRejectedValue(err)
    const onRetry = vi.fn()

    await expect(retryTransientSpawn(runFn, onRetry, 3)).rejects.toThrow('Unexpected token')
    expect(runFn).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('throws the final error after exhausting all attempts on a transient error', async () => {
    const finalErr = new Error('429 rate limit — final')
    const runFn = vi.fn()
      .mockRejectedValueOnce(new Error('429 rate limit — 1'))
      .mockRejectedValueOnce(new Error('429 rate limit — 2'))
      .mockRejectedValueOnce(finalErr)
    const onRetry = vi.fn()

    const promise = retryTransientSpawn(runFn, onRetry, 3, [30000, 60000, 120000])
    const assertion = expect(promise).rejects.toThrow('429 rate limit — final')
    await vi.advanceTimersByTimeAsync(30000)
    await vi.advanceTimersByTimeAsync(60000)
    await assertion

    expect(runFn).toHaveBeenCalledTimes(3)
    expect(onRetry).toHaveBeenCalledTimes(2)
  })

  it('falls back to the last backoffMs entry when maxAttempts exceeds the schedule length', async () => {
    const runFn = vi.fn()
      .mockRejectedValueOnce(new Error('429'))
      .mockRejectedValueOnce(new Error('429'))
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValueOnce('ok on fourth')
    const onRetry = vi.fn()

    const promise = retryTransientSpawn(runFn, onRetry, 4, [30000, 60000, 120000])
    await vi.advanceTimersByTimeAsync(30000)
    await vi.advanceTimersByTimeAsync(60000)
    await vi.advanceTimersByTimeAsync(120000)
    const result = await promise

    expect(result).toBe('ok on fourth')
    expect(onRetry).toHaveBeenNthCalledWith(3, 3, 4, expect.any(Error), 120000)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run electron/ipc/mission.retryTransientSpawn.test.js
```

Expected: FAIL — `isTransientApiError` and `retryTransientSpawn` are not exported from `./mission.cjs` yet.

- [ ] **Step 3: Locate the exact insertion point**

```bash
grep -n "^async function retryMockupGeneration" electron/ipc/mission.cjs
```

Read 20 lines from that line number with the Read tool to confirm the function's closing `}` and the blank line before the next function (`spawnMockupGenerator`).

- [ ] **Step 4: Implement both functions**

Using the Edit tool, insert the following immediately after `retryMockupGeneration`'s closing `}` and before the `spawnMockupGenerator` comment block:

```js
// ─────────────────────────────────────────────────────────────────
// isTransientApiError — classifies accumulated stdout/stderr text from
// a failed spawn attempt as a transient (retry-worthy) API error.
// ─────────────────────────────────────────────────────────────────
function isTransientApiError(text) {
  return /\b429\b|rate limit|Request rejected|overloaded|\b5\d\d\b|ECONNRESET|ETIMEDOUT|ECONNREFUSED.*api|network error/i.test(text || '');
}

// ─────────────────────────────────────────────────────────────────
// retryTransientSpawn — runs runFn(attempt) up to maxAttempts times.
// Only retries when the rejection's .message matches isTransientApiError;
// non-transient errors reject immediately on first occurrence. Calls
// onRetry(attempt, maxAttempts, err, delay) before waiting out the
// backoff for each retried attempt.
// ─────────────────────────────────────────────────────────────────
async function retryTransientSpawn(runFn, onRetry, maxAttempts = 3, backoffMs = [30000, 60000, 120000]) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await runFn(attempt);
    } catch (err) {
      lastErr = err;
      const transient = isTransientApiError(err && err.message);
      if (!transient || attempt === maxAttempts) throw err;
      const delay = backoffMs[attempt - 1] ?? backoffMs[backoffMs.length - 1];
      onRetry(attempt, maxAttempts, err, delay);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
```

- [ ] **Step 5: Add named exports**

Using the Edit tool, change:

```js
module.exports.retryMockupGeneration = retryMockupGeneration;
```

to:

```js
module.exports.retryMockupGeneration = retryMockupGeneration;
module.exports.isTransientApiError = isTransientApiError;
module.exports.retryTransientSpawn = retryTransientSpawn;
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npx vitest run electron/ipc/mission.retryTransientSpawn.test.js
```

Expected: PASS — all 17 tests green.

- [ ] **Step 7: Commit**

```bash
git add electron/ipc/mission.cjs electron/ipc/mission.retryTransientSpawn.test.js
git commit -m "feat: add isTransientApiError and retryTransientSpawn helpers"
```

---

### Task 2: Attempt-context plumbing in the shared readers (`readProcessStderr`, `readProcessStdout_launch`, `readProcessStdout_deploy`)

**Files:**
- Modify: `electron/ipc/mission.cjs`:
  - `readProcessStderr(proc, sendToWindow)` at line 1585
  - `readProcessStdout_launch(proc, missionId, sendToWindow)` at line 1286
  - `readProcessStdout_deploy(proc, sendToWindow, isContMode)` at line 1715

**Interfaces:**
- Consumes: nothing from Task 1 directly (this task only prepares data that Task 3/4 will consume).
- Produces (new 4th parameter on all three functions — a plain mutable object, created fresh by the caller for every spawn attempt):
  ```js
  // Shape of the `attemptCtx` object each call site creates per attempt:
  // {
  //   stderrText: '',   // appended to by readProcessStderr
  //   stdoutText: '',   // appended to by the stdout reader (raw JSON-parsed text + raw non-JSON lines)
  //   sessionId: null,  // set by the stdout reader as soon as `init`/session_id arrives
  // }
  ```
  - New signatures:
    - `function readProcessStderr(proc, sendToWindow, attemptCtx)`
    - `function readProcessStdout_launch(proc, missionId, sendToWindow, attemptCtx)`
    - `function readProcessStdout_deploy(proc, sendToWindow, isContMode, attemptCtx)`
  - `attemptCtx` is optional (defaults to `{}` internally) so any call site not yet updated in this task still works — Task 3/4 will be the ones that actually create and pass a real `attemptCtx` per attempt.

- [ ] **Step 1: Modify `readProcessStderr` to accept and populate `attemptCtx`**

Read the current function (`electron/ipc/mission.cjs:1585-1598`) to confirm exact text, then use Edit to replace:

```js
function readProcessStderr(proc, sendToWindow) {
  const rl = readline.createInterface({ input: proc.stderr, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const clean = stripAnsi(line).trim();
    if (!clean) return;
    const ts    = now();
    const entry = makeLogEntry(ts, 'System', clean, 'error');
    if (missionState) {
      missionState.log.push(entry);
      missionState.raw_output.push(`[stderr] ${clean}`);
    }
    sendToWindow('mission:log', entry);
  });
}
```

with:

```js
function readProcessStderr(proc, sendToWindow, attemptCtx = {}) {
  const rl = readline.createInterface({ input: proc.stderr, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const clean = stripAnsi(line).trim();
    if (!clean) return;
    if (attemptCtx) attemptCtx.stderrText = (attemptCtx.stderrText || '') + clean + '\n';
    const ts    = now();
    const entry = makeLogEntry(ts, 'System', clean, 'error');
    if (missionState) {
      missionState.log.push(entry);
      missionState.raw_output.push(`[stderr] ${clean}`);
    }
    sendToWindow('mission:log', entry);
  });
}
```

- [ ] **Step 2: Modify `readProcessStdout_launch` to accept `attemptCtx` and populate it**

Read `electron/ipc/mission.cjs:1286-1330` (the function signature, local state, and the existing `capturedSessionId` backup-capture site) and `electron/ipc/mission.cjs:1465-1472` (the primary `init`-message capture site) to confirm exact text.

Using Edit, change the function signature:

```js
function readProcessStdout_launch(proc, missionId, sendToWindow) {
```

to:

```js
function readProcessStdout_launch(proc, missionId, sendToWindow, attemptCtx = {}) {
```

Using Edit, at the primary session-id capture site (the `subtype === 'init'` branch, `mission.cjs:~1465-1470`), which currently reads:

```js
            if (!capturedSessionId && json.session_id) {
              capturedSessionId = json.session_id;
              if (missionState) missionState.session_id = json.session_id;
            }
```

replace with:

```js
            if (!capturedSessionId && json.session_id) {
              capturedSessionId = json.session_id;
              if (missionState) missionState.session_id = json.session_id;
              if (attemptCtx) attemptCtx.sessionId = json.session_id;
            }
```

(Read the surrounding 10 lines first to confirm this is the `system`/`init` branch and not the backup-capture branch — there are two capture sites in this function per the spec; apply the same two-line addition — `if (attemptCtx) attemptCtx.sessionId = json.session_id;` — to BOTH the primary `init`-subtype capture and the backup `assistant`-message capture at `mission.cjs:~1321-1325`, which currently reads:

```js
          if (!capturedSessionId && json.session_id) {
            capturedSessionId = json.session_id;
            if (missionState) missionState.session_id = json.session_id;
          }
```

replace with:

```js
          if (!capturedSessionId && json.session_id) {
            capturedSessionId = json.session_id;
            if (missionState) missionState.session_id = json.session_id;
            if (attemptCtx) attemptCtx.sessionId = json.session_id;
          }
```

).

Using Edit, in the `result` case's `Planning`-phase branch (`mission.cjs:~1505-1521`, where `resultText`/`fullTextBuf` is built), find the line that appends the result text to `fullTextBuf`:

```js
            fullTextBuf += resultText;
```

(Read the surrounding lines first — if the exact variable name differs from `resultText`/`fullTextBuf`, use the actual names found in the file.) Immediately after that line, add:

```js
            if (attemptCtx) attemptCtx.stdoutText = (attemptCtx.stdoutText || '') + resultText;
```

Also, in the `system` case's non-`init` subtypes (where raw error/message text is logged, `mission.cjs:~1471-1481`), read that branch first with the Read tool to get its exact current text. If the branch computes a local text variable before calling `makeLogEntry(ts, sourceAgent, <var>, ...)`, add this line immediately after that variable's declaration, using the exact variable name found in the file in place of `text`:

```js
if (attemptCtx) attemptCtx.stdoutText = (attemptCtx.stdoutText || '') + text + '\n';
```

If no such per-subtype branch exists distinct from the `default` branch already handled below, skip this addition — the `default` branch's accumulation (added later in this step) already covers it.

- [ ] **Step 3: Modify `readProcessStdout_deploy` the same way**

Read `electron/ipc/mission.cjs:1715-1730` (signature + local state) and the two session-id capture sites at `~1761-1764` (`init` subtype) and `~1851-1854` (backup, `assistant` case) to confirm exact text.

Using Edit, change the signature:

```js
function readProcessStdout_deploy(proc, sendToWindow, isContMode) {
```

to:

```js
function readProcessStdout_deploy(proc, sendToWindow, isContMode, attemptCtx = {}) {
```

Using Edit, at the `init`-subtype capture site (currently):

```js
            case 'init':
              // Capture session_id for resume-based question protocol
              if (json.session_id && missionState) {
                capturedSessionId = json.session_id;
                missionState.session_id = json.session_id;
              }
              break; // skip
```

replace with:

```js
            case 'init':
              // Capture session_id for resume-based question protocol
              if (json.session_id && missionState) {
                capturedSessionId = json.session_id;
                missionState.session_id = json.session_id;
              }
              if (json.session_id && attemptCtx) attemptCtx.sessionId = json.session_id;
              break; // skip
```

Using Edit, at the backup `assistant`-case capture site (currently):

```js
          // Capture session_id from assistant messages as backup
          if (!capturedSessionId && json.session_id) {
            capturedSessionId = json.session_id;
            if (missionState) missionState.session_id = json.session_id;
          }
```

replace with:

```js
          // Capture session_id from assistant messages as backup
          if (!capturedSessionId && json.session_id) {
            capturedSessionId = json.session_id;
            if (missionState) missionState.session_id = json.session_id;
          }
          if (!attemptCtx.sessionId && json.session_id) attemptCtx.sessionId = json.session_id;
```

Using Edit, in the `result` case (`mission.cjs:~2082-2135`), at the top where `text`/`display` are computed:

```js
        case 'result': {
          const text = json.result ||
            (Array.isArray(json.content)
              ? ((json.content.find(c => c.text) || {}).text || 'Completed')
              : 'Completed');
          const display = text.length > 500 ? text.slice(0, 500) + '...' : text;
```

add immediately after:

```js
          if (attemptCtx) attemptCtx.stdoutText = (attemptCtx.stdoutText || '') + text;
```

Also in the `system` case's `default` subtype branch (`mission.cjs:~1833-1842`, where non-task-protocol system messages are logged):

```js
            default: {
              const text  = (json.message || clean).toString();
              const entry = makeLogEntry(ts, sourceAgent, text, 'info');
```

add right after the `const text = ...` line:

```js
              if (attemptCtx) attemptCtx.stdoutText = (attemptCtx.stdoutText || '') + text + '\n';
```

- [ ] **Step 4: Verify no syntax errors**

```bash
node --check electron/ipc/mission.cjs
```

Expected: no output, exit code 0.

- [ ] **Step 5: Run the full existing test suite to check for regressions**

```bash
npm test
```

Expected: all existing tests pass (Task 1's new tests plus the pre-existing `mission.retryMockupGeneration.test.js` suite); no behavior change yet since no call site passes a real `attemptCtx` in this task, so `attemptCtx` defaults to `{}` everywhere and is inert.

- [ ] **Step 6: Commit**

```bash
git add electron/ipc/mission.cjs
git commit -m "feat: add attemptCtx plumbing to shared readers for retry text/session capture"
```

---

### Task 3: Group 1 retry — `restartLeadAfterMockup` and `answer_question`

**Files:**
- Modify: `electron/ipc/mission.cjs`:
  - `restartLeadAfterMockup(missionId, injection, sendToWindow)` at line 968
  - `answer_question` IPC handler at line 2810

**Interfaces:**
- Consumes: `retryTransientSpawn(runFn, onRetry, maxAttempts, backoffMs)` and `isTransientApiError(text)` from Task 1; the `attemptCtx` 4th-parameter contract on `readProcessStdout_launch`/`readProcessStdout_deploy`/`readProcessStderr` from Task 2.
- Produces: nothing new consumed by later tasks (Group 2/3 follow the same pattern independently).

Both sites already resume via `--resume <sessionId>` using `missionState.session_id`, which is guaranteed populated before either ever spawns. Retry here is the simplest case: re-invoke the exact same spawn args; classify failure via the exit watcher.

- [ ] **Step 1: Read `restartLeadAfterMockup`'s current full body to confirm exact text**

```bash
grep -n "^function restartLeadAfterMockup" electron/ipc/mission.cjs
```

Read 45 lines from that line number with the Read tool.

- [ ] **Step 2: Rewrite `restartLeadAfterMockup` to retry on transient exit**

Replace the entire function body (currently `electron/ipc/mission.cjs:968-1010`, confirmed as):

```js
function restartLeadAfterMockup(missionId, injection, sendToWindow) {
  if (!missionState || !missionState.session_id) return;
  killChild();
  const sessionId   = missionState.session_id;
  const leadModel   = missionState.agents.find(a => a.name === 'Lead')?.model || 'sonnet';
  const projectPath = missionState.project_path;
  const execMode    = missionState.execution_mode || 'standard';
  const proc = spawnClaude(
    ['-p', '--resume', sessionId, '--dangerously-skip-permissions',
     '--model', leadModel,
     '--output-format', 'stream-json', '--verbose', '--max-turns', '200'],
    projectPath,
    execMode === 'agent_teams'
  );
  childProcess = proc;
  try {
    proc.stdin.write(injection, 'utf8');
    proc.stdin.end();
  } catch (e) {
    const entry = makeLogEntry(now(), 'System', `Failed to resume after mockup: ${e.message}`, 'error');
    if (missionState) missionState.log.push(entry);
    sendToWindow('mission:log', entry);
    killChild();
    return;
  }
  if (missionState) missionState.status = 'Running';
  startAutosave();
  startStuckChecker(sendToWindow, false);
  sendToWindow('mission:status', { status: 'running', phase: missionState?.phase || 'Planning' });
  readProcessStdout_launch(proc, missionId, sendToWindow);
  readProcessStderr(proc, sendToWindow);
  watchProcessExit_launch(proc, missionId, sendToWindow);
}
```

with:

```js
function restartLeadAfterMockup(missionId, injection, sendToWindow, attempt = 1) {
  if (!missionState || !missionState.session_id) return;
  killChild();
  const sessionId   = missionState.session_id;
  const leadModel   = missionState.agents.find(a => a.name === 'Lead')?.model || 'sonnet';
  const projectPath = missionState.project_path;
  const execMode    = missionState.execution_mode || 'standard';
  const proc = spawnClaude(
    ['-p', '--resume', sessionId, '--dangerously-skip-permissions',
     '--model', leadModel,
     '--output-format', 'stream-json', '--verbose', '--max-turns', '200'],
    projectPath,
    execMode === 'agent_teams'
  );
  childProcess = proc;
  try {
    proc.stdin.write(injection, 'utf8');
    proc.stdin.end();
  } catch (e) {
    const entry = makeLogEntry(now(), 'System', `Failed to resume after mockup: ${e.message}`, 'error');
    if (missionState) missionState.log.push(entry);
    sendToWindow('mission:log', entry);
    killChild();
    return;
  }
  if (missionState) missionState.status = 'Running';
  startAutosave();
  startStuckChecker(sendToWindow, false);
  sendToWindow('mission:status', { status: 'running', phase: missionState?.phase || 'Planning' });
  const attemptCtx = { stdoutText: '', stderrText: '', sessionId: null };
  readProcessStdout_launch(proc, missionId, sendToWindow, attemptCtx);
  readProcessStderr(proc, sendToWindow, attemptCtx);
  watchProcessExit_launch(proc, missionId, sendToWindow, {
    attemptCtx,
    attempt,
    maxAttempts: 3,
    backoffMs: [30000, 60000, 120000],
    retrySpawn: (nextAttempt) => restartLeadAfterMockup(missionId, injection, sendToWindow, nextAttempt),
  });
}
```

- [ ] **Step 3: Add retry handling inside `watchProcessExit_launch`**

Read the full current body of `watchProcessExit_launch` (`electron/ipc/mission.cjs:1603-1673`) to confirm exact text.

Using Edit, change the signature:

```js
function watchProcessExit_launch(proc, missionId, sendToWindow) {
```

to:

```js
function watchProcessExit_launch(proc, missionId, sendToWindow, retryInfo = null) {
```

Using Edit, replace the failure-classification line and everything through the final `sendToWindow('mission:status', ...)` call:

```js
    const finalStatus = (code === 0 || code === null) ? 'Completed' : 'Failed';
    const ts = now();

    stopAutosave();
    stopStuckChecker();
    if (missionState) {
      missionState.status = finalStatus;
      for (const a of missionState.agents) {
        if (a.status === 'Working' || a.status === 'Idle' || a.status === 'Spawning') {
          a.status       = finalStatus === 'Completed' ? 'Done' : 'Error';
          a.current_task = null;
        }
      }
    }

    const statusStr = finalStatus === 'Completed' ? 'completed' : 'failed';

    // Auto-save
    if (missionState) {
      missionState.ended_at = ts;  // Persist ended_at in snapshot too
      const entry = {
        id: missionState.id,
        description: missionState.description,
        project_path: missionState.project_path,
        execution_mode: missionState.execution_mode || 'standard',
        team_size: missionState.team_size,
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
    }

    sendToWindow('mission:status', { mission_id: missionId, status: statusStr });
```

with:

```js
    const finalStatus = (code === 0 || code === null) ? 'Completed' : 'Failed';
    const ts = now();

    if (finalStatus === 'Failed' && retryInfo) {
      const { attemptCtx, attempt, maxAttempts, backoffMs, retrySpawn } = retryInfo;
      const combinedText = (attemptCtx.stdoutText || '') + '\n' + (attemptCtx.stderrText || '');
      if (attempt < maxAttempts && isTransientApiError(combinedText)) {
        const delay = backoffMs[attempt - 1] ?? backoffMs[backoffMs.length - 1];
        const entry = makeLogEntry(ts, 'System',
          `⚠ Gặp lỗi tạm thời (rate limit/API), đang thử lại lần ${attempt}/${maxAttempts} sau ${delay / 1000}s...`, 'info');
        if (missionState) missionState.log.push(entry);
        sendToWindow('mission:log', entry);
        setTimeout(() => retrySpawn(attempt + 1), delay);
        return;
      }
      if (attempt >= maxAttempts && isTransientApiError(combinedText)) {
        const entry = makeLogEntry(ts, 'System',
          `Đã thử lại ${maxAttempts} lần nhưng vẫn gặp lỗi rate limit — dừng mission.`, 'error');
        if (missionState) missionState.log.push(entry);
        sendToWindow('mission:log', entry);
      }
    }

    stopAutosave();
    stopStuckChecker();
    if (missionState) {
      missionState.status = finalStatus;
      for (const a of missionState.agents) {
        if (a.status === 'Working' || a.status === 'Idle' || a.status === 'Spawning') {
          a.status       = finalStatus === 'Completed' ? 'Done' : 'Error';
          a.current_task = null;
        }
      }
    }

    const statusStr = finalStatus === 'Completed' ? 'completed' : 'failed';

    // Auto-save
    if (missionState) {
      missionState.ended_at = ts;  // Persist ended_at in snapshot too
      const entry = {
        id: missionState.id,
        description: missionState.description,
        project_path: missionState.project_path,
        execution_mode: missionState.execution_mode || 'standard',
        team_size: missionState.team_size,
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
    }

    sendToWindow('mission:status', { mission_id: missionId, status: statusStr });
```

Note: the early-return branches above this block (`ReviewPlan`, `WaitingForAnswer`, `WaitingForMockup`) are untouched — retry only applies to the actual `Failed` path, exactly as scoped.

- [ ] **Step 4: Update `answer_question` to wire an `attemptCtx` and pass `retryInfo`**

Read the full current body of the `answer_question` handler (`electron/ipc/mission.cjs:2810-2904`) to confirm exact text.

Using Edit, replace the spawn + reader-wiring block:

```js
    const proc = spawnClaude(
      ['-p', '--resume', sessionId, '--dangerously-skip-permissions',
       '--model', leadModel,
       '--output-format', 'stream-json', '--verbose', '--max-turns', '200'],
      projectPath,
      execMode === 'agent_teams'
    );

    try {
      proc.stdin.write(answerPrompt, 'utf8');
      proc.stdin.end();
    } catch (e) {
      return `Failed to write answer prompt: ${e.message}`;
    }

    childProcess = proc;
    missionState.status = 'Running';
    startAutosave();
    startStuckChecker(sendToWindow, false);  // resume after Q&A — preserve silence clocks

    // Wire up readers — use launch reader for planning phase, deploy reader for execution
    const isPlanning = missionState.phase === 'Planning';
    if (isPlanning) {
      readProcessStdout_launch(proc, missionState.id, sendToWindow);
      readProcessStderr(proc, sendToWindow);
      watchProcessExit_launch(proc, missionState.id, sendToWindow);
    } else {
      readProcessStdout_deploy(proc, sendToWindow, false);
      readProcessStderr(proc, sendToWindow);
      watchProcessExit_deploy(proc, missionState.id, sendToWindow);
      // Agent Teams: restart file watcher so inter-agent messages are detected
      // after resuming from a Q&A pause (previous watcher may have stopped when
      // the prior process exited after <<<QUESTIONS_END>>>).
      if (execMode === 'agent_teams' && projectPath) {
        startFileWatcher(projectPath, sendToWindow);
      }
    }
```

with:

```js
    const spawnAnswerAttempt = (attempt) => {
      killChild();
      const proc = spawnClaude(
        ['-p', '--resume', sessionId, '--dangerously-skip-permissions',
         '--model', leadModel,
         '--output-format', 'stream-json', '--verbose', '--max-turns', '200'],
        projectPath,
        execMode === 'agent_teams'
      );

      try {
        proc.stdin.write(answerPrompt, 'utf8');
        proc.stdin.end();
      } catch (e) {
        const entry = makeLogEntry(now(), 'System', `Failed to write answer prompt: ${e.message}`, 'error');
        if (missionState) missionState.log.push(entry);
        sendToWindow('mission:log', entry);
        return;
      }

      childProcess = proc;
      if (missionState) missionState.status = 'Running';
      startAutosave();
      startStuckChecker(sendToWindow, false);  // resume after Q&A — preserve silence clocks

      const attemptCtx = { stdoutText: '', stderrText: '', sessionId: null };
      const retryInfo = {
        attemptCtx, attempt, maxAttempts: 3, backoffMs: [30000, 60000, 120000],
        retrySpawn: (nextAttempt) => spawnAnswerAttempt(nextAttempt),
      };

      // Wire up readers — use launch reader for planning phase, deploy reader for execution
      const isPlanning = missionState.phase === 'Planning';
      if (isPlanning) {
        readProcessStdout_launch(proc, missionState.id, sendToWindow, attemptCtx);
        readProcessStderr(proc, sendToWindow, attemptCtx);
        watchProcessExit_launch(proc, missionState.id, sendToWindow, retryInfo);
      } else {
        readProcessStdout_deploy(proc, sendToWindow, false, attemptCtx);
        readProcessStderr(proc, sendToWindow, attemptCtx);
        watchProcessExit_deploy(proc, missionState.id, sendToWindow, retryInfo);
        // Agent Teams: restart file watcher so inter-agent messages are detected
        // after resuming from a Q&A pause (previous watcher may have stopped when
        // the prior process exited after <<<QUESTIONS_END>>>).
        if (execMode === 'agent_teams' && projectPath) {
          startFileWatcher(projectPath, sendToWindow);
        }
      }
    };

    spawnAnswerAttempt(1);
```

(This task does not yet add `retryInfo` support to `watchProcessExit_deploy` — that lands in Task 4. Since `answer_question` can dispatch to either watcher depending on `missionState.phase`, Task 4 must land before this change is fully functional for the non-planning branch; sequence Task 4 immediately after this task and do not ship Task 3 alone to production.)

- [ ] **Step 5: Verify no syntax errors**

```bash
node --check electron/ipc/mission.cjs
```

Expected: no output, exit code 0.

- [ ] **Step 6: Run the full test suite**

```bash
npm test
```

Expected: all existing tests pass; no new automated tests are added in this task (the retry-decision logic embedded in `watchProcessExit_launch` is exercised via the pure `isTransientApiError`/`retryTransientSpawn` unit tests from Task 1 — end-to-end process-spawn retry behavior is covered by the Manual Verification section at the end of this plan, consistent with how `mission.retryMockupGeneration.test.js` scoped its own automated coverage).

- [ ] **Step 7: Commit**

```bash
git add electron/ipc/mission.cjs
git commit -m "feat: retry restartLeadAfterMockup and answer_question on transient API errors"
```

---

### Task 4: Group 2 retry — `launch_mission`, `deploy_mission`, `continue_mission`, and `watchProcessExit_deploy`

**Files:**
- Modify: `electron/ipc/mission.cjs`:
  - `watchProcessExit_deploy(proc, missionId, sendToWindow)` at line 2189
  - `launch_mission` IPC handler at line 2331
  - `deploy_mission` IPC handler at line 2450
  - `continue_mission` IPC handler at line 2643

**Interfaces:**
- Consumes: `retryTransientSpawn`/`isTransientApiError` from Task 1; `attemptCtx` 4th-parameter contract from Task 2; the `retryInfo` object shape established in Task 3 (`{ attemptCtx, attempt, maxAttempts, backoffMs, retrySpawn }`), reused identically here.
- Produces: `watchProcessExit_deploy(proc, missionId, sendToWindow, retryInfo = null)` — completes the 4-argument contract Task 3's `answer_question` update depends on for its non-planning branch.

These three sites are "fresh session by design" — they do not pass `--resume` on the *first* attempt. On retry: if `attemptCtx.sessionId` was captured before the failure, resume with it; otherwise spawn fresh with the original args.

- [ ] **Step 1: Add retry handling inside `watchProcessExit_deploy`**

Read the full current body (`electron/ipc/mission.cjs:2189-2251`) to confirm exact text.

Using Edit, change the signature:

```js
function watchProcessExit_deploy(proc, missionId, sendToWindow) {
```

to:

```js
function watchProcessExit_deploy(proc, missionId, sendToWindow, retryInfo = null) {
```

Using Edit, replace the block starting at `stopWatcher();` (right after the `WaitingForAnswer` early return) through `if (missionState.status === 'Running') { ... }`:

```js
    stopWatcher();
    stopAutosave();
    stopStuckChecker();
    clearAgentTeamsTimer();
    if (missionState.status === 'Running') {
      missionState.status = code === 0 || code === null ? 'Completed' : 'Failed';
    }
    missionState.phase = 'Done';
```

with:

```js
    if (missionState.status === 'Running' && code !== 0 && code !== null && retryInfo) {
      const { attemptCtx, attempt, maxAttempts, backoffMs, retrySpawn } = retryInfo;
      const combinedText = (attemptCtx.stdoutText || '') + '\n' + (attemptCtx.stderrText || '');
      if (attempt < maxAttempts && isTransientApiError(combinedText)) {
        const delay = backoffMs[attempt - 1] ?? backoffMs[backoffMs.length - 1];
        const entry = makeLogEntry(ts, 'System',
          `⚠ Gặp lỗi tạm thời (rate limit/API), đang thử lại lần ${attempt}/${maxAttempts} sau ${delay / 1000}s...`, 'info');
        missionState.log.push(entry);
        sendToWindow('mission:log', entry);
        setTimeout(() => retrySpawn(attempt + 1, attemptCtx.sessionId || null), delay);
        return;
      }
      if (attempt >= maxAttempts && isTransientApiError(combinedText)) {
        const entry = makeLogEntry(ts, 'System',
          `Đã thử lại ${maxAttempts} lần nhưng vẫn gặp lỗi rate limit — dừng mission.`, 'error');
        missionState.log.push(entry);
        sendToWindow('mission:log', entry);
      }
    }

    stopWatcher();
    stopAutosave();
    stopStuckChecker();
    clearAgentTeamsTimer();
    if (missionState.status === 'Running') {
      missionState.status = code === 0 || code === null ? 'Completed' : 'Failed';
    }
    missionState.phase = 'Done';
```

(This function already has `const ts = now();` near its top, before the `WaitingForAnswer` check — confirm this when reading the full body; it is reused here rather than redeclared.)

- [ ] **Step 2: Restructure `launch_mission` into a retryable `attemptSpawn`**

Read the full current handler body (`electron/ipc/mission.cjs:2331-2447`) to confirm exact text.

Using Edit, replace the block from `const proc = spawnClaude(` through the final `return missionState;`:

```js
    const proc = spawnClaude(
      ['-p', '--dangerously-skip-permissions', '--model', modelArg,
       '--output-format', 'stream-json', '--verbose'],
      projectPath,
      false
    );

    try {
      // Write prompt to stdin then close it
      // If continuing from history, append previous work context to the prompt
      const fullPrompt = (prompt || '') + previousWorkSection;
      proc.stdin.write(fullPrompt, 'utf8');
      proc.stdin.end();
    } catch (e) {
      return `Failed to write prompt to stdin: ${e.message}`;
    }

    childProcess = proc;
    missionState.status = 'Running';
    startAutosave();
    startStuckChecker(sendToWindow, true);  // new mission — reset all clocks
    sendToWindow('mission:status', { mission_id: missionId, status: 'running' });

    // Wire up readers
    readProcessStdout_launch(proc, missionId, sendToWindow);
    readProcessStderr(proc, sendToWindow);
    watchProcessExit_launch(proc, missionId, sendToWindow);

    return missionState;
```

with:

```js
    const fullPrompt = (prompt || '') + previousWorkSection;

    const attemptSpawnLaunch = (attempt, resumeSessionId) => {
      const spawnArgs = resumeSessionId
        ? ['-p', '--resume', resumeSessionId, '--dangerously-skip-permissions', '--model', modelArg,
           '--output-format', 'stream-json', '--verbose']
        : ['-p', '--dangerously-skip-permissions', '--model', modelArg,
           '--output-format', 'stream-json', '--verbose'];

      const proc = spawnClaude(spawnArgs, projectPath, false);

      try {
        // Resumed attempts don't need the prompt again — the aborted session already has it.
        if (!resumeSessionId) {
          proc.stdin.write(fullPrompt, 'utf8');
        }
        proc.stdin.end();
      } catch (e) {
        const entry = makeLogEntry(now(), 'System', `Failed to write prompt to stdin: ${e.message}`, 'error');
        missionState.log.push(entry);
        sendToWindow('mission:log', entry);
        return;
      }

      childProcess = proc;
      missionState.status = 'Running';
      startAutosave();
      startStuckChecker(sendToWindow, attempt === 1);  // new mission — reset all clocks only on first attempt
      sendToWindow('mission:status', { mission_id: missionId, status: 'running' });

      const attemptCtx = { stdoutText: '', stderrText: '', sessionId: null };
      const retryInfo = {
        attemptCtx, attempt, maxAttempts: 3, backoffMs: [30000, 60000, 120000],
        retrySpawn: (nextAttempt, nextSessionId) => attemptSpawnLaunch(nextAttempt, nextSessionId),
      };

      readProcessStdout_launch(proc, missionId, sendToWindow, attemptCtx);
      readProcessStderr(proc, sendToWindow, attemptCtx);
      watchProcessExit_launch(proc, missionId, sendToWindow, retryInfo);
    };

    attemptSpawnLaunch(1, null);

    return missionState;
```

- [ ] **Step 3: Restructure `deploy_mission` into a retryable `attemptSpawn`**

Read the full current handler body (`electron/ipc/mission.cjs:2450-2640`) to confirm exact text.

Using Edit, replace the block from `const proc = spawnClaude(` through `return null; // Ok(())`:

```js
    const proc = spawnClaude(
      ['-p', '--dangerously-skip-permissions', '--model', leadModel,
       '--output-format', 'stream-json', '--verbose', '--max-turns', '200'],
      projectPath,
      true
    );

    try {
      proc.stdin.write(deployPrompt, 'utf8');
      // Always close stdin — interactive questions use session resume (new process)
      proc.stdin.end();
    } catch (e) {
      return `Failed to write deploy prompt: ${e.message}`;
    }

    childProcess = proc;
    missionState.phase = 'Executing';
    startAutosave();
    startStuckChecker(sendToWindow, true);  // new execution phase — reset all clocks
    saveMissionSnapshot(missionState); // milestone: deploy started

    // Agent_teams mode: start file watcher
    if (execMode === 'agent_teams') {
      startFileWatcher(projectPath, sendToWindow);
    }

    // Wire up readers — pass permission mode for question marker handling
    readProcessStdout_deploy(proc, sendToWindow, false);
    readProcessStderr(proc, sendToWindow);
    watchProcessExit_deploy(proc, missionId, sendToWindow);

    return null; // Ok(())
```

with:

```js
    const attemptSpawnDeploy = (attempt, resumeSessionId) => {
      const spawnArgs = resumeSessionId
        ? ['-p', '--resume', resumeSessionId, '--dangerously-skip-permissions', '--model', leadModel,
           '--output-format', 'stream-json', '--verbose', '--max-turns', '200']
        : ['-p', '--dangerously-skip-permissions', '--model', leadModel,
           '--output-format', 'stream-json', '--verbose', '--max-turns', '200'];

      const proc = spawnClaude(spawnArgs, projectPath, true);

      try {
        if (!resumeSessionId) {
          proc.stdin.write(deployPrompt, 'utf8');
        }
        // Always close stdin — interactive questions use session resume (new process)
        proc.stdin.end();
      } catch (e) {
        const entry = makeLogEntry(now(), 'System', `Failed to write deploy prompt: ${e.message}`, 'error');
        missionState.log.push(entry);
        sendToWindow('mission:log', entry);
        return;
      }

      childProcess = proc;
      missionState.phase = 'Executing';
      startAutosave();
      startStuckChecker(sendToWindow, attempt === 1);  // new execution phase — reset all clocks only on first attempt
      if (attempt === 1) saveMissionSnapshot(missionState); // milestone: deploy started

      // Agent_teams mode: start file watcher
      if (execMode === 'agent_teams') {
        startFileWatcher(projectPath, sendToWindow);
      }

      const attemptCtx = { stdoutText: '', stderrText: '', sessionId: null };
      const retryInfo = {
        attemptCtx, attempt, maxAttempts: 3, backoffMs: [30000, 60000, 120000],
        retrySpawn: (nextAttempt, nextSessionId) => attemptSpawnDeploy(nextAttempt, nextSessionId),
      };

      // Wire up readers — pass permission mode for question marker handling
      readProcessStdout_deploy(proc, sendToWindow, false, attemptCtx);
      readProcessStderr(proc, sendToWindow, attemptCtx);
      watchProcessExit_deploy(proc, missionId, sendToWindow, retryInfo);
    };

    attemptSpawnDeploy(1, null);

    return null; // Ok(())
```

- [ ] **Step 4: Restructure `continue_mission` into a retryable `attemptSpawn`**

Read the full current handler body (`electron/ipc/mission.cjs:2643-2805`) to confirm exact text.

Using Edit, replace the block from `const proc = spawnClaude(` through `return null; // Ok(())`:

```js
    const proc = spawnClaude(
      ['-p', '--dangerously-skip-permissions', '--model', leadModel,
       '--output-format', 'stream-json', '--verbose', '--max-turns', '200'],
      projectPath,
      true  // always enable AGENT_TEAMS so Lead can spawn sub-agents
    );

    try {
      proc.stdin.write(continuePrompt, 'utf8');
      // Always close stdin — interactive questions use session resume (new process)
      proc.stdin.end();
    } catch (e) {
      return `Failed to write continue prompt: ${e.message}`;
    }

    childProcess = proc;
    if (missionState) missionState.phase = 'Executing';
    startAutosave();
    startStuckChecker(sendToWindow, false);  // resume — preserve silence clocks

    // Start file watcher if agent_teams mode (detect file changes from subagents)
    if (execMode === 'agent_teams') {
      startFileWatcher(projectPath, sendToWindow);
    }

    // Wire up readers
    readProcessStdout_deploy(proc, sendToWindow, true);
    readProcessStderr(proc, sendToWindow);

    const missionId = missionState ? missionState.id : 'unknown';
    watchProcessExit_deploy(proc, missionId, sendToWindow);

    return null; // Ok(())
```

with:

```js
    const attemptSpawnContinue = (attempt, resumeSessionId) => {
      const spawnArgs = resumeSessionId
        ? ['-p', '--resume', resumeSessionId, '--dangerously-skip-permissions', '--model', leadModel,
           '--output-format', 'stream-json', '--verbose', '--max-turns', '200']
        : ['-p', '--dangerously-skip-permissions', '--model', leadModel,
           '--output-format', 'stream-json', '--verbose', '--max-turns', '200'];

      const proc = spawnClaude(spawnArgs, projectPath, true);  // always enable AGENT_TEAMS so Lead can spawn sub-agents

      try {
        if (!resumeSessionId) {
          proc.stdin.write(continuePrompt, 'utf8');
        }
        // Always close stdin — interactive questions use session resume (new process)
        proc.stdin.end();
      } catch (e) {
        const entry = makeLogEntry(now(), 'System', `Failed to write continue prompt: ${e.message}`, 'error');
        if (missionState) missionState.log.push(entry);
        sendToWindow('mission:log', entry);
        return;
      }

      childProcess = proc;
      if (missionState) missionState.phase = 'Executing';
      startAutosave();
      startStuckChecker(sendToWindow, false);  // resume — preserve silence clocks

      // Start file watcher if agent_teams mode (detect file changes from subagents)
      if (execMode === 'agent_teams') {
        startFileWatcher(projectPath, sendToWindow);
      }

      const attemptCtx = { stdoutText: '', stderrText: '', sessionId: null };
      const missionIdForWatch = missionState ? missionState.id : 'unknown';
      const retryInfo = {
        attemptCtx, attempt, maxAttempts: 3, backoffMs: [30000, 60000, 120000],
        retrySpawn: (nextAttempt, nextSessionId) => attemptSpawnContinue(nextAttempt, nextSessionId),
      };

      // Wire up readers
      readProcessStdout_deploy(proc, sendToWindow, true, attemptCtx);
      readProcessStderr(proc, sendToWindow, attemptCtx);
      watchProcessExit_deploy(proc, missionIdForWatch, sendToWindow, retryInfo);
    };

    attemptSpawnContinue(1, null);

    return null; // Ok(())
```

- [ ] **Step 5: Verify no syntax errors**

```bash
node --check electron/ipc/mission.cjs
```

Expected: no output, exit code 0.

- [ ] **Step 6: Run the full test suite**

```bash
npm test
```

Expected: all existing tests pass; no regressions.

- [ ] **Step 7: Commit**

```bash
git add electron/ipc/mission.cjs
git commit -m "feat: retry launch_mission, deploy_mission, and continue_mission on transient API errors"
```

---

### Task 5: Group 3 retry — `replan_mission`

**Files:**
- Modify: `electron/ipc/mission.cjs` (`replan_mission` IPC handler at line 2945)

**Interfaces:**
- Consumes: `retryTransientSpawn(runFn, onRetry, maxAttempts, backoffMs)` and `isTransientApiError` from Task 1.
- Produces: nothing consumed by later tasks (last task in this plan).

`replan_mission`'s existing Promise **resolves** (never rejects) even on failure — its `proc.on('error')`, malformed-parse, and timeout paths all call `resolve(<error string>)`. `retryTransientSpawn` decides whether to retry based on a **rejected** promise's `.message`. So the existing self-contained Promise body is wrapped in a new inner function that translates its failure-shaped resolutions into a rejection, letting `retryTransientSpawn` drive the retry loop; the outer handler then translates a final rejection back into the same failure-string return contract the frontend already expects.

- [ ] **Step 1: Read the full current handler body to confirm exact text**

```bash
grep -n "ipcMain.handle('replan_mission'" electron/ipc/mission.cjs
```

Read 140 lines from that line number with the Read tool.

- [ ] **Step 2: Extract the existing Promise body into `runReplanAttempt` and wrap it with `retryTransientSpawn`**

Using Edit, replace the block from `sendToWindow('mission:log', {` (the "Re-planning: sending changes..." log call) through the closing `});` of the handler:

```js
    sendToWindow('mission:log', {
      timestamp: now(), agent: 'System',
      message: 'Re-planning: sending changes to Lead for review...',
      log_type: 'info',
    });

    return new Promise((resolve) => {
      const proc = spawnClaude(
        ['-p', '--dangerously-skip-permissions', '--model', leadModel,
         '--output-format', 'stream-json', '--verbose', '--max-turns', '50'],
        projectPath,
        false
      );

      let fullText = '';
      let resolved = false;

      const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const msg = JSON.parse(trimmed);
          // Collect text from assistant messages
          if (msg.type === 'assistant' && msg.message?.content) {
            for (const block of msg.message.content) {
              if (block.type === 'text' && block.text) {
                fullText += block.text;
              }
            }
          }
          // Also collect from content_block_delta
          if (msg.type === 'content_block_delta' && msg.delta?.text) {
            fullText += msg.delta.text;
          }
          // result message often has final text
          if (msg.type === 'result' && msg.result) {
            fullText += '\n' + msg.result;
          }
        } catch (_) {
          // Non-JSON line — just accumulate
          fullText += trimmed + '\n';
        }
      });

      proc.stderr.on('data', () => {}); // Drain stderr

      proc.on('close', () => {
        if (resolved) return;
        resolved = true;

        const parsed = tryParsePlanFromBuffer(fullText);
        if (parsed && parsed.agents && parsed.tasks) {
          sendToWindow('mission:log', {
            timestamp: now(), agent: 'System',
            message: `Re-plan complete: ${parsed.agents.length} agents, ${parsed.tasks.length} tasks`,
            log_type: 'info',
          });
          // Save replan version to snapshot
          if (missionState) {
            savePlanVersionInternal(missionState.id, 'replan', parsed.agents, parsed.tasks)
              .catch(e => console.error('[replan_mission] savePlanVersionInternal error:', e));
          }
          resolve({ agents: parsed.agents, tasks: parsed.tasks });
        } else {
          sendToWindow('mission:log', {
            timestamp: now(), agent: 'System',
            message: 'Re-plan failed: could not parse updated plan from Lead response',
            log_type: 'error',
          });
          resolve('Failed to parse re-plan output');
        }
      });

      proc.on('error', (err) => {
        if (resolved) return;
        resolved = true;
        resolve(`Re-plan process error: ${err.message}`);
      });

      // Send prompt
      try {
        proc.stdin.write(replanPrompt, 'utf8');
        proc.stdin.end();
      } catch (e) {
        if (!resolved) {
          resolved = true;
          resolve(`Failed to write re-plan prompt: ${e.message}`);
        }
      }

      // Timeout: 120 seconds
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try { proc.kill(); } catch (_) {}
          resolve('Re-plan timed out after 120s');
        }
      }, 120000);
    });
  });
```

with:

```js
    const runReplanAttempt = () => new Promise((resolve, reject) => {
      const proc = spawnClaude(
        ['-p', '--dangerously-skip-permissions', '--model', leadModel,
         '--output-format', 'stream-json', '--verbose', '--max-turns', '50'],
        projectPath,
        false
      );

      let fullText = '';
      let stderrText = '';
      let resolved = false;

      const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const msg = JSON.parse(trimmed);
          // Collect text from assistant messages
          if (msg.type === 'assistant' && msg.message?.content) {
            for (const block of msg.message.content) {
              if (block.type === 'text' && block.text) {
                fullText += block.text;
              }
            }
          }
          // Also collect from content_block_delta
          if (msg.type === 'content_block_delta' && msg.delta?.text) {
            fullText += msg.delta.text;
          }
          // result message often has final text
          if (msg.type === 'result' && msg.result) {
            fullText += '\n' + msg.result;
          }
        } catch (_) {
          // Non-JSON line — just accumulate
          fullText += trimmed + '\n';
        }
      });

      proc.stderr.on('data', (chunk) => { stderrText += chunk.toString(); });

      proc.on('close', () => {
        if (resolved) return;
        resolved = true;

        const parsed = tryParsePlanFromBuffer(fullText);
        if (parsed && parsed.agents && parsed.tasks) {
          sendToWindow('mission:log', {
            timestamp: now(), agent: 'System',
            message: `Re-plan complete: ${parsed.agents.length} agents, ${parsed.tasks.length} tasks`,
            log_type: 'info',
          });
          // Save replan version to snapshot
          if (missionState) {
            savePlanVersionInternal(missionState.id, 'replan', parsed.agents, parsed.tasks)
              .catch(e => console.error('[replan_mission] savePlanVersionInternal error:', e));
          }
          resolve({ agents: parsed.agents, tasks: parsed.tasks });
        } else {
          reject(new Error(`Failed to parse re-plan output: ${fullText}\n${stderrText}`));
        }
      });

      proc.on('error', (err) => {
        if (resolved) return;
        resolved = true;
        reject(new Error(`Re-plan process error: ${err.message}\n${stderrText}`));
      });

      // Send prompt
      try {
        proc.stdin.write(replanPrompt, 'utf8');
        proc.stdin.end();
      } catch (e) {
        if (!resolved) {
          resolved = true;
          reject(new Error(`Failed to write re-plan prompt: ${e.message}`));
        }
      }

      // Timeout: 120 seconds
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try { proc.kill(); } catch (_) {}
          reject(new Error(`Re-plan timed out after 120s\n${stderrText}`));
        }
      }, 120000);
    });

    const onRetry = (attempt, maxAttempts, err, delay) => {
      const entry = {
        timestamp: now(), agent: 'System',
        message: `⚠ Gặp lỗi tạm thời (rate limit/API), đang thử lại lần ${attempt}/${maxAttempts} sau ${delay / 1000}s...`,
        log_type: 'info',
      };
      if (missionState) missionState.log.push(entry);
      sendToWindow('mission:log', entry);
    };

    sendToWindow('mission:log', {
      timestamp: now(), agent: 'System',
      message: 'Re-planning: sending changes to Lead for review...',
      log_type: 'info',
    });

    try {
      const result = await retryTransientSpawn(runReplanAttempt, onRetry, 3, [30000, 60000, 120000]);
      return result;
    } catch (err) {
      if (isTransientApiError(err.message)) {
        const entry = {
          timestamp: now(), agent: 'System',
          message: 'Đã thử lại 3 lần nhưng vẫn gặp lỗi rate limit — dừng mission.',
          log_type: 'error',
        };
        if (missionState) missionState.log.push(entry);
        sendToWindow('mission:log', entry);
      } else {
        sendToWindow('mission:log', {
          timestamp: now(), agent: 'System',
          message: 'Re-plan failed: could not parse updated plan from Lead response',
          log_type: 'error',
        });
      }
      return err.message;
    }
  });
```

- [ ] **Step 3: Verify no syntax errors**

```bash
node --check electron/ipc/mission.cjs
```

Expected: no output, exit code 0.

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: all existing tests pass; no regressions.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/mission.cjs
git commit -m "feat: retry replan_mission on transient API errors"
```

---

## Manual Verification (post-implementation)

Automated tests in Task 1 cover the pure retry-counting/classification logic in full (`isTransientApiError`, `retryTransientSpawn`), and every task's `node --check` + `npm test` steps guard against syntax errors and regressions in existing behavior. The actual end-to-end retry wiring through real `claude` CLI process spawns, exit codes, and stdout/stderr text — across all six call sites — cannot be reliably exercised without mocking `child_process.spawn`, which is out of scope for this plan (same scoping decision the prior `mockup-generation-retry` plan made). Verify manually:

1. Start the app, launch a mission, and let it reach each phase in turn (Planning → ReviewPlan → Deploying/Executing), triggering a Q&A pause and a replan at least once.
2. To simulate a transient failure, temporarily point `ANTHROPIC_API_KEY` (or the equivalent env var the `claude` CLI reads) at an invalid/rate-limited key, or use a network proxy that returns HTTP 429 for one attempt then restores normal behavior.
3. Confirm for each call site: a `⚠ Gặp lỗi tạm thời (rate limit/API), đang thử lại lần 1/3 sau 30s...` log entry appears, the mission does NOT transition to `Failed` on the first failure, and after the backoff a new `claude` process is observed spawning (check `mission:raw-line` events resume).
4. Confirm Group 1/2 resume behavior: when the key is restored before the retry fires, the mission continues normally (no re-prompting from scratch, aside from Group 2's fresh-spawn edge case when failure occurs before `init`).
5. Confirm exhaustion behavior: with the key kept invalid for all 3 attempts, the mission reaches `Failed` after ~210s total added latency, with the final `Đã thử lại 3 lần nhưng vẫn gặp lỗi rate limit — dừng mission.` log line present.
6. Confirm a non-transient failure (e.g. deliberately break `PROMPT_DEPLOY_STANDARD`'s file so a prompt load error occurs) still fails immediately with no retry log entries.
