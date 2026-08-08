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

## Addendum (post-implementation): reverting `-p`/stdin prompt delivery — interactive escaping instead

**Trigger:** the final whole-branch review of the implementation (Tasks 1-2, commits `2a875a4..9afd644`) found that routing `prompt` through `claude -p < "<tempfile>"` — while injection-safe — silently converts `launch_in_terminal` from an interactive Claude Code session into a one-shot print-and-exit invocation. Confirmed against the real installed `claude` binary (`claude --help`): interactive mode is the default; `--input-format`/stdin prompt delivery "only works with `--print`." `src/pages/PlaygroundPage.jsx`'s post-launch UI text ("Nhấn Enter trong terminal để gửi prompt", "Dùng Shift+↓ để switch giữa agents") depends on the session staying interactive — a real regression against the plan's own "preserve existing user-visible behavior" constraint, not something a fix subagent should resolve by picking a side unilaterally. Escalated to the human partner; **resolution: keep the interactive `claude "<prompt>"` invocation, and replace the original (pre-fix) naive escaping — which only handled `\` and `"` — with a correct, complete cmd.exe-safe quoting function.**

### What changes

- `buildLaunchTerminalPlan`'s `tempFilePath`/`tempFileContent`/`-p`/stdin-redirect machinery for **prompt** is removed entirely. `prompt` goes back to being embedded directly in `innerCmd` as `claude "<escaped prompt>"` — but through a correct escaping function instead of the original vulnerable one.
- `projectPath`'s fix (validate existence/directory, pass via `spawn`'s `cwd` option, `wt -d .`) is **unchanged** — it never relied on string escaping and isn't affected by this addendum.
- No temp file is created for `prompt` anymore, so the 30s `setTimeout`/cleanup code for it is removed (the Important finding about its unref/race is moot — the mechanism it applied to no longer exists).

### The escaping function

Two independent problems must both be solved, because two different parsers see this text: (1) `claude`'s own argv parsing (Windows programs receive argv via `CommandLineToArgvW`, which every Node-based CLI, including `claude`, goes through), and (2) `cmd.exe`'s command-line grammar, which parses the *entire* `/K <command>` string for `&`, `|`, `<`, `>`, `^`, `%` before ever launching `claude`.

```js
// Win32 CommandLineToArgvW-compatible quoting: wraps `arg` in a double-quoted
// token that claude's own argv parser reconstructs back to the exact
// original string, byte for byte. Same algorithm as Python's
// subprocess.list2cmdline / MSDN's documented CommandLineToArgvW rules:
// N backslashes immediately before a quote become 2N backslashes + an
// escaped quote; N backslashes NOT before a quote are left as-is; the
// quote character itself is always escaped by doubling its preceding
// backslash count and adding one more.
function win32QuoteArg(arg) {
  let result = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === '\\') {
      backslashes++;
      continue;
    }
    if (ch === '"') {
      result += '\\'.repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
      continue;
    }
    result += '\\'.repeat(backslashes) + ch;
    backslashes = 0;
  }
  result += '\\'.repeat(backslashes * 2) + '"';
  return result;
}

// Wraps `prompt` for safe embedding in a cmd.exe command line, as the
// argument to `claude`. Strategy: quote via win32QuoteArg so the attacker
// can never place an unescaped `"` that closes the quoted region early —
// without an early close, `&`, `|`, `<`, `>`, `(`, `)` all stay inert
// (cmd.exe does not treat them as operators inside a quoted span). `%` is
// the one exception: cmd.exe expands `%VAR%` even inside quotes, so a
// prompt containing e.g. `%USERNAME%` verbatim would have that substring
// replaced with the real environment variable's value before `claude`
// ever sees it. There is no character-level escape for `%` in cmd.exe
// that doesn't corrupt the argument text itself (see docs.microsoft.com
// cmd.exe behavior notes) — this is a known, industry-accepted residual
// limitation (e.g. Python's list2cmdline has the same gap). It is an
// information-disclosure risk (an env var's value leaks into the prompt
// text claude receives), never code execution, so it does not block this
// fix. Newlines are still stripped/collapsed to spaces beforehand, same
// as the pre-fix code, since a literal newline would terminate the
// single-line command early regardless of quoting.
function escapePromptForCmdExe(prompt) {
  const singleLine = prompt.replace(/\r\n|\r|\n/g, ' ');
  return win32QuoteArg(singleLine);
}
```

`buildLaunchTerminalPlan`'s `innerCmd` becomes:

```js
const innerCmd = `set CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 && claude ${escapePromptForCmdExe(prompt)}`;
```

Note `innerCmd` still starts with `set`, not with a bare `"`  — this matters because `cmd /K`/`/C` has a documented special case (`cmd /?`) where, if its *entire* remaining argument is bounded by exactly two quote characters at the very start and end, cmd.exe strips that outer quote pair and re-parses the inside unquoted. Since `innerCmd` never starts with `"`, that quote-stripping special case does not apply to it.

### Required verification (higher bar than a plain unit test)

Because cmd.exe's parser has known quirks that string-level review can't fully rule out, correctness must be proven by two layers, not one:

1. **Unit tests of `win32QuoteArg`/`escapePromptForCmdExe`** — round-trip and edge-case coverage: empty string, trailing backslash before the closing quote, embedded `"`, embedded `\"`, embedded `\\"`, multiple consecutive backslashes, `&`/`|`/`<`/`>`/`^`/`(`/`)` characters, a `%VAR%`-shaped substring (documented as expanding — assert it is *not* further corrupted, i.e. the function doesn't try and fail to neutralize it), newlines.
2. **A real-execution proof test** — spawns the actual `cmd.exe` on the machine with a constructed command line using an attack-style prompt (e.g. containing `& fsutil file createnew <marker> 0` or `&& type nul > <marker>`, using a temp marker file path unique to the test run instead of `calc.exe`), waits for it to finish, and asserts the marker file does **not** exist — i.e. proof the injected command never ran, not just proof the string looked escaped. This closes the gap that pure code review of a hand-rolled cmd.exe escaper cannot close on its own.

### Acceptance criteria (supersedes the equivalent bullets above for `prompt` only)

- `prompt` is delivered to an **interactive** `claude` process (no `-p`), preserving the existing UX (auto-filled prompt, Enter-to-send, live multi-agent session, `Shift+Down` switching) exactly as before this feature's fix work began.
- A `prompt` containing `&`, `|`, `<`, `>`, `^`, `(`, `)`, `"`, and backslash-quote sequences never results in injected command execution — proven by both the unit tests and the real-execution proof test above.
- The one documented, accepted exception: a `prompt` containing a substring exactly matching `%<existing-env-var-name>%` may have that substring expanded to the variable's value by cmd.exe before `claude` sees it (information disclosure only, never code execution).
- No temp file is created for `prompt` delivery.

## Addendum 2 (correction): `win32QuoteArg` alone is not sufficient — add a second, cmd.exe-level caret-escaping layer

**Trigger:** the scoped re-review of Addendum 1's implementation (commit `92520cf`) empirically reproduced real command execution (a marker file created on disk) using the attack prompt `x" & echo pwned>marker &rem `. Root cause: Addendum 1's reasoning ("quoting via `win32QuoteArg` means the attacker can never place an unescaped `"` that closes the quoted region early") is **false**. `win32QuoteArg` encodes an embedded `"` as `\"` — a convention `CommandLineToArgvW` (used by the *receiving* program, `claude`, to parse its own argv) understands, but `cmd.exe`'s own command-line grammar does **not**. `cmd.exe` tracks its quote state by toggling on **every literal `"` character it scans, unconditionally** — it has no concept of a backslash "escaping" a quote. So the `"` inside `win32QuoteArg`'s `\"` output still closes cmd.exe's quoted span early, from cmd.exe's point of view, re-exposing everything after it (`&`, `|`, `<`, `>`) as live operators. Addendum 1's own real-execution proof test passed anyway only because every attack payload in it wrapped its injection target in quotes (e.g. `... > "marker"`), so the corrupted escaping mangled the target path and the injected command failed for an unrelated reason (bad filename syntax) — a false-green, not a real defense.

### The corrected, two-layer escaping function

`win32QuoteArg` (Layer 1, unchanged — still needed so `claude`'s own argv parser reconstructs the exact original string) is no longer sufficient on its own. Add Layer 2: after producing the Layer-1 quoted string, caret-escape every character `cmd.exe`'s own parser treats as significant — including the `"` characters Layer 1 just added:

```js
// Layer 1 (unchanged from Addendum 1): Win32 CommandLineToArgvW-compatible
// quoting, for claude's own argv parser.
function win32QuoteArg(arg) {
  let result = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === '\\') {
      backslashes++;
      continue;
    }
    if (ch === '"') {
      result += '\\'.repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
      continue;
    }
    result += '\\'.repeat(backslashes) + ch;
    backslashes = 0;
  }
  result += '\\'.repeat(backslashes * 2) + '"';
  return result;
}

// Layer 2 (NEW): neutralize every cmd.exe-significant character in the
// ALREADY Layer-1-quoted string, so cmd.exe's own (backslash-unaware)
// quote-toggle scan never sees a raw operator or quote character at all —
// it only ever sees `^X` sequences, which cmd.exe's single left-to-right
// parse pass treats as "emit X literally into the current token, do not
// evaluate X for special meaning," then strips the caret. This is a
// lossless round-trip: after cmd.exe strips the carets, the string handed
// to CreateProcess for the child process is exactly Layer 1's output,
// which claude's own CommandLineToArgvW then parses correctly. Because
// every `"` from Layer 1 is now caret-prefixed too, cmd.exe's quote-toggle
// scan never fires at all for this token — there is no quote state to
// break out of.
function escapeForCmdExe(argvQuoted) {
  return argvQuoted.replace(/[\^"&|<>()%!]/g, (c) => '^' + c);
}

function escapePromptForCmdExe(prompt) {
  const singleLine = prompt.replace(/\r\n|\r|\n/g, ' ');
  return escapeForCmdExe(win32QuoteArg(singleLine));
}
```

This also **improves** on Addendum 1's accepted `%VAR%`-expansion residual risk: `%` and `!` (delayed-expansion) are now caret-escaped too (`^%`, `^!`), which suppresses cmd.exe's environment-variable expansion rather than accepting it as a known gap. This must be confirmed by the unit tests below, not assumed.

### Empirical verification performed before this correction was written

Before drafting this correction, the two-layer scheme was verified directly against the real `cmd.exe` and a real Node child process on the development machine (not just reasoned about), to avoid repeating Addendum 1's mistake of trusting unverified reasoning about cmd.exe's parser:

1. Three hand-written `.cmd` probes run via `cmd.exe` directly, confirming caret-escaping neutralizes `&` as an operator even when combined with a `\"`-encoded embedded quote (the exact shape Layer 1 produces).
2. A Node harness (`spawnSync('cmd.exe', ['/d', '/c', innerCmd], { windowsVerbatimArguments: true })`) spawning a real Node child process as a stand-in for `claude`'s own argv parsing, round-tripping 12 attack/edge-case payloads (quote-breakout, pipe, redirect-in, redirect-out, bare/doubled carets, `%VAR%`, trailing backslash, embedded `\"`, embedded `\\"`, parens, the classic `done" & calc.exe & "` breakout, embedded newlines/CRLF) — **all 12 round-tripped byte-for-byte and none triggered a side effect**.
3. A dedicated side-effect test using **unquoted** injection targets (`... > markerfile & rem`, no quotes around `markerfile`) — the exact false-green vector that let Addendum 1's flawed test pass — across five operator variants (`&`, single `&` with tight `&rem`, `|`, `&&`, and parenthesized `& (...)  &`). **None created the marker file; all round-tripped correctly.**

### Required verification (implementation task)

1. **Unit tests of `win32QuoteArg`/`escapeForCmdExe`/`escapePromptForCmdExe`** — same coverage as Addendum 1 required, plus: assert `%VAR%`-shaped substrings round-trip literally (Layer 2 must prevent expansion now, not just document it as accepted risk), assert bare `^` and doubled `^^` round-trip correctly, assert `!` round-trips literally under delayed expansion.
2. **A real-execution proof test that uses UNQUOTED injection targets**, not quoted ones — this is the specific defect that made Addendum 1's proof test a false green. At minimum: an attack payload shaped like `x" & type nul > <marker-path-with-no-surrounding-quotes> & rem ` (and the `|`, `&&`, and `(...)` operator variants) must, after being escaped and passed through the real inner-command construction and spawned via real `cmd.exe`, leave the marker file **absent**. Assert absence, not merely that the test "passed" — the previous proof test's fatal flaw was asserting success without checking whether the injected side effect actually occurred.
3. Re-verify the manual QA checklist bullets from the original Testing & Verification section still hold (interactive session preserved, normal prompts unaffected).

### Acceptance criteria (supersedes Addendum 1's escaping-specific bullets)

- Both `win32QuoteArg` (Layer 1) and `escapeForCmdExe` (Layer 2) are applied — `escapePromptForCmdExe` is the single exported entry point used by `buildLaunchTerminalPlan`.
- A `prompt` containing `&`, `|`, `<`, `>`, `^`, `(`, `)`, `"`, `%`, `!`, and backslash-quote sequences never results in injected command execution — proven against **unquoted** injection targets, not just quoted ones.
- A `prompt` containing a substring shaped like `%<env-var-name>%` round-trips to `claude` literally (no expansion) — Layer 2 closes the residual risk Addendum 1 had accepted; no exception is documented anymore.
- All other acceptance criteria from Addendum 1 remain in force unchanged (interactive `claude`, no `-p`, no temp file for prompt, `projectPath`/`cwd` handling unaffected).
