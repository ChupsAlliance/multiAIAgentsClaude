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

function nextEscalationTier(qcRound) {
  if (qcRound <= 2) return { tier: 'retry-same' };
  if (qcRound <= 8) return { tier: 'retry-fresh' };
  return { tier: 'needs-attention' };
}

/**
 * runQcQaCheck — run one QC or QA verification pass and parse the verdict.
 *
 * QC/QA verification DELIBERATELY runs on Claude regardless of the mission's
 * agent backend: the verdict-parsing contract (stream-json + the exact
 * `[STAGE] VERDICT: …` marker protocol) is validated against Claude only, and
 * a mismatched verifier could silently pass/fail work. So even when the
 * mission backend is e.g. Copilot, QC/QA stays on Claude via `spawnClaude`.
 *
 * @param {{
 *   spawnClaude: Function,       // (args, cwd, useAgentTeams) => ChildProcess
 *   prompt: string,
 *   projectPath: string,
 *   model: string,
 *   stage: string,               // 'QC' | 'QA'
 *   timeoutMs?: number,
 *   backend?: string,            // mission/agent backend id (for logging only)
 *   log?: Function,              // optional (message) => void for surfacing the notice
 * }} opts
 */
function runQcQaCheck({ spawnClaude, prompt, projectPath, model, stage, timeoutMs = 180000, backend, log }) {
  return new Promise((resolve) => {
    // QC/QA always runs on Claude. If a non-Claude backend was requested for
    // the mission, log clearly that verification is staying on Claude.
    if (backend && backend !== 'claude') {
      const msg = `[${stage}] Backend '${backend}' được yêu cầu, nhưng kiểm định QC/QA vẫn chạy trên Claude (giao thức verdict chỉ được xác thực với Claude).`;
      if (typeof log === 'function') { try { log(msg); } catch (_) {} }
      else { try { console.log('[qcqa] ' + msg); } catch (_) {} }
    }

    const args = ['-p', prompt, '--dangerously-skip-permissions', '--model', model,
      '--output-format', 'stream-json', '--verbose'];
    const proc = spawnClaude(args, projectPath, false);

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

    proc.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(parseQcQaVerdict(stdoutText, stage));
    });
  });
}

module.exports = { parseQcQaVerdict, nextEscalationTier, runQcQaCheck };
