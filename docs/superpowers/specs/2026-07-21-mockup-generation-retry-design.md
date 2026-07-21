# Mockup Generation Auto-Retry — Design

## Problem

`spawnMockupGenerator()` in `electron/ipc/mission.cjs` generates a UI mockup by spawning a Claude CLI subprocess via `runClaudeForHtml(prompt)`, which hard-kills the process and rejects after a fixed 60s timeout. On any failure (timeout, spawn error, or missing `<<<HTML>>>` markers in output), the mission immediately falls through to the existing skip-and-continue path: it logs "Mockup generation failed (...) — continuing planning" and calls `restartLeadAfterMockup()` with a `MOCKUP SKIPPED` injection, resuming the Lead's planning session without ever showing the user a mockup.

This is a real, working failure-handling mechanism — but it has no retry. A single transient failure (e.g. one slow/timed-out `claude` invocation) permanently skips the mockup for that mission with no second attempt, even though a retry would often succeed.

## Goal

Add automatic retry to mockup generation: attempt `runClaudeForHtml(prompt)` up to a fixed number of times before falling through to the existing skip-and-continue behavior. No other behavior changes — the timeout mechanism, the skip fallback, and the `restartLeadAfterMockup` injection all stay exactly as they are today; retry only wraps the call that can fail.

## Design

### Retry parameters (decided via brainstorming Q&A)

- **Total attempts:** 3 (1 initial + 2 retries).
- **Timeout per attempt:** fixed 60s on every attempt — no increasing/backoff timeout schedule.
- **Delay between attempts:** none — retry immediately on failure.
- **Logging:** on each failed attempt (except after the final attempt, which falls through to the existing failure log), log a progress entry to the mission log in the form `Mockup lỗi (lần X/3), đang thử lại...` so the user sees retry activity in real time.

### Implementation shape

In `spawnMockupGenerator()`, replace the single `await runClaudeForHtml(prompt)` call with a loop of up to 3 attempts:

```js
const MAX_ATTEMPTS = 3;
let htmlContent;
let lastErr;

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  try {
    htmlContent = await runClaudeForHtml(prompt);
    lastErr = null;
    break;
  } catch (err) {
    lastErr = err;
    if (attempt < MAX_ATTEMPTS) {
      const entry = makeLogEntry(now(), 'System',
        `Mockup lỗi (lần ${attempt}/${MAX_ATTEMPTS}), đang thử lại...`, 'info');
      if (missionState) missionState.log.push(entry);
      sendToWindow('mission:log', entry);
    }
  }
}

if (lastErr) {
  throw lastErr; // falls through to the existing catch block / skip-and-continue path
}
```

This sits inside the existing `try { ... } catch (err) { ...skip-and-continue... }` block in `spawnMockupGenerator`, so the outer catch (which already logs "Mockup generation failed (...) — continuing planning" and calls `restartLeadAfterMockup`) requires no changes — it now simply fires only after all 3 attempts are exhausted, instead of after 1.

### Progress-warning timers (`warn30` / `warn50`)

These currently fire once per `spawnMockupGenerator` call based on total elapsed time since the whole generation process started. Per the retry design, they should reset per-attempt, so the user gets a "30s in" / "50s in" warning relative to each individual attempt rather than only the first one. The existing `cleanup()` (`clearTimeout(warn30); clearTimeout(warn50);`) is called after each attempt (success or failure) and the timers are re-armed at the start of the next attempt.

### What does NOT change

- `runClaudeForHtml()` itself — no changes to its 60s timeout, its process-kill behavior, or its `<<<HTML>>>` marker parsing.
- The skip-and-continue fallback (`restartLeadAfterMockup` with the `MOCKUP SKIPPED` injection) — unchanged, just triggered after 3 failures instead of 1.
- The mockup success path (serving HTML via `http.createServer`, `shell.openExternal`, `sendToWindow('mission:mockup', ...)`) — unchanged.

## Scope

Single file: `electron/ipc/mission.cjs`. Only the body of `spawnMockupGenerator()` changes — the retry loop replaces the single `await runClaudeForHtml(prompt)` call, and the `warn30`/`warn50` timer setup moves inside the per-attempt loop. No changes to `runClaudeForHtml`, `restartLeadAfterMockup`, or any other function.

## Acceptance Criteria

- A mockup generation that fails on attempt 1 but succeeds on attempt 2 or 3 results in the mockup being shown normally (no skip), with a `Mockup lỗi (lần 1/3), đang thử lại...` log entry appearing before the successful attempt.
- A mockup generation that fails on all 3 attempts falls through to the existing skip-and-continue behavior exactly as today (same log message, same `restartLeadAfterMockup` injection), with two `Mockup lỗi (lần X/3), đang thử lại...` entries logged beforehand (after attempts 1 and 2).
- Each attempt gets its own independent 60s timeout and its own `warn30`/`warn50` progress warnings — a slow attempt 1 does not shorten the timeout available to attempt 2 or 3.
- Total worst-case time for full mockup failure is ~180s (3 × 60s) plus negligible overhead, up from ~60s today — this tradeoff was implicitly accepted by the user in choosing 3 fixed-timeout attempts over faster/increasing alternatives.
