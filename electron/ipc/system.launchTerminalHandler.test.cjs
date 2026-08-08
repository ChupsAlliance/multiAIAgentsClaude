// electron/ipc/system.launchTerminalHandler.test.cjs
//
// Integration test for the launch_in_terminal ipcMain.handle wiring
// (Critical issue #2, docs/critical-issues-review-2026-08-08.md). Confirms
// the handler actually calls buildLaunchTerminalPlan and spawns with the
// planned cwd/args — i.e. that the safe plan is the thing that actually
// runs, not just that the pure helper is correct in isolation. The prompt
// is now delivered inline as the argument to an interactive `claude
// "<prompt>"` session (no temp file, no `-p`), made injection-safe by
// escapePromptForCmdExe.
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

  test('spawns with cwd set to the resolved projectPath and an interactive claude invocation — no temp file, injection-safe', async () => {
    const handler = freshSystem();
    const dangerousPrompt = 'build X & calc.exe & echo "done"';

    await handler(null, { projectPath: tmpDir, prompt: dangerousPrompt });

    expect(spawnCalls.length).toBe(1);
    const [cmd, args, opts] = spawnCalls[0];
    expect(cmd).toBe('cmd');
    expect(opts.cwd).toBe(path.resolve(tmpDir));

    const innerCmd = args[args.length - 1];

    // Interactive claude, not the old temp-file/-p/stdin-redirect approach.
    expect(innerCmd).toContain('claude "');
    expect(innerCmd).not.toContain('claude -p');
    expect(innerCmd).not.toMatch(/<\s*"/);

    // No temp file is written any more — handler no longer touches the fs.
    const { escapePromptForCmdExe } = require('./system.cjs');
    expect(innerCmd).toContain(`claude ${escapePromptForCmdExe(dangerousPrompt)}`);

    // Injection safety: the raw operator sequence is never left exposed
    // outside the quoted span (the `"` before `& calc.exe` is escaped).
    expect(innerCmd).not.toContain('done" & calc.exe');
  });
});
