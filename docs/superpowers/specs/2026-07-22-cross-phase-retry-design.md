# Cross-Phase Transient-API-Error Retry — Design

## Problem

The user's API key intermittently rate-limits for short windows, producing errors like:

```
API Error: Request rejected (429) · This request would exceed your account's rate limit. Please try again later.
```

This can surface at **any** point in a mission's lifecycle: brainstorm/planning, execution, mid-mission Q&A, replan, and subagent work spawned via Agent Teams. Today, none of these paths retry. `electron/ipc/mission.cjs` has exactly one existing retry mechanism, `retryMockupGeneration()` (lines 858-874), which wraps a single, unrelated one-shot call (`runClaudeForHtml`, the mockup generator). It has no delay between attempts and no error-type discrimination — by design, since mockup generation failures are rare and low-stakes (they fall back to skip-and-continue).

The six process-spawning call sites that drive the actual mission (all built on the shared `spawnClaude()` helper, `mission.cjs:805-821`) have **no retry of any kind** today:

| Call site | Line | Phase |
|---|---|---|
| `restartLeadAfterMockup` | 978 | Resume Lead after mockup |
| `launch_mission` | 2418 | Initial planning spawn |
| `deploy_mission` | 2608 | Execution-phase spawn (fresh session, Agent Teams enabled) |
| `continue_mission` | 2772 | Mid-mission continuation (fresh session) |
| `answer_question` | 2856 | Resume Lead after user answers a question |
| `replan_mission` | 2988 | One-shot incremental re-plan (self-contained Promise) |

A failure at any of these currently marks the mission `Failed` on the very first occurrence, even when the underlying cause is a rate limit that would clear itself within seconds to a couple of minutes.

## Goal

Add automatic, bounded retry for **transient API errors only** (rate limits, 5xx, overloaded, network resets) at all six call sites, so a short-lived key outage no longer kills the mission. Non-transient failures (bad prompts, auth errors that aren't rate-limit-shaped, parse failures) must continue to fail immediately, exactly as today — retrying those would only waste up to ~3.5 minutes for no benefit.

## Design

### 1. Transient-error detection (`isTransientApiError`)

A new pure function in `mission.cjs`:

```js
function isTransientApiError(text) {
  return /\b429\b|rate limit|Request rejected|overloaded|\b5\d\d\b|ECONNRESET|ETIMEDOUT|ECONNREFUSED.*api|network error/i.test(text || '');
}
```

Scope of matching, decided via brainstorming Q&A: broader than 429 alone — also covers 5xx, "overloaded", and network-reset/timeout signatures, since these are all transient-by-nature failures a short backoff can plausibly resolve.

Applied to the **combined text of stdout and stderr accumulated during the failed attempt** — the user confirmed they don't know for certain which stream the 429 error prints to, so detection must not assume one or the other. Each call site already accumulates a text buffer it can check (`resultText` in the two shared readers, `fullText` in `replan_mission`'s inline reader); `readProcessStderr` will additionally accumulate a local stderr buffer per attempt for this check (today it only forwards stderr lines to `mission:log`, it does not retain them).

### 2. Retry helper (`retryTransientSpawn`)

A new pure, dependency-injected helper, modeled on `retryMockupGeneration` but with backoff and error-type discrimination:

```js
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

- `runFn(attempt)` performs one spawn attempt and must resolve on success / reject with an `Error` whose `.message` contains whatever stdout/stderr text was captured, so `isTransientApiError` can inspect it.
- Non-transient errors reject immediately on first occurrence — no backoff wasted.
- Transient errors get 3 total attempts with backoff `30s → 60s → 120s` (decided via brainstorming Q&A: fixed schedule, not exponential-unbounded — the user described their outages as short-lived).
- `onRetry(attempt, maxAttempts, err, delay)` is the caller's hook to emit a `mission:log` entry, matching the existing pattern established by `spawnMockupGenerator`'s use of `retryMockupGeneration`.

### 3. Per-call-site integration (three groups)

Session-ID feasibility was investigated directly (not assumed): `missionState.session_id` is captured as soon as a spawn's `system`/`init` stream-json message arrives (the very first line of output), stored globally, and re-used by `--resume`-based call sites. This split the six call sites into three groups with different retry mechanics.

**Group 1 — already resume-based (`restartLeadAfterMockup`, `answer_question`):**
`missionState.session_id` is guaranteed populated before these ever spawn (both require a prior completed exchange). Retry re-invokes the same spawn with the same `--resume <sessionId>` args unchanged — simplest case, no new session-capture logic needed.

**Group 2 — fresh-session by design (`launch_mission`, `deploy_mission`, `continue_mission`):**
These intentionally do NOT pass `--resume` today — each starts a new Claude session by design (deploy/continue are deliberately not continuations of the planning session). Per brainstorming Q&A: on retry, each attempt captures its own `session_id` **locally** (a closure-scoped variable for this retry sequence, distinct from and not overwriting `missionState.session_id` until final success) from its own attempt's `init` message. Behavior on retry:
  - If the prior attempt got far enough to emit its `init` message (local `session_id` captured before failure): retry with `--resume <locally-captured-session-id>` — resumes *this attempt's own* aborted session, not some unrelated prior-phase session.
  - If the prior attempt failed before its `init` message arrived (no local `session_id` yet, e.g. the API rejected the very first request): retry spawns fresh with the original args, identical to the first attempt — there is no partial progress to preserve.

**Group 3 — `replan_mission` (self-contained Promise, distinct architecture):**
Already has its own `proc.on('close')`/`proc.on('error')`/120s-timeout trio and buffers output via an inline `readline` handler rather than the shared readers. Per brainstorming Q&A: wrap the entire existing Promise body in `retryTransientSpawn`, always spawning fresh on each attempt (no resume) — consistent with the user's choice to keep this call site's simpler, self-contained shape rather than adding session-capture machinery to it.

### 4. User-visible logging and terminal behavior

On each retry, emit a `mission:log` entry (same `makeLogEntry` + `sendToWindow('mission:log', ...)` pattern used everywhere else in the file):

```
⚠ Gặp lỗi tạm thời (rate limit/API), đang thử lại lần {attempt}/{maxAttempts} sau {delay/1000}s...
```

If all attempts are exhausted, behavior is **unchanged from today**: the call site proceeds to its existing failure path (`missionState.status = 'Failed'`, existing `mission:status`/`mission:log` events), with one additional log line before that:

```
Đã thử lại {maxAttempts} lần nhưng vẫn gặp lỗi rate limit — dừng mission.
```

No manual "Retry" button, no unbounded/indefinite backoff — decided via brainstorming Q&A. Worst case added latency per call site: 30+60+120 = 210s (3.5 min) before the mission is marked `Failed`, versus immediate failure today.

### What does NOT change

- `spawnClaude()` itself — no signature or behavior change.
- The shared readers (`readProcessStdout_launch`, `readProcessStdout_deploy`) — their line-by-line parsing, `mission:log` streaming, and tool/task tracking are untouched. Retry only wraps the decision point where each call site currently transitions to `Failed`.
- The `isConnErr`/`isTooLarge` classification in `readProcessStdout_launch` (mission.cjs:1522-1523) — unrelated, unchanged.
- `retryMockupGeneration` / `spawnMockupGenerator` — untouched; this is a separate, new mechanism for the six `spawnClaude` call sites, not a modification of the mockup-retry feature shipped in v0.10.0.
- Non-transient failures at any of the six call sites — these continue to fail immediately with no retry, exactly as today.

## Scope

Single file: `electron/ipc/mission.cjs`. New pure helpers (`isTransientApiError`, `retryTransientSpawn`) plus integration at the six existing call sites and their local session-capture/backoff wiring. No changes to any other file, no new IPC channels (reuses `mission:log`/`mission:status`), no renderer/UI changes.

## Acceptance Criteria

- A transient failure (matching `isTransientApiError`) at any of the 6 call sites triggers up to 3 attempts total with 30s/60s/120s backoff between them, logging a retry message before each wait.
- A non-transient failure at any of the 6 call sites fails immediately on the first occurrence — no backoff, no retry attempt, identical to today's behavior.
- Group 1 sites (`restartLeadAfterMockup`, `answer_question`) retry using the same `--resume <sessionId>` they already use.
- Group 2 sites (`launch_mission`, `deploy_mission`, `continue_mission`) resume using a locally-captured `session_id` from the failed attempt's own `init` message when available, or fall back to a fresh spawn with original args when the failure happened before `init` was received.
- Group 3 (`replan_mission`) retries by re-running its existing self-contained Promise body fresh each time, preserving its existing `proc.on('error')` and 120s-timeout behavior per attempt.
- After exhausting all attempts, the mission reaches `Failed` status exactly as it does today (same downstream events), with one additional log line stating the retry exhaustion.
- `retryMockupGeneration`/`spawnMockupGenerator` (mockup generation) are unaffected — no shared code path with the new mechanism beyond both using `makeLogEntry`/`sendToWindow`.
