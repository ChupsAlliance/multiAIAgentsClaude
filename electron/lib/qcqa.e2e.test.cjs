// electron/lib/qcqa.e2e.test.cjs
//
// Real end-to-end proof that the QC/QA verdict-parsing fix works against the
// actual `claude` CLI's real stream-json output, not just structurally-realistic
// fixtures. Mirrors the convention in electron/lib/cliAdapters/copilot.e2e.test.cjs:
// probe CLI availability once in beforeAll, skip the whole suite (never fail it)
// if the CLI isn't present/usable, no fixed sleeps — every wait is driven by real
// subprocess events, bounded only by the test's own timeout.
//
// NOTE on require('vitest'): the brief for this task specified plain
// `require('vitest')`, but this repo's package.json sets `"type": "module"`
// and Vitest v4 explicitly refuses `require('vitest')` at runtime ("Vitest
// cannot be imported in a CommonJS module using require()"), confirmed by
// running this file. electron/lib/qcqa.test.cjs and
// electron/lib/cliAdapters/copilot.e2e.test.cjs (the file this test is
// meant to mirror) both already solve this the same way: `import` the
// vitest globals at the top (this file is loaded as ESM by Vite/Vitest
// despite its .cjs extension) and use `createRequire` only for the local
// CommonJS modules under test.
import { describe, test, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';

const require = createRequire(import.meta.url);
const { runQcQaCheck } = require('./qcqa.cjs');
const claudeAdapter = require('./cliAdapters/claudeAdapter.cjs');

const CLI_TIMEOUT_MS = 60_000;

function isClaudeCliAvailable() {
  try {
    const useShell = process.platform === 'win32';
    execFileSync('claude', ['--version'], {
      stdio: 'ignore',
      shell: useShell,
      timeout: 15_000,
      windowsHide: true,
    });
    return true;
  } catch (_) {
    return false;
  }
}

function describeIfCli(name, body) {
  if (isClaudeCliAvailable()) {
    describe(name, body);
  } else {
    describe.skip(`${name} (SKIPPED — claude CLI not available)`, body);
  }
}

describeIfCli('runQcQaCheck — real claude CLI spawn', () => {
  beforeAll(() => {
    if (!isClaudeCliAvailable()) {
      throw new Error('claude CLI became unavailable between module load and beforeAll');
    }
  });

  test('resolves PASS from the real claude CLI\'s real stream-json output', async () => {
    const prompt = [
      'You are being tested by an automated harness. Respond with EXACTLY the',
      'following text and nothing else — no markdown, no explanation, no',
      'extra lines before or after it:',
      '',
      '[QC] VERDICT: PASS',
    ].join('\n');

    const result = await runQcQaCheck({
      spawnFn: claudeAdapter.spawn,
      buildArgs: claudeAdapter.buildLaunchArgs,
      parseLine: claudeAdapter.parseLine,
      promptViaStdin: true,
      prompt,
      projectPath: process.cwd(),
      model: 'haiku',
      stage: 'QC',
      timeoutMs: CLI_TIMEOUT_MS,
    });

    expect(result).toEqual({ verdict: 'PASS' });
  }, CLI_TIMEOUT_MS);
});
