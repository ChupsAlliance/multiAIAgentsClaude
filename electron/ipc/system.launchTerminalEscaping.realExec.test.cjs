// electron/ipc/system.launchTerminalEscaping.realExec.test.cjs
//
// Real-execution PROOF that escapePromptForCmdExe survives cmd.exe's actual
// parser — not just a mental model of it (Critical issue #2 correction,
// docs/superpowers/specs/2026-08-08-launch-terminal-command-injection-design.md
// "Addendum 2 (correction): win32QuoteArg alone is not sufficient — add a
// second, cmd.exe-level caret-escaping layer").
//
// We build the exact inner command buildLaunchTerminalPlan produces, but swap
// the `claude` program for a harness program in the IDENTICAL command-line
// position (same escaping function, same position, a program that exits
// immediately) — a real interactive `claude` would hang the test forever.
//
// CRITICAL METHODOLOGY NOTE — why this file was rewritten:
//
// The previous version of this file (from commit 92520cf, the flawed
// "Addendum 1" fix) wrapped every injection target in quotes, e.g.
// `... > "marker.txt"`. That made every attack payload's proof a FALSE
// GREEN: even the OLD, broken (Layer-1-only) escaping "passed", not
// because injection was actually prevented, but because the corrupted
// escaping mangled the quoted target path and the injected redirect failed
// for an unrelated reason (bad filename syntax), never because the `&`/`|`
// operators were actually inert. A scoped re-review of Addendum 1 proved
// this empirically: the attack prompt `x" & echo pwned>marker &rem `
// (UNQUOTED marker target) created a real marker file through the
// Layer-1-only escaping, even though the old quoted-target tests below had
// all reported success.
//
// This file's payloads therefore use UNQUOTED injection targets throughout
// — the exact vector the old version missed — so a security regression in
// either escaping layer shows up as a real, unambiguous marker-file
// creation, not a masked syntax error.
//
// TWO witness programs, because they prove two different things:
//
//  * `echo` (cmd builtin) → PRIMARY SECURITY PROOF. Asserts the injected
//    payload's marker file is NEVER created: proof the `& | && ( )`
//    operators never ran as live cmd.exe operators.
//
//  * a Node argv printer → ROUND-TRIP PROOF. `claude` is a Node CLI, so it
//    receives argv via CommandLineToArgvW exactly like this printer. Asserts
//    the reconstructed argv equals the original attack string byte-for-byte
//    — proof the payload is delivered to the real receiver as inert text,
//    un-mangled by either escaping layer.
//
// Windows-only: cmd.exe is the parser under test. Skipped elsewhere.

import { describe, test, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const { buildLaunchTerminalPlan, escapePromptForCmdExe } = require('./system.cjs');

const runOnWindows = process.platform === 'win32' ? describe : describe.skip;

runOnWindows('launch_in_terminal escaping — real cmd.exe execution', () => {
  const cleanup = [];

  afterEach(() => {
    for (const p of cleanup) {
      try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
    }
    cleanup.length = 0;
  });

  function freshMarkerPath() {
    const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realexec-marker-'));
    cleanup.push(markerDir);
    const marker = path.join(markerDir, 'marker.txt');
    // Sanity: the marker path must contain no spaces, or an UNQUOTED
    // redirect target would itself be ambiguous cmd.exe syntax independent
    // of the escaping under test — that would corrupt the proof the same
    // way quoting the target used to. Fails loudly if the dev machine's
    // temp path has a space in it, rather than silently producing a
    // meaningless result.
    if (/\s/.test(marker)) {
      throw new Error(`Test environment's temp path contains whitespace, breaks unquoted-target proof: ${marker}`);
    }
    return marker;
  }

  // Builds the real innerCmd via buildLaunchTerminalPlan, then substitutes the
  // program name only — keeping the identical escaped argument in the identical
  // position: `... && claude <escaped>` → `... && <program> <escaped>`.
  function buildInnerCmdWith(program, attackPrompt) {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realexec-proj-'));
    cleanup.push(projectDir);
    const plan = buildLaunchTerminalPlan(projectDir, attackPrompt);
    const realInner = plan.fallbackArgs[plan.fallbackArgs.length - 1];
    const escaped = escapePromptForCmdExe(attackPrompt);
    // Confirm we're operating on the genuine article the handler would spawn.
    expect(realInner.endsWith(`claude ${escaped}`)).toBe(true);
    return realInner.replace(`claude ${escaped}`, `${program} ${escaped}`);
  }

  // Spawns a real cmd.exe /c with the given inner command string. Uses
  // windowsVerbatimArguments so Node passes our command string to cmd.exe
  // unmodified — the same parsing path cmd /K uses.
  function runInCmd(innerCmd) {
    const r = spawnSync('cmd.exe', ['/d', '/c', innerCmd], {
      encoding: 'utf-8',
      windowsVerbatimArguments: true,
    });
    return { stdout: r.stdout || '', stderr: r.stderr || '' };
  }

  // ─── PRIMARY SECURITY PROOF: injected commands never run ─────────
  // Every attack below targets an UNQUOTED marker path — no `"..."` around
  // it anywhere in the payload. This is deliberate: it's the exact shape
  // that let the flawed prior test suite pass against genuinely broken
  // escaping (see file header). If either escaping layer regresses, these
  // attacks create a real file on disk, not a syntax error.
  test.each([
    ['&  (space-separated)', (marker) => `hello" & type nul > ${marker} & rem `],
    ['&rem (tight, no space)', (marker) => `hello" & type nul > ${marker} &rem `],
    ['|  (pipe)', (marker) => `hello" | type nul > ${marker} & rem `],
    ['&&  (conditional-and)', (marker) => `hello" && type nul > ${marker} & rem `],
    ['(...) &  (parenthesized subshell)', (marker) => `hello" & (type nul > ${marker}) & rem `],
  ])('marker-file injection via %s with an UNQUOTED target never creates the marker', (_label, buildAttack) => {
    const marker = freshMarkerPath();
    const attack = buildAttack(marker);

    const inner = buildInnerCmdWith('echo', attack);
    runInCmd(inner);

    expect(fs.existsSync(marker)).toBe(false);
  });

  test('metacharacter salad (& | < > ^ ( )) with an UNQUOTED redirect target never creates the marker (echo witness)', () => {
    const marker = freshMarkerPath();
    const attack = `a & b | c ^ d ( e ) f > ${marker}`;

    const inner = buildInnerCmdWith('echo', attack);
    runInCmd(inner);

    expect(fs.existsSync(marker)).toBe(false);
  });

  // ─── ROUND-TRIP PROOF: payload delivered to the real receiver inert ──
  test('a Node CLI (claude\'s class) reconstructs the exact prompt from argv, un-mangled — unquoted attack targets', () => {
    // Print argv[2..] joined by an ASCII record-separator so nothing is
    // ambiguous. This is exactly how claude, itself a Node CLI, receives argv.
    const printer = path.join(os.tmpdir(), `realexec-printargv-${crypto.randomUUID()}.js`);
    fs.writeFileSync(
      printer,
      'process.stdout.write(process.argv.slice(2).join(String.fromCharCode(30)));'
    );
    cleanup.push(printer);

    const marker = freshMarkerPath();

    const cases = [
      `hello" & type nul > ${marker} & rem `,   // & quote-breakout, unquoted target
      `hello" | type nul > ${marker} & rem `,   // | quote-breakout, unquoted target
      `hello" && type nul > ${marker} & rem `,  // && quote-breakout, unquoted target
      `hello" & (type nul > ${marker}) & rem `, // parenthesized, unquoted target
      'a & b | c ^ d ( e ) f',                  // metacharacter salad, no quote-breakout
      'trailing backslash\\',                   // trailing backslash before close quote
      'embedded "quote" here',                  // embedded quotes
      'back\\"slashquote',                      // backslash immediately before a quote
      'plain ordinary prompt text',             // baseline
    ];

    for (const attack of cases) {
      const escaped = escapePromptForCmdExe(attack);
      const inner = `set X=1 && node ${JSON.stringify(printer)} ${escaped}`;
      const { stdout } = runInCmd(inner);
      // buildLaunchTerminalPlan collapses newlines; none here, so the single-
      // line form equals the input. The receiver must see it byte-for-byte.
      expect(stdout).toBe(attack);
      // And no attack ever created the marker.
      expect(fs.existsSync(marker)).toBe(false);
    }
  });

  test('the documented %VAR% exception is CLOSED by Layer 2: cmd.exe no longer expands it before the receiver sees it', () => {
    const printer = path.join(os.tmpdir(), `realexec-printargv-${crypto.randomUUID()}.js`);
    fs.writeFileSync(
      printer,
      'process.stdout.write(process.argv.slice(2).join(String.fromCharCode(30)));'
    );
    cleanup.push(printer);

    const attack = '%TEMP% leaks here';
    const escaped = escapePromptForCmdExe(attack);
    const inner = `set X=1 && node ${JSON.stringify(printer)} ${escaped}`;
    const { stdout } = runInCmd(inner);

    // Layer 2 caret-escapes `%`, which suppresses cmd.exe's %VAR%
    // expansion entirely — this is an IMPROVEMENT over the Layer-1-only
    // design, which had to accept this as a documented residual risk.
    // The receiver must see the literal, un-expanded prompt text.
    expect(stdout).toBe(attack);
    expect(stdout).toContain('%TEMP%');
    expect(stdout).not.toContain(os.tmpdir());
  });
});
