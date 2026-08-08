# Cancel Pending Retry Timers on Stop/Reset — Design

## Problem

[2026-07-22-cross-phase-retry-design.md](2026-07-22-cross-phase-retry-design.md) added automatic retry-with-backoff for transient API errors across the mission lifecycle. Each retry is scheduled with a bare `setTimeout(() => retrySpawn(...), delay)` call, at four call sites in `electron/ipc/mission.cjs`:

| Line | Context |
|---|---|
| 2245 | `readProcessStdout_launch` — dangling-question safety-net retry (Lead cut off mid-question) |
| 2390 | `watchProcessExit_launch` — transient-API-error retry, planning phase |
| 2994 | `readProcessStdout_deploy` — dangling-question safety-net retry, execution phase |
| 3047 | `watchProcessExit_deploy` — transient-API-error retry, execution phase |

Unlike every other scheduled timer in this file (`agentTeamsCompletionTimer`, the autosave interval, the stuck-checker interval — each has a module-level handle and a `clear*()` function called from `stop_mission`/`reset_mission`), none of these four `setTimeout` return values are captured. `stop_mission` and `reset_mission` have nothing to `clearTimeout`.

**Failure scenario:** a transient API error is detected → a retry is scheduled 30-120s out → the user clicks Stop (or Reset) before it fires. Two outcomes depending on which handler ran:

- `reset_mission` sets `missionState = null`. The pending timer still fires and calls `attemptSpawnDeploy`/`attemptSpawnLaunch`, which write to `missionState.phase`/`.status` unconditionally (unlike the sibling `attemptSpawnContinue`, which null-guards). Result: uncaught `TypeError` inside a bare timer callback — nothing catches it — crashing the Electron main process.
- `stop_mission` leaves `missionState` intact (just marks it `Stopped`). The pending timer still fires and **silently respawns a live `claude` child process**, even though the user believes the mission was stopped.

Only one mission (and therefore at most one pending retry timer) can be active at a time — `childProcess` is a single module-level variable, not a collection — so there is never a need to track more than one in-flight retry timer.

## Goal

1. Cancel any pending retry timer as part of `stop_mission`/`reset_mission`, the same way `clearAgentTeamsTimer()` already does for the agent-teams safety timer.
2. Give the user a chance to back out of stopping the mission when doing so would throw away a scheduled retry, since a transient error is often about to resolve itself on its own.

## Design

### 1. Backend — track and cancel the timer

Mirror the existing `agentTeamsCompletionTimer` pattern (`mission.cjs:93-96`):

```js
let pendingRetryTimer = null; // handle for a scheduled retrySpawn() call, if any

function clearPendingRetryTimer() {
  if (pendingRetryTimer !== null) {
    clearTimeout(pendingRetryTimer);
    pendingRetryTimer = null;
  }
}
```

Each of the four call sites changes from:

```js
setTimeout(() => retrySpawn(attempt + 1, attemptCtx.sessionId || null), delay);
```

to:

```js
sendToWindow('mission:retry-pending', { pending: true, attempt: attempt + 1, maxAttempts, delayMs: delay });
pendingRetryTimer = setTimeout(() => {
  pendingRetryTimer = null;
  retrySpawn(attempt + 1, attemptCtx.sessionId || null);
}, delay);
```

`stop_mission` and `reset_mission` both call `clearPendingRetryTimer()` alongside the existing `clearAgentTeamsTimer()` call. This is the actual bug fix — after this change, stopping/resetting during a pending retry cancels it outright: no crash, no silent respawn.

### 2. New event: `mission:retry-pending`

A dedicated event, separate from the existing `mission:status` channel. `mission:status` drives `isRunning` and several phase-transition branches in `useMission.js` keyed off a fixed set of known strings (`running`, `launching`, `deploying`, `completed`, `stopped`, `failed`); introducing a new status value there (e.g. `retrying`) would fall through those branches unpredictably — `isRunning` would flip to `false` while the mission is actually still alive and waiting, which would hide the very Stop button we need visible. Keeping this on its own event avoids touching that existing logic at all.

Payload: `{ pending: true, attempt, maxAttempts, delayMs }` when scheduled, `{ pending: false }` when the timer fires and `retrySpawn` actually runs (informational only — by that point a new spawn is already underway).

This event is fire-and-forget UI signaling only; it has no effect on `missionState` and nothing on the backend depends on it.

### 3. Frontend — confirm before stopping mid-retry

In `src/hooks/useMission.js`:

- New state: `isRetryPending` (boolean) and `retryInfo` (`{ attempt, maxAttempts } | null`), updated by a new `listen('mission:retry-pending', ...)` handler.
- The existing `mission:status` handler sets `isRetryPending` back to `false` unconditionally as its first action — any status transition (stopped/completed/failed/reset) supersedes a pending-retry signal, so this is a safety net against ever missing a cancel and getting stuck showing a stale "retry pending" flag.
- `stop()` (`useMission.js:780`): if `isRetryPending` is `true` when called, show `window.confirm(...)` with a message identifying the retry attempt in progress, e.g.:

  > Mission đang tự động thử lại lần {attempt}/{maxAttempts} sau lỗi tạm thời. Nếu dừng ngay bây giờ, lần thử lại sẽ bị huỷ. Bạn có chắc chắn muốn dừng mission?

  If the user cancels the confirm dialog, `stop()` returns immediately — no IPC call, mission keeps waiting for its retry exactly as before. If confirmed, `stop()` proceeds exactly as it does today (which now correctly cancels the backend timer per part 1).

`window.confirm()` (native dialog) is used rather than a new custom modal component — the codebase has no existing generic confirmation-dialog component, and this is a single yes/no gate, not recurring UI.

### Scope notes

- `reset()` (`useMission.js:803`) is **not** given the same confirmation. The "New Mission" button that calls it is only rendered when `state.status` is already `Done`/`Stopped`/`Failed` (`MissionHeader.jsx:55`) — a pending retry keeps the mission looking active (no status transition has happened yet), so that button cannot be reached while a retry is pending. `reset_mission` still gets `clearPendingRetryTimer()` on the backend for defense in depth, but no frontend confirm is needed since the path is unreachable.
- No visual "retrying in Ns..." indicator is added to the UI while waiting — only the confirm-on-Stop behavior requested. Could be a follow-up using the same `mission:retry-pending` event if wanted later.
- No re-sync of `isRetryPending` on hook mount/app reload while a retry happens to be pending in the backend — an edge case not handled today for any other in-flight state either, and out of scope here.

## What does NOT change

- The four retry call sites' actual retry logic (attempt/backoff counting, transient-error detection, session resumption) — untouched, only the scheduling call itself is wrapped.
- `mission:status` event semantics and everything downstream of it in `useMission.js`.
- `reset_mission`'s existing behavior beyond the added `clearPendingRetryTimer()` call.

## Scope

Two files: `electron/ipc/mission.cjs` (backend timer tracking + new event) and `src/hooks/useMission.js` (listener + confirm-before-stop). No new components, no changes to `MissionHeader.jsx` or any other UI file — the confirm happens inside the existing `stop()` callback, transparent to its callers.

## Acceptance Criteria

- Triggering a transient-API-error or dangling-question retry at any of the four call sites, then calling `stop_mission` or `reset_mission` before the backoff elapses, cancels the scheduled timer — `retrySpawn` never fires afterward.
- `reset_mission` during a pending retry no longer throws / crashes the main process.
- `stop_mission` during a pending retry no longer results in a `claude` child process being spawned after the mission was stopped.
- Clicking Stop while `isRetryPending` is `true` shows a native confirm dialog naming the current attempt/max attempts; cancelling it leaves the mission untouched (still waiting on its retry); confirming it stops the mission exactly as today.
- Clicking Stop while no retry is pending behaves exactly as today — no dialog, immediate stop.
- `reset()` behavior and the "New Mission" button are unchanged.
