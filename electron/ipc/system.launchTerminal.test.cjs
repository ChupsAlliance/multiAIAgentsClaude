// electron/ipc/system.launchTerminal.test.cjs
//
// Regression tests for Critical issue #2
// (docs/critical-issues-review-2026-08-08.md): launch_in_terminal built a
// cmd.exe command string by concatenating unescaped projectPath/prompt,
// allowing shell-metacharacter injection via the project-path text field.
// See docs/superpowers/specs/2026-08-08-launch-terminal-command-injection-design.md.
//
// The prompt is now delivered inline as the argument to an INTERACTIVE
// `claude "<prompt>"` invocation (no `-p`, no temp file) — injection-safety
// comes from escapePromptForCmdExe/win32QuoteArg, not from avoiding string
// embedding. These tests cover both the pure planning function and the
// escaping functions directly (no spawn/electron side effects).

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const {
  buildLaunchTerminalPlan,
  win32QuoteArg,
  escapePromptForCmdExe,
} = require('./system.cjs');

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

  test('does not return temp-file fields (prompt is inline now)', () => {
    const plan = buildLaunchTerminalPlan(tmpDir, 'hello');
    expect(plan).not.toHaveProperty('tempFilePath');
    expect(plan).not.toHaveProperty('tempFileContent');
    expect(Object.keys(plan).sort()).toEqual(['cwd', 'fallbackArgs', 'wtArgs']);
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

  test('innerCmd is an interactive claude invocation — no -p, no stdin redirect, no temp file', () => {
    const plan = buildLaunchTerminalPlan(tmpDir, 'hello world');
    const innerCmd = plan.wtArgs[plan.wtArgs.length - 1];

    // Starts with `set` (not a bare `"`) — dodges cmd /K outer-quote stripping.
    expect(innerCmd.startsWith('set CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 && claude ')).toBe(true);
    expect(innerCmd).toContain('claude "hello world"');
    // Old temp-file / -p / redirect machinery must be gone.
    expect(innerCmd).not.toContain('claude -p');
    expect(innerCmd).not.toMatch(/<\s*"/);
    expect(innerCmd).not.toContain('.txt');

    // wt and fallback share the identical inner command.
    const fallbackInnerCmd = plan.fallbackArgs[plan.fallbackArgs.length - 1];
    expect(fallbackInnerCmd).toBe(innerCmd);
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

  test('a dangerous prompt is embedded only as a quoted/escaped claude argument, never as bare operators', () => {
    const dangerousPrompt = 'do X & calc.exe & echo "done"';
    const plan = buildLaunchTerminalPlan(tmpDir, dangerousPrompt);
    const innerCmd = plan.wtArgs[plan.wtArgs.length - 1];

    // The exact escaped form the escaper produces must be what appears.
    expect(innerCmd).toContain(`claude ${escapePromptForCmdExe(dangerousPrompt)}`);
    // The raw, un-neutralized `& calc.exe &` operator sequence must NOT
    // appear outside the quoted region — i.e. the `"` before it is escaped,
    // so cmd.exe never sees an early quote-close.
    expect(innerCmd).not.toContain('done" & calc.exe');
  });

  test('newlines/CRLF in the prompt are collapsed to spaces before quoting', () => {
    const multiline = 'line one\nline two\r\nline three\rline four';
    const plan = buildLaunchTerminalPlan(tmpDir, multiline);
    const innerCmd = plan.wtArgs[plan.wtArgs.length - 1];
    expect(innerCmd).not.toMatch(/[\r\n]/);
    expect(innerCmd).toContain('claude "line one line two line three line four"');
  });
});

describe('win32QuoteArg', () => {
  test('empty string → just an empty quoted token', () => {
    expect(win32QuoteArg('')).toBe('""');
  });

  test('simple text with no special chars is wrapped verbatim', () => {
    expect(win32QuoteArg('hello world')).toBe('"hello world"');
  });

  test('a trailing backslash before the closing quote is doubled', () => {
    // `foo\` → the closing `"` would otherwise be escaped by the lone `\`,
    // so the backslash count is doubled: `"foo\\"`.
    expect(win32QuoteArg('foo\\')).toBe('"foo\\\\"');
  });

  test('multiple trailing backslashes are doubled', () => {
    expect(win32QuoteArg('foo\\\\')).toBe('"foo\\\\\\\\"');
  });

  test('an embedded double-quote is escaped with a preceding backslash', () => {
    // `a"b` → `"a\"b"`
    expect(win32QuoteArg('a"b')).toBe('"a\\"b"');
  });

  test('a backslash immediately before an embedded quote (\\") is doubled then quote escaped', () => {
    // `a\"b` → backslash count 1 before the quote → 2*1+1 = 3 backslashes + "
    // => `"a\\\"b"`
    expect(win32QuoteArg('a\\"b')).toBe('"a\\\\\\"b"');
  });

  test('two backslashes before an embedded quote (\\\\") → 5 backslashes + quote', () => {
    // `a\\"b` → 2 backslashes before quote → 2*2+1 = 5 backslashes + "
    expect(win32QuoteArg('a\\\\"b')).toBe('"a\\\\\\\\\\"b"');
  });

  test('consecutive backslashes NOT before a quote are left as-is', () => {
    // `a\\b` (backslashes mid-string, next char is `b`, not `"`) → unchanged.
    expect(win32QuoteArg('a\\\\b')).toBe('"a\\\\b"');
  });

  test('does NOT touch % (no cmd.exe %-escape scheme invented)', () => {
    expect(win32QuoteArg('%TEMP%')).toBe('"%TEMP%"');
  });
});

describe('escapePromptForCmdExe', () => {
  test('collapses \\r\\n, \\r, and \\n to single spaces before quoting', () => {
    expect(escapePromptForCmdExe('a\r\nb\nc\rd')).toBe('"a b c d"');
  });

  test('empty prompt → empty quoted token', () => {
    expect(escapePromptForCmdExe('')).toBe('""');
  });

  test('passes %VAR%-shaped substrings through unchanged (accepted residual risk)', () => {
    // The addendum documents that cmd.exe expands %VAR% even inside quotes;
    // the function must NOT invent a broken %-escape — it passes through.
    expect(escapePromptForCmdExe('hi %TEMP% there')).toBe('"hi %TEMP% there"');
    expect(escapePromptForCmdExe('%USERNAME%')).toBe('"%USERNAME%"');
  });

  test.each([
    ['&', 'a & b'],
    ['|', 'a | b'],
    ['<', 'a < b'],
    ['>', 'a > b'],
    ['^', 'a ^ b'],
    ['(', 'a ( b'],
    [')', 'a ) b'],
  ])('single metacharacter %s stays inside the quoted span', (_name, prompt) => {
    const out = escapePromptForCmdExe(prompt);
    // Whole thing is one quoted token: opens with " and closes with ",
    // and the metacharacter is interior (never re-exposed by an early close).
    expect(out.startsWith('"')).toBe(true);
    expect(out.endsWith('"')).toBe(true);
    expect(out).toBe(`"${prompt}"`);
  });

  test('the realistic combined attack payload stays inert inside one quoted token', () => {
    const attack = '& fsutil file createnew C:\\temp\\pwned.txt 0 &';
    const out = escapePromptForCmdExe(attack);
    // No embedded quotes in the attack, so it is wrapped verbatim — the
    // leading/trailing `&` are interior to the quoted span, not operators.
    expect(out).toBe(`"${attack}"`);
  });

  test('an attack that tries to break out with a quote gets the quote escaped', () => {
    const attack = 'hello" & calc.exe & "';
    const out = escapePromptForCmdExe(attack);
    // Every `"` from the payload is backslash-escaped, so cmd.exe never sees
    // an early quote-close; the `& calc.exe &` remains inside the token.
    expect(out).toBe('"hello\\" & calc.exe & \\""');
    // Sanity: the payload's operators are never left exposed outside quotes.
    expect(out).not.toMatch(/[^\\]" & calc\.exe & "$/);
  });
});
