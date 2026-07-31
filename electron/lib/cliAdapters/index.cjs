'use strict';

// ─────────────────────────────────────────────────────────────────
// cliAdapters/index.cjs — CLI adapter registry
//
// A CLI adapter abstracts a single AI-coding-CLI backend (Claude Code,
// GitHub Copilot CLI, …) behind ONE common interface so that mission.cjs /
// qcqa.cjs never have to know backend-specific argv, output schemas, or
// process-kill quirks. See ./types.md for the full interface + normalized
// event shape.
//
// Usage:
//   const { getAdapter } = require('../lib/cliAdapters/index.cjs');
//   const adapter = getAdapter(missionBackendId);   // 'claude' | 'copilot' | undefined
//   const args    = adapter.buildLaunchArgs({ prompt, model, resumeSessionId, maxTurns });
//   const proc    = adapter.spawn(args, cwd, { useAgentTeams });
//   // per stdout line:
//   const ev = adapter.parseLine(line);   // { kind, text?, sessionId?, ... }
//   // to terminate:
//   adapter.kill(proc);
// ─────────────────────────────────────────────────────────────────

const claudeAdapter  = require('./claudeAdapter.cjs');
const copilotAdapter = require('./copilotAdapter.cjs');

/**
 * Map of backendId → adapter object. Every adapter implements the interface
 * documented in ./types.md.
 * @type {Record<string, import('./claudeAdapter.cjs')>}
 */
const adapters = {
  claude:  claudeAdapter,
  copilot: copilotAdapter,
};

/** Default backend used when no (or an unknown) backendId is supplied. */
const DEFAULT_BACKEND = 'claude';

/**
 * Resolve a CLI adapter by backend id. Falls back to the Claude adapter for
 * undefined / null / unknown ids so existing call sites (which never passed a
 * backend id) keep behaving exactly as before.
 *
 * @param {('claude'|'copilot'|string|undefined|null)} [backendId]
 * @returns {object} the matching adapter (never null).
 */
function getAdapter(backendId) {
  if (backendId && Object.prototype.hasOwnProperty.call(adapters, backendId)) {
    return adapters[backendId];
  }
  return adapters[DEFAULT_BACKEND];
}

/**
 * List the ids of all registered backends.
 * @returns {string[]}
 */
function listBackendIds() {
  return Object.keys(adapters);
}

module.exports = { getAdapter, adapters, listBackendIds, DEFAULT_BACKEND };
