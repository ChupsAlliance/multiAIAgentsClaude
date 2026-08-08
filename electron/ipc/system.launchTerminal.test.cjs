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
  escapeForCmdExe,
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
    // No special chars in this prompt, but Layer 2 still caret-escapes the
    // Layer-1-added quote pair (`^"..."^"` is not "^" — see below), so the
    // exact expected form comes from the escaper itself, not a hand-written
    // `"hello world"` literal.
    expect(innerCmd).toContain(`claude ${escapePromptForCmdExe('hello world')}`);
    expect(innerCmd).toContain('claude ^"hello world^"');
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

  test('a dangerous prompt is embedded only as a caret-escaped claude argument, never as bare operators', () => {
    const dangerousPrompt = 'do X & calc.exe & echo "done"';
    const plan = buildLaunchTerminalPlan(tmpDir, dangerousPrompt);
    const innerCmd = plan.wtArgs[plan.wtArgs.length - 1];
    const escaped = escapePromptForCmdExe(dangerousPrompt);

    // The exact escaped form the escaper produces must be what appears.
    expect(innerCmd).toContain(`claude ${escaped}`);
    // The real security property: every cmd.exe-significant character —
    // including the `"` that Layer 1 introduced to encode the embedded
    // quote — is caret-escaped, so cmd.exe's own quote-toggle scan never
    // fires and `&` is never live. NOT "quoting alone keeps it inert" —
    // that reasoning was empirically disproved (Addendum 2 in the design
    // doc): cmd.exe treats `\"` as a quote-close regardless of the
    // preceding backslash, so an unescaped `&` after it WOULD be live.
    expect(innerCmd).not.toContain('done" & calc.exe');
    expect(escaped).toContain('^&');
    expect(escaped).toContain('done\\^"');
    // Within the escaped token itself (not the literal `&&` command
    // separator that precedes it in innerCmd), no `&` appears without a
    // preceding `^`.
    expect(escaped).not.toMatch(/[^^]&/);
  });

  test('newlines/CRLF in the prompt are collapsed to spaces before quoting', () => {
    const multiline = 'line one\nline two\r\nline three\rline four';
    const plan = buildLaunchTerminalPlan(tmpDir, multiline);
    const innerCmd = plan.wtArgs[plan.wtArgs.length - 1];
    expect(innerCmd).not.toMatch(/[\r\n]/);
    expect(innerCmd).toContain('claude ^"line one line two line three line four^"');
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

describe('escapeForCmdExe (Layer 2)', () => {
  test('caret-escapes every cmd.exe-significant character in an already Layer-1-quoted string', () => {
    expect(escapeForCmdExe('""')).toBe('^"^"');
    expect(escapeForCmdExe('"%VAR%"')).toBe('^"^%VAR^%^"');
    expect(escapeForCmdExe('"a^b"')).toBe('^"a^^b^"');
    expect(escapeForCmdExe('"a^^b"')).toBe('^"a^^^^b^"');
    expect(escapeForCmdExe('"a!b"')).toBe('^"a^!b^"');
    expect(escapeForCmdExe(win32QuoteArg('(a) b'))).toBe('^"^(a^) b^"');
    expect(escapeForCmdExe(win32QuoteArg('a|b'))).toBe('^"a^|b^"');
    expect(escapeForCmdExe(win32QuoteArg('a<b>c'))).toBe('^"a^<b^>c^"');
  });

  test('leaves backslashes untouched (Layer 1 already resolved backslash/quote interplay)', () => {
    expect(escapeForCmdExe(win32QuoteArg('a"b'))).toBe('^"a\\^"b^"');
    expect(escapeForCmdExe(win32QuoteArg('a\\"b'))).toBe('^"a\\\\\\^"b^"');
    expect(escapeForCmdExe(win32QuoteArg('a\\\\"b'))).toBe('^"a\\\\\\\\\\^"b^"');
    expect(escapeForCmdExe(win32QuoteArg('a\\\\b'))).toBe('^"a\\\\b^"');
    expect(escapeForCmdExe(win32QuoteArg('foo\\'))).toBe('^"foo\\\\^"');
  });
});

describe('escapePromptForCmdExe (Layer 1 + Layer 2)', () => {
  test('collapses \\r\\n, \\r, and \\n to single spaces before quoting/escaping', () => {
    expect(escapePromptForCmdExe('a\r\nb\nc\rd')).toBe('^"a b c d^"');
  });

  test('empty prompt → empty escaped/quoted token', () => {
    expect(escapePromptForCmdExe('')).toBe('^"^"');
  });

  test('%VAR%-shaped substrings are now caret-escaped so cmd.exe cannot expand them (Layer 2 closes the residual risk Layer 1 alone had to accept)', () => {
    // Addendum 1 (Layer 1 only) documented this as an accepted residual
    // risk: cmd.exe expands %VAR% even inside a quoted span, so %TEMP%
    // would leak the real env-var value. Layer 2 caret-escapes `%`, which
    // suppresses that expansion — verified here, not just assumed.
    expect(escapePromptForCmdExe('hi %TEMP% there')).toBe('^"hi ^%TEMP^% there^"');
    expect(escapePromptForCmdExe('%USERNAME%')).toBe('^"^%USERNAME^%^"');
  });

  test.each([
    ['&', 'a & b', '^"a ^& b^"'],
    ['|', 'a | b', '^"a ^| b^"'],
    ['<', 'a < b', '^"a ^< b^"'],
    ['>', 'a > b', '^"a ^> b^"'],
    ['^', 'a ^ b', '^"a ^^ b^"'],
    ['(', 'a ( b', '^"a ^( b^"'],
    [')', 'a ) b', '^"a ^) b^"'],
  ])('single metacharacter %s is caret-escaped, not left as a bare live operator', (_name, prompt, expected) => {
    const out = escapePromptForCmdExe(prompt);
    expect(out).toBe(expected);
    // The real security property: the metacharacter is prefixed with `^`,
    // which is what actually neutralizes it for cmd.exe's parser — NOT
    // "it's inside a quoted span" (Addendum 1's reasoning), which was
    // empirically disproved: cmd.exe's quote-toggle scan doesn't understand
    // Layer 1's `\"` convention, so an un-caret-escaped quoted span alone
    // does not reliably keep operators inert.
    expect(out).toMatch(/\^./);
  });

  test('the realistic combined attack payload has its operators caret-escaped, not merely quoted', () => {
    const attack = '& fsutil file createnew C:\\temp\\pwned.txt 0 &';
    const out = escapePromptForCmdExe(attack);
    expect(out).toBe('^"^& fsutil file createnew C:\\temp\\pwned.txt 0 ^&^"');
    expect(out).toContain('^&');
    expect(out).not.toMatch(/[^^]&/);
  });

  test('an attack that tries to break out with a quote gets both the quote AND the operators caret-escaped', () => {
    const attack = 'hello" & calc.exe & "';
    const out = escapePromptForCmdExe(attack);
    // Every `"` from Layer 1 is now itself caret-escaped (`\^"`), and every
    // `&` is caret-escaped too — this is the actual mechanism that defeats
    // the quote-breakout, not "the quote alone keeps things inert" (the
    // reasoning that Addendum 2 proved false via a real marker-file exploit
    // against the attack prompt `x" & echo pwned>marker &rem `).
    expect(out).toBe('^"hello\\^" ^& calc.exe ^& \\^"^"');
    // No bare, un-caret-prefixed `&` anywhere in the escaped token.
    expect(out).not.toMatch(/[^^]&/);
    // Old (false) assertion this replaces would have checked for a raw
    // `done" & calc.exe` substring "staying inert" — that substring must
    // simply never appear at all now, in either raw or `\"`-only form.
    expect(out).not.toContain('done" & calc.exe');
    expect(out).not.toContain('hello\\" & calc.exe');
  });

  test('classic breakout shape `done" & calc.exe & "` is fully neutralized', () => {
    const attack = 'done" & calc.exe & "';
    const out = escapePromptForCmdExe(attack);
    expect(out).toBe('^"done\\^" ^& calc.exe ^& \\^"^"');
  });

  test('bare ^ and doubled ^^ round-trip through both layers correctly', () => {
    expect(escapePromptForCmdExe('a ^ b')).toBe('^"a ^^ b^"');
    expect(escapePromptForCmdExe('a ^^ b')).toBe('^"a ^^^^ b^"');
  });

  test('! (delayed expansion character) is caret-escaped', () => {
    expect(escapePromptForCmdExe('a ! b')).toBe('^"a ^! b^"');
  });

  test('embedded newlines/CRLF still collapse to spaces under the full pipeline', () => {
    const multiline = 'line one\nline two\r\nline three\rline four';
    expect(escapePromptForCmdExe(multiline)).toBe(
      '^"line one line two line three line four^"'
    );
  });
});
