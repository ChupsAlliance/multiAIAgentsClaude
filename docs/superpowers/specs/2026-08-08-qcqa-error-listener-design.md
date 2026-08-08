# QC/QA spawn missing `error` listener — design

**Tracked issue:** #4 in `docs/critical-issues-review-2026-08-08.md` — "QC/QA spawn has no `error` listener"

## Problem

`runQcQaCheck` (`electron/lib/qcqa.cjs:84-138`) spawns a QC/QA verification subprocess (via `spawnFn`/`buildArgs` or the legacy `spawnClaude` fallback) and registers `proc.stdout.on('data', ...)` and `proc.on('close', ...)` listeners, plus a timeout timer. It never registers `proc.on('error', ...)`.

Node's `child_process` emits `'error'` (not just a non-zero exit via `'close'`) when the process itself fails to spawn — e.g. the `claude`/adapter binary is missing from `PATH`, permissions are wrong (`EACCES`), or the working directory doesn't exist. With no listener for that event, Node's default behavior for an unhandled `'error'` event on an `EventEmitter` is to throw synchronously from wherever the event is emitted — which, for a child process, is an uncaught exception on the Electron main process event loop, outside any try/catch in the calling code. This can crash the entire Electron main process mid-mission, taking down the whole app, not just failing the one QC/QA check.

## Fix

Add an `error` listener to `runQcQaCheck`, mirroring the existing pattern already used four times elsewhere in this codebase for the same class of promise-wrapped spawn call (`electron/ipc/history.cjs:134`, `electron/ipc/mission.cjs:3471`, `electron/ipc/mission.cjs:3559`, `electron/ipc/mission.cjs:4457`): clear the timeout, guard against double-resolution with the existing `settled` flag, and `resolve(...)` — never `reject`/throw — with an error-shaped result.

```js
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
```

Placed alongside the existing `proc.on('close', ...)` handler in `runQcQaCheck`. Reuses the function's existing `settled` flag and `timer` variable — no new state.

**Resolved shape:** `{ verdict: 'FAIL', responsibleAgent: null, reason: 'QC/QA process error: <message>' }` — same shape as the existing timeout branch, distinguished only by the `reason` text. This keeps `runQcQaCheck`'s contract unchanged (always resolves, never rejects, with a `{ verdict, responsibleAgent, reason }` object) so no caller in `mission.cjs` needs to change.

## Global constraints

- No change to `parseQcQaVerdict`, `extractLastAssistantText`, `nextEscalationTier`, or the escalation/retry logic in `mission.cjs` that consumes `runQcQaCheck`'s result.
- No change to the QC/QA prompt templates.
- `runQcQaCheck` must keep resolving (never rejecting/throwing) in all cases — callers in `mission.cjs` already assume this.

## Testing

Add a unit test to `electron/lib/qcqa.test.cjs`: construct a fake `proc` as an `EventEmitter` (matching the shape the existing PASS/FAIL tests already build — with a no-op `stdout` `EventEmitter` and a `kill` stub), call `runQcQaCheck` with a `spawnFn` that returns this fake proc, then emit `proc.emit('error', new Error('spawn ENOENT'))` instead of `'close'`. Assert the returned promise resolves (not rejects) to `{ verdict: 'FAIL', responsibleAgent: null, reason: 'QC/QA process error: spawn ENOENT' }`, and that no unhandled exception escapes the test process.

No changes needed to the existing PASS/FAIL/timeout tests.
