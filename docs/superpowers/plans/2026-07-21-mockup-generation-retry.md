# Mockup Generation Auto-Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the single `runClaudeForHtml(prompt)` call inside `spawnMockupGenerator()` (in `electron/ipc/mission.cjs`) with a fixed 3-attempt retry loop, so a transient mockup-generation failure no longer permanently skips the mockup for a mission — retry happens automatically before falling through to the existing skip-and-continue behavior.

**Architecture:** Extract the retry loop into a small, pure, dependency-injected function `retryMockupGeneration(runFn, onRetry, maxAttempts)` that takes the actual generation call (`runFn`) and a retry-notification callback (`onRetry`) as parameters. This mirrors the existing `system.cjs` / `checkForUpdates` pattern in this repo, where a function is exported as a named export from a `.cjs` file and unit-tested directly via `vitest` with mocked dependencies — no Electron/process-spawn mocking needed. `spawnMockupGenerator` then calls this helper instead of calling `runClaudeForHtml` directly, and re-arms its `warn30`/`warn50` timers per attempt.

**Tech Stack:** Node.js (CommonJS, `.cjs`), Vitest for unit tests (existing project test runner, see `package.json`'s `"test": "vitest run"`).

## Global Constraints

- Total attempts: 3 (1 initial + 2 retries) — fixed, not configurable via env/args beyond the function parameter itself.
- Timeout per attempt: unchanged at 60s (enforced inside the existing `runClaudeForHtml`, untouched by this plan).
- No delay between attempts — retry fires immediately after a failure.
- On each failed attempt except the last, log `Mockup lỗi (lần X/3), đang thử lại...` to the mission log via `sendToWindow('mission:log', entry)` and `missionState.log.push(entry)`, matching the existing log-entry pattern already in `spawnMockupGenerator`.
- `warn30` and `warn50` progress-warning timers must reset per attempt (cleared and re-armed at the start of each attempt), not accumulate across the whole retry sequence.
- No changes to `runClaudeForHtml`, `restartLeadAfterMockup`, the mockup success-serving code (`http.createServer`, `shell.openExternal`), or any other function in `mission.cjs`.
- Only `electron/ipc/mission.cjs` is modified; add one new test file `electron/ipc/mission.retryMockupGeneration.test.js`.

---

### Task 1: Extract and test `retryMockupGeneration` as a standalone pure function

**Files:**
- Modify: `electron/ipc/mission.cjs` (add new function `retryMockupGeneration` near `runClaudeForHtml`/`spawnMockupGenerator`, around line 856-858; add a named export at the bottom of the file)
- Create: `electron/ipc/mission.retryMockupGeneration.test.js`

**Interfaces:**
- Produces: `async function retryMockupGeneration(runFn, onRetry, maxAttempts = 3)` — exported as `module.exports.retryMockupGeneration`.
  - `runFn: () => Promise<string>` — the actual generation call (in production, `() => runClaudeForHtml(prompt)`); returns the HTML string on success, throws/rejects on failure.
  - `onRetry: (attempt: number, maxAttempts: number, err: Error) => void` — called synchronously after each failed attempt that is NOT the last attempt, before the next attempt starts. Not called after the final failed attempt.
  - `maxAttempts: number` — defaults to 3.
  - Returns: `Promise<string>` — resolves with `runFn()`'s successful result (from whichever attempt succeeded first).
  - Throws: the error from the final attempt, if all `maxAttempts` attempts fail. (Matches existing behavior: `spawnMockupGenerator`'s caller already has a `try/catch` around the whole generation call — see Task 2.)
- Consumes: nothing from other tasks (this is the first task).

- [ ] **Step 1: Write the failing test file**

Create `electron/ipc/mission.retryMockupGeneration.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import { retryMockupGeneration } from './mission.cjs'

describe('retryMockupGeneration', () => {
  it('resolves immediately when the first attempt succeeds', async () => {
    const runFn = vi.fn().mockResolvedValue('<html>ok</html>')
    const onRetry = vi.fn()

    const result = await retryMockupGeneration(runFn, onRetry, 3)

    expect(result).toBe('<html>ok</html>')
    expect(runFn).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('retries after a failure and resolves on the second attempt', async () => {
    const runFn = vi.fn()
      .mockRejectedValueOnce(new Error('timed out'))
      .mockResolvedValueOnce('<html>second try</html>')
    const onRetry = vi.fn()

    const result = await retryMockupGeneration(runFn, onRetry, 3)

    expect(result).toBe('<html>second try</html>')
    expect(runFn).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith(1, 3, expect.any(Error))
  })

  it('retries twice and resolves on the third attempt', async () => {
    const runFn = vi.fn()
      .mockRejectedValueOnce(new Error('timed out'))
      .mockRejectedValueOnce(new Error('timed out again'))
      .mockResolvedValueOnce('<html>third try</html>')
    const onRetry = vi.fn()

    const result = await retryMockupGeneration(runFn, onRetry, 3)

    expect(result).toBe('<html>third try</html>')
    expect(runFn).toHaveBeenCalledTimes(3)
    expect(onRetry).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, 3, expect.any(Error))
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, 3, expect.any(Error))
  })

  it('throws the final error after all attempts fail, without calling onRetry after the last attempt', async () => {
    const finalError = new Error('final failure')
    const runFn = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockRejectedValueOnce(finalError)
    const onRetry = vi.fn()

    await expect(retryMockupGeneration(runFn, onRetry, 3)).rejects.toThrow('final failure')
    expect(runFn).toHaveBeenCalledTimes(3)
    expect(onRetry).toHaveBeenCalledTimes(2)
  })

  it('defaults to 3 max attempts when not specified', async () => {
    const runFn = vi.fn().mockRejectedValue(new Error('always fails'))
    const onRetry = vi.fn()

    await expect(retryMockupGeneration(runFn, onRetry)).rejects.toThrow('always fails')
    expect(runFn).toHaveBeenCalledTimes(3)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run electron/ipc/mission.retryMockupGeneration.test.js
```

Expected: FAIL — `retryMockupGeneration` is not exported from `./mission.cjs` yet (import error or `undefined is not a function`).

- [ ] **Step 3: Implement `retryMockupGeneration` in mission.cjs**

Read the current content around line 856-858 first to find the exact insertion point:

```bash
awk 'NR==855,NR==860{print NR": "$0}' electron/ipc/mission.cjs
```

Expected output (confirm this matches before editing):

```
855: }
856: 
857: // spawnMockupGenerator — generate HTML via runClaudeForHtml, serve on localhost,
858: // open browser, send mission:mockup IPC. Handles its own errors gracefully.
```

Using the Edit tool, insert a new function between the existing blank line 856 and the `spawnMockupGenerator` comment at line 857. Replace:

```js
// spawnMockupGenerator — generate HTML via runClaudeForHtml, serve on localhost,
// open browser, send mission:mockup IPC. Handles its own errors gracefully.
```

with:

```js
// retryMockupGeneration — runs runFn up to maxAttempts times, calling onRetry(attempt, maxAttempts, err)
// after each non-final failed attempt. Resolves with the first successful result, or throws the
// final attempt's error if all attempts fail.
async function retryMockupGeneration(runFn, onRetry, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await runFn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        onRetry(attempt, maxAttempts, err);
      }
    }
  }
  throw lastErr;
}

// spawnMockupGenerator — generate HTML via runClaudeForHtml, serve on localhost,
// open browser, send mission:mockup IPC. Handles its own errors gracefully.
```

- [ ] **Step 4: Add the named export**

This repo's convention (see `electron/ipc/system.cjs`, which has `module.exports = function registerSystem(...) {...}` followed later by a separate `module.exports.checkForUpdates = checkForUpdates;` line) is to append additional named exports as their own line after the main `module.exports = function registerMission(...)` block, without modifying that block itself.

Check the end of the file:

```bash
tail -5 electron/ipc/mission.cjs
```

Using the Edit tool, append a new line at the very end of the file, after the last `}` that closes the `registerMission` function body:

```js
module.exports.retryMockupGeneration = retryMockupGeneration;
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run electron/ipc/mission.retryMockupGeneration.test.js
```

Expected: PASS — all 5 tests green.

- [ ] **Step 6: Commit**

```bash
git add electron/ipc/mission.cjs electron/ipc/mission.retryMockupGeneration.test.js
git commit -m "feat: extract retryMockupGeneration as a testable retry helper"
```

---

### Task 2: Wire `retryMockupGeneration` into `spawnMockupGenerator` with per-attempt warning timers

**Files:**
- Modify: `electron/ipc/mission.cjs` (the body of `spawnMockupGenerator`, currently lines ~860-925 before Task 1's insertion shifts line numbers — re-locate by function name, not line number)

**Interfaces:**
- Consumes: `retryMockupGeneration(runFn, onRetry, maxAttempts)` from Task 1 (exact signature above).
- Produces: nothing new consumed by later tasks (this is the last task in this plan).

- [ ] **Step 1: Read the current spawnMockupGenerator body to confirm exact text before editing**

```bash
grep -n "async function spawnMockupGenerator" electron/ipc/mission.cjs
```

Read 70 lines starting from that line number using the Read tool to get the exact current text (Task 1's insertion above shifted line numbers by ~16 lines, so don't rely on the original 860-925 range from the spec).

- [ ] **Step 2: Replace the timer setup and the try block's generation call**

The current body (before this task's edit) looks like this, modulo the line-number shift from Task 1:

```js
  const warn30 = setTimeout(() => {
    const entry = makeLogEntry(now(), 'System', 'Mockup đang generate (30s)...', 'info');
    if (missionState) missionState.log.push(entry);
    sendToWindow('mission:log', entry);
  }, 30000);

  const warn50 = setTimeout(() => {
    const entry = makeLogEntry(now(), 'System',
      'Mockup sắp timeout — nếu thất bại sẽ tiếp tục planning tự động', 'info');
    if (missionState) missionState.log.push(entry);
    sendToWindow('mission:log', entry);
  }, 50000);

  const cleanup = () => { clearTimeout(warn30); clearTimeout(warn50); };

  try {
    const htmlContent = await runClaudeForHtml(prompt);
    cleanup();
```

Using the Edit tool, replace that entire block (from `const warn30 = setTimeout` through `cleanup();` on the line right after `const htmlContent = await runClaudeForHtml(prompt);`) with:

```js
  const MAX_MOCKUP_ATTEMPTS = 3;
  let warn30, warn50;

  const armWarningTimers = () => {
    warn30 = setTimeout(() => {
      const entry = makeLogEntry(now(), 'System', 'Mockup đang generate (30s)...', 'info');
      if (missionState) missionState.log.push(entry);
      sendToWindow('mission:log', entry);
    }, 30000);

    warn50 = setTimeout(() => {
      const entry = makeLogEntry(now(), 'System',
        'Mockup sắp timeout — nếu thất bại sẽ tiếp tục planning tự động', 'info');
      if (missionState) missionState.log.push(entry);
      sendToWindow('mission:log', entry);
    }, 50000);
  };

  const cleanup = () => { clearTimeout(warn30); clearTimeout(warn50); };

  const onRetry = (attempt, maxAttempts) => {
    cleanup();
    const entry = makeLogEntry(now(), 'System',
      `Mockup lỗi (lần ${attempt}/${maxAttempts}), đang thử lại...`, 'info');
    if (missionState) missionState.log.push(entry);
    sendToWindow('mission:log', entry);
    armWarningTimers();
  };

  try {
    armWarningTimers();
    const htmlContent = await retryMockupGeneration(
      () => runClaudeForHtml(prompt),
      onRetry,
      MAX_MOCKUP_ATTEMPTS
    );
    cleanup();
```

- [ ] **Step 3: Verify the rest of the function body is untouched**

Read the full `spawnMockupGenerator` function again after the edit and confirm:
- The `server.listen(...)` success block (http.createServer, shell.openExternal, sendToWindow('mission:mockup', ...)) is byte-for-byte unchanged.
- The `catch (err)` block (logging `Mockup generation failed (...)` and calling `restartLeadAfterMockup`) is byte-for-byte unchanged — it now simply fires after all 3 attempts fail instead of after 1.

- [ ] **Step 4: Manually verify no syntax errors**

```bash
node --check electron/ipc/mission.cjs
```

Expected: no output (exit code 0), confirming valid JS syntax.

- [ ] **Step 5: Run the full existing test suite to check for regressions**

```bash
npm test
```

Expected: all existing tests still pass (including `electron/ipc/mission.retryMockupGeneration.test.js` from Task 1), no new failures introduced elsewhere.

- [ ] **Step 6: Commit**

```bash
git add electron/ipc/mission.cjs
git commit -m "feat: retry mockup generation up to 3 times before falling back to skip"
```

---

## Manual Verification (post-implementation)

Automated tests cover the pure retry-counting logic (Task 1) and a syntax/regression check (Task 2), but the full end-to-end behavior — real `claude` CLI process spawning, timers, and the `restartLeadAfterMockup` handoff — requires a manual run:

1. Start the app and trigger a mission that reaches the mockup-request phase.
2. To simulate a transient failure, temporarily lower `MAX_MOCKUP_ATTEMPTS`'s underlying timeout is not needed — instead, verify via the mission log: watch for `Mockup đang generate (30s)...` (per-attempt) and, if a failure occurs, `Mockup lỗi (lần X/3), đang thử lại...` before either a successful mockup opening in the browser or the final `Mockup generation failed (...) — continuing planning` message after 3 attempts.
3. Confirm total elapsed time for a full 3-attempt failure is roughly 180s (3 × 60s), consistent with the accepted tradeoff in the spec.

This manual step is necessary because reliably forcing `claude` CLI timeouts/failures in an automated test would require mocking `child_process.spawn`, which is out of scope for this plan (the spec scoped verification to the pure retry-counting logic, not full process-spawn simulation).
