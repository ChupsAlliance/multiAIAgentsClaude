# Replay events leaking into the live mission hook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give replayed IPC events their own channel namespace (`replay:mission:*`) so a replay session run with no live mission can never populate `useMission`'s `missionState`, closing Issue #6.

**Architecture:** `electron/lib/replayEngine.cjs`'s `emitEvent()` prefixes every outbound channel with `replay:` before calling `sendToWindow`. `src/hooks/useReplay.js` subscribes on the prefixed channel names (still dispatching into its existing bare-channel `applyEvent` switch). `src/hooks/useMission.js` is untouched — it keeps listening on bare `mission:*` channels, which replay traffic no longer touches at all.

**Tech Stack:** Electron (`ipcMain`/`webContents.send`), React hooks, `@tauri-apps/api/core` + `@tauria-apps/api/event` compatibility shim, Vitest + React Testing Library.

## Global Constraints

- No backend IPC whitelist changes — `replay:mission:*` channels are outbound-only (main → renderer), never invoked from the renderer, so `electron/preload.cjs`'s `ALLOWED_COMMANDS` is unaffected.
- No change to the recorded event schema (`recordingSchema.cjs`) or to how events are stored on disk — only how they are re-broadcast during playback.
- No change to `replayEngine.start()`'s existing `isMissionRunning()` mutual-exclusion guard.
- `src/hooks/useMission.js` gets **no code changes** at all — the fix removes the hazard structurally rather than teaching it to distinguish live from replayed payloads.
- `applyEvent()` inside `src/hooks/useReplay.js` (its internal `switch (channel)` reducer) keeps operating on **bare** channel names — only the `listen()` subscription argument changes.

---

### Task 1: Prefix replay-forwarded channels in the backend replay engine

**Files:**
- Modify: `electron/lib/replayEngine.cjs:14-19` (`emitEvent`)
- Test: `electron/lib/replayEngine.test.cjs:96-99`

**Interfaces:**
- Consumes: nothing new — `emitEvent(event)` already receives `{ channel, payload, relativeTimestamp }` from its three call sites (`scheduleNext`, `fireDueEvent`, `seek`'s flush loop), which are unchanged by this task.
- Produces: `deps.sendToWindow` is now called with `` `replay:${event.channel}` `` instead of the bare `event.channel` for every recorded business event. `replay:progress` is unchanged (already prefixed). This is the contract Task 2 depends on.

- [ ] **Step 1: Write the failing test — update the channel-name assertion to expect the `replay:` prefix**

In `electron/lib/replayEngine.test.cjs`, find the assertion (inside the "sends every event synchronously..." test, around lines 96-99):

```js
      const businessEvents = sentEvents.filter(e => e.channel !== 'replay:progress');
      expect(businessEvents.map(e => e.channel)).toEqual(
        recording.events.map(e => e.channel)
      );
```

Replace it with:

```js
      const businessEvents = sentEvents.filter(e => e.channel !== 'replay:progress');
      expect(businessEvents.map(e => e.channel)).toEqual(
        recording.events.map(e => `replay:${e.channel}`)
      );
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/lib/replayEngine.test.cjs -t "sends every event synchronously"`
Expected: FAIL — actual channel names (`mission:status`, `mission:agent-spawned`, ...) don't match the now-expected `replay:mission:status`, `replay:mission:agent-spawned`, ...

- [ ] **Step 3: Implement the minimal fix**

In `electron/lib/replayEngine.cjs`, find `emitEvent`:

```js
function emitEvent(event) {
  if (!event) return;
  deps.sendToWindow(event.channel, event.payload);
  deps.sendToWindow('replay:progress', {
    currentMs: event.relativeTimestamp,
    totalMs: session ? session.totalMs : 0,
    eventIndex: session ? session.index : 0,
  });
}
```

Change the first `sendToWindow` call:

```js
function emitEvent(event) {
  if (!event) return;
  deps.sendToWindow(`replay:${event.channel}`, event.payload);
  deps.sendToWindow('replay:progress', {
    currentMs: event.relativeTimestamp,
    totalMs: session ? session.totalMs : 0,
    eventIndex: session ? session.index : 0,
  });
}
```

- [ ] **Step 4: Run the full file to verify it passes and nothing else broke**

Run: `npx vitest run electron/lib/replayEngine.test.cjs`
Expected: PASS, all tests in the file (instant-speed, pause/resume, seek scenarios — these only assert on `.payload`/counts, not `.channel`, so they were unaffected by Step 1's edit).

- [ ] **Step 5: Commit**

```bash
git add electron/lib/replayEngine.cjs electron/lib/replayEngine.test.cjs
git commit -m "fix: prefix replayed IPC events with replay: channel namespace"
```

---

### Task 2: Subscribe `useReplay` to the prefixed channel namespace

**Files:**
- Modify: `src/hooks/useReplay.js:6-23` (doc comment), `:262-294` (listener-registration effect)
- Test: `src/hooks/useReplay.phase.test.jsx` (9 `emit()` call sites), `src/hooks/useReplay.qa-mockup.test.jsx` (3 `emit()` call sites)

**Interfaces:**
- Consumes: `replay:${bareChannel}` events emitted by `electron/lib/replayEngine.cjs`'s `emitEvent()` from Task 1.
- Produces: no change to `useReplay`'s own return shape (`replayMissionState`, `replayPlanReady`, etc.) — `applyEvent(channel, payload)` still receives bare channel names as its first argument, unchanged behavior for every downstream consumer of the hook.

- [ ] **Step 1: Write the failing tests — prefix every `emit()` call in the two hook test files**

In `src/hooks/useReplay.phase.test.jsx`, replace every occurrence of the literal string `emit('mission:` with `emit('replay:mission:` (17 occurrences in this file — every `emit(...)` call in the file targets a `mission:*` channel, so a literal find-and-replace of `emit('mission:` → `emit('replay:mission:` catches all of them without touching the `listen('replay:progress', ...)` mock registration or the `unlisteners`/`listeners` plumbing, which use no such string).

In `src/hooks/useReplay.qa-mockup.test.jsx`, apply the same literal replacement: `emit('mission:` → `emit('replay:mission:` (4 occurrences in this file).

- [ ] **Step 2: Run both test files to verify they fail**

Run: `npx vitest run src/hooks/useReplay.phase.test.jsx src/hooks/useReplay.qa-mockup.test.jsx`
Expected: FAIL — the tests now emit on `replay:mission:*` channels, but `useReplay.js` still subscribes on bare `mission:*` channels, so `applyEvent` is never invoked and the assertions on `replayMissionState`/`replayPlanReady`/etc. time out or see stale values.

- [ ] **Step 3: Implement the minimal fix in `useReplay.js`**

Find the listener-registration effect:

```js
  useEffect(() => {
    let cancelled = false
    const setup = async () => {
      const channels = [
        'mission:status', 'mission:agent-spawned', 'mission:log', 'mission:file-change',
        'mission:task-update', 'mission:raw-line', 'mission:agent-message', 'mission:agent-stuck',
        'mission:question', 'mission:answer-sent', 'mission:mockup', 'mission:plan-ready',
      ]
      const unlisteners = await Promise.all([
        ...channels.map(ch => listen(ch, (e) => applyEvent(ch, e.payload))),
        listen('replay:progress', (e) => {
```

Change only the `channels.map(...)` line:

```js
      const unlisteners = await Promise.all([
        ...channels.map(ch => listen(`replay:${ch}`, (e) => applyEvent(ch, e.payload))),
        listen('replay:progress', (e) => {
```

The rest of the effect (cleanup, `cancelled` guard, `unlistenersRef`) is unchanged. `applyEvent`'s internal `switch (channel)` (lines 62-260) is unchanged — it already receives the bare `ch` value via the explicit second argument to `listen`'s callback, not the raw event channel.

Also update the top-of-file doc comment (lines 6-23) describing the IPC contract: wherever it lists the bare channel names (e.g. `mission:log`, `mission:agent-spawned`, `mission:task-update`, `mission:file-change`, `mission:agent-message`, `mission:status`, `mission:agent-stuck`) as what this hook listens on, prefix each with `replay:` (e.g. `replay:mission:log`) and add a short note that replayed business events arrive on `replay:mission:*`, distinct from the live `mission:*` namespace `useMission` listens on.

- [ ] **Step 4: Run the two test files to verify they pass**

Run: `npx vitest run src/hooks/useReplay.phase.test.jsx src/hooks/useReplay.qa-mockup.test.jsx`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useReplay.js src/hooks/useReplay.phase.test.jsx src/hooks/useReplay.qa-mockup.test.jsx
git commit -m "fix: subscribe useReplay to the replay:mission:* channel namespace"
```

---

### Task 3: Update the page-level replay integration test to the new channel contract

**Files:**
- Modify: `src/pages/MissionControlPage.replay-phases.test.jsx` (6 `emitEvent()` call sites)

**Interfaces:**
- Consumes: the `replay:mission:*` contract from Task 2 — this file renders the real (unmocked) `useReplay` hook through the real `MissionControlPage` component tree (it mocks `useMission` entirely, so it's a pure `useReplay` + rendering integration test, not a regression test for Issue #6 itself).
- Produces: nothing consumed by later tasks — this is a leaf test file.

- [ ] **Step 1: Write the failing test — prefix every `emitEvent()` call**

In `src/pages/MissionControlPage.replay-phases.test.jsx`, replace every occurrence of the literal string `emitEvent('mission:` with `emitEvent('replay:mission:` (6 occurrences: 2 in the "Planning phase" test, 3 in the "ReviewPlan phase" test's setup plus its own event, and so on — every `emitEvent(...)` call in the file targets a `mission:*` channel). The local `emitEvent(channel, payload)` helper at the bottom of the file (a thin wrapper around `emit`) itself needs no change — only its call sites' channel-name arguments.

- [ ] **Step 2: Run the test file to verify it fails**

Run: `npx vitest run src/pages/MissionControlPage.replay-phases.test.jsx`
Expected: FAIL — events are emitted on `replay:mission:*` channels but (before this task's dependency, Task 2, is applied) or if run against pre-Task-2 code, `useReplay` doesn't react; run this after Task 2 is already committed, so the real failure mode being guarded against here is verifying this specific file's call sites are all updated — if any occurrence was missed, that specific test (e.g. "Executing phase renders MissionDashboard") stays on the old bare channel and its `waitFor(...)` assertion times out.

- [ ] **Step 3: No further implementation needed**

`useReplay.js` was already fixed in Task 2. This task is a test-only migration — Step 1's edit is the entire change.

- [ ] **Step 4: Run the test file to verify it passes**

Run: `npx vitest run src/pages/MissionControlPage.replay-phases.test.jsx`
Expected: PASS, all 3 tests (Planning phase, ReviewPlan phase, Executing phase).

- [ ] **Step 5: Commit**

```bash
git add src/pages/MissionControlPage.replay-phases.test.jsx
git commit -m "test: update MissionControlPage replay-phase test to replay:mission:* channels"
```

---

### Task 4: Add the regression test proving live/replay isolation

**Files:**
- Create: `src/hooks/useMission.replay-isolation.test.jsx`

**Interfaces:**
- Consumes: `useMission()` (from `src/hooks/useMission.js`, no params, returns `{ missionState, ... }`) and `useReplay(recordingId)` (from `src/hooks/useReplay.js`, returns `{ replayMissionState, loading, ... }`) — both hooks mounted simultaneously in the same test, mirroring `MissionControlPage.jsx`'s actual unconditional-mount pattern (`useMission()` always mounted; `useReplay(isReplayMode ? replayRecordingId : null)` mounted alongside it).
- Produces: nothing — this is a leaf regression test, the final task in this plan.

- [ ] **Step 1: Write the regression test**

Create `src/hooks/useMission.replay-isolation.test.jsx`:

```jsx
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'
import { vi, afterEach, test, expect } from 'vitest'
import { useMission } from './useMission'
import { useReplay } from './useReplay'

const listeners = new Map()
function emit(channel, payload) {
  const cbs = listeners.get(channel) || []
  cbs.forEach(cb => cb({ payload }))
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd) => {
    if (cmd === 'replay_start') {
      return Promise.resolve({ totalMs: 1000, eventCount: 1, recording: { name: 'demo' }, stepMarkers: [] })
    }
    return Promise.resolve(null)
  }),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((channel, cb) => {
    if (!listeners.has(channel)) listeners.set(channel, [])
    listeners.get(channel).push(cb)
    return Promise.resolve(() => {
      const arr = listeners.get(channel) || []
      const idx = arr.indexOf(cb)
      if (idx >= 0) arr.splice(idx, 1)
    })
  }),
}))

const stableToast = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() }
vi.mock('./useToast', () => ({
  useToast: () => ({ toast: stableToast }),
}))

afterEach(() => {
  cleanup()
  listeners.clear()
})

test('a replayed reset agent-spawned event updates useReplay but leaves useMission untouched', async () => {
  const mission = renderHook(() => useMission())
  const replay = renderHook(() => useReplay('rec-isolation-1'))

  await act(async () => { await Promise.resolve() })
  await waitFor(() => expect(replay.result.current.loading).toBe(false))

  expect(mission.result.current.missionState).toBe(null)

  act(() => {
    emit('replay:mission:agent-spawned', { agent_name: 'Lead', role: 'Coordinator', reset: true, timestamp: 1 })
  })

  await waitFor(() => expect(replay.result.current.replayMissionState.phase).toBe('Planning'))
  expect(replay.result.current.replayMissionState.agents).toHaveLength(1)

  // Regression check for issue #6: even with both hooks mounted simultaneously
  // (as MissionControlPage.jsx does today), a replayed event must never reach
  // useMission's state.
  expect(mission.result.current.missionState).toBe(null)
})

test('a bare-channel live event still reaches useMission normally', async () => {
  const mission = renderHook(() => useMission())
  await act(async () => { await Promise.resolve() })

  act(() => {
    emit('mission:agent-spawned', { agent_name: 'Lead', role: 'Coordinator', reset: true, timestamp: 1 })
  })

  await waitFor(() => expect(mission.result.current.missionState).not.toBe(null))
  expect(mission.result.current.missionState.agents).toHaveLength(1)
})
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run src/hooks/useMission.replay-isolation.test.jsx`
Expected: PASS, both tests. (Tasks 1-2 already implemented the fix, so this is a pure regression-proof task — there is no "red" step here, since it exercises already-fixed production code; the guardrail is the assertion itself, not a fail/pass transition.)

- [ ] **Step 3: Run the full test suite to confirm no regressions anywhere**

Run: `npx vitest run`
Expected: PASS across the whole suite (aside from the pre-existing, unrelated Playwright-glob false-positive noted in Issue #8's closure — not introduced by this work).

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useMission.replay-isolation.test.jsx
git commit -m "test: add regression test proving replay events cannot leak into useMission"
```

---

## Final Step: Mark Issue #6 fixed

After Task 4's review passes, update `docs/critical-issues-review-2026-08-08.md`'s Issue #6 entry to `[x] Fixed`, following the same pattern used for Issues #1-#5 (a `**Fix (commits ..., design doc ...)**:` line summarizing the change), then commit that doc update separately.
