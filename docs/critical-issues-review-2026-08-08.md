# Critical issues — full codebase review (2026-08-08)

Found via a 5-agent parallel review (Electron main/IPC/security, electron/lib, React components, frontend hooks/lib/utils, build/test/config). Tracked here so fixes can be planned and checked off one by one.

## 1. Retry timers not cancelled on Stop/Reset mission
- **Where:** `electron/ipc/mission.cjs:2390`, `:2994`, `:3047`
- **Bug:** Retry backoff timers (`setTimeout(() => retrySpawn(...), delay)`, up to 120s) scheduled after a transient API error / dangling-question detection are never stored or cancelled. `stop_mission`/`reset_mission` (`mission.cjs:4487-4538`) clear other intervals but have no reference to these timers.
- **Repro:** Mission hits a transient API error → retry scheduled 30-120s out → user clicks Stop or Reset before it fires → timer still fires → calls `attemptSpawnDeploy`/`attemptSpawnLaunch` which write to `missionState` with no null-guard (unlike `attemptSpawnContinue`, which does guard) → either an uncaught `TypeError` crashes the main process (if `missionState` was nulled by reset), or a `claude` child process is silently respawned after the user believed the mission was stopped.
- [x] Fixed

## 2. Command injection in "launch in terminal"
- **Where:** `electron/ipc/system.cjs` (`launch_in_terminal`)
- **Bug:** `projectPath` is concatenated unescaped into a shell command string (`cd /d "${projectPath}" && ... && claude "${safePrompt}"`), then passed through `cmd /C wt cmd /K ...`. Only `prompt` is partially escaped; `projectPath` is not, and it comes from a free-text `<input>` in `src/pages/PlaygroundPage.jsx:294-296`.
- **Repro:** User types/pastes `C:\proj" & calc.exe & "` as the project path → arbitrary command execution via cmd.exe injection.
- **Fix (commits `2a875a4..5771176`, design doc `docs/superpowers/specs/2026-08-08-launch-terminal-command-injection-design.md`):** `projectPath` now goes through `spawn`'s structured `cwd` option (never shell-parsed) with existence/directory validation. `prompt` is escaped with a two-layer scheme (`win32QuoteArg` for `claude`'s own argv parsing + `escapeForCmdExe` caret-escaping for `cmd.exe`'s own parser) — empirically verified against the real `cmd.exe` with dozens of attack payloads including unquoted injection targets.
- **Known residual risk (accepted 2026-08-08):** if `claude` resolves via `PATH` to an npm-installed `.cmd`/`.bat` shim (e.g. `npm install -g @anthropic-ai/claude-code`, a common Windows install method) rather than a native `.exe`, the shim's `%*`-forwarding causes a second `cmd.exe` parse pass that strips the caret-escaping layer, re-exposing the injection. This is a structural limitation (same class as Node.js CVE-2024-27980 "BatBadBut") — no string-escaping scheme can survive an unknown number of `cmd.exe` parse passes. Not exploitable when `claude` is a native binary. Human partner reviewed and explicitly accepted this residual risk rather than implementing shim-detection; see `.superpowers/sdd/2026-08-08-launch-terminal-command-injection/progress.md` for the full decision trail.
- [x] Fixed (substantially mitigated; npm-shim residual risk accepted, not eliminated)

## 3. QC/QA verdict parsing likely never matches real output
- **Where:** `electron/lib/qcqa.cjs:99-105` (`parseQcQaVerdict`) vs. `claudeAdapter.buildLaunchArgs` (always appends `--output-format stream-json --verbose`)
- **Bug:** `parseQcQaVerdict` regex `^[QC] VERDICT: PASS$` is matched against raw concatenated stdout. In production, stdout is newline-delimited JSON, so the verdict line is embedded as an escaped string inside a JSON blob, never at the true start/end of a physical line — the anchors never match. Falls through to default `FAIL`. Unit tests don't catch this because they emit plain unwrapped text instead of a real stream-json envelope.
- **Effect:** QC/QA gating reports FAIL on essentially every real check, driving spurious retries/escalation regardless of actual agent output.
- **Fix (design doc `docs/superpowers/specs/2026-08-08-qcqa-verdict-parsing-design.md`, plan `docs/superpowers/plans/2026-08-08-qcqa-verdict-parsing.md`):** `runQcQaCheck` now extracts the agent's last real assistant text via the backend adapter's own `parseLine()` (already used elsewhere for the same purpose) before handing it to the unchanged `parseQcQaVerdict` regex. Wired into production via `mission.cjs::qcQaSpawnOpts()`. Verified with rewritten unit tests using real stream-json/Copilot fixtures plus a real end-to-end test spawning the actual `claude` CLI.
- [x] Fixed

## 4. QC/QA spawn has no `error` listener
- **Where:** `electron/lib/qcqa.cjs:56-107` (`runQcQaCheck`)
- **Bug:** No `proc.on('error', ...)` registered on the spawned child process. If the `claude`/adapter binary is missing from PATH or fails to spawn (EACCES etc.), Node's unhandled `'error'` event throws synchronously with nothing to catch it.
- **Effect:** Can crash the entire Electron main process mid-mission.
- **Fix (design doc `docs/superpowers/specs/2026-08-08-qcqa-error-listener-design.md`, plan `docs/superpowers/plans/2026-08-08-qcqa-error-listener.md`):** `runQcQaCheck` now registers `proc.on('error', ...)`, mirroring the existing spawn-error pattern already used elsewhere in the codebase (`electron/ipc/history.cjs:134`, `electron/ipc/mission.cjs:3471,3559,4457`). It clears the timeout, guards against double-resolution with the function's existing `settled` flag, and resolves (never rejects) `{ verdict: 'FAIL', responsibleAgent: null, reason: 'QC/QA process error: <message>' }` — same shape as the existing timeout branch. Verified with unit tests covering both a bare spawn-error and an error emitted after `close` (no double-resolve).
- [x] Fixed

## 5. Export / plan version history completely broken
- **Where:** `src/components/mission/ExportDropdown.jsx:61,96`, `src/components/mission/PlanVersionHistory.jsx:15,34`, `src/components/mission/PlanDocument.jsx:454`
- **Bug:** These call `window.electron.ipcRenderer.invoke(...)`, but the preload script (`electron/preload.cjs:49`) only exposes `window.electronAPI` (`.invoke`/`.on`). `window.electron` is never defined.
- **Effect:** "Export Markdown/PDF" always fails (caught, shows a failure toast). Plan version history (`PlanVersionHistory.jsx`) silently renders an always-empty list — rollback is impossible. `PlanDocument.jsx:454` uses optional chaining, so manual-edit versions are silently never persisted (no error shown at all). Backend IPC handlers (`save_plan_version`, `get_plan_versions`, `export_plan_markdown`, `export_plan_pdf`) are correctly whitelisted — this is a pure frontend wiring bug.
- **Fix (design doc `docs/superpowers/specs/2026-08-10-export-plan-version-wiring-design.md`, plan `docs/superpowers/plans/2026-08-10-export-plan-version-wiring.md`):** All three call sites now use the `invoke()` helper from `@tauri-apps/api/core` (`src/lib/tauri-shim/core.js`), matching the dominant IPC convention already used by 15+ other files in this codebase, instead of the nonexistent `window.electron.ipcRenderer.invoke(...)` global. `PlanDocument.jsx:454` also dropped its now-unnecessary `?.`/`?.` optional chaining, since `invoke()` is a plain always-callable function. No backend, preload, or shim changes. Verified with new component tests: `ExportDropdown.test.jsx`, `PlanVersionHistory.test.jsx`, `PlanDocument.test.jsx`.
- [x] Fixed

## 6. Replay events leak into the live mission hook
- **Where:** `src/hooks/useMission.js` (whole file) + `src/hooks/useReplay.js:11-23,271`
- **Bug:** `MissionControlPage.jsx:25,41` mounts `useMission()` unconditionally even in replay mode. The backend replay engine re-emits recorded events on the *same* IPC channels as live events (`electron/ipc/mission.cjs:3569`). `useMission.js`'s `mission:agent-spawned` handler builds a fresh `missionState` from any `reset:true` event, even when no real mission is running.
- **Repro:** Open `/mission?replay=<id>` with no active mission, let it play — the hidden `useMission()` listeners silently populate `missionState` from replayed data. Navigating to `/mission` (same route, no remount) can then show the polluted state as if it were a real, currently-running mission.
- [ ] Fixed

## 7. No CI pipeline at all
- **Where:** `.github/` (only contains `copilot-instructions.md`, no `workflows/`)
- **Bug:** Nothing gates merges — `npm test`, `npm run test:e2e`, or build never run automatically. `playwright.config.ts:21-22` references `process.env.CI` (forbidOnly/retries) as if CI exists, but it's dead code today.
- **Effect:** All of the above bugs (and future ones) can land on `main` with no automated check catching them.
- [ ] Fixed

## 8. Vitest runner intermittently fails to load, all test files fail
- **Where:** repo-wide — `npx vitest run` (vitest v4.1.8, vite v7.3.5)
- **Symptom:** Occasionally every test file fails at the `describe(...)` call site with `TypeError: Cannot read properties of undefined (reading 'config')`, before any test body runs. Seen on `electron/lib/qcqa.test.cjs` and, per the final-review agent for issue #4, on unrelated files too (e.g. `OfficeLayoutStore.test.ts`, `pixelAgentsProtocol.test.js`).
- **Investigated (2026-08-10, systematic-debugging):** Not caused by this repo. No vitest-related files (`package.json`, `vitest.config.*`, `vite.config.*`) changed near the failure (checked via `git log`/`git diff`). Attempted reproduction 15+ times — sequential runs, cold `node_modules/.vite` cache, 3 concurrent same-process runs, 3 trials of cold-cache + 5 concurrent CPU-heavy Node processes (simulating the review agent's own verification load), and via PowerShell instead of Bash — **zero reproductions**; `npx vitest run` passed 393/394 real tests every time (the 1 known-unrelated failure category is 3 Playwright spec files vitest's default glob incorrectly picks up, pre-existing, tracked separately if ever prioritized). The error signature matches a known upstream Vite plugin-context initialization race — see [vitejs/vite#19144](https://github.com/vitejs/vite/issues/19144), where a plugin hook (`buildEsbuildPlugin`) reads `this.environment.config` before `this.environment` is bound; still "needs reproduction" on Vite's own tracker, i.e. even Vite's maintainers can't reliably trigger it either.
- **Effect:** Rare, non-deterministic `npx vitest run` failures unrelated to any actual code defect. No project-side fix is applicable — the race lives inside Vite's plugin-environment binding, not in this repo's config or dependencies.
- **Resolution:** Closed as an upstream Vite issue, not actionable in this repo. If it recurs, note the exact concurrent system state at the time (other running processes) for a sharper repro before re-opening.
- [x] Investigated — not a project bug (upstream Vite race, not independently reproducible)

---
*Important/Minor findings from the same review (path traversal in `read_superpowers_skill`/`files.cjs`, non-atomic index writes in `recordingStore.cjs`/`missionIndex.cjs`, `compareSemver` pre-release handling, prompt injection in `promptWrapper.js`, broken drag-and-drop, missing ErrorBoundary, outdated Electron version, unpinned third-party clone in `build-pixel-agents.cjs`, etc.) were reported in conversation but not tracked here — revisit after the Critical list is cleared.*
