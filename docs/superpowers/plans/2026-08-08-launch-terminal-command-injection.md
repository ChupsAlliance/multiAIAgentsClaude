# Fix Command Injection in `launch_in_terminal` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the command-injection vulnerability in `launch_in_terminal` (`electron/ipc/system.cjs:191-207`) by removing all string concatenation of user-controlled `projectPath`/`prompt` into a `cmd.exe`-parsed command string, replacing it with structured, non-parsed channels (`spawn`'s `cwd` option, and a temp-file stdin redirect).

**Architecture:** Split the handler into a pure, unit-testable helper `buildLaunchTerminalPlan(projectPath, prompt)` that validates `projectPath` and returns a plan object (`{ cwd, tempFilePath, tempFileContent, wtArgs, fallbackArgs }`), and a thin `ipcMain.handle('launch_in_terminal', ...)` body that performs the actual file write, `spawn` calls, and best-effort temp-file cleanup.

**Tech Stack:** Node.js `child_process.spawn`, `fs`, `os`, `path`, `crypto.randomUUID`; Vitest for tests (`.test.cjs` files using `createRequire` + `require.cache` injection to fake `electron`/`child_process`, matching the existing convention in `electron/ipc/mission.retryTimerCancel.test.cjs`).

## Global Constraints

- No user-controlled text (`projectPath` or `prompt`) may ever be embedded into a string that `cmd.exe` parses. `projectPath` goes through `spawn`'s `cwd` option only; `prompt` goes through a temp file referenced by a code-generated path only.
- `scaffold_project` (`electron/ipc/files.cjs`) is confirmed safe (pure `fs` APIs, no shell) — out of scope, no code change.
- `open_folder_in_explorer` — out of scope per the tracked issue.
- Preserve existing user-visible behavior for valid inputs: Windows Terminal preferred, `cmd /K` fallback, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` set, terminal window stays open after `claude` exits.
- Design doc: `docs/superpowers/specs/2026-08-08-launch-terminal-command-injection-design.md`. Tracked issue: `docs/critical-issues-review-2026-08-08.md` issue #2.

---

## Task 1: `buildLaunchTerminalPlan` helper with full unit test coverage

**Files:**
- Modify: `electron/ipc/system.cjs` (add helper function + export, near top of file after existing requires; does not touch the existing `launch_in_terminal` handler in this task)
- Test: `electron/ipc/system.launchTerminal.test.cjs` (create)

**Interfaces:**
- Produces: `buildLaunchTerminalPlan(projectPath, prompt)` — exported as `module.exports.buildLaunchTerminalPlan` from `electron/ipc/system.cjs`. Throws `Error` if `projectPath` is missing/empty, doesn't exist, or isn't a directory. On success returns:
  ```js
  {
    cwd: string,            // path.resolve(projectPath)
    tempFilePath: string,   // path.join(os.tmpdir(), `agent-teams-launch-${uuid}.txt`)
    tempFileContent: string,// the raw, unmodified prompt
    wtArgs: string[],       // ['/C', 'wt', '-d', '.', 'cmd', '/K', innerCmd]
    fallbackArgs: string[], // ['/C', 'start', 'cmd', '/K', innerCmd]
  }
  ```
  where `innerCmd` is the literal string `` set CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 && claude -p < "<tempFilePath>" `` with `tempFilePath` substituted in.

- [ ] **Step 1: Write the failing tests**

Create `electron/ipc/system.launchTerminal.test.cjs`:

```js
// electron/ipc/system.launchTerminal.test.cjs
//
// Regression tests for Critical issue #2
// (docs/critical-issues-review-2026-08-08.md): launch_in_terminal built a
// cmd.exe command string by concatenating unescaped projectPath/prompt,
// allowing shell-metacharacter injection via the project-path text field.
// See docs/superpowers/specs/2026-08-08-launch-terminal-command-injection-design.md.
//
// These tests exercise buildLaunchTerminalPlan() directly — a pure function
// with no spawn/electron side effects, so no fake-module harness is needed
// here (unlike system.launchTerminalHandler.test.cjs in Task 2, which tests
// the wired-up ipcMain.handle).

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const { buildLaunchTerminalPlan } = require('./system.cjs');

describe('buildLaunchTerminalPlan', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-terminal-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('rejects a non-existent projectPath', () => {
    const missing = path.join(tmpDir, 'does-not-exist');
    expect(() => buildLaunchTerminalPlan(missing, 'hello')).toThrow(/not found/i);
  });

  test('rejects a projectPath that exists but is a file, not a directory', () => {
    const filePath = path.join(tmpDir, 'a-file.txt');
    fs.writeFileSync(filePath, 'not a directory', 'utf-8');
    expect(() => buildLaunchTerminalPlan(filePath, 'hello')).toThrow(/not found|directory/i);
  });

  test('rejects an empty projectPath', () => {
    expect(() => buildLaunchTerminalPlan('', 'hello')).toThrow();
  });

  test('cwd equals the resolved projectPath for a valid directory', () => {
    const plan = buildLaunchTerminalPlan(tmpDir, 'hello');
    expect(plan.cwd).toBe(path.resolve(tmpDir));
  });

  test('wtArgs contains -d and . as separate literal entries, never projectPath text', () => {
    const plan = buildLaunchTerminalPlan(tmpDir, 'hello');
    expect(plan.wtArgs).toContain('-d');
    const dIdx = plan.wtArgs.indexOf('-d');
    expect(plan.wtArgs[dIdx + 1]).toBe('.');
    for (const entry of plan.wtArgs) {
      expect(entry).not.toContain(tmpDir);
    }
  });

  test('fallbackArgs never contains projectPath text', () => {
    const plan = buildLaunchTerminalPlan(tmpDir, 'hello');
    for (const entry of plan.fallbackArgs) {
      expect(entry).not.toContain(tmpDir);
    }
  });

  test('regression: a projectPath containing a Windows-legal shell metacharacter (&) never leaks into any spawn arg', () => {
    // Windows filenames cannot contain a literal `"`, so the exact repro
    // string from the tracked issue (`C:\proj" & calc.exe & "`) can never
    // be a real, existing directory — fs validation alone already rejects
    // it. `&` IS legal in a real Windows directory name, so it is the
    // realistic version of this regression test: it proves the fix removes
    // projectPath from the parsed command string entirely, not just that
    // `"` gets rejected.
    const injectDir = path.join(tmpDir, 'proj & calc.exe & ');
    fs.mkdirSync(injectDir);

    const plan = buildLaunchTerminalPlan(injectDir, 'hello');

    expect(plan.cwd).toBe(path.resolve(injectDir));
    for (const entry of [...plan.wtArgs, ...plan.fallbackArgs]) {
      expect(entry).not.toContain('calc.exe');
      expect(entry).not.toContain(injectDir);
    }
  });

  test('prompt text is isolated to tempFileContent, never present in wtArgs/fallbackArgs', () => {
    const dangerousPrompt = 'do X & calc.exe & echo "done"\nsecond line\r\nthird';
    const plan = buildLaunchTerminalPlan(tmpDir, dangerousPrompt);

    expect(plan.tempFileContent).toBe(dangerousPrompt);
    for (const entry of [...plan.wtArgs, ...plan.fallbackArgs]) {
      expect(entry).not.toContain('calc.exe');
      expect(entry).not.toContain(dangerousPrompt);
    }
  });

  test('tempFilePath is under os.tmpdir(), has a unique name per call, and matches the redirect target in the built args', () => {
    const planA = buildLaunchTerminalPlan(tmpDir, 'hello');
    const planB = buildLaunchTerminalPlan(tmpDir, 'hello');

    expect(planA.tempFilePath.startsWith(os.tmpdir())).toBe(true);
    expect(planA.tempFilePath).not.toBe(planB.tempFilePath);

    const innerCmd = planA.wtArgs[planA.wtArgs.length - 1];
    expect(innerCmd).toContain(`< "${planA.tempFilePath}"`);
    expect(innerCmd).toContain('claude -p');
    expect(innerCmd).toContain('set CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1');

    const fallbackInnerCmd = planA.fallbackArgs[planA.fallbackArgs.length - 1];
    expect(fallbackInnerCmd).toBe(innerCmd);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run electron/ipc/system.launchTerminal.test.cjs`
Expected: FAIL — `buildLaunchTerminalPlan is not a function` (or similar), since `electron/ipc/system.cjs` doesn't export it yet.

- [ ] **Step 3: Implement `buildLaunchTerminalPlan`**

In `electron/ipc/system.cjs`, add `const crypto = require('crypto');` to the top imports block (after the existing `const os = require('os');` on line 7):

```js
const os = require('os');
const crypto = require('crypto');
```

Then add the helper function after the `checkForUpdates` function definition (after line 51, before `module.exports = function registerSystem(...)` on line 53):

```js
// ─── buildLaunchTerminalPlan ────────────────────────────────────────
// Pure planning function for launch_in_terminal — validates projectPath
// and returns everything the handler needs to spawn a terminal, with
// zero user-controlled text embedded in any cmd.exe-parsed string.
// projectPath reaches the terminal only via the `cwd` field (a structured
// spawn() option, never shell-parsed); prompt reaches `claude` only via
// tempFileContent, written to a code-generated temp file and redirected
// into `claude -p`'s stdin.
function buildLaunchTerminalPlan(projectPath, prompt) {
  if (typeof projectPath !== 'string' || !projectPath.trim()) {
    throw new Error('projectPath is required');
  }

  const resolvedPath = path.resolve(projectPath);
  const exists = fs.existsSync(resolvedPath);
  if (!exists || !fs.statSync(resolvedPath).isDirectory()) {
    throw new Error(`Directory not found: ${projectPath}`);
  }

  const tempFilePath = path.join(os.tmpdir(), `agent-teams-launch-${crypto.randomUUID()}.txt`);
  const innerCmd = `set CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 && claude -p < "${tempFilePath}"`;

  return {
    cwd: resolvedPath,
    tempFilePath,
    tempFileContent: prompt,
    wtArgs: ['/C', 'wt', '-d', '.', 'cmd', '/K', innerCmd],
    fallbackArgs: ['/C', 'start', 'cmd', '/K', innerCmd],
  };
}
```

Add the export at the bottom of the file, next to the existing `module.exports.checkForUpdates = checkForUpdates;` line (currently line 238):

```js
module.exports.checkForUpdates = checkForUpdates;
module.exports.buildLaunchTerminalPlan = buildLaunchTerminalPlan;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run electron/ipc/system.launchTerminal.test.cjs`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/system.cjs electron/ipc/system.launchTerminal.test.cjs
git commit -m "fix: add buildLaunchTerminalPlan helper to eliminate command injection surface"
```

---

## Task 2: Wire `launch_in_terminal` to the safe helper, remove the vulnerable code, verify end-to-end wiring

**Files:**
- Modify: `electron/ipc/system.cjs:190-207` (replace the `launch_in_terminal` handler body)
- Test: `electron/ipc/system.launchTerminalHandler.test.cjs` (create)
- Modify: `docs/critical-issues-review-2026-08-08.md` (check off issue #2)

**Interfaces:**
- Consumes: `buildLaunchTerminalPlan(projectPath, prompt)` from Task 1 — exact signature and return shape as documented there. Do not change that signature in this task.

- [ ] **Step 1: Write the failing integration test**

Create `electron/ipc/system.launchTerminalHandler.test.cjs`:

```js
// electron/ipc/system.launchTerminalHandler.test.cjs
//
// Integration test for the launch_in_terminal ipcMain.handle wiring
// (Critical issue #2, docs/critical-issues-review-2026-08-08.md). Confirms
// the handler actually calls buildLaunchTerminalPlan (Task 1), writes the
// prompt to the planned temp file, and spawns with the planned cwd/args —
// i.e. that the safe plan is the thing that actually runs, not just that
// the pure helper is correct in isolation.
//
// Harness: fakes `electron`'s ipcMain.handle to record handlers into a Map
// via the same require.cache-injection technique used in
// mission.retryTimerCancel.test.cjs ('electron' is a normal resolvable
// package in the test environment, so cache injection works for it).
//
// `child_process` is a Node **built-in**, not a resolvable file-based
// module — Node's core-module loader bypasses `Module._cache` entirely, so
// the require.cache-injection trick that works for 'electron'/'cross-spawn'
// does NOT intercept `require('child_process')`. Instead this harness
// monkeypatches `child_process.spawn` in place (the built-in module object
// is a shared singleton) *before* system.cjs is (re)required, so that when
// system.cjs runs `const { spawn } = require('child_process')`, the local
// `spawn` it captures is already the fake. The patch is restored in
// afterEach so it never leaks into other test files.

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);

const ipcHandlers = new Map();
const ELECTRON_PATH = require.resolve('electron');
function installFakeElectron() {
  require.cache[ELECTRON_PATH] = {
    id: ELECTRON_PATH,
    filename: ELECTRON_PATH,
    loaded: true,
    exports: {
      ipcMain: {
        handle: (channel, fn) => { ipcHandlers.set(channel, fn); },
        on: () => {},
      },
      shell: { openExternal: async () => {} },
      app: {
        getVersion: () => '0.0.0-test',
        getPath: () => os.tmpdir(),
      },
    },
  };
}

const spawnCalls = [];
let originalSpawn;
function installFakeSpawn() {
  originalSpawn = childProcess.spawn;
  childProcess.spawn = (...callArgs) => {
    spawnCalls.push(callArgs);
    return { on: () => {}, unref: () => {} };
  };
}
function restoreSpawn() {
  childProcess.spawn = originalSpawn;
}

function freshSystem() {
  installFakeElectron();
  installFakeSpawn();
  delete require.cache[require.resolve('./system.cjs')];
  spawnCalls.length = 0;
  ipcHandlers.clear();
  const registerSystem = require('./system.cjs');
  registerSystem(() => null);
  return ipcHandlers.get('launch_in_terminal');
}

describe('launch_in_terminal handler', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-terminal-handler-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    restoreSpawn();
    delete require.cache[ELECTRON_PATH];
  });

  test('rejects a non-existent projectPath without spawning anything', async () => {
    const handler = freshSystem();
    const missing = path.join(tmpDir, 'nope');

    await expect(handler(null, { projectPath: missing, prompt: 'hi' })).rejects.toThrow();
    expect(spawnCalls.length).toBe(0);
  });

  test('spawns with cwd set to the resolved projectPath and writes the prompt to the redirected temp file', async () => {
    const handler = freshSystem();
    const dangerousPrompt = 'build X & calc.exe & echo "done"';

    await handler(null, { projectPath: tmpDir, prompt: dangerousPrompt });

    expect(spawnCalls.length).toBe(1);
    const [cmd, args, opts] = spawnCalls[0];
    expect(cmd).toBe('cmd');
    expect(opts.cwd).toBe(path.resolve(tmpDir));

    const innerCmd = args[args.length - 1];
    const match = innerCmd.match(/< "([^"]+)"/);
    expect(match).not.toBeNull();
    const tempFilePath = match[1];

    expect(fs.existsSync(tempFilePath)).toBe(true);
    expect(fs.readFileSync(tempFilePath, 'utf-8')).toBe(dangerousPrompt);
    expect(innerCmd).not.toContain('calc.exe');

    fs.unlinkSync(tempFilePath);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/ipc/system.launchTerminalHandler.test.cjs`
Expected: FAIL — the current handler still builds the raw `claudeCmd` string, spawns without a `cwd` option, and writes no temp file, so the assertions on `opts.cwd` and the temp file's existence fail.

- [ ] **Step 3: Replace the handler implementation**

In `electron/ipc/system.cjs`, replace the `launch_in_terminal` handler (currently lines 190-207):

```js
  // ─── launch_in_terminal ─────────────────────────────────────────
  ipcMain.handle('launch_in_terminal', async (_event, args) => {
    const { projectPath, prompt } = args;
    const safePrompt = prompt
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, ' ')
      .replace(/\r/g, '');

    const claudeCmd = `cd /d "${projectPath}" && set CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 && claude "${safePrompt}"`;

    // Try Windows Terminal first, fallback to cmd
    try {
      spawn('cmd', ['/C', 'wt', 'cmd', '/K', claudeCmd], { detached: true, stdio: 'ignore' });
    } catch {
      spawn('cmd', ['/C', 'start', 'cmd', '/K', claudeCmd], { detached: true, stdio: 'ignore' });
    }
  });
```

with:

```js
  // ─── launch_in_terminal ─────────────────────────────────────────
  // projectPath and prompt are both free-text, user-controlled values
  // (see src/pages/PlaygroundPage.jsx) — neither is ever embedded into a
  // cmd.exe-parsed string. buildLaunchTerminalPlan() validates projectPath
  // and routes it through spawn()'s `cwd` option (a structured Win32 param,
  // not shell-parsed text), and routes prompt through a code-generated temp
  // file redirected into `claude -p`'s stdin. See
  // docs/superpowers/specs/2026-08-08-launch-terminal-command-injection-design.md.
  ipcMain.handle('launch_in_terminal', async (_event, args) => {
    const { projectPath, prompt } = args;
    const plan = buildLaunchTerminalPlan(projectPath, prompt);

    fs.writeFileSync(plan.tempFilePath, plan.tempFileContent, 'utf-8');
    setTimeout(() => {
      try { fs.unlinkSync(plan.tempFilePath); } catch {}
    }, 30_000);

    // Try Windows Terminal first, fallback to cmd
    try {
      spawn('cmd', plan.wtArgs, { cwd: plan.cwd, detached: true, stdio: 'ignore' });
    } catch {
      spawn('cmd', plan.fallbackArgs, { cwd: plan.cwd, detached: true, stdio: 'ignore' });
    }
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run electron/ipc/system.launchTerminalHandler.test.cjs`
Expected: PASS — both tests green.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npx vitest run`
Expected: PASS — every existing test (including Task 1's `system.launchTerminal.test.cjs` and all `mission.*.test.cjs`/`history.*.test.cjs` files) still passes.

- [ ] **Step 6: Check off issue #2 in the tracking doc**

In `docs/critical-issues-review-2026-08-08.md`, under `## 2. Command injection in "launch in terminal"`, change:

```markdown
- [ ] Fixed
```

to:

```markdown
- [x] Fixed
```

- [ ] **Step 7: Commit**

```bash
git add electron/ipc/system.cjs electron/ipc/system.launchTerminalHandler.test.cjs docs/critical-issues-review-2026-08-08.md
git commit -m "fix: eliminate command injection in launch_in_terminal (critical issue #2)"
```

---

## Manual QA (perform once after Task 2, before final review — cannot be automated: requires observing a real GUI terminal window)

- Launch with a normal, real project path and an ordinary prompt → a terminal (Windows Terminal if installed, else a `cmd` window) opens, starts in the given directory, runs `claude` with the prompt, and stays open afterward for further interaction.
- Launch with a project path containing `&` in a real directory name (e.g. create `C:\Temp\proj & test`, launch with that path) → terminal opens correctly in that exact directory; no unexpected process (e.g. `calc.exe`) is spawned.
- Launch with a prompt containing `&`, `"`, and a newline → `claude` receives the full, correct prompt text (verify via the terminal's visible output), nothing is truncated or misinterpreted as a shell command.
- Launch with a non-existent project path → the renderer surfaces an error (rejected promise from `invoke('launch_in_terminal', ...)`); no terminal window opens.
- If Windows Terminal is not installed (or its `wt` command is unavailable), confirm the `cmd /K` fallback still opens correctly in the right directory.

## Self-Review Notes

- **Spec coverage:** Every item in the design doc's Acceptance Criteria is covered — Task 1 covers "no shell-parsed string contains raw projectPath/prompt" and the `&`-based regression test; Task 2 covers the non-existent/non-directory rejection at the handler level, prompt delivery correctness, preserved normal-launch behavior, and the `wt`-then-fallback behavior (both branches use `plan.cwd`/`plan.wtArgs`/`plan.fallbackArgs`, exercised by Task 1's tests on the plan object and Task 2's test on the `wt` branch — the fallback branch shares the exact same `plan.fallbackArgs` construction verified in Task 1, so it doesn't need a duplicate spawn-level test). `scaffold_project` audit is documented in the design doc itself (no task needed — no code changes required there).
- **Placeholder scan:** No TBD/TODO; all test code and implementation code is complete and literal.
- **Type consistency:** `buildLaunchTerminalPlan(projectPath, prompt)` and its return shape (`cwd`, `tempFilePath`, `tempFileContent`, `wtArgs`, `fallbackArgs`) are defined once in Task 1 and consumed with the identical field names in Task 2 — no drift.
