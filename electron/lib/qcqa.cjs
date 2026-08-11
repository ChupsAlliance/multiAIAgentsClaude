'use strict';

function parseQcQaVerdict(stdoutText, stage) {
  const text = stdoutText || '';
  const passRe = new RegExp(`^\\[${stage}\\]\\s*VERDICT:\\s*PASS\\s*$`, 'im');
  const failRe = new RegExp(`^\\[${stage}\\]\\s*VERDICT:\\s*FAIL\\s*$`, 'im');
  const agentRe = new RegExp(`^\\[${stage}\\]\\s*RESPONSIBLE_AGENT:\\s*(.+)$`, 'im');
  const reasonRe = new RegExp(`^\\[${stage}\\]\\s*REASON:\\s*(.+)$`, 'im');

  if (passRe.test(text)) {
    return { verdict: 'PASS' };
  }

  if (failRe.test(text)) {
    const agentMatch = text.match(agentRe);
    const reasonMatch = text.match(reasonRe);
    return {
      verdict: 'FAIL',
      responsibleAgent: agentMatch ? agentMatch[1].trim() : null,
      reason: reasonMatch ? reasonMatch[1].trim() : null,
    };
  }

  return {
    verdict: 'FAIL',
    responsibleAgent: null,
    reason: 'No verdict line found in QC/QA output',
  };
}

/**
 * extractLastAssistantText — turn `--output-format stream-json` JSONL stdout
 * into the agent's actual last plain-text answer, backend-agnostically.
 *
 * Runs each line through the given adapter `parseLine` and keeps the LAST
 * `kind:'text'` event's `.text` ONLY from complete assistant messages
 * (raw.type === 'assistant' for Claude, raw.type === 'assistant.message'
 * for Copilot), NOT delta fragments. This avoids truncated verdicts when
 * streaming text across multiple content_block_delta lines — the verdict
 * text must come from the complete, full message event. Tool-use/system/
 * result events never overwrite the tracked text, so a tool call between
 * the agent's reasoning and its final verdict line does not clobber the
 * real answer. Mirrors mission.cjs::extractAssistantText approach, which
 * restricts to type === 'assistant' for the same reason.
 */
function extractLastAssistantText(stdoutText, parseLine) {
  const lines = (stdoutText || '').split('\n').filter(Boolean);
  let lastText = null;
  for (const line of lines) {
    const ev = parseLine(line);
    if (ev && ev.kind === 'text' && ev.text && ev.raw &&
        (ev.raw.type === 'assistant' || ev.raw.type === 'assistant.message')) {
      lastText = ev.text;
    }
  }
  return lastText || '';
}

function nextEscalationTier(qcRound) {
  if (qcRound <= 2) return { tier: 'retry-same' };
  if (qcRound <= 8) return { tier: 'retry-fresh' };
  return { tier: 'needs-attention' };
}

/**
 * runQcQaCheck — run one QC or QA verification pass and parse the verdict.
 *
 * Uses the provided spawn function which should respect the mission's backend.
 * The spawn function can be the adapter's spawn or the legacy spawnClaude.
 *
 * @param {{
 *   spawnFn: Function,          // (args, cwd, opts) => ChildProcess
 *   buildArgs: Function,        // (spec) => string[]  — adapter's buildLaunchArgs
 *   promptViaStdin?: boolean,   // true for Claude, false for Copilot
 *   prompt: string,
 *   projectPath: string,
 *   model: string,
 *   stage: string,               // 'QC' | 'QA'
 *   timeoutMs?: number,
 *   backend?: string,            // backend id (for logging)
 *   log?: Function,              // optional (message) => void
 * }} opts
 */
function runQcQaCheck({ spawnFn, buildArgs, promptViaStdin, parseLine, spawnClaude, prompt, projectPath, model, stage, timeoutMs = 180000, backend: _backend, log: _log }) {
  return new Promise((resolve) => {
    let proc;

    if (spawnFn && buildArgs) {
      // Adapter-based path: buildArgs decides prompt delivery
      const args = buildArgs({ prompt, model });

      // Detect `-p -` convention for stdin delivery
      const pIdx = args.indexOf('-p');
      const viaStdin = (pIdx !== -1 && args[pIdx + 1] === '-') || (promptViaStdin !== false);

      proc = spawnFn(args, projectPath, {});

      if (viaStdin) {
        try { proc.stdin.write(prompt, 'utf8'); proc.stdin.end(); } catch (_) {}
      } else {
        try { proc.stdin.end(); } catch (_) {}
      }
    } else if (spawnClaude) {
      // Legacy fallback: spawnClaude path
      const args = ['-p', prompt, '--dangerously-skip-permissions', '--model', model,
        '--output-format', 'stream-json', '--verbose'];
      proc = spawnClaude(args, projectPath, false);
    } else {
      resolve({ verdict: 'FAIL', responsibleAgent: null, reason: 'No spawn function provided for QC/QA' });
      return;
    }

    let stdoutText = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill(); } catch (_) {}
      resolve({
        verdict: 'FAIL',
        responsibleAgent: null,
        reason: `QC/QA check timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    proc.stdout.on('data', (chunk) => { stdoutText += chunk.toString('utf8'); });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        verdict: 'FAIL',
        responsibleAgent: null,
        reason: `QC/QA process error: ${err.message}`,
      });
    });

    proc.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const resolvedParseLine = parseLine || require('./cliAdapters/claudeAdapter.cjs').parseLine;
      const assistantText = extractLastAssistantText(stdoutText, resolvedParseLine);
      resolve(parseQcQaVerdict(assistantText, stage));
    });
  });
}

module.exports = { parseQcQaVerdict, nextEscalationTier, runQcQaCheck };
