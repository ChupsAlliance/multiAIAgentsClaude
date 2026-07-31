'use strict';

// ─────────────────────────────────────────────────────────────────
// claudeAdapter.cjs — CLI adapter for Anthropic's `claude` CLI.
//
// This adapter is a faithful refactor of the logic already living in
// electron/ipc/mission.cjs (spawnClaude, killClaudeProcess, the argv arrays
// around lines 2986-3474, and the stream-json parsing in
// readProcessStdout_launch ~1647-1855). Behavior MUST be identical — do not
// change flags, order, env handling, or text-extraction semantics.
//
// See ./types.md for the interface + normalized event shape.
// ─────────────────────────────────────────────────────────────────

const { spawn }    = require('cross-spawn');
const { execFile } = require('child_process');

/**
 * spawnClaude equivalent (mission.cjs). Spawns a new `claude` process.
 * @param {string[]} args
 * @param {string} cwd
 * @param {{ useAgentTeams?: boolean }} [opts]
 * @returns {import('child_process').ChildProcess}
 */
function spawnClaude(args, cwd, opts = {}) {
  const useAgentTeams = !!opts.useAgentTeams;
  const env = Object.assign({}, process.env);
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_SESSION;
  if (useAgentTeams) {
    env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1';
  } else {
    delete env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
  }

  return spawn('claude', args, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    // On Windows, `claude` resolves through a `claude.cmd` shim which
    // cross-spawn launches via an implicit `cmd.exe /c` wrapper, so the
    // ChildProcess pid is the wrapper's. windowsHide avoids flashing a
    // console; killing the real tree is handled by kill() below.
    windowsHide: true,
  });
}

/**
 * killClaudeProcess equivalent (mission.cjs). On win32 does a taskkill tree
 * kill (the cmd.exe wrapper otherwise leaves the real node process orphaned);
 * elsewhere a plain proc.kill(signal). Guarded so an already-exited process
 * never throws.
 * @param {import('child_process').ChildProcess} proc
 * @param {NodeJS.Signals|number} [signal]
 */
function killClaudeProcess(proc, signal) {
  if (!proc) return;
  if (process.platform === 'win32' && proc.pid) {
    try {
      execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], () => {});
    } catch (_) {}
    return;
  }
  try { proc.kill(signal); } catch (_) {}
}

/**
 * Map a short model id to the id Claude expects. Claude accepts the short
 * aliases ('sonnet'/'opus'/'haiku') directly, AND accepts full dated ids
 * (e.g. 'claude-sonnet-5', 'claude-haiku-4-5-20251001'). So this is a
 * pass-through: whatever mission.cjs passes today keeps working unchanged.
 * @param {string} shortId
 * @returns {string} the model id to hand to --model
 */
function mapModel(shortId) {
  // Claude understands both the short alias and the full id — never rewrite.
  return shortId;
}

/**
 * Build the argv for spawning claude. Prompt is NOT included here: mission.cjs
 * writes it to proc.stdin (and skips it on resume). '-p' IS included.
 *
 * Produces argv byte-identical to mission.cjs:
 *   new:    ['-p','--dangerously-skip-permissions','--model',M,'--output-format','stream-json','--verbose']
 *   resume: ['-p','--resume',S,'--dangerously-skip-permissions','--model',M,'--output-format','stream-json','--verbose']
 *   (+ ['--max-turns', String(n)] appended when maxTurns is a positive number)
 *
 * @param {{ prompt?: string, model?: string, resumeSessionId?: string|null,
 *           maxTurns?: number|null, useAgentTeams?: boolean }} spec
 * @returns {string[]}
 */
function buildLaunchArgs(spec = {}) {
  const model = mapModel(spec.model || 'sonnet');
  const resumeSessionId = spec.resumeSessionId || null;

  const args = resumeSessionId
    ? ['-p', '--resume', resumeSessionId, '--dangerously-skip-permissions',
       '--model', model, '--output-format', 'stream-json', '--verbose']
    : ['-p', '--dangerously-skip-permissions',
       '--model', model, '--output-format', 'stream-json', '--verbose'];

  const maxTurns = spec.maxTurns;
  if (typeof maxTurns === 'number' && maxTurns > 0) {
    args.push('--max-turns', String(maxTurns));
  }
  return args;
}

/**
 * spawn — thin wrapper over spawnClaude matching the adapter interface.
 * @param {string[]} args
 * @param {string} cwd
 * @param {{ useAgentTeams?: boolean }} [opts]
 * @returns {import('child_process').ChildProcess}
 */
function spawnAdapter(args, cwd, opts = {}) {
  return spawnClaude(args, cwd, { useAgentTeams: !!opts.useAgentTeams });
}

/**
 * Extract assistant text from a parsed stream-json object, covering every
 * structure mission.cjs handles (assistant.message.content[], assistant
 * .content[], content_block_delta.delta.text, content_block_start
 * .content_block.text).
 * @param {any} json
 * @returns {string|null}
 */
function extractTextFromJson(json) {
  let text = null;

  const msgContent = json.message && json.message.content;
  if (Array.isArray(msgContent)) {
    for (const item of msgContent) {
      if (item.text !== undefined) { text = item.text; break; }
      if (item.type === 'text' && item.text !== undefined) { text = item.text; break; }
    }
  }
  if (text === null && Array.isArray(json.content)) {
    for (const item of json.content) {
      if (item.text !== undefined) { text = item.text; break; }
    }
  }
  if (text === null && json.delta && json.delta.text !== undefined) {
    text = json.delta.text;
  }
  if (text === null && json.content_block && json.content_block.text !== undefined) {
    text = json.content_block.text;
  }
  return text;
}

/**
 * parseLine — normalize a single raw stdout line into a backend-agnostic
 * event. Mirrors the switch in readProcessStdout_launch. The raw parsed json
 * is always attached as `.raw` so callers that still need backend-specific
 * fields (tool_use inputs, subtypes, usage) can reach them.
 *
 * kind values: 'text' | 'session' | 'result' | 'tool_use' | 'system'
 *              | 'error' | 'none'
 *
 * @param {string} rawLine
 * @returns {{ kind: string, text?: string, sessionId?: string, subtype?: string,
 *             tool?: string, input?: any, resultText?: string, raw?: any }}
 */
function parseLine(rawLine) {
  const clean = (rawLine == null ? '' : String(rawLine)).trim();
  if (!clean) return { kind: 'none' };

  let json;
  try { json = JSON.parse(clean); } catch (_) { json = null; }
  if (!json) return { kind: 'none', raw: null };

  const msgType = (json.type || '').toString();

  switch (msgType) {
    case 'assistant':
    case 'content_block_delta':
    case 'content_block_start': {
      const sessionId = json.session_id || undefined;

      // A tool_use block on an assistant message → surface it as tool_use so
      // callers can log tool activity / file changes.
      const msgContent = json.message && json.message.content;
      if (msgType === 'assistant' && Array.isArray(msgContent)) {
        const toolBlock = msgContent.find(b => b && b.type === 'tool_use');
        if (toolBlock) {
          return {
            kind: 'tool_use',
            tool: toolBlock.name || 'unknown',
            input: toolBlock.input || null,
            sessionId,
            raw: json,
          };
        }
      }

      const text = extractTextFromJson(json);
      if (text !== null && text !== '') {
        return { kind: 'text', text, sessionId, raw: json };
      }
      // assistant frame with a session id but no text (rare) — surface session.
      if (sessionId) return { kind: 'session', sessionId, raw: json };
      return { kind: 'none', raw: json };
    }

    case 'system': {
      const subtype = json.subtype || '';
      if (subtype === 'init') {
        return { kind: 'system', subtype: 'init', sessionId: json.session_id || undefined, raw: json };
      }
      const text = (json.message || clean).toString();
      return { kind: 'system', subtype, text, raw: json };
    }

    case 'error': {
      const text = ((json.error && json.error.message) || json.message || clean).toString();
      return { kind: 'error', text, raw: json };
    }

    case 'result': {
      const resultText =
        (json.result || '') ||
        (Array.isArray(json.content) ? ((json.content.find(c => c.text) || {}).text || '') : '');
      return {
        kind: 'result',
        resultText,
        sessionId: json.session_id || undefined,
        raw: json,
      };
    }

    default:
      return { kind: 'none', raw: json };
  }
}

module.exports = {
  id: 'claude',
  displayName: 'Claude Code',
  binaryName() { return 'claude'; },
  mapModel,
  buildLaunchArgs,
  spawn: spawnAdapter,
  parseLine,
  kill: killClaudeProcess,

  // Prompt delivery: mission.cjs writes the prompt to proc.stdin (not argv).
  promptViaStdin: true,

  // Feature flags.
  supportsResume: true,
  supportsStreamJson: true,
  supportsAgentTeams: true,

  // Exported for tests / reuse.
  _internal: { spawnClaude, extractTextFromJson },
};
