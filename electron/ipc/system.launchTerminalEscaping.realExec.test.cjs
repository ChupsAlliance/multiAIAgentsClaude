// electron/ipc/system.launchTerminalEscaping.realExec.test.cjs
//
// Real-execution PROOF that escapePromptForCmdExe survives cmd.exe's actual
// parser — not just a mental model of it (Critical issue #2 correction,
// docs/superpowers/specs/2026-08-08-launch-terminal-command-injection-design.md
// "Addendum" → "Required verification (higher bar than a plain unit test)").
//
// We build the exact inner command buildLaunchTerminalPlan produces, but swap
// the `claude` program for a harness program in the IDENTICAL command-line
// position (same escaping function, same position, a program that exits
// immediately) — a real interactive `claude` would hang the test forever.
//
// TWO witness programs, because they prove two different things:
//
//  * `echo` (cmd builtin) → PRIMARY SECURITY PROOF. Asserts the injected
//    payload's marker file is NEVER created: proof the `& ... &` operators
//    never ran, i.e. cmd.exe treated them as inert text inside the quoted
//    span. NOTE: echo prints the RAW post-parse command text and does NOT
//    perform CommandLineToArgvW un-escaping, so its stdout shows the escaped
//    form (with `\"`), not the original string — see the round-trip witness
//    below for the un-mangling proof.
//
//  * a Node argv printer → ROUND-TRIP PROOF. `claude` is a Node CLI, so it
//    receives argv via CommandLineToArgvW exactly like this printer. Asserts
//    the reconstructed argv equals the original prompt byte-for-byte — proof
//    the payload is delivered to the real receiver as inert text, un-mangled.
//    The one documented exception: `%VAR%` expands (info disclosure, not code
//    execution), asserted explicitly.
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
    const r = spawnSync('cmd.exe', ['/c', innerCmd], {
      encoding: 'utf-8',
      windowsVerbatimArguments: true,
    });
    return { stdout: r.stdout || '', stderr: r.stderr || '' };
  }

  // ─── PRIMARY SECURITY PROOF: injected commands never run ─────────
  test('marker-file injection via quote-breakout never creates the marker (echo witness)', () => {
    const marker = path.join(os.tmpdir(), `realexec-marker-${crypto.randomUUID()}.txt`);
    cleanup.push(marker);
    // If quoting failed, cmd.exe would parse `& echo pwned > "<marker>" &` as
    // real operators and the redirect would create the marker file.
    const attack = `hello & echo pwned > "${marker}" &`;

    const inner = buildInnerCmdWith('echo', attack);
    runInCmd(inner);

    expect(fs.existsSync(marker)).toBe(false);
  });

  test('metacharacter salad (& | < > ^ ( )) with a redirect never creates the marker (echo witness)', () => {
    const marker = path.join(os.tmpdir(), `realexec-marker-${crypto.randomUUID()}.txt`);
    cleanup.push(marker);
    const attack = `a & b | c ^ d ( e ) f > "${marker}"`;

    const inner = buildInnerCmdWith('echo', attack);
    runInCmd(inner);

    expect(fs.existsSync(marker)).toBe(false);
  });

  // ─── ROUND-TRIP PROOF: payload delivered to the real receiver inert ──
  test('a Node CLI (claude\'s class) reconstructs the exact prompt from argv, un-mangled', () => {
    // Print argv[2..] joined by an ASCII record-separator so nothing is
    // ambiguous. This is exactly how claude, itself a Node CLI, receives argv.
    const printer = path.join(os.tmpdir(), `realexec-printargv-${crypto.randomUUID()}.js`);
    fs.writeFileSync(
      printer,
      'process.stdout.write(process.argv.slice(2).join(String.fromCharCode(30)));'
    );
    cleanup.push(printer);

    const marker = path.join(os.tmpdir(), `realexec-marker-${crypto.randomUUID()}.txt`);
    cleanup.push(marker);

    const cases = [
      `hello & echo pwned > "${marker}" &`, // full quote-breakout attack
      'a & b | c ^ d ( e ) f',              // metacharacter salad
      'trailing backslash\\',               // trailing backslash before close quote
      'embedded "quote" here',              // embedded quotes
      'back\\"slashquote',                  // backslash immediately before a quote
      'plain ordinary prompt text',         // baseline
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

  test('the documented %VAR% exception: cmd.exe expands it before the receiver sees it (info disclosure only)', () => {
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

    // Expanded — NOT the literal `%TEMP%` — exactly the accepted residual risk.
    // No shell metacharacter interpretation, just variable substitution.
    expect(stdout).not.toContain('%TEMP%');
    expect(stdout).toContain('leaks here');
    expect(stdout).toContain(os.tmpdir());
  });
});
