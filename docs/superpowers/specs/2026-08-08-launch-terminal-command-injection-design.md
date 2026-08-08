# Fix Command Injection in `launch_in_terminal` — Design

## Problem

[docs/critical-issues-review-2026-08-08.md](../../critical-issues-review-2026-08-08.md) issue #2: `launch_in_terminal` (`electron/ipc/system.cjs:191-207`) builds a `cmd.exe` command line by string-concatenating unescaped, user-controlled `projectPath` into a shell string:

```js
const claudeCmd = `cd /d "${projectPath}" && set CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 && claude "${safePrompt}"`;
try {
  spawn('cmd', ['/C', 'wt', 'cmd', '/K', claudeCmd], { detached: true, stdio: 'ignore' });
} catch {
  spawn('cmd', ['/C', 'start', 'cmd', '/K', claudeCmd], { detached: true, stdio: 'ignore' });
}
```

`projectPath` comes from a freely-editable `<input>` in `src/pages/PlaygroundPage.jsx:294-296` — the presence of a native folder-picker button alongside it doesn't make the field trusted, since the text can still be typed or pasted directly. An embedded `"` closes the quoted `cd /d "..."` segment early; anything after it (e.g. `& calc.exe & `) is then parsed by `cmd.exe` as a new command:

**Repro:** project path `C:\proj" & calc.exe & "` → arbitrary command execution.

`prompt` receives partial escaping (`\`→`\\`, `"`→`\"`, strip `\n`/`\r`) before being embedded in the same string, but `cmd.exe`'s metacharacter scanning (`&`, `|`, `<`, `>`, `^`) happens independently of that escaping convention, so it isn't reliably safe either — a defense-in-depth target for this fix, not just the named `projectPath` vector.

### Audit: `scaffold_project`

`scaffold_project` (`electron/ipc/files.cjs:126-185`) receives the same unsanitized `projectPath` but only calls `fs.existsSync`, `path.join`, `fs.mkdirSync`, `fs.writeFileSync` — pure Node filesystem APIs that talk directly to Win32 file APIs, never through a shell. No character in `projectPath` can be interpreted as command syntax there. **Finding: no vulnerability, no code change needed.** Noted here as a completed audit item per the tracked issue's scope decision.

## Design

The fix removes both `projectPath` and `prompt` from any string `cmd.exe` parses — replacing string concatenation with structured, non-parsed channels for each.

### 1. `projectPath` → `spawn`'s `cwd` option, not `cd /d "..."`

- Validate first: `fs.existsSync(projectPath) && fs.statSync(projectPath).isDirectory()`. Reject (throw, surfaced to the renderer as an error) otherwise — this also fixes the current behavior of silently opening a broken terminal for a bad path.
- Pass the resolved path via `spawn(..., { cwd: resolvedPath, ... })`. This is a structured Win32 `CreateProcess` parameter (`lpCurrentDirectory`), never a string `cmd.exe` parses — no character in `projectPath` can act as a shell metacharacter here, regardless of content.
- The `cd /d "${projectPath}"` segment is removed entirely from the inner command string.
- For the new terminal tab to actually land in that directory:
  - **`wt` path:** add the literal, code-controlled flag `-d .` (`wt -d . cmd /K <inner>`) — `.` tells `wt` "use the caller's current directory," which is the safely-set `cwd` above. `.` is a fixed literal, never user data.
  - **`start cmd /K` fallback:** no change needed — `start` already inherits the calling `cmd.exe` process's cwd by default, which is now `projectPath` via the outer `spawn`'s `cwd` option.

### 2. `prompt` → temp file + stdin redirect, not inline string

`electron/lib/cliAdapters/claudeAdapter.cjs:249-250` confirms `claude -p` (with nothing following `-p` in argv) reads the prompt from stdin — the same mechanism `mission.cjs` already uses everywhere for background missions (`proc.stdin.write(prompt, 'utf8'); proc.stdin.end();`). `launch_in_terminal` doesn't hold a pipe to the detached terminal's `claude` process, so instead of writing to stdin directly, it redirects stdin from a file:

- Generate a temp file path with a **code-generated name**: `path.join(os.tmpdir(), \`agent-teams-launch-${crypto.randomUUID()}.txt\`)` — matches the existing `os.tmpdir()` usage pattern in `electron/ipc/files.cjs:62`.
- Write the raw prompt text to that file (`fs.writeFileSync(tempFile, prompt, 'utf-8')`) — no escaping needed, since file content isn't shell-parsed.
- Inner command becomes: `claude -p < "<tempFile>"`. The path is quoted for whitespace-safety, but since it's entirely code-generated (`os.tmpdir()` + a UUID), it contains no characters an attacker controls.
- `/K` keeps the window open after `claude` exits; `<` redirection applies only to that one command, so normal interactive typing in the same window afterward is unaffected.
- Cleanup: `setTimeout(() => { try { fs.unlinkSync(tempFile); } catch {} }, 30_000)` — best-effort, non-blocking, gives `claude` time to finish reading stdin before removal. Consistent with other fire-and-forget cleanup in this codebase (wrapped in try/catch, no error surfaced if it fails).

### 3. Resulting inner command string

```
set CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 && claude -p < "<tempFile>"
```

Zero user-controlled bytes. `set CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is an unchanged, fully static literal — no user input was ever part of it, so it's left as-is.

### 4. Code structure — testable helper

Split the handler into:

- `buildLaunchTerminalPlan(projectPath, prompt)` — a pure function (no I/O) that validates `projectPath` exists and is a directory, resolves it, generates the temp file path, and returns `{ cwd, tempFilePath, tempFileContent, wtArgs, fallbackArgs }` (`wtArgs`/`fallbackArgs` being the full `spawn` argument arrays for each branch). Throws on invalid `projectPath`.
- `ipcMain.handle('launch_in_terminal', ...)` — calls the helper, performs the actual `fs.writeFileSync` + `spawn` side effects, schedules cleanup.

This separation is what makes the injection fix verifiable by unit test without spawning a real terminal (see Testing below).

## What does NOT change

- `scaffold_project` — audited, confirmed safe, untouched.
- `open_folder_in_explorer` — out of scope per the tracked issue (uses `spawn('explorer', [p], ...)`, array-based, no shell string; `explorer` doesn't parse shell metacharacters the way `cmd.exe` does).
- The `wt`-then-`cmd /K`-fallback control flow itself, and the `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` env var behavior.
- `PlaygroundPage.jsx` — no frontend changes; the fix is entirely backend-side validation/construction.

## Testing & Verification

Automated tests can't spawn a real visible terminal window, so verification splits into automated unit tests of the pure helper plus a manual QA checklist for the actual terminal-launch UX.

**Automated (Vitest, `electron/ipc/system.test.cjs`, following the existing `.test.cjs` pattern):**
- Rejects a non-existent `projectPath` — `buildLaunchTerminalPlan` throws, no `spawn` call attempted.
- Rejects a `projectPath` that exists but is a file, not a directory.
- For a valid `projectPath`, `cwd` equals the resolved path.
- **Regression test for the vulnerability:** for the exact repro string `C:\proj" & calc.exe & "` (created as a real temp directory via `fs.mkdtempSync`-style setup, since the helper validates existence), assert none of the returned `wtArgs`/`fallbackArgs` array entries or the constructed inner command string contains `&`, `calc.exe`, or an unescaped `"` from that path as a raw injected fragment — i.e., the only place `projectPath` characters can appear is as the literal `cwd` field, never inside the command-string args.
- `wtArgs` contains `-d` and `.` as separate array entries.
- Prompt text containing `&`, `"`, and newlines ends up only in `tempFileContent`, never in `wtArgs`/`fallbackArgs`.
- Temp file path in the redirect (`< "<tempFile>"`) matches `tempFilePath`.

**Manual QA checklist (documented in the plan, executed once before merge):**
- Launch with a normal path + prompt → terminal opens in the right directory, runs `claude` with the prompt.
- Launch with the malicious repro path (a real temp dir on disk containing `"` and `&` in its name, or the closest Windows-legal approximation, if `"` isn't a legal filename character — see Open Question below) → rejected with a clear error, nothing executed.
- Launch with a prompt containing `&`, `"`, and newlines → all delivered correctly to `claude`, none dropped or misinterpreted.
- Fallback path (temporarily rename/hide `wt.exe` or simulate its absence) → `cmd /K` opens in the right directory.

### Open question for the plan

Windows filenames/paths cannot literally contain `"` (it's a reserved character), so the exact repro string `C:\proj" & calc.exe & "` can never be a real, existing directory — meaning `fs.existsSync` alone already rejects it today for a *real* path. The actual exploitable case is a path that syntactically breaks out even though the underlying directory both exists and is otherwise legitimate-looking — which isn't possible either, since `"` can't be part of a real path on Windows. **This means the `fs.existsSync`/`isDirectory` validation on its own may already fully close this specific repro**, independent of the `cwd`-option change. The `cwd`-option and temp-file changes remain valuable as defense-in-depth (removing string concatenation of `projectPath`/`prompt` entirely, which also protects against metacharacters that *are* legal in Windows paths, e.g. `&`, `%`, `^`, which don't require a quote-escape and can appear in a real, existing directory name like `C:\Users\bob\my & project`). The implementation plan should include a unit test using `&` (a Windows-legal path character) as the realistic injection repro, in addition to documenting that `"` was never independently exploitable against a real path.

## Acceptance Criteria

- `launch_in_terminal` no longer builds any shell-parsed string containing raw `projectPath` or `prompt` text.
- A `projectPath` containing shell metacharacters that are legal in Windows paths (e.g. `&`) no longer results in injected command execution — verified by the regression test.
- A non-existent or non-directory `projectPath` is rejected with a clear error before any `spawn` call.
- A `prompt` containing `&`, `"`, or newlines is delivered to `claude` correctly and completely, with no shell reinterpretation.
- Normal launches (valid path, ordinary prompt) behave the same as before from the user's perspective: a terminal opens in the right directory, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set, `claude` runs with the given prompt, the window stays open afterward.
- `wt`-then-`start cmd /K`-fallback behavior is preserved.
- `scaffold_project` is confirmed safe and left unchanged.
