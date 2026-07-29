# "Phát trên UI thật" — Full-Fidelity Phase Replay Design

## Problem

The "Phát trên UI thật" ("Play on Real UI") replay mode is currently fake: it
always renders `MissionDashboard`, regardless of what phase the recorded
mission was actually in at that point in time. A recorded mission that went
through Planning → ReviewPlan → Executing → Done just looks like it's frozen
on the dashboard the entire time. The user wants the replay to reproduce
**exactly** what the user saw live — every phase transition, every popup,
every screen — the only difference being that no real backend/API calls are
made.

This is scoped to `/mission?replay=<id>` (`MissionControlPage.jsx`'s
`isReplayMode` branch) and `useReplay.js`. Presentation Mode
(`PresentationModePage.jsx` / `PresentationTimeline.jsx`) is a separate
feature and is explicitly out of scope — it must not be touched.

## Root cause

Three confirmed defects:

1. `MissionControlPage.jsx`'s `isReplayMode` branch unconditionally renders
   only `MissionDashboard` — it never renders `PlanningStream`, `PlanReview`,
   or `PromptPreview`, regardless of phase.
2. `useReplay.js`'s `EMPTY_STATE()` hardcodes `phase: 'Executing'` forever.
   No case in its `applyEvent` switch ever updates `phase`, unlike
   `useMission.js`, which actively tracks
   `Planning → ReviewPlan → Deploying/Executing → Done`.
3. Replay skips the `PlanReview` / `PromptPreview` step entirely, even though
   the backend already has the data to reproduce it: `sendToWindow` (in
   `electron/ipc/mission.cjs`) wraps recording capture around **every**
   channel it sends, and `replayEngine.cjs` re-emits **every** recorded event
   verbatim on its original channel during playback — including
   `mission:plan-ready`. The data is already flowing; the frontend just never
   listens for it or reacts to it.

## Design

### 1. `useReplay.js` — phase tracking + separated pending state

Add phase derivation to `applyEvent`, mirroring `useMission.js`'s live logic:

- `mission:agent-spawned` with `reset: true` → `phase: 'Planning'` (mirrors
  live mode's new-mission-starts-in-Planning rule).
- `mission:plan-ready` (new case, channel added to the `channels` listen
  list) → `phase: 'ReviewPlan'`, store the payload (`agents`, `tasks`,
  `mission_context`) into a new `replayPlanReady` state — separate from
  `replayMissionState`, mirroring how `useMission.js` keeps `planReady`
  outside `missionState`.
- First `mission:task-update` event occurring after a `ReviewPlan` phase was
  seen → `phase: 'Executing'` (there is no dedicated "deploy" channel
  recorded live either — `useMission.js` infers `Deploying` from the local
  `deploy()` call, which doesn't exist in replay; inferring `Executing` from
  the first post-review `mission:task-update` is the closest replay-safe
  equivalent and is good enough since `Deploying` is a near-instant
  transitional state in live mode anyway). `mission:agent-message` and log
  events do not trigger this transition — only `mission:task-update` does,
  to keep the condition single and unambiguous.
- `mission:status` with terminal status (`completed`/`stopped`/`failed`) →
  `phase: 'Done'`.

Add two new pieces of state, populated the same way `useMission.js` exposes
them (separate from `replayMissionState`, not nested):

- `pendingQuestion` — set by `mission:question`, cleared by
  `mission:answer-sent`. Replaces today's `_pendingQuestion` field nested
  inside `replayMissionState`.
- `mockupInfo` — set by `mission:mockup`, cleared when a
  `mission:answer-sent`-equivalent mockup-resolution event is replayed (there
  isn't a dedicated one today; clear it the same way `mission:mockup`
  entries currently get appended to `mockup_events` — keep appending to
  `mockup_events` for history, but also mirror the latest unresolved one into
  `mockupInfo` for display, clearing it on the next `mission:mockup` or on
  reaching a new phase).

Both are returned from the hook alongside the existing return values.

Because `applyEvent` already processes events strictly in recorded order
(driven by `replay:progress`/`replay_seek` on the backend, which replays
from the start up to the target position on every seek), phase and pending
state naturally stay correct across seeks/scrubs — no separate seek-handling
logic needed on the frontend.

### 2. Read-only interaction lock

Add a `readOnly` boolean prop to the components that get reused inside
replay:

- `PlanReview` — when `readOnly`, the Deploy button, Re-plan button/input,
  drag-and-drop (`DndContext` sensors), add/edit/delete task, add/remove
  agent, model chips, and custom-prompt editing all render disabled/inert.
  Layout and content stay pixel-identical to the live version; nothing is
  clickable/editable.
- `PromptPreview` — when `readOnly`, the per-agent prompt edit button and
  "Deploy Mission" button are disabled.
- The mockup approval card inside `PlanningStream` (`MockupApprovalCard`) —
  when `readOnly`, the Approve button and feedback textarea are disabled.
- The question card (used by `MissionDashboard`'s intervention panel) — same
  treatment when shown during replay.

No new components are created; existing ones gain one prop and a handful of
`disabled={readOnly}` / `readOnly={readOnly}` bindings at their action
elements.

### 3. `MissionControlPage.jsx` replay branch — phase-driven UI switch

Replace the unconditional `MissionDashboard` render in the `isReplayMode`
branch with the same phase switch already used in live mode further down
the same file:

- `replay.replayMissionState.phase === 'Planning'` → render `PlanningStream`,
  fed with `replay.replayMissionState`, `mockupInfo={replay.mockupInfo}`,
  `onMockupRespond={undefined}` (no-op — the card renders via its own
  `readOnly` prop, see above).
- `phase === 'ReviewPlan'` → render `PlanReview`/`PromptPreview` (same tab
  toggle as live mode's `isPlanReview` branch), fed from
  `replay.replayPlanReady`, with `readOnly` forced `true` and `onDeploy`/
  `onReplan`/`onConfirm` as no-ops.
- Otherwise (`Executing`/`Done`/etc.) → render `MissionDashboard` as today.

`ReplayControls` stays mounted as a fixed-bottom overlay across all three
branches, unchanged — the user confirmed they want it always available
regardless of which phase UI is showing.

## Out of scope

- Presentation Mode and any of its components.
- Any change to how recording captures events (already sufficient — the
  fix is purely in how replay consumes and renders what's already recorded).
- New backend/IPC channels — no new data needs to flow from Electron; the
  channels replay needs are already recorded and re-emitted today.
