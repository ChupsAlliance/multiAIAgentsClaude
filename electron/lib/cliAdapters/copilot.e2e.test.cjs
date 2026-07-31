// electron/lib/cliAdapters/copilot.e2e.test.cjs
//
// Conditional REAL end-to-end test for CopilotAdapter: spawns the actual
// `copilot` CLI binary (via adapter.spawn — the exact same code path
// mission.cjs uses in production) with a trivial prompt and asserts we
// receive a real `assistant.message` text event back through
// adapter.parseLine.
//
// This is NOT a mocked/fake-process test (see cliAdapters.test.cjs for the
// pure unit tests of buildLaunchArgs/parseLine/mapModel/kill). This file
// talks to the real CLI subprocess, so it is inherently slower and
// environment-dependent — hence the conditional skip below.
//
// Conditional skip (describeIfCli): a `beforeAll` probes `copilot --version`
// via execFileSync. If the binary is missing, not on PATH, or the call
// throws for any reason (e.g. not logged in and the version check itself
// requires auth in some future CLI version), the whole suite is registered
// via `describe.skip` — it is reported as skipped, never as a failure, so
// this file is safe to run in environments (CI, other contributors'
// machines) that don't have the Copilot CLI installed/authenticated.
//
// On THIS machine the CLI is confirmed present (`GitHub Copilot CLI
// 1.0.77`), per .claude-agent-team/copilot-cli-spec.md, so the suite runs
// for real here.
//
// Zero waitForTimeout: every wait in this file is driven by a real
// subprocess event (`data` on stdout, or `close`) via a Promise that
// resolves from inside the event handler — never a fixed sleep. The only
// time-bound construct is the overall Vitest test timeout (a ceiling, not a
// wait), passed as the third argument to `test(...)`.

import { describe, test, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import readline from 'readline';

const require = createRequire(import.meta.url);
const copilotAdapter = require('./copilotAdapter.cjs');

const CLI_TIMEOUT_MS = 60_000;

/**
 * Probe whether the real `copilot` CLI is usable in this environment:
 * installed, on PATH, and not obviously broken. We deliberately do NOT try
 * to detect "logged in" beyond what `--version` can tell us (a login check
 * would itself require a network round-trip); if the CLI is present but not
 * authenticated, the actual prompt test below will fail fast with a clear
 * CLI error in its own assertion rather than hanging, since we still bound
 * it with CLI_TIMEOUT_MS and inspect exit code / stderr.
 * @returns {boolean}
 */
function isCopilotCliAvailable() {
  try {
    // On Windows, npm-installed CLIs like `copilot` are `.cmd` shims — a
    // plain `execFileSync('copilot', ...)` fails with ENOENT because the
    // Windows loader does not resolve `.cmd` extensions the way the shell
    // does (the same shim quirk documented for `cross-spawn` in
    // .claude-agent-team/copilot-cli-spec.md §1/§6). `cross-spawn` (used by
    // adapter.spawn below) handles this transparently; for this one-off
    // version probe we route through the shell instead, since the argv is a
    // fixed literal (no user input), so the shell-injection risk normally
    // associated with `shell: true` does not apply here.
    const useShell = process.platform === 'win32';
    const out = execFileSync('copilot', ['--version'], {
      timeout: 15_000,
      windowsHide: true,
      shell: useShell,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
    return /copilot/i.test(out);
  } catch (_) {
    return false;
  }
}

/**
 * Run `body` as a real Vitest suite when the Copilot CLI is available,
 * otherwise register the whole suite as skipped (visible in output as
 * "skipped", never as a failure). Mirrors the shape of `describe`/`describe.skip`
 * so call sites read identically either way.
 * @param {string} name
 * @param {() => void} body
 */
function describeIfCli(name, body) {
  if (isCopilotCliAvailable()) {
    describe(name, body);
  } else {
    describe.skip(`${name} (SKIPPED — copilot CLI not found / not usable on this machine)`, body);
  }
}

describeIfCli('CopilotAdapter — real CLI E2E (Given/When/Then)', () => {
  beforeAll(() => {
    // Re-assert inside the suite too, so a flaky/late-failing probe still
    // surfaces as a clear pre-condition failure rather than a confusing
    // downstream spawn error.
    expect(isCopilotCliAvailable()).toBe(true);
  });

  test(
    'Given adapter.spawn với prompt đơn giản, When copilot CLI thật chạy xong, Then nhận được assistant.message text đúng nội dung',
    async () => {
      // Given: a trivial, deterministic prompt and the real launch argv built
      // by the adapter (exactly what mission.cjs would use for backend=copilot).
      const expectedText = 'PONG';
      const prompt = `In ra đúng chữ: ${expectedText}. Không in gì khác, không giải thích.`;
      const args = copilotAdapter.buildLaunchArgs({ prompt, model: 'sonnet' });
      expect(args[0]).toBe('-p');
      expect(args[1]).toBe(prompt);

      // When: spawn the REAL copilot process via the adapter's own spawn().
      const proc = copilotAdapter.spawn(args, process.cwd());

      const assistantTexts = [];
      let resultEvent = null;
      let stderrOutput = '';

      const rl = readline.createInterface({ input: proc.stdout });
      rl.on('line', (line) => {
        const ev = copilotAdapter.parseLine(line);
        if (ev.kind === 'text' && ev.text) {
          assistantTexts.push(ev.text);
        } else if (ev.kind === 'result') {
          resultEvent = ev;
        }
      });
      proc.stderr.on('data', (chunk) => { stderrOutput += chunk.toString(); });

      // Then: wait for the real process to exit — driven by the 'close'
      // event (and rl's 'close', which fires once stdout ends), never a
      // fixed timer. The outer `test(..., CLI_TIMEOUT_MS)` argument is the
      // only time bound, acting as a ceiling for a hung/misbehaving process.
      const exitCode = await new Promise((resolve, reject) => {
        proc.on('error', reject);
        proc.on('close', (code) => {
          rl.close();
          resolve(code);
        });
      });

      expect(exitCode, `copilot CLI exited non-zero. stderr:\n${stderrOutput}`).toBe(0);

      const fullText = assistantTexts.join('');
      expect(
        fullText.length > 0,
        `Expected at least one assistant.message text event; got none. stderr:\n${stderrOutput}`,
      ).toBe(true);
      expect(fullText).toContain(expectedText);

      // The terminal `result` event (sessionId/exitCode) should also have
      // arrived, per the real JSONL contract documented in
      // .claude-agent-team/copilot-cli-spec.md §4a.
      expect(resultEvent).not.toBeNull();
    },
    CLI_TIMEOUT_MS,
  );
});
