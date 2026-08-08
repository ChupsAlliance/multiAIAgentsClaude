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
