# QC/QA Spawn Error Listener Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent an unhandled `'error'` event on the QC/QA subprocess from crashing the Electron main process, by registering a `proc.on('error', ...)` listener in `runQcQaCheck` that resolves a FAIL result instead of letting Node throw.

**Architecture:** One-line-of-behavior addition to the existing `runQcQaCheck` function in `electron/lib/qcqa.cjs`: a new `proc.on('error', ...)` listener, placed alongside the existing `close` listener, reusing the function's existing `settled` flag and `timer` variable so it composes safely with the current timeout/close handling.

**Tech Stack:** Node.js `child_process`/`EventEmitter`, Vitest.

## Global Constraints

- `runQcQaCheck` must keep resolving (never rejecting/throwing) in all cases — callers in `mission.cjs` already assume this.
- No change to `parseQcQaVerdict`, `extractLastAssistantText`, `nextEscalationTier`, or the escalation/retry logic in `mission.cjs`.
- No change to the QC/QA prompt templates.
- Resolved error shape: `{ verdict: 'FAIL', responsibleAgent: null, reason: 'QC/QA process error: <err.message>' }` — same shape as the existing timeout branch, distinguished only by the `reason` text.

---

### Task 1: Add `error` listener to `runQcQaCheck`

**Files:**
- Modify: `electron/lib/qcqa.cjs:127-136` (inside `runQcQaCheck`, between the existing `proc.stdout.on('data', ...)` and `proc.on('close', ...)` listeners)
- Test: `electron/lib/qcqa.test.cjs` (append a new test inside the existing `describe('runQcQaCheck', ...)` block, which starts at line 96)

**Interfaces:**
- Consumes: `runQcQaCheck`'s existing local variables `settled` (boolean flag, already declared at line 114) and `timer` (the `setTimeout` handle, already declared at lines 116-125). No new function signature or exported symbol.
- Produces: nothing new is exported. `runQcQaCheck`'s existing contract (always resolves with `{ verdict, responsibleAgent, reason }`, never rejects) now also covers the subprocess-spawn-failure case.

The current relevant section of `electron/lib/qcqa.cjs` (for orientation — do not copy this comment, it's here so you can find the exact insertion point):

```js
    proc.stdout.on('data', (chunk) => { stdoutText += chunk.toString('utf8'); });

    proc.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const resolvedParseLine = parseLine || require('./cliAdapters/claudeAdapter.cjs').parseLine;
      const assistantText = extractLastAssistantText(stdoutText, resolvedParseLine);
      resolve(parseQcQaVerdict(assistantText, stage));
    });
```

- [ ] **Step 1: Write the failing test**

Append this test inside the existing `describe('runQcQaCheck', ...)` block in `electron/lib/qcqa.test.cjs`, immediately after the `'resolves FAIL on timeout without waiting for close'` test (which ends at line 146, right before the `'a tool_use turn before the verdict text...'` test at line 148). Use the file's existing `makeFakeProc()` helper (already defined at lines 83-89) and `spawnClaude` legacy-path convention (already used by every other test in this block):

```js
  test('resolves FAIL when the subprocess emits an error instead of closing', async () => {
    const fakeProc = makeFakeProc();
    const spawnClaude = () => fakeProc;

    const resultPromise = runQcQaCheck({
      spawnClaude, parseLine: claudeAdapter.parseLine,
      prompt: 'check task X', projectPath: '/tmp/proj',
      model: 'claude-sonnet-5', stage: 'QC', timeoutMs: 5000,
    });

    fakeProc.emit('error', new Error('spawn ENOENT'));

    await expect(resultPromise).resolves.toEqual({
      verdict: 'FAIL',
      responsibleAgent: null,
      reason: 'QC/QA process error: spawn ENOENT',
    });
  });

  test('an error emitted after close is ignored (no double-resolve)', async () => {
    const fakeProc = makeFakeProc();
    const spawnClaude = () => fakeProc;

    const resultPromise = runQcQaCheck({
      spawnClaude, parseLine: claudeAdapter.parseLine,
      prompt: 'check task X', projectPath: '/tmp/proj',
      model: 'claude-sonnet-5', stage: 'QC', timeoutMs: 5000,
    });

    fakeProc.stdout.emit('data', Buffer.from(claudeTextLine('[QC] VERDICT: PASS') + '\n'));
    fakeProc.emit('close', 0);
    // Emitting 'error' after 'close' must not throw or change the already-resolved result.
    expect(() => fakeProc.emit('error', new Error('late error'))).not.toThrow();

    await expect(resultPromise).resolves.toEqual({ verdict: 'PASS' });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run electron/lib/qcqa.test.cjs`

Expected: the new `'resolves FAIL when the subprocess emits an error instead of closing'` test times out or fails (the promise never settles, because nothing currently listens for `'error'` on `fakeProc`, and Node's default unhandled-`'error'`-on-EventEmitter behavior is to throw — Vitest will report this as a thrown/uncaught error in that test). The `'an error emitted after close is ignored'` test may pass vacuously (since `'close'` already resolves it) or throw for the same unhandled-`'error'` reason — either outcome confirms the listener is missing; do not treat either as a false pass.

- [ ] **Step 3: Add the `error` listener**

In `electron/lib/qcqa.cjs`, insert the new listener between the existing `proc.stdout.on('data', ...)` line and the existing `proc.on('close', ...)` block:

```js
    proc.stdout.on('data', (chunk) => { stdoutText += chunk.toString('utf8'); });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        verdict: 'FAIL',
        responsibleAgent: null,
        reason: `QC/QA process error: ${err.message}`,
      });
    });

    proc.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const resolvedParseLine = parseLine || require('./cliAdapters/claudeAdapter.cjs').parseLine;
      const assistantText = extractLastAssistantText(stdoutText, resolvedParseLine);
      resolve(parseQcQaVerdict(assistantText, stage));
    });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run electron/lib/qcqa.test.cjs`

Expected: PASS — all tests in the file green, including both new tests, and the full existing suite (PASS/FAIL/timeout/tool_use/delta/Copilot/no-spawn-fn tests) still green.

- [ ] **Step 5: Run the full project test suite to check for regressions**

Run: `npx vitest run`

Expected: same pass/fail counts as before this change for every other file (this change only touches `qcqa.cjs`/`qcqa.test.cjs`; pre-existing unrelated Playwright-under-Vitest failures in `tests/specs/*.spec.ts`, if present, are not introduced by this task — do not attempt to fix them here).

- [ ] **Step 6: Commit**

```bash
git add electron/lib/qcqa.cjs electron/lib/qcqa.test.cjs
git commit -m "fix: prevent unhandled subprocess error from crashing QC/QA check"
```

---

### Task 2: Update tracking doc

**Files:**
- Modify: `docs/critical-issues-review-2026-08-08.md` (issue #4 section, lines 26-30)

**Interfaces:**
- Consumes: nothing from Task 1's code — this task only records that Task 1 landed, and cites its own file/line evidence.
- Produces: nothing consumed by later tasks (this is the final task in this plan).

The current issue #4 entry reads:

```markdown
## 4. QC/QA spawn has no `error` listener
- **Where:** `electron/lib/qcqa.cjs:56-107` (`runQcQaCheck`)
- **Bug:** No `proc.on('error', ...)` registered on the spawned child process. If the `claude`/adapter binary is missing from PATH or fails to spawn (EACCES etc.), Node's unhandled `'error'` event throws synchronously with nothing to catch it.
- **Effect:** Can crash the entire Electron main process mid-mission.
- [ ] Fixed
```

- [ ] **Step 1: Update the entry**

Following the exact pattern already used for issue #2's and #3's entries in this same file (a `**Fix (...)**:` line added above the checkbox, then the checkbox flipped), replace the `- [ ] Fixed` line and add a fix line so the entry reads:

```markdown
## 4. QC/QA spawn has no `error` listener
- **Where:** `electron/lib/qcqa.cjs:56-107` (`runQcQaCheck`)
- **Bug:** No `proc.on('error', ...)` registered on the spawned child process. If the `claude`/adapter binary is missing from PATH or fails to spawn (EACCES etc.), Node's unhandled `'error'` event throws synchronously with nothing to catch it.
- **Effect:** Can crash the entire Electron main process mid-mission.
- **Fix (design doc `docs/superpowers/specs/2026-08-08-qcqa-error-listener-design.md`, plan `docs/superpowers/plans/2026-08-08-qcqa-error-listener.md`):** `runQcQaCheck` now registers `proc.on('error', ...)`, mirroring the existing spawn-error pattern already used elsewhere in the codebase (`electron/ipc/history.cjs:134`, `electron/ipc/mission.cjs:3471,3559,4457`). It clears the timeout, guards against double-resolution with the function's existing `settled` flag, and resolves (never rejects) `{ verdict: 'FAIL', responsibleAgent: null, reason: 'QC/QA process error: <message>' }` — same shape as the existing timeout branch. Verified with unit tests covering both a bare spawn-error and an error emitted after `close` (no double-resolve).
- [x] Fixed
```

- [ ] **Step 2: Commit**

```bash
git add docs/critical-issues-review-2026-08-08.md
git commit -m "docs: mark issue #4 (QC/QA spawn error listener) as fixed"
```
