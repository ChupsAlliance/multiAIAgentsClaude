'use strict';

// ─────────────────────────────────────────────────────────────────
// copilotAdapter.cjs — CLI adapter for GitHub Copilot CLI (`copilot`).
//
// Grounded in .claude-agent-team/copilot-cli-spec.md (real syntax + real
// output samples captured from `copilot` v1.0.77 on this machine).
//
// Key differences from Claude, encoded here:
//  - binary is `copilot`; prompt is passed as the VALUE of -p (argv), NOT via
//    stdin (promptViaStdin = false).
//  - non-interactive requires --allow-all-tools; we also pass --no-ask-user so
//    the agent never blocks on a question while headless.
//  - output is JSONL via --output-format json, but the event schema is totally
//    different from Claude stream-json (assistant.message_delta /
//    assistant.message / result).
//  - resume flow is NOT wired (supportsResume=false) — mission.cjs must spawn
//    fresh for Copilot rather than pass --resume.
//  - agent-teams has no Copilot equivalent (supportsAgentTeams=false).
//
// See ./types.md for the interface + normalized event shape.
// ─────────────────────────────────────────────────────────────────

const { spawn }    = require('cross-spawn');
const { execFile } = require('child_process');

/** App-protocol markers embedded in TEXT content (backend-independent). */
const PROTOCOL_MARKERS = [
  '<<<QUESTION>>>',
  '<<<QUESTIONS_END>>>',
  '<<<MOCKUP_REQUEST>>>',
  '<<<MOCKUP_PAUSE>>>',
  '=== MISSION PLAN ===',
];

/**
 * Map a short model id to a Copilot model id. Copilot uses full model names,
 * not the short aliases. Per the spec, the only ids observed valid on this
 * machine are 'auto' (always safe) and 'claude-sonnet-4.6' (the real default).
 * We map conservatively and fall back to 'auto' so a launch never fails on an
 * unavailable model. Returning null tells buildLaunchArgs to DROP --model
 * entirely (Copilot then auto-selects).
 *
 * @param {string} shortId  'sonnet' | 'opus' | 'haiku' | full id | undefined
 * @returns {string|null}
 */
function mapModel(shortId) {
  switch ((shortId || '').toString().toLowerCase()) {
    case 'sonnet': return 'claude-sonnet-4.6';
    case 'opus':   return 'auto'; // no stable Opus id exposed via CLI here
    case 'haiku':  return 'auto';
    case '':       return null;   // no model requested → drop the flag
    default:
      // A caller may pass an explicit Copilot model id (e.g. 'gpt-5.4') —
      // honor it verbatim; unknown Claude-style dated ids fall back to auto.
      if (/^claude-[a-z]+-\d/.test(shortId) && shortId !== 'claude-sonnet-4.6') {
        return 'auto';
      }
      return shortId;
  }
}

/**
 * Build argv for a non-interactive Copilot run. Unlike Claude, the prompt is
 * the argument to -p (Copilot's -p requires an inline prompt value).
 *
 *   base: ['-p', prompt, '--allow-all-tools', '--no-ask-user',
 *          '--output-format', 'json', '--no-color']
 *   (+ ['--model', mapped] unless mapModel returns null)
 *   (+ ['--max-autopilot-continues', String(n)] when maxTurns given — nearest
 *      analogue to Claude's --max-turns)
 *
 * resumeSessionId is intentionally ignored (supportsResume=false).
 *
 * @param {{ prompt?: string, model?: string, resumeSessionId?: string|null,
 *           maxTurns?: number|null, useAgentTeams?: boolean }} spec
 * @returns {string[]}
 */
function buildLaunchArgs(spec = {}) {
  const prompt = spec.prompt != null ? String(spec.prompt) : '';

  // Use `-p -` (read from stdin) when prompt is long to avoid Windows
  // command-line length limits (~8191 chars). Short prompts stay inline
  // for simplicity and debuggability.
  const INLINE_LIMIT = 6000;
  const useStdin = prompt.length > INLINE_LIMIT;

  const args = ['-p', useStdin ? '-' : prompt,
    '--allow-all-tools',
    '--no-ask-user',
    '--output-format', 'json',
    '--no-color'];

  const mapped = mapModel(spec.model);
  if (mapped) {
    args.push('--model', mapped);
  }

  const maxTurns = spec.maxTurns;
  if (typeof maxTurns === 'number' && maxTurns > 0) {
    args.push('--max-autopilot-continues', String(maxTurns));
  }
  return args;
}

/**
 * Spawn a `copilot` process. Env handling: strip Claude-specific vars so a
 * nested run never inherits them; agent-teams is unsupported so we never set
 * CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS.
 * @param {string[]} args
 * @param {string} cwd
 * @param {{ useAgentTeams?: boolean }} [_opts] ignored for Copilot
 * @returns {import('child_process').ChildProcess}
 */
function spawnAdapter(args, cwd, _opts = {}) {
  const env = Object.assign({}, process.env);
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_SESSION;
  delete env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;

  return spawn('copilot', args, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    // Same Windows .cmd shim situation as claude → windowsHide + tree-kill.
    windowsHide: true,
  });
}

/**
 * kill — identical strategy to killClaudeProcess (taskkill tree-kill on win32,
 * plain proc.kill elsewhere). `copilot` is also a .cmd shim on Windows.
 * @param {import('child_process').ChildProcess} proc
 * @param {NodeJS.Signals|number} [signal]
 */
function kill(proc, signal) {
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
 * Does a line contain any app-protocol marker? Markers live in the TEXT
 * content and are backend-independent, so they must survive parseLine intact.
 * @param {string} text
 * @returns {boolean}
 */
function hasProtocolMarker(text) {
  if (!text) return false;
  return PROTOCOL_MARKERS.some(m => text.includes(m));
}

/**
 * parseLine — normalize one raw stdout line from Copilot into a backend-
 * agnostic event. Handles BOTH:
 *   - JSONL mode (--output-format json): assistant.message_delta /
 *     assistant.message → text; result → result+sessionId; session.* /
 *     *_delta reasoning / ephemeral noise → none.
 *   - Plain-text mode (no --output-format json): any non-empty line becomes
 *     { kind:'text' }.
 *
 * Whichever mode, protocol markers (<<<QUESTION>>>, === MISSION PLAN ===, …)
 * are preserved verbatim in `text` and flagged via `.hasMarker` so the caller
 * can run the same marker detection it uses for Claude.
 *
 * kind values: 'text' | 'session' | 'result' | 'system' | 'error' | 'none'
 *
 * @param {string} rawLine
 * @returns {{ kind: string, text?: string, sessionId?: string, hasMarker?: boolean,
 *             resultText?: string, raw?: any }}
 */
function parseLine(rawLine) {
  const clean = (rawLine == null ? '' : String(rawLine)).trim();
  if (!clean) return { kind: 'none' };

  let json;
  try { json = JSON.parse(clean); } catch (_) { json = null; }

  // ── Plain-text mode (not JSON): every non-empty line is text ────────────
  if (!json || typeof json !== 'object') {
    return { kind: 'text', text: clean, hasMarker: hasProtocolMarker(clean), raw: null };
  }

  const type = (json.type || '').toString();
  const data = json.data || {};

  switch (type) {
    // Full assistant message — authoritative text for the turn.
    case 'assistant.message': {
      const text = (data.content != null ? String(data.content) : '');
      if (text === '') return { kind: 'none', raw: json };
      return { kind: 'text', text, hasMarker: hasProtocolMarker(text), raw: json };
    }

    // Streamed partial text.
    case 'assistant.message_delta': {
      const text = (data.deltaContent != null ? String(data.deltaContent) : '');
      if (text === '') return { kind: 'none', raw: json };
      return { kind: 'text', text, hasMarker: hasProtocolMarker(text), raw: json };
    }

    // Terminal event: carries sessionId + exitCode.
    case 'result': {
      return {
        kind: 'result',
        sessionId: json.sessionId || undefined,
        resultText: '',
        raw: json,
      };
    }

    // Errors surfaced by the CLI.
    case 'error':
    case 'session.error': {
      const text = (data.message || json.message || clean).toString();
      return { kind: 'error', text, raw: json };
    }

    // Model / tool status carries the resolved model — surface as system.
    case 'session.tools_updated':
    case 'assistant.turn_start':
    case 'assistant.turn_end':
      return { kind: 'system', subtype: type, raw: json };

    // Everything else (reasoning deltas, mcp status, usage checkpoints,
    // ephemeral noise, user.message echo, …) → ignore.
    default:
      return { kind: 'none', raw: json };
  }
}

module.exports = {
  id: 'copilot',
  displayName: 'GitHub Copilot CLI',
  binaryName() { return 'copilot'; },
  mapModel,
  buildLaunchArgs,
  spawn: spawnAdapter,
  parseLine,
  kill,

  // Prompt delivery: Copilot's -p takes the prompt inline (argv) for short
  // prompts, but falls back to `-p -` (stdin) for long prompts to avoid
  // Windows command-line length limits.
  promptViaStdin: false,

  // Feature flags — see spec §8.
  supportsResume: false,
  supportsStreamJson: true,
  supportsAgentTeams: false,

  // Exported for tests / reuse.
  _internal: { hasProtocolMarker, PROTOCOL_MARKERS },
};
