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

module.exports = { parseQcQaVerdict, nextEscalationTier };
