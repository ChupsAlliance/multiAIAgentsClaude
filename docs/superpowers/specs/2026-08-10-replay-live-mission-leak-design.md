# Replay events leaking into the live mission hook — design

**Tracked issue:** #6 in `docs/critical-issues-review-2026-08-08.md` — "Replay events leak into the live mission hook"

## Problem

`MissionControlPage.jsx` mounts `useMission()` unconditionally (line 25), regardless of whether the page is currently in replay mode (`isReplayMode`, driven by the `?replay=<id>` query param). `useReplay(isReplayMode ? replayRecordingId : null)` (line 41) is mounted alongside it. The page only branches on `isReplayMode` at render time to decide which hook's state to display — `useMission`'s IPC listeners are always registered and always processing events.

Both hooks listen on the same bare channel names: `mission:status`, `mission:agent-spawned`, `mission:log`, `mission:file-change`, `mission:task-update`, `mission:raw-line`, `mission:agent-message`, `mission:agent-stuck`, `mission:question`, `mission:answer-sent`, `mission:mockup`, `mission:plan-ready`.

`electron/lib/replayEngine.cjs`'s `emitEvent()` re-broadcasts every recorded event on its *original* recorded channel — the same `mission:*` namespace used for live events:

```js
function emitEvent(event) {
  if (!event) return;
  deps.sendToWindow(event.channel, event.payload);
  deps.sendToWindow('replay:progress', { ... });
}
```

This means a replay session's events land on `useMission`'s listeners too. `useMission.js`'s `mission:agent-spawned` handler treats any `reset: true` payload (present at the start of every recorded mission) as the start of a real mission and fabricates a fresh `missionState`, even when `prev` was `null` (no real mission running):

```js
if (reset) {
  const freshAgent = { name: agentName, role, status: 'Running', ... }
  if (!prev) return { agents: [freshAgent], log: [], tasks: [], file_changes: [], raw_output: [], messages: [] }
  return { ...prev, agents: [freshAgent] }
}
```

**Repro:** Open `/mission?replay=<id>` with no active mission, let it play. `useMission`'s hidden listeners silently populate `missionState` from the replayed events. Navigating to `/mission` (same route, no full remount) then renders the live branch using this polluted `missionState`, indistinguishable from a real running mission.

Backend note: `replayEngine.start()` already refuses to start if a real mission is `Running`/`Launching` (`isMissionRunning()` guard), so a real mission and an active replay can never run concurrently. The leak only affects the *idle* case — but that's exactly the repro above, and idle is the common case when browsing recordings.

## Fix

Give replayed events their own IPC channel namespace, so live and replay traffic can never collide, by extending a convention the codebase already has. `electron/ipc/mission.cjs`'s `sendToWindow()` already treats any channel starting with `replay:` as replay-internal and excludes it from recording capture:

```js
if (activeRecording && typeof channel === 'string' && !channel.startsWith('replay:')) {
  // ...capture into recording...
}
```

`replay:progress` already uses this prefix. Business event channels (`mission:log`, `mission:agent-spawned`, ...) forwarded during playback do not — this fix closes that gap.

### `electron/lib/replayEngine.cjs`

- `emitEvent()`: change `deps.sendToWindow(event.channel, event.payload)` to `deps.sendToWindow(\`replay:${event.channel}\`, event.payload)`. The `replay:progress` emission on the next line is unchanged.
- No other change. `start()`, `pause()`, `resume()`, `seek()`, `stop()`, `isActive()`, `normalizeSpeed()` are untouched — they operate on the recording's stored channel names internally and only `emitEvent()` decides what goes out over IPC.

### `src/hooks/useReplay.js`

- Update the channel list / listener-registration effect (currently ~lines 263-294) so each `listen(ch, ...)` call subscribes to the prefixed name while still passing the *bare* channel name into `applyEvent`, which keeps its existing `switch (channel)` cases unchanged:

  ```js
  const channels = [
    'mission:status', 'mission:agent-spawned', 'mission:log', 'mission:file-change',
    'mission:task-update', 'mission:raw-line', 'mission:agent-message', 'mission:agent-stuck',
    'mission:question', 'mission:answer-sent', 'mission:mockup', 'mission:plan-ready',
  ]
  const unlisteners = await Promise.all([
    ...channels.map(ch => listen(`replay:${ch}`, (e) => applyEvent(ch, e.payload))),
    listen('replay:progress', (e) => { ... }),
  ])
  ```

- Update the top-of-file doc comment (lines 6-23) describing the IPC contract to note that replayed business events arrive on `replay:mission:*`, not bare `mission:*`.
- `applyEvent()`'s internal switch/case logic (lines 62-260) is unchanged — it already operates on bare channel names, which is still exactly what it receives.

### `src/hooks/useMission.js`

- **No changes.** It keeps listening on bare `mission:*` channels. Since replay traffic now exclusively uses the `replay:mission:*` namespace, `useMission`'s listeners simply never receive replayed events — regardless of mount order, current route, or whether the component remounts. This removes the entire class of bug at its source rather than teaching `useMission` to distinguish live from replayed payloads.

### `electron/ipc/mission.cjs`

- **No changes.** `sendToWindow()`'s existing `!channel.startsWith('replay:')` guard already correctly excludes the newly-prefixed replay traffic (`replay:mission:log` etc.) from being captured into an active recording — the same way it already excludes `replay:progress` today. `replayEngine.init({ sendToWindow, isMissionRunning })` wiring is unaffected.

## Alternative considered and rejected

**Frontend gating:** pause `useMission.js`'s event handlers while `isReplayMode` is true (early-return in each listener, or unregister/re-register the effect based on a ref-tracked mode flag).

Rejected because:
- Requires new pause/resume bookkeeping inside `useMission`'s single long-lived mount effect (941 lines, already the most complex hook in the app) — the file the issue explicitly flags as needing care, not more surface area.
- Doesn't cleanly solve the "same route, no remount" case: gating handles *ignoring new events* during replay, but doesn't address re-hydrating correctly after replay ends without a real mission underneath.
- Leaves the shared-channel hazard structurally in place — any future new event type added to the protocol has to remember to respect the gate; the channel-separation fix makes that mistake structurally impossible instead of process-dependent.

## Testing

Follow the existing hook-test convention (`vi.mock('@tauri-apps/api/event', ...)` with a `Map`-based channel→callbacks registry and an `emit(channel, payload)` test helper).

- **`electron/lib/replayEngine.test.cjs`**: update the channel-name assertions (e.g. `businessEvents.map(e => e.channel)` comparisons) to expect `replay:` + the recorded channel name, across the instant-speed, pause/resume, and seek test blocks. The existing `e.channel !== 'replay:progress'` filters keep working unchanged, since `replay:mission:log` etc. are still not equal to `replay:progress`.
- **`src/hooks/useReplay.phase.test.jsx`**: update every `emit('mission:...', ...)` call to `emit('replay:mission:...', ...)` to match the new subscription channel. No changes to assertions on `replayMissionState`/`replayPlanReady`/etc. — `applyEvent`'s behavior is unchanged.
- **`src/hooks/useReplay.qa-mockup.test.jsx`**: same update — `emit('mission:question', ...)` / `emit('mission:answer-sent', ...)` → `emit('replay:mission:question', ...)` / `emit('replay:mission:answer-sent', ...)`.
- **New file `src/hooks/useMission.replay-isolation.test.jsx`**: a regression test that reproduces the original bug scenario at the hook level — render `useMission()` and `useReplay(recordingId)` together against the same mocked `listen()` registry, emit a `reset: true` `agent-spawned`-shaped event on the *prefixed* replay channel (simulating what `replayEngine` now sends), and assert:
  - `useReplay`'s `replayMissionState` updates as expected (replay still works).
  - `useMission`'s `missionState` remains `null`/untouched (no leak) — this is the actual regression check for issue #6, proving that even with both hooks mounted simultaneously (as `MissionControlPage.jsx` does today), replay data cannot reach live state.

No changes needed to `useMission.test.jsx` or `useMission.ipc-errors.test.jsx` — they exercise bare `mission:*` channels only, which remain the live-event convention unchanged.

## Global constraints

- No backend IPC whitelist changes — `replay:mission:*` channels are outbound-only (main → renderer via `webContents.send`), never invoked from the renderer, so `preload.cjs`'s `ALLOWED_COMMANDS` is unaffected.
- No change to the recorded event schema (`recordingSchema.cjs`) or to how events are stored — only how they're re-broadcast during playback.
- No change to `replayEngine.start()`'s existing `isMissionRunning()` guard — real-mission/active-replay mutual exclusion is already correct and out of scope here.
