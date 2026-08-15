'use strict';

// ─── mission.cjs ─────────────────────────────────────────────────
// Faithful 1:1 port of the MISSION IPC handlers from Rust (Tauri) → Node.js (Electron)
// Source: src-tauri/src/lib.rs  (MissionManager + all mission commands)
// ─────────────────────────────────────────────────────────────────

const { ipcMain, shell, dialog, BrowserWindow } = require('electron');
const { spawn }   = require('cross-spawn');
const { execFile } = require('child_process');
const readline    = require('readline');
const fs          = require('fs');
const path        = require('path');
const os          = require('os');
const http        = require('http');

// ── Recording / Replay modules ─────────────────────────────────
const recordingSchema = require('../lib/recordingSchema.cjs');
const recordingStore  = require('../lib/recordingStore.cjs');
const replayEngine    = require('../lib/replayEngine.cjs');

// ── QC/QA per-task verification pipeline ────────────────────────
const { runQcQaCheck, nextEscalationTier } = require('../lib/qcqa.cjs');

// ── Incremental mission-index updates (Mission Companion Ask/Debrief) ──
const { enqueueChunk, scheduleFlush, buildChunksFromLogEntry, buildChunkFromFileChange,
  buildChunkFromTask, buildChunkFromMessage, flushPending, queryIndex } = require('../lib/missionIndex.cjs');

// ── CLI backend adapters (Claude / Copilot / …) ─────────────────
// getAdapter(backendId) → adapter object. Falls back to the Claude adapter for
// undefined/unknown ids so every existing call site behaves exactly as before.
// Guarded require: if the registry ever fails to load, resolveAdapter() returns
// null and callers transparently fall back to the legacy Claude code path.
let _getAdapter = null; // null = not yet loaded; false = load failed
function resolveAdapter(backendId) {
  if (_getAdapter === null) {
    try {
      _getAdapter = require('../lib/cliAdapters/index.cjs').getAdapter;
    } catch (e) {
      _getAdapter = false;
      try { console.error('[mission] cliAdapters load failed, falling back to Claude:', e && e.message); } catch (_) {}
    }
  }
  if (!_getAdapter) return null;
  try { return _getAdapter(backendId); } catch (_) { return null; }
}

/** Resolve an agent's backend id, defaulting to the mission's, then 'claude'. */
function agentBackendOf(agent) {
  if (agent && agent.backend) return agent.backend;
  if (missionState && missionState.backend) return missionState.backend;
  return 'claude';
}

/** Build QC/QA runner opts that route through the mission's backend adapter. */
function qcQaSpawnOpts() {
  const backendId = (missionState && missionState.backend) || 'claude';
  const adapter = resolveAdapter(backendId);
  if (adapter) {
    return {
      spawnFn: adapter.spawn.bind(adapter),
      buildArgs: adapter.buildLaunchArgs.bind(adapter),
      promptViaStdin: adapter.promptViaStdin !== false,
      parseLine: adapter.parseLine.bind(adapter),
      backend: backendId,
    };
  }
  // Fallback: legacy Claude path via spawnClaude
  // (runQcQaCheck defaults its own parseLine to claudeAdapter.parseLine when omitted,
  // which is correct here since this path's argv is always Claude's stream-json format.)
  return { spawnClaude, backend: backendId };
}

// ── Prompt templates (loaded once at startup) ──────────────────
// Dev: electron/prompts/   Prod (packaged): resources/prompts/
function promptPath(filename) {
  const devPath = path.join(__dirname, '../prompts', filename);
  if (fs.existsSync(devPath)) return devPath;
  // Packaged app: extraResources lands in process.resourcesPath
  return path.join(process.resourcesPath, 'prompts', filename);
}
const PROMPT_DEPLOY_AGENT_TEAMS = fs.readFileSync(promptPath('deploy_agent_teams.md'), 'utf8');
const PROMPT_DEPLOY_STANDARD = fs.readFileSync(promptPath('deploy_standard.md'), 'utf8');
const PROMPT_CONTINUE_AGENT_TEAMS = fs.readFileSync(promptPath('continue_agent_teams.md'), 'utf8');
const PROMPT_CONTINUE_STANDARD = fs.readFileSync(promptPath('continue_standard.md'), 'utf8');
const PROMPT_REPLAN = fs.existsSync(promptPath('replan.md'))
  ? fs.readFileSync(promptPath('replan.md'), 'utf8')
  : null;

// ── Module-level state (equivalent to Rust's MissionManager) ───
let missionState  = null;   // Option<MissionState>
let childProcess  = null;   // Running claude subprocess
let childBackend  = 'claude'; // backend id of the currently running childProcess
let watcherInterval = null; // setInterval for file watcher
let autosaveInterval = null; // setInterval for periodic snapshot saves
let agentTeamsCompletionTimer = null; // safety auto-complete timer for agent_teams mode
let pendingRetryTimer = null; // handle for a scheduled retrySpawn() call, if any (see docs/superpowers/specs/2026-08-08-retry-timer-cancel-on-stop-design.md)
const mockupServers = {};  // missionId → http.Server (cleanup on stop/reset)

// ── Recording capture state ──
// activeRecording = null khi không ghi; ngược lại:
//   { startedAt, missionId, events: [] }
let activeRecording = null;

// ── Agent stuck detection ──
let stuckCheckerInterval = null;
const agentLastActivity = new Map();  // agentName → lastLogTimestamp (ms)
const agentLastTask = new Map();      // agentName → { text, since }
const agentStuckWarnedAt = new Map(); // agentName → { no_log?: timestamp, task_frozen?: timestamp }

// ── QC/QA per-task verification pipeline state ──
// qcQaRunner: injectable so tests can stub out the real `claude` subprocess spawn.
// sendToWindowRef: enqueueQcCheck/enqueueQaCheck/handleQcQaFailure live outside the
// registerMission(...) closure that defines sendToWindow, so we capture a reference
// to it here once, at registerMission time (see `sendToWindowRef = sendToWindow;` below).
let qcQaRunner = runQcQaCheck;
let sendToWindowRef = () => {};

// ─────────────────────────────────────────────────────────────────
// Helper: current timestamp in milliseconds
// ─────────────────────────────────────────────────────────────────
function now() {
  return Date.now();
}

// ─────────────────────────────────────────────────────────────────
// strip_ansi — remove ANSI escape sequences
// ─────────────────────────────────────────────────────────────────
function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex -- \x1b deliberately matches the ANSI escape control character to strip terminal color codes
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

// ─────────────────────────────────────────────────────────────────
// infer_role — derive agent role from name
// ─────────────────────────────────────────────────────────────────
function inferRole(name) {
  const lower = name.toLowerCase();
  if (lower.includes('backend') || lower === 'be') return 'Backend Developer';
  if (lower.includes('frontend') || lower === 'fe') return 'Frontend Developer';
  if (lower.includes('test') || lower.includes('qc') || lower.includes('qa')) return 'Quality/Testing';
  if (lower.includes('security') || lower.includes('sec')) return 'Security Auditor';
  if (lower.includes('perf')) return 'Performance';
  if (lower.includes('doc')) return 'Documentation';
  if (lower.includes('deploy') || lower.includes('devops')) return 'DevOps';
  if (lower === 'lead' || lower === 'orchestrator') return 'Lead Coordinator';
  return name;
}

// ─────────────────────────────────────────────────────────────────
// inferPhase — derive phase hint from tool name
// ─────────────────────────────────────────────────────────────────
function inferPhase(tool) {
  switch (tool) {
    case 'Read': case 'Glob': case 'Grep': case 'WebSearch': case 'WebFetch':
      return 'investigating';
    case 'Write': case 'Edit': case 'NotebookEdit':
      return 'coding';
    case 'Bash':
      return 'building';
    case 'Agent':
      return 'spawning';
    default:
      return 'coding';
  }
}

// ─────────────────────────────────────────────────────────────────
// recordAgentActivity — track last log timestamp + task text per agent
// Called every time a log entry with an agent field is emitted.
// ─────────────────────────────────────────────────────────────────
function recordAgentActivity(agentName, taskText) {
  agentLastActivity.set(agentName, Date.now());
  if (taskText !== undefined) {
    const prev = agentLastTask.get(agentName);
    if (!prev || prev.text !== taskText) {
      agentLastTask.set(agentName, { text: taskText, since: Date.now() });
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// makeLogEntry — creates a LogEntry object
// ─────────────────────────────────────────────────────────────────
function makeLogEntry(timestamp, agent, message, logType, toolName) {
  const entry = { timestamp, agent, message, log_type: logType };
  if (toolName) {
    entry.tool_name  = toolName;
    entry.phase_hint = inferPhase(toolName);
  }
  return entry;
}

// ─────────────────────────────────────────────────────────────────
// parseProgressLine — parse "[AgentName] message" format
// ─────────────────────────────────────────────────────────────────
function parseProgressLine(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    if (end > 0) {
      const agent = trimmed.slice(1, end);
      const msg   = trimmed.slice(end + 1).trim();
      if (agent && msg) return [agent, msg];
    }
  }
  return ['Lead', trimmed];
}

// ─────────────────────────────────────────────────────────────────
// OutputParser — regex-based parser for plain-text claude output
// ─────────────────────────────────────────────────────────────────
const AGENT_MSG_RE   = /^\[([^\]]+)\]\s*(.+)$/;
const SPAWN_RE       = /(?:spawn(?:ing|ed)?\s+(?:teammate\s+)?'([^']+)')/i;
const FILE_WRITE_RE  = /(?:writ|creat|modif|updat)(?:e|ed|ing)\s+(?:file[:\s]+)?[`']?([^\s`']+\.\w+)/i;
const STARTING_RE    = /^Starting:\s*(.+)$/i;
const COMPLETED_RE   = /^Completed:\s*(.+)$/i;

class OutputParser {
  constructor() {
    this.knownAgents   = ['Lead'];
    this.currentAgent  = 'Lead';
  }

  parseLine(line) {
    const events = [];
    const clean  = stripAnsi(line).trim();
    if (!clean) return events;

    events.push({ type: 'RawLine', line: clean });

    const agentMatch = AGENT_MSG_RE.exec(clean);
    if (agentMatch) {
      const agent = agentMatch[1];
      const msg   = agentMatch[2];
      this.currentAgent = agent;

      if (!this.knownAgents.includes(agent)) {
        this.knownAgents.push(agent);
        events.push({ type: 'AgentSpawned', agentName: agent, role: inferRole(agent) });
      }

      events.push({ type: 'AgentMessage', agent, message: msg });

      // Check for spawn announcement in message
      const spawnMatch = SPAWN_RE.exec(msg);
      if (spawnMatch) {
        const spawned = spawnMatch[1];
        if (!this.knownAgents.includes(spawned)) {
          this.knownAgents.push(spawned);
          events.push({ type: 'AgentSpawned', agentName: spawned, role: inferRole(spawned) });
        }
      }

      // Task markers
      const startMatch = STARTING_RE.exec(msg);
      if (startMatch) {
        events.push({ type: 'TaskStarted', agent, description: startMatch[1] });
      }
      const completedMatch = COMPLETED_RE.exec(msg);
      if (completedMatch) {
        events.push({ type: 'TaskCompleted', agent, description: completedMatch[1] });
      }

      // File operations
      const fileMatch = FILE_WRITE_RE.exec(msg);
      if (fileMatch) {
        events.push({ type: 'FileChanged', filePath: fileMatch[1], action: 'modified', agent });
      }
    } else {
      // No agent prefix — check for file operations in bare lines
      const fileMatch = FILE_WRITE_RE.exec(clean);
      if (fileMatch) {
        events.push({ type: 'FileChanged', filePath: fileMatch[1], action: 'modified', agent: this.currentAgent });
      }
    }

    return events;
  }
}

// ─────────────────────────────────────────────────────────────────
// QC/QA per-task verification pipeline
// ─────────────────────────────────────────────────────────────────
function loadPromptTemplate(filename) {
  return fs.readFileSync(promptPath(filename), 'utf8');
}

function fillTemplate(template, values) {
  const keys = Object.keys(values);
  if (keys.length === 0) return template;
  // Single-pass substitution: build one regex matching any {{KEY}} placeholder
  // and resolve each match from `values` during replacement. This guarantees
  // a substituted value's own content is never re-scanned for further
  // placeholder matches, unlike a sequential per-key split/join loop.
  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    keys.map((key) => `\\{\\{${escapeRegExp(key)}\\}\\}`).join('|'),
    'g'
  );
  return template.replace(pattern, (match) => {
    const key = match.slice(2, -2);
    const value = values[key];
    return value == null ? '' : String(value);
  });
}

function enqueueQcCheck(task, agent) {
  const template = loadPromptTemplate('qc_check.md');
  const prompt = fillTemplate(template, {
    PROJECT_PATH: missionState.project_path,
    TASK_TITLE: task.title,
    TASK_DETAIL: task.detail || task.title,
    FILES_WRITTEN: (task.files_written || []).join(', ') || '(none reported)',
    BUILD_HINT: detectProjectType(missionState.project_path || '.'),
    RESPONSIBLE_AGENT: agent,
  });

  qcQaRunner({
    ...qcQaSpawnOpts(), prompt, projectPath: missionState.project_path,
    model: 'claude-sonnet-5', stage: 'QC', timeoutMs: 180000,
  }).then((verdict) => {
    if (verdict.verdict === 'PASS') {
      enqueueQaCheck(task, agent, verdict);
    } else {
      handleQcQaFailure(task, 'qc', verdict.responsibleAgent || agent, verdict.reason);
    }
  });
}

// Small, real-UX-visible delay between the failed_qc/failed_qa emit and the
// follow-up in_progress emit in handleQcQaFailure, so the failure state is
// actually observable (by a user or a polling test) instead of flashing for
// ~0ms in the same synchronous tick.
const QC_QA_FAILURE_VISIBILITY_DELAY_MS = 900;

function enqueueQaCheck(task, agent, _qcVerdict) {
  task.status = 'pending_qa';
  sendToWindowRef('mission:task-update', {
    task_id: task.id, agent, description: task.title, status: 'pending_qa', timestamp: now(),
  });

  const template = loadPromptTemplate('qa_check.md');
  const prompt = fillTemplate(template, {
    PROJECT_PATH: missionState.project_path,
    TASK_TITLE: task.title,
    TASK_WHY: task.why || '(not specified)',
    TASK_DETAIL: task.detail || task.title,
    FILES_WRITTEN: (task.files_written || []).join(', ') || '(none reported)',
    QC_VERDICT_SUMMARY: 'PASS',
    RESPONSIBLE_AGENT: agent,
    SCOPE_NOTE: '',
  });

  qcQaRunner({
    ...qcQaSpawnOpts(), prompt, projectPath: missionState.project_path,
    model: 'claude-sonnet-5', stage: 'QA', timeoutMs: 180000,
  }).then((verdict) => {
    if (verdict.verdict === 'PASS') {
      task.status = 'completed';
      task.completed_at = now();
      sendToWindowRef('mission:task-update', {
        task_id: task.id, agent, description: task.title, status: 'completed', timestamp: task.completed_at,
      });
    } else {
      handleQcQaFailure(task, 'qa', verdict.responsibleAgent || agent, verdict.reason);
    }
  });
}

function handleQcQaFailure(task, stage, responsibleAgent, reason) {
  task.qcRound = (task.qcRound || 0) + 1;
  task.status = stage === 'qc' ? 'failed_qc' : 'failed_qa';
  const ts = now();
  task.lastFailureDetail = { stage, reason, responsibleAgent, timestamp: ts };
  sendToWindowRef('mission:task-update', {
    task_id: task.id, agent: responsibleAgent, description: task.title, status: task.status,
    reason, timestamp: ts,
  });

  const { tier } = nextEscalationTier(task.qcRound);
  if (tier === 'needs-attention') {
    missionState.status = 'Needs Attention';
    sendToWindowRef('mission:status', {
      mission_id: missionState.id, status: 'Needs Attention',
      task_id: task.id, reason,
    });
    return;
  }

  // retry-same / retry-fresh: hand back to Lead's existing agent-resume flow
  // by putting the task back in progress. Lead's own DM/resume mechanics
  // (unchanged, out of scope) pick this up the same way it already handles
  // build-failure feedback today.
  // The transition is delayed (rather than immediate) so the failed_qc/failed_qa
  // state is actually visible for a moment -- both to a real user watching the
  // UI and to any polling-based observer -- instead of flashing for ~0ms.
  setTimeout(() => {
    task.status = 'in_progress';
    sendToWindowRef('mission:task-update', {
      task_id: task.id, agent: responsibleAgent, description: task.title, status: 'in_progress',
      reason, timestamp: now(),
    });
  }, QC_QA_FAILURE_VISIBILITY_DELAY_MS);
}

// ─────────────────────────────────────────────────────────────────
// retryAgentCore — core logic behind the 'retry_agent' IPC handler.
// Widened to also recover a task stuck at failed_qc/failed_qa (the
// 'Needs Attention' dead end from handleQcQaFailure's escalation-tier
// ceiling): resets the task's qcRound so the next QC pass starts the
// escalation tiers over, and exits 'Needs Attention' back to 'Running'
// at the mission level (the task-level status was the only thing the
// old code reset, leaving the mission stuck even after the task moved).
// ─────────────────────────────────────────────────────────────────
function retryAgentCore(agentName, sendToWindow) {
  if (!missionState) return { ok: false, error: 'No active mission' };

  const agent = missionState.agents.find(a => a.name === agentName);
  if (!agent) return { ok: false, error: `Agent "${agentName}" not found` };

  const task = missionState.tasks.find(t =>
    t.assigned_agent === agentName &&
    ['in_progress', 'completed', 'failed_qc', 'failed_qa'].includes(t.status)
  );
  if (!task) return { ok: false, error: 'No retryable task found' };

  const wasQcQaFailure = task.status === 'failed_qc' || task.status === 'failed_qa';

  agent.status = 'Idle';
  agent.error = null;
  task.status = 'pending';
  if (wasQcQaFailure) {
    task.qcRound = 0;
  }

  if (missionState.status === 'Needs Attention') {
    missionState.status = 'Running';
    sendToWindow('mission:status', { mission_id: missionState.id, status: 'Running' });
  }

  // Manual retry is a fresh vote of confidence — reset auto-resume budget
  missionState.autoResumeCount = 0;

  const agentEntry = makeLogEntry(now(), 'System',
    `[Lead] Retrying agent "${agentName}"...`, 'info');
  missionState.log.push(agentEntry);
  sendToWindow('mission:log', agentEntry);
  sendToWindow('mission:agent-spawned', { ...agent });

  if (missionState.process && !missionState.process.killed) {
    missionState.process.stdin.write(
      `\n[System] Agent "${agentName}" encountered an error. Please re-spawn it with the same task.\n`
    );
  }

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────
// waitForPendingQcQa — wait for tasks stuck in pending_qc/pending_qa
// to settle (become 'completed' or 'in_progress'/'failed_qc'/'failed_qa')
// before running the final QA sweep. Without this, the process can exit
// before async QC/QA checks finish, causing runFinalQaSweep to see
// tasks in intermediate states and skip the sweep entirely.
// Timeout: 120s (QC 180s + QA 180s max, but normally much faster).
// ─────────────────────────────────────────────────────────────────
let pendingQcQaTimeoutMs = 120000;

function waitForPendingQcQa() {
  const timeout = pendingQcQaTimeoutMs;
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if (!missionState) { resolve(); return; }
      const hasPending = missionState.tasks.some(t =>
        t.status === 'pending_qc' || t.status === 'pending_qa'
      );
      if (!hasPending || Date.now() - start > timeout) {
        resolve();
        return;
      }
      setTimeout(check, 500);
    };
    check();
  });
}

// ─────────────────────────────────────────────────────────────────
// runFinalQaSweep — whole-picture QA gate checked whenever the deploy
// process exits successfully. Only PASS here can flip the mission to
// 'Completed'; a success exit code alone is no longer sufficient.
// ─────────────────────────────────────────────────────────────────
function runFinalQaSweep() {
  // Wait for any in-flight per-task QC/QA checks to settle before deciding.
  // Without this, the process can exit before async QC/QA finishes, leaving
  // tasks at pending_qc/pending_qa and causing the sweep to skip entirely.
  return waitForPendingQcQa().then(() => {
    // Auto-promote tasks that were pushed back by handleQcQaFailure and worked
    // on by auto-resume but didn't get a proper TaskCompleted event (Lead exited
    // without emitting the marker). These tasks have qcRound > 0 (previously
    // went through QC/QA) and are still in_progress after the process exited.
    const stuckRetryTasks = missionState.tasks.filter(t =>
      t.status === 'in_progress' && (t.qcRound || 0) > 0
    );
    if (stuckRetryTasks.length > 0) {
      for (const task of stuckRetryTasks) {
        task.status = 'pending_qc';
        task.qc_started_at = now();
        const agent = task.assigned_agent || 'Lead';
        sendToWindowRef('mission:task-update', {
          task_id: task.id, agent, description: task.title,
          status: 'pending_qc', timestamp: task.qc_started_at,
        });
        enqueueQcCheck(task, agent);
      }
      // Wait again for the re-enqueued QC/QA checks to settle
      return waitForPendingQcQa().then(() => runFinalQaSweepCore());
    }

    return runFinalQaSweepCore();
  });
}

// Core logic of runFinalQaSweep, separated so it can be called after
// auto-promoting stuck retry tasks.
function runFinalQaSweepCore() {
    const allCompleted = missionState.tasks.every(t => t.status === 'completed');
    if (!allCompleted) {
      // Process exited successfully but not every task reached real completion.
      // Do not force it — leave the mission Running so the gap is visible
      // rather than papered over.
      return;
    }

    missionState.status = 'AwaitingFinalQA';
    sendToWindowRef('mission:status', { mission_id: missionState.id, status: 'AwaitingFinalQA' });

    const template = loadPromptTemplate('qa_check.md');
    const changedFiles = (missionState.file_changes || []).map(f => f.path || f).join(', ');
    const taskSummaries = missionState.tasks.map(t => `- ${t.title} (owner: ${t.assigned_agent || 'unknown'})`).join('\n');
    const prompt = fillTemplate(template, {
      PROJECT_PATH: missionState.project_path,
      TASK_TITLE: '(whole mission — see scope note)',
      TASK_WHY: missionState.description || '(not specified)',
      TASK_DETAIL: taskSummaries,
      FILES_WRITTEN: changedFiles || '(none reported)',
      QC_VERDICT_SUMMARY: 'N/A — every task already passed its own QC/QA',
      RESPONSIBLE_AGENT: '(see REASON — name the specific agent at fault)',
      SCOPE_NOTE: 'This is the FINAL WHOLE-PICTURE review: judge the mission as an integrated whole, not one task in isolation. Look specifically for cross-task mismatches (e.g. backend and frontend each correct alone but not correctly wired together).',
    });

    return qcQaRunner({
      ...qcQaSpawnOpts(), prompt, projectPath: missionState.project_path,
      model: 'claude-sonnet-5', stage: 'QA', timeoutMs: 240000,
    }).then((verdict) => {
      if (verdict.verdict === 'PASS') {
        missionState.status = 'Completed';
        missionState.autoResumeCount = 0;
        sendToWindowRef('mission:status', { mission_id: missionState.id, status: 'Completed' });
      } else {
        missionState.status = 'Running';
        const flagged = missionState.tasks.find(t => t.assigned_agent === verdict.responsibleAgent) || missionState.tasks[0];
        handleQcQaFailure(flagged, 'qa', verdict.responsibleAgent || flagged.assigned_agent, verdict.reason);
        sendToWindowRef('mission:status', { mission_id: missionState.id, status: 'Running' });
      }
    });
}

// ─────────────────────────────────────────────────────────────────
// handleParsedEvent — apply a parsed event to missionState & emit
// ─────────────────────────────────────────────────────────────────
function handleParsedEvent(event, sendToWindow) {
  const ts = now();

  switch (event.type) {
    case 'AgentSpawned': {
      const { agentName, role } = event;
      if (missionState) {
        if (!missionState.agents.some(a => a.name === agentName)) {
          missionState.agents.push({
            name: agentName, role,
            status: 'Spawning', current_task: null,
            spawned_at: ts, model: null, model_reason: null,
            backend: (missionState.backend || 'claude'),
          });
        }
        const spawnEntry = makeLogEntry(ts, 'System', `Agent '${agentName}' spawned (${role})`, 'spawn');
        missionState.log.push(spawnEntry);
        for (const chunk of buildChunksFromLogEntry(spawnEntry)) {
          enqueueChunk(missionState.id, chunk);
        }
        scheduleFlush(missionState.id);
      }
      sendToWindow('mission:agent-spawned', {
        agent_name: agentName, role, timestamp: ts,
        model: (missionState && (missionState.agents.find(x => x.name === agentName) || {}).model) || null,
      });
      break;
    }

    case 'AgentMessage': {
      const { agent, message } = event;
      if (missionState) {
        const a = missionState.agents.find(x => x.name === agent);
        if (a) {
          if (a.status === 'Spawning' || a.status === 'Idle') a.status = 'Working';
          a.current_task = message.length > 80 ? message.slice(0, 77) + '...' : message;
        }
        const entry = makeLogEntry(ts, agent, message, 'info');
        missionState.log.push(entry);
        for (const chunk of buildChunksFromLogEntry(entry)) {
          enqueueChunk(missionState.id, chunk);
        }
        scheduleFlush(missionState.id);
        if (missionState.log.length > 2000) missionState.log.splice(0, 500);
        sendToWindow('mission:log', entry);
        if (entry.agent && entry.agent !== 'System' && entry.agent !== 'User') {
          const agentObj = missionState?.agents?.find(a => a.name === entry.agent);
          recordAgentActivity(entry.agent, agentObj?.current_task);
        }
      }
      break;
    }

    case 'TaskStarted': {
      const { agent, description } = event;
      if (missionState) {
        const existing = missionState.tasks.find(x =>
          x.title === description && x.assigned_agent === agent && x.status === 'pending');
        if (existing) {
          existing.status = 'in_progress';
          existing.started_at = ts;
          const a = missionState.agents.find(x => x.name === agent);
          if (a) { a.status = 'Working'; a.current_task = description; }
          sendToWindow('mission:task-update', { task_id: existing.id, agent, description, status: 'in_progress', timestamp: ts });
          break;
        }
        const taskId = `task-${ts}`;
        missionState.tasks.push({
          id: taskId, title: description,
          status: 'in_progress', assigned_agent: agent,
          started_at: ts, completed_at: null, priority: null,
        });
        const a = missionState.agents.find(x => x.name === agent);
        if (a) { a.status = 'Working'; a.current_task = description; }
        sendToWindow('mission:task-update', { task_id: taskId, agent, description, status: 'in_progress', timestamp: ts });
      }
      break;
    }

    case 'TaskCompleted': {
      const { agent, description } = event;
      if (missionState) {
        // Find this agent's task still in flight. Matching only 'in_progress'
        // misses the case where a QC/QA retry's "Completed:" line arrives
        // before handleQcQaFailure's QC_QA_FAILURE_VISIBILITY_DELAY_MS timer
        // has flipped the task back from 'failed_qc'/'failed_qa' to
        // 'in_progress' — that race pushed a brand-new duplicate task row
        // (and a second, concurrent QC check) for the same task instead of
        // recognizing it as the retry. Match any status short of the
        // terminal 'completed' so the same task is reused across its whole
        // QC/QA lifecycle.
        const t = missionState.tasks.find(x =>
          x.assigned_agent === agent && x.status !== 'completed');
        let targetTask;
        if (t) {
          t.status = 'pending_qc';
          t.qc_started_at = ts;
          targetTask = t;
        } else {
          // Task wasn't tracked; add as pending_qc
          targetTask = {
            id: `task-${ts}`, title: description,
            status: 'pending_qc', assigned_agent: agent,
            started_at: ts, qc_started_at: ts, priority: null, qcRound: 0,
          };
          missionState.tasks.push(targetTask);
        }
        const a = missionState.agents.find(x => x.name === agent);
        if (a) { a.status = 'Idle'; a.current_task = null; }
        enqueueQcCheck(targetTask, agent);
      }
      sendToWindow('mission:task-update', { agent, description, status: 'pending_qc', timestamp: ts });
      break;
    }

    case 'FileChanged': {
      const { filePath, action, agent } = event;
      const fc = { path: filePath, action, agent, timestamp: ts, lines: null, content_preview: null };
      if (missionState) missionState.file_changes.push(fc);
      sendToWindow('mission:file-change', { path: filePath, action, agent, timestamp: ts });
      break;
    }

    case 'RawLine': {
      const { line } = event;
      if (missionState) {
        missionState.raw_output.push(line);
        if (missionState.raw_output.length > 5000) missionState.raw_output.splice(0, 1000);
      }
      sendToWindow('mission:raw-line', { line });
      break;
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// detectProjectType — match Rust's project detection logic
// ─────────────────────────────────────────────────────────────────
function detectProjectType(projectPath) {
  const p = projectPath;
  if (fs.existsSync(path.join(p, 'package.json'))) {
    let pkg = '';
    try { pkg = fs.readFileSync(path.join(p, 'package.json'), 'utf8'); } catch (_) {}
    if (pkg.includes('"vite"') || pkg.includes('"@vitejs')) {
      return 'Node.js/Vite project. After writing code: run `npm install` then `npm run build`. If build fails, fix errors and retry. Final check: `npm run build` must succeed with 0 errors.';
    } else if (pkg.includes('"next"')) {
      return 'Node.js/Next.js project. After writing code: run `npm install` then `npm run build`. If build fails, fix errors and retry.';
    } else {
      return 'Node.js project. After writing code: run `npm install` then verify with `node -e "require(\'./index.js\')"` or appropriate entry point.';
    }
  }
  if (fs.existsSync(path.join(p, 'requirements.txt')) ||
      fs.existsSync(path.join(p, 'pyproject.toml')) ||
      fs.existsSync(path.join(p, 'setup.py'))) {
    return 'Python project. After writing code: run `pip install -r requirements.txt` (if exists) then verify with `python -c "import <module>"` or run the main script.';
  }
  if (fs.existsSync(path.join(p, 'Cargo.toml'))) {
    return 'Rust project. After writing code: run `cargo build`. If it fails, fix errors and retry until `cargo build` succeeds.';
  }
  if (fs.existsSync(path.join(p, 'go.mod'))) {
    return 'Go project. After writing code: run `go build ./...`. If it fails, fix errors and retry.';
  }
  if (fs.existsSync(path.join(p, 'pom.xml')) || fs.existsSync(path.join(p, 'build.gradle'))) {
    return 'Java/JVM project. After writing code: run `mvn compile` or `gradle build`. Fix any errors before declaring done.';
  }
  return 'Unknown project type. Detect from file extensions what runtime is needed. Always verify the code actually runs before reporting done.';
}

// Simpler version for continue_mission (shorter hint)
function detectProjectTypeCont(projectPath) {
  const p = projectPath;
  if (fs.existsSync(path.join(p, 'package.json'))) {
    let pkg = '';
    try { pkg = fs.readFileSync(path.join(p, 'package.json'), 'utf8'); } catch (_) {}
    if (pkg.includes('"vite"') || pkg.includes('"@vitejs')) {
      return 'Node.js/Vite — verify with: npm install && npm run build';
    }
    return 'Node.js — verify with: npm install && node <entry>';
  }
  if (fs.existsSync(path.join(p, 'requirements.txt')) || fs.existsSync(path.join(p, 'pyproject.toml'))) {
    return 'Python — verify with: pip install -r requirements.txt && python <entry>';
  }
  if (fs.existsSync(path.join(p, 'Cargo.toml'))) return 'Rust — verify with: cargo build';
  return 'Unknown — detect and verify appropriately';
}

// ─────────────────────────────────────────────────────────────────
// buildPermissionModeSection — prompt injection based on permission mode
// ─────────────────────────────────────────────────────────────────
function buildPermissionModeSection(mode) {
  if (mode === 'interactive') {
    return `
## QUESTION PROTOCOL (Interactive Mode)

When you genuinely cannot proceed without user input — missing critical information
that is not available in the provided documents, reference materials, or project files:

1. Output this EXACT format (one block per question):
<<<QUESTION>>>
{"from":"Lead","type":"clarification","question":"Your specific question here","options":["Option A","Option B"],"context":"Why you need this answered"}
<<<END_QUESTION>>>

2. You may output multiple <<<QUESTION>>> blocks if you have several questions.

3. After ALL questions, output the terminal marker:
<<<QUESTIONS_END>>>

4. Then STOP. End your turn immediately after the <<<QUESTIONS_END>>> marker.
   Do not output anything else, do not call any tools, do not continue working.
   The user will answer your questions and a new turn will begin with their answers.

5. When you receive the user's answers in the next turn, continue working based on them.

RULES:
- Only YOU (Lead) can ask the user. Subagents ask you via SendMessage.
- You decide whether to answer subagents from your knowledge or escalate to the user.
- Only ask when you truly lack critical information that would lead to wrong decisions.
- Prefer making informed decisions autonomously when possible.
- If you've already asked multiple questions, strongly consider deciding on your own.
- ALWAYS end your question batch with <<<QUESTIONS_END>>> marker.
- ALWAYS end your turn immediately after <<<QUESTIONS_END>>> — this is critical.
`;
  }
  // auto mode (default) — or plan-only
  return `
## AUTONOMOUS MODE
You are running in autonomous mode. Make all decisions independently.
Choose the most optimal approach that best fits the current project architecture.
Do NOT output <<<QUESTION>>> markers.
`;
}

// ─────────────────────────────────────────────────────────────────
// detectVietnamese — check if description has Vietnamese characters
// ─────────────────────────────────────────────────────────────────
function detectVietnamese(text) {
  // Same character set as Rust source
  const VI_RE = /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴĐ]/;
  return VI_RE.test(text);
}

// ─────────────────────────────────────────────────────────────────
// saveMissionSnapshot — save full MissionState to ~/.claude/agent-teams-snapshots/
// Preserves everything needed to fully restore the Dashboard UI at mission-end.
// raw_output is truncated to last 500 lines to keep file size reasonable.
// ─────────────────────────────────────────────────────────────────
function saveMissionSnapshot(state, extra = {}) {
  try {
    const snapshotsDir = path.join(os.homedir(), '.claude', 'agent-teams-snapshots');
    fs.mkdirSync(snapshotsDir, { recursive: true });
    const filePath = path.join(snapshotsDir, `${state.id}.json`);

    // Clone to avoid mutating live state; truncate raw_output for disk savings
    const snap = Object.assign({}, state, extra);
    if (Array.isArray(snap.raw_output) && snap.raw_output.length > 500) {
      snap.raw_output = snap.raw_output.slice(-500);
    }
    // Truncate log to last 2000 entries (still plenty for review)
    if (Array.isArray(snap.log) && snap.log.length > 2000) {
      snap.log = snap.log.slice(-2000);
    }

    fs.writeFileSync(filePath, JSON.stringify(snap, null, 2), 'utf8');
  } catch {
    // Non-fatal
  }
}

// ─────────────────────────────────────────────────────────────────
// saveToHistory — append entry to ~/.claude/agent-teams-history.json
// ─────────────────────────────────────────────────────────────────
function saveToHistory(entry) {
  try {
    const historyPath = path.join(os.homedir(), '.claude', 'agent-teams-history.json');
    let history = [];
    if (fs.existsSync(historyPath)) {
      try { history = JSON.parse(fs.readFileSync(historyPath, 'utf8')); } catch (_) {}
    }
    if (!Array.isArray(history)) history = [];
    history.unshift(entry);
    if (history.length > 50) history.length = 50;
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf8');
  } catch (_) {
    // Non-fatal
  }
}

// ─────────────────────────────────────────────────────────────────
// stopWatcher — stop the file-watcher interval
// ─────────────────────────────────────────────────────────────────
function stopWatcher() {
  if (watcherInterval !== null) {
    clearInterval(watcherInterval);
    watcherInterval = null;
  }
}

// ─────────────────────────────────────────────────────────────────
// startAutosave / stopAutosave — periodic snapshot flush (every 10s)
// ─────────────────────────────────────────────────────────────────
function startAutosave() {
  stopAutosave();
  autosaveInterval = setInterval(() => {
    if (missionState) {
      saveMissionSnapshot(missionState);
    }
  }, 10_000);
}

function stopAutosave() {
  if (autosaveInterval !== null) {
    clearInterval(autosaveInterval);
    autosaveInterval = null;
  }
}

// ─────────────────────────────────────────────────────────────────
// startStuckChecker / stopStuckChecker
// Detects agents that go silent (60s no log) or frozen (90s same task).
// Interval: 15s. Emits mission:agent-stuck to frontend.
// ─────────────────────────────────────────────────────────────────
function startStuckChecker(sendToWindow, fresh = true) {
  stopStuckChecker();  // always clear the interval
  if (fresh) {
    agentLastActivity.clear();
    agentLastTask.clear();
    agentStuckWarnedAt.clear();
  }
  stuckCheckerInterval = setInterval(() => {
    if (!missionState || missionState.status !== 'Running') return;
    const now_ = Date.now();
    for (const [agentName, lastSeen] of agentLastActivity) {
      const silentMs = now_ - lastSeen;
      // For no_log: only emit when newly crossing threshold (or re-crossing after 60s since last warn)
      const warned = agentStuckWarnedAt.get(agentName) || {};
      if (silentMs >= 60_000 && (!warned.no_log || (now_ - warned.no_log) >= 60_000)) {
        sendToWindow('mission:agent-stuck', {
          agent: agentName,
          silent_ms: silentMs,
          reason: 'no_log',
        });
        agentStuckWarnedAt.set(agentName, { ...warned, no_log: now_ });
      } else {
        // Use else if to avoid double-toast when both conditions apply
        const taskInfo = agentLastTask.get(agentName);
        if (taskInfo && (now_ - taskInfo.since) >= 90_000) {
          const warned2 = agentStuckWarnedAt.get(agentName) || {};
          if (!warned2.task_frozen || (now_ - warned2.task_frozen) >= 90_000) {
            sendToWindow('mission:agent-stuck', {
              agent: agentName,
              silent_ms: now_ - taskInfo.since,
              reason: 'task_frozen',
            });
            agentStuckWarnedAt.set(agentName, { ...warned2, task_frozen: now_ });
          }
        }
      }
    }
  }, 15_000);
}

function stopStuckChecker() {
  if (stuckCheckerInterval !== null) {
    clearInterval(stuckCheckerInterval);
    stuckCheckerInterval = null;
  }
  agentLastActivity.clear();
  agentLastTask.clear();
  agentStuckWarnedAt.clear();
}

// ─────────────────────────────────────────────────────────────────
// Agent Teams completion safety timer
// When all non-Lead subagents finish but the Lead process hangs
// (e.g. stuck waiting on SendMessage acknowledgement or final build),
// this timer force-completes the mission after 90 seconds of inactivity.
// ─────────────────────────────────────────────────────────────────
function clearAgentTeamsTimer() {
  if (agentTeamsCompletionTimer !== null) {
    clearTimeout(agentTeamsCompletionTimer);
    agentTeamsCompletionTimer = null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Pending cross-phase retry timer (transient API error / dangling-question
// safety net). Only one mission (and therefore at most one in-flight retry)
// can be active at a time — childProcess is a single module-level variable,
// not a collection — so a single scalar handle is sufficient.
// ─────────────────────────────────────────────────────────────────
function clearPendingRetryTimer() {
  if (pendingRetryTimer !== null) {
    clearTimeout(pendingRetryTimer);
    pendingRetryTimer = null;
  }
}

function scheduleAgentTeamsCompletion(missionId, sendToWindow) {
  clearAgentTeamsTimer();
  agentTeamsCompletionTimer = setTimeout(() => {
    agentTeamsCompletionTimer = null;
    if (!missionState || missionState.status !== 'Running') return;
    if (missionState.phase !== 'Executing') return;

    const ts = now();
    const logEntry = makeLogEntry(ts, 'System',
      'All agents done — Lead process timed out after 90s, running final QA sweep', 'info');
    missionState.log.push(logEntry);
    sendToWindow('mission:log', logEntry);

    killChild();
    stopWatcher();
    stopAutosave();
    stopStuckChecker();

    runFinalQaSweep().then(() => {
      missionState.phase = 'Done';
      for (const a of missionState.agents) {
        if (a.status !== 'Error') a.status = 'Done';
        if (a.name === 'Lead') {
          a.current_task = missionState.status === 'Completed' ? 'Mission completed'
            : missionState.status === 'Running' ? 'Awaiting retry (final QA sweep scheduled one)'
            : 'Mission failed';
        }
      }
      finalizeDeployExit(missionId, sendToWindow, ts);
    });
  }, 90_000);
}

// ─────────────────────────────────────────────────────────────────
// killChild — kill the running claude subprocess
// ─────────────────────────────────────────────────────────────────
function killChild() {
  if (childProcess !== null) {
    killBackendProcess(childProcess, childBackend, 'SIGKILL');
    childProcess = null;
  }
}

// ─────────────────────────────────────────────────────────────────
// collectFiles — recursive file list helper (mirrors Rust collect_files)
// ─────────────────────────────────────────────────────────────────
const SKIP_DIRS = new Set(['node_modules', '.git', '.claude', 'dist', 'build', 'target']);

function collectFiles(dir, base, out = new Set()) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch (_) { return out; }
  for (const name of entries) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    let stat;
    try { stat = fs.statSync(full); } catch (_) { continue; }
    if (stat.isDirectory()) {
      collectFiles(full, base, out);
    } else {
      const rel = path.relative(base, full).replace(/\\/g, '/');
      out.add(rel);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
// buildMissionSummary — build completed/in-progress/pending/logs/files summary
// Used in launch_mission (history context) and continue_mission (both paths)
// ─────────────────────────────────────────────────────────────────
function buildMissionSummary(state, logLimit = 30) {
  const parts = [];
  const tasks = state.tasks || [];
  const done   = tasks.filter(t => t.status === 'completed')
    .map(t => `- [DONE] ${t.title} (by ${t.assigned_agent || 'unknown'})`);
  const inProg = tasks.filter(t => t.status === 'in_progress')
    .map(t => `- [IN PROGRESS] ${t.title} (by ${t.assigned_agent || 'unknown'})`);
  const pend   = tasks.filter(t => t.status === 'pending')
    .map(t => `- [PENDING] ${t.title}`);
  if (done.length)   parts.push(`Completed:\n${done.join('\n')}`);
  if (inProg.length) parts.push(`In Progress:\n${inProg.join('\n')}`);
  if (pend.length)   parts.push(`Pending:\n${pend.join('\n')}`);

  const failedQa = tasks.filter(t =>
    (t.status === 'failed_qc' || t.status === 'failed_qa') && t.lastFailureDetail
  ).map(t =>
    `- ${t.title} (owner: ${t.lastFailureDetail.responsibleAgent || 'unknown'}, stage: ${t.lastFailureDetail.stage}): ${t.lastFailureDetail.reason || '(no reason given)'}`
  );
  if (failedQa.length) parts.push(`QA/QC failures:\n${failedQa.join('\n')}`);

  const logs = (state.log || []).filter(l => l.log_type !== 'raw').slice(-logLimit)
    .map(l => `[${l.agent}] ${(l.message || '').slice(0, 300)}`);
  if (logs.length) parts.push(`Recent activity:\n${logs.join('\n')}`);

  const files = (state.file_changes || []).slice(0, 50)
    .map(f => `- ${f.path} (${f.action})`);
  if (files.length) parts.push(`Files created/modified:\n${files.join('\n')}`);

  return parts.join('\n\n');
}

// ─────────────────────────────────────────────────────────────────
// startFileWatcher — agent_teams mode: poll tasks dir + project dir
// mirrors watch_agent_teams_mission in Rust
// ─────────────────────────────────────────────────────────────────
function startFileWatcher(projectPath, sendToWindow) {
  stopWatcher(); // cancel any previous watcher

  const tasksDir = path.join(os.homedir(), '.claude', 'tasks', 'mission');
  const projectDir = projectPath;

  // Seed known project files so we don't emit for pre-existing ones
  let knownProjectFiles = collectFiles(projectDir, projectDir);
  const knownTaskStatuses = new Map();  // taskId → status
  const knownMsgIds       = new Set();  // "from-to-ts" dedup

  let iter = 0;

  watcherInterval = setInterval(() => {
    iter++;
    const ts = now();

    // ── Poll ~/.claude/tasks/mission/ for task updates ──
    if (fs.existsSync(tasksDir)) {
      let entries;
      try { entries = fs.readdirSync(tasksDir); } catch (_) { entries = []; }
      for (const fname of entries) {
        if (!fname.endsWith('.json')) continue;
        let raw, json;
        try { raw = fs.readFileSync(path.join(tasksDir, fname), 'utf8'); } catch (_) { continue; }
        try { json = JSON.parse(raw); } catch (_) { continue; }

        const taskId     = (json.id     || '').toString();
        const taskTitle  = (json.title  || '').toString();
        const taskStatus = (json.status || 'pending').toString();
        const taskOwner  = (json.owner  || '').toString();

        if (!taskId) continue;

        const prevStatus = knownTaskStatuses.get(taskId) || '';
        if (prevStatus !== taskStatus) {
          knownTaskStatuses.set(taskId, taskStatus);

          // Update missionState
          if (missionState) {
            // Find or skip task update
            const existingTask = missionState.tasks.find(t => t.id === taskId || t.title === taskTitle);
            if (existingTask) {
              const mappedStatus = (taskStatus === 'completed' || taskStatus === 'done')
                ? 'completed' : (taskStatus === 'in_progress' ? 'in_progress' : 'pending');
              existingTask.status = mappedStatus;
              if (taskStatus === 'completed' || taskStatus === 'done') {
                existingTask.completed_at = ts;
              }
            }
            // Update agent status
            if (taskOwner) {
              const agentObj = missionState.agents.find(a => a.name === taskOwner);
              if (agentObj && taskStatus === 'in_progress') {
                agentObj.status = 'Working';
                agentObj.current_task = taskTitle;
              }
            }
            // Log entry
            const logAgent = taskOwner || 'System';
            const logEntry = makeLogEntry(ts, logAgent, `[Task ${taskStatus}] ${taskId}: ${taskTitle}`, 'task');
            missionState.log.push(logEntry);
            sendToWindow('mission:log', { timestamp: ts, agent: logAgent, message: `[Task ${taskStatus}] ${taskTitle}`, log_type: 'task' });
          }

          sendToWindow('mission:task-update', {
            task_id: taskId,
            agent: taskOwner,
            description: taskTitle,
            status: taskStatus,
            owner: taskOwner,
            timestamp: ts,
          });
        }

        // ── Check for messages in task file ──
        const msgs = Array.isArray(json.messages) ? json.messages : [];
        for (const msg of msgs) {
          const from    = (msg.from    || '').toString();
          const to      = (msg.to      || '').toString();
          const content = (msg.content || '').toString();
          const msgTs   = typeof msg.timestamp === 'number' ? msg.timestamp : ts;
          const msgId   = `${from}-${to}-${msgTs}`;

          if (from && content && !knownMsgIds.has(msgId)) {
            knownMsgIds.add(msgId);
            if (missionState) {
              if (!missionState.messages.some(m => m.from === from && m.timestamp === msgTs)) {
                const messageObj = { timestamp: msgTs, from, to, content, msg_type: 'message' };
                missionState.messages.push(messageObj);
                enqueueChunk(missionState.id, buildChunkFromMessage(messageObj));
                scheduleFlush(missionState.id);
              }
            }
            sendToWindow('mission:agent-message', { from, to, content, timestamp: msgTs, msg_id: msgId });
          }
        }
      }
    }

    // ── Poll project directory for new files (every 5 iters = 10s) ──
    if (iter % 5 === 0) {
      const currentFiles = collectFiles(projectDir, projectDir);
      for (const f of currentFiles) {
        if (!knownProjectFiles.has(f)) {
          knownProjectFiles.add(f);
          if (missionState) {
            if (!missionState.file_changes.some(fc => fc.path === f)) {
              missionState.file_changes.push({
                path: f, action: 'created', agent: 'Agent',
                timestamp: ts, lines: null, content_preview: null,
                diff_old: null, diff_new: null,
              });
            }
          }
          sendToWindow('mission:file-change', { path: f, action: 'created', agent: 'Agent', timestamp: ts });
        }
      }
    }

  }, 2000);
}

// ─────────────────────────────────────────────────────────────────
// spawnClaude — spawn a new `claude -p ...` process and return it
// ─────────────────────────────────────────────────────────────────
function spawnClaude(args, cwd, useAgentTeams) {
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
    // On Windows, `claude` typically resolves through a `claude.cmd` shim,
    // which cross-spawn can only launch via an implicit `cmd.exe /c` wrapper
    // (regardless of shell:false) -- so the ChildProcess's pid is the wrapper's,
    // not the real claude/node process underneath it. `windowsHide` avoids
    // flashing a console window for that wrapper; the actual fix for killing
    // the real process tree lives in killClaudeProcess() below, which does a
    // Windows tree-kill instead of relying on proc.kill() alone.
    windowsHide: true,
  });
}

// killClaudeProcess — terminate a ChildProcess returned by spawnClaude.
// On non-Windows platforms this is exactly proc.kill() (unchanged behavior).
// On Windows, proc.kill() only ever reaches the cmd.exe wrapper that
// cross-spawn interposes to launch the claude.cmd shim, leaving the real
// claude/node process (and any of its children) running as an orphan. Using
// `taskkill /pid <pid> /T /F` kills the wrapper's entire process tree instead.
// Guarded so a process that already exited (taskkill errors) never throws
// uncaught.
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

// ─────────────────────────────────────────────────────────────────
// killBackendProcess — terminate a ChildProcess for ANY backend.
// Uses the backend adapter's kill() when available (Claude and Copilot both
// need a Windows tree-kill for their .cmd shims); falls back to the legacy
// killClaudeProcess() when no adapter is resolvable so Claude behavior is
// byte-identical to before.
// ─────────────────────────────────────────────────────────────────
function killBackendProcess(proc, backendId, signal) {
  if (!proc) return;
  const adapter = resolveAdapter(backendId);
  if (adapter && typeof adapter.kill === 'function') {
    try { adapter.kill(proc, signal); return; } catch (_) {}
  }
  killClaudeProcess(proc, signal);
}

// ─────────────────────────────────────────────────────────────────
// spawnAgentProcess — the ONE spawn site for mission agent processes.
// Routes through the backend adapter: builds argv, applies resume fallback,
// gates agent-teams, chooses prompt delivery (stdin vs argv), spawns, and
// tracks childBackend so killChild() can terminate the right tree.
//
// Returns { proc, adapter, backendId, resumeDropped, promptViaStdin,
//           supportsAgentTeams }.
//
// If no adapter is resolvable (registry load failure), falls back to the
// legacy Claude path (spawnClaude + inline argv), so Claude keeps working.
//
// @param {{ backendId?, model?, prompt?, resumeSessionId?, maxTurns?,
//           useAgentTeams?, cwd, sendToWindow? }} spec
// ─────────────────────────────────────────────────────────────────
function spawnAgentProcess(spec = {}) {
  const backendId       = spec.backendId || (missionState && missionState.backend) || 'claude';
  const model           = spec.model;
  const prompt          = spec.prompt != null ? String(spec.prompt) : '';
  let   resumeSessionId = spec.resumeSessionId || null;
  const maxTurns        = (typeof spec.maxTurns === 'number' && spec.maxTurns > 0) ? spec.maxTurns : null;
  const cwd             = spec.cwd;
  const sendToWindow    = typeof spec.sendToWindow === 'function' ? spec.sendToWindow : null;

  const adapter = resolveAdapter(backendId);

  // ── Fallback: no adapter (registry failed) → legacy Claude path ─────────
  if (!adapter) {
    const args = resumeSessionId
      ? ['-p', '--resume', resumeSessionId, '--dangerously-skip-permissions',
         '--model', (model || 'sonnet'), '--output-format', 'stream-json', '--verbose']
      : ['-p', '--dangerously-skip-permissions',
         '--model', (model || 'sonnet'), '--output-format', 'stream-json', '--verbose'];
    if (maxTurns) args.push('--max-turns', String(maxTurns));
    const proc = spawnClaude(args, cwd, !!spec.useAgentTeams);
    childProcess = proc;
    childBackend = 'claude';
    return { proc, adapter: null, backendId: 'claude', resumeDropped: false,
             promptViaStdin: true, supportsAgentTeams: true };
  }

  // ── Resume fallback: adapter can't resume → spawn fresh + loud log ──────
  let resumeDropped = false;
  if (resumeSessionId && adapter.supportsResume === false) {
    resumeDropped = true;
    resumeSessionId = null;
    const name = adapter.displayName || backendId;
    if (sendToWindow) {
      sendToWindow('mission:log', {
        agent: 'System',
        message: `[${name}] không hỗ trợ resume phiên (session). Khởi chạy lại từ đầu (fresh launch) thay vì --resume.`,
        log_type: 'system',
        timestamp: Date.now(),
      });
    }
    try { console.log(`[mission] backend '${backendId}' supportsResume=false → dropping resume, spawning fresh`); } catch (_) {}
  }

  // ── Agent-teams gating: only when adapter supports it ───────────────────
  const effAgentTeams = !!spec.useAgentTeams && adapter.supportsAgentTeams !== false;
  if (spec.useAgentTeams && !effAgentTeams && sendToWindow) {
    const name = adapter.displayName || backendId;
    sendToWindow('mission:log', {
      agent: 'System',
      message: `[${name}] không hỗ trợ Agent Teams. Chạy ở chế độ tiêu chuẩn (standard).`,
      log_type: 'system',
      timestamp: Date.now(),
    });
  }

  // ── Prompt delivery: stdin (Claude) vs argv (Copilot) ───────────────────
  // Static default from the adapter, but buildLaunchArgs may use `-p -` for
  // long prompts (Copilot on Windows), which signals stdin delivery.
  let promptViaStdin = adapter.promptViaStdin !== false;

  const args = adapter.buildLaunchArgs({
    prompt: promptViaStdin ? undefined : prompt,
    model,
    resumeSessionId,
    maxTurns,
    useAgentTeams: effAgentTeams,
  });

  // Detect `-p -` convention: adapter built args with `-p -` meaning
  // "read prompt from stdin" (e.g. Copilot with long prompt).
  const pIdx = args.indexOf('-p');
  if (pIdx !== -1 && args[pIdx + 1] === '-') {
    promptViaStdin = true;
  }

  const proc = adapter.spawn(args, cwd, { useAgentTeams: effAgentTeams });
  childProcess = proc;
  childBackend = backendId;

  return { proc, adapter, backendId, resumeDropped, promptViaStdin,
           supportsAgentTeams: adapter.supportsAgentTeams !== false };
}

// Indirection over spawnAgentProcess so tests can substitute a fake spawn
// implementation (e.g. for askMissionLive) without touching real subprocess
// machinery. Only askMissionLive calls through spawnAgentProcessRef today —
// all pre-existing call sites still call spawnAgentProcess directly and are
// unaffected. Defaults to the real spawnAgentProcess above.
let spawnAgentProcessRef = spawnAgentProcess;

// runMockupHtml — spawn a one-shot process to generate an HTML mockup.
// Uses the mission's backend adapter when available, falls back to Claude.
// Returns the HTML string extracted from <<<HTML>>>...<<<END_HTML>>> markers.
async function runMockupHtml(prompt) {
  const backendId = (missionState && missionState.backend) || 'claude';
  const adapter = resolveAdapter(backendId);

  return new Promise((resolve, reject) => {
    let proc;

    if (adapter) {
      const args = adapter.buildLaunchArgs({
        prompt,
        model: 'haiku',
      });

      // Detect `-p -` convention for stdin delivery
      const pIdx = args.indexOf('-p');
      const viaStdin = (pIdx !== -1 && args[pIdx + 1] === '-') || (adapter.promptViaStdin !== false);

      proc = adapter.spawn(args, missionState ? missionState.project_path : '.', {});

      if (viaStdin) {
        try { proc.stdin.write(prompt, 'utf8'); proc.stdin.end(); } catch (_) {}
      } else {
        try { proc.stdin.end(); } catch (_) {}
      }
    } else {
      // Fallback: legacy Claude path
      proc = spawn('claude', [
        '-p', prompt,
        '--model', 'claude-haiku-4-5-20251001',
        '--dangerously-skip-permissions',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
    }

    let stdout = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });

    const timer = setTimeout(() => {
      killBackendProcess(proc, backendId);
      reject(new Error('Mockup generation timed out after 180s'));
    }, 180000);

    proc.on('close', () => {
      clearTimeout(timer);
      // stdout is `--output-format stream-json` JSONL (adapter.buildLaunchArgs
      // always requests it) — the real text lives inside each line's JSON
      // string, so matching markers against raw stdout captures the
      // JSON-escaped form (literal "\n", "\"" etc.) instead of real
      // characters. Decode via extractAssistantText first; fall back to raw
      // stdout for backends/paths whose output isn't stream-json JSONL.
      const decoded = extractAssistantText(stdout);
      const searchText = decoded !== null ? decoded : stdout;
      const match = /<<<HTML>>>([\s\S]*?)<<<END_HTML>>>/.exec(searchText);
      if (match) {
        resolve(match[1].trim());
      } else {
        reject(new Error(`No <<<HTML>>> markers in output. First 300 chars: ${searchText.slice(0, 300)}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn ${adapter ? adapter.displayName : 'claude'} for mockup: ${err.message}`));
    });
  });
}

// retryMockupGeneration — runs runFn up to maxAttempts times, calling onRetry(attempt, maxAttempts, err)
// after each non-final failed attempt. Resolves with the first successful result, or throws the
// final attempt's error if all attempts fail.
async function retryMockupGeneration(runFn, onRetry, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await runFn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        onRetry(attempt, maxAttempts, err);
      }
    }
  }
  throw lastErr;
}

// ─────────────────────────────────────────────────────────────────
// isTransientApiError — classifies accumulated stdout/stderr text from
// a failed spawn attempt as a transient (retry-worthy) API error.
// ─────────────────────────────────────────────────────────────────
function isTransientApiError(text) {
  return /\b429\b|rate limit|Request rejected|overloaded|\b5\d\d\b|ECONNRESET|ETIMEDOUT|ECONNREFUSED.*api|network error/i.test(text || '');
}

// ─────────────────────────────────────────────────────────────────
// retryTransientSpawn — runs runFn(attempt) up to maxAttempts times.
// Only retries when the rejection's .message matches isTransientApiError;
// non-transient errors reject immediately on first occurrence. Calls
// onRetry(attempt, maxAttempts, err, delay) before waiting out the
// backoff for each retried attempt.
// ─────────────────────────────────────────────────────────────────
async function retryTransientSpawn(runFn, onRetry, maxAttempts = 3, backoffMs = [30000, 60000, 120000]) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await runFn(attempt);
    } catch (err) {
      lastErr = err;
      const transient = isTransientApiError(err && err.message);
      if (!transient || attempt === maxAttempts) throw err;
      const delay = backoffMs[attempt - 1] ?? backoffMs[backoffMs.length - 1];
      onRetry(attempt, maxAttempts, err, delay);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

// spawnMockupGenerator — generate HTML via runClaudeForHtml, serve on localhost,
// open browser, send mission:mockup IPC. Handles its own errors gracefully.
async function spawnMockupGenerator(title, spec, missionId, sendToWindow) {
  const prompt =
    `You are a UI mockup generator. Generate a self-contained HTML mockup for: "${title}".\n` +
    `Spec: ${spec}\n` +
    `Requirements:\n` +
    `- No external dependencies (no CDN links, no external fonts, no external scripts)\n` +
    `- All CSS in a single <style> tag\n` +
    `- Dark VS Code theme: background #1e1e1e, text #d4d4d4, accent #569cd6, panel #252526\n` +
    `- Polished, realistic UI — not a wireframe\n` +
    `- Include realistic placeholder content\n` +
    `Output ONLY the complete HTML document wrapped in <<<HTML>>> and <<<END_HTML>>> markers. Nothing else before or after.`;

  // Log which backend is being used for mockup generation.
  const _mockupBackend = (missionState && missionState.backend) || 'claude';
  if (_mockupBackend !== 'claude') {
    const adapter = resolveAdapter(_mockupBackend);
    const name = (adapter && adapter.displayName) || _mockupBackend;
    const entry = makeLogEntry(now(), 'System',
      `Mockup được tạo bằng ${name} (cùng backend với mission).`, 'info');
    if (missionState) missionState.log.push(entry);
    sendToWindow('mission:log', entry);
  }

  const MAX_MOCKUP_ATTEMPTS = 3;
  let warn30, warn50;

  const armWarningTimers = () => {
    warn30 = setTimeout(() => {
      const entry = makeLogEntry(now(), 'System', 'Mockup đang generate (90s)...', 'info');
      if (missionState) missionState.log.push(entry);
      sendToWindow('mission:log', entry);
    }, 90000);

    warn50 = setTimeout(() => {
      const entry = makeLogEntry(now(), 'System',
        'Mockup sắp timeout — nếu thất bại sẽ tiếp tục planning tự động', 'info');
      if (missionState) missionState.log.push(entry);
      sendToWindow('mission:log', entry);
    }, 150000);
  };

  const cleanup = () => { clearTimeout(warn30); clearTimeout(warn50); };

  const onRetry = (attempt, maxAttempts) => {
    cleanup();
    const entry = makeLogEntry(now(), 'System',
      `Mockup lỗi (lần ${attempt}/${maxAttempts}), đang thử lại...`, 'info');
    if (missionState) missionState.log.push(entry);
    sendToWindow('mission:log', entry);
    armWarningTimers();
  };

  try {
    armWarningTimers();
    const htmlContent = await retryMockupGeneration(
      () => runMockupHtml(prompt),
      onRetry,
      MAX_MOCKUP_ATTEMPTS
    );
    cleanup();

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlContent);
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const url  = `http://127.0.0.1:${port}`;
      if (missionId) mockupServers[missionId] = server;

      shell.openExternal(url);
      sendToWindow('mission:mockup', { title, spec, url, port });

      const entry = makeLogEntry(now(), 'System',
        `Mockup for "${title}" ready — opened in browser (${url})`, 'info');
      if (missionState) missionState.log.push(entry);
      sendToWindow('mission:log', entry);
    });

  } catch (err) {
    cleanup();
    const entry = makeLogEntry(now(), 'System',
      `Mockup generation failed (${err.message}) — continuing planning`, 'info');
    if (missionState) missionState.log.push(entry);
    sendToWindow('mission:log', entry);

    // Resume Lead with skip signal so planning isn't permanently blocked
    // Guard: only resume if mission is still in WaitingForMockup — user may have stopped it
    if (missionState?.session_id && missionState.status === 'WaitingForMockup') {
      restartLeadAfterMockup(missionId,
        'MOCKUP SKIPPED: Generation failed. Continue planning normally and output the final plan JSON.',
        sendToWindow);
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// restartLeadAfterMockup — resume Lead after mockup approve/feedback/skip.
// Mirrors the answer_question restart pattern exactly.
// ─────────────────────────────────────────────────────────────────
function restartLeadAfterMockup(missionId, injection, sendToWindow, attempt = 1) {
  if (!missionState || !missionState.session_id) return;

  killChild();

  const sessionId   = missionState.session_id;
  const leadModel   = missionState.agents.find(a => a.name === 'Lead')?.model || 'sonnet';
  const projectPath = missionState.project_path;
  const execMode    = missionState.execution_mode || 'standard';
  const leadBackend = agentBackendOf(missionState.agents.find(a => a.name === 'Lead'));

  const { proc, promptViaStdin } = spawnAgentProcess({
    backendId: leadBackend, model: leadModel, prompt: injection,
    resumeSessionId: sessionId, maxTurns: 200,
    useAgentTeams: execMode === 'agent_teams',
    cwd: projectPath, sendToWindow,
  });

  // Assign childProcess immediately so the proc is tracked even if stdin.write fails
  childProcess = proc;

  try {
    if (promptViaStdin) proc.stdin.write(injection, 'utf8');
    proc.stdin.end();
  } catch (e) {
    const entry = makeLogEntry(now(), 'System', `Failed to resume Lead: ${e.message}`, 'error');
    if (missionState) missionState.log.push(entry);
    sendToWindow('mission:log', entry);
    killChild();
    return;
  }

  if (missionState) missionState.status = 'Running';
  startAutosave();
  startStuckChecker(sendToWindow, false);  // resume — preserve silence clocks

  // Notify frontend that Lead is running again (keeps isRunning in sync)
  sendToWindow('mission:status', { status: 'running', phase: missionState?.phase || 'Planning' });

  const attemptCtx = { stdoutText: '', stderrText: '', sessionId: null, backend: leadBackend };
  readProcessStdout_launch(proc, missionId, sendToWindow, attemptCtx);
  readProcessStderr(proc, sendToWindow, attemptCtx);
  watchProcessExit_launch(proc, missionId, sendToWindow, {
    attemptCtx,
    attempt,
    maxAttempts: 3,
    backoffMs: [30000, 60000, 120000],
    retrySpawn: (nextAttempt) => restartLeadAfterMockup(missionId, injection, sendToWindow, nextAttempt),
  });
}

// ─────────────────────────────────────────────────────────────────
// buildToolDetail — rich tool detail string for log entry
// ─────────────────────────────────────────────────────────────────
function buildToolDetail(tool, input) {
  if (!input) return `Using tool: ${tool}`;
  switch (tool) {
    case 'Write': case 'Edit': {
      const fp = input.file_path || '';
      if (!fp) return `Using tool: ${tool}`;
      const lc = tool === 'Write'
        ? ((input.content || '').split('\n').length)
        : ((input.new_string || '').split('\n').length);
      return `${tool}: ${fp} (+${lc} lines)`;
    }
    case 'Read': {
      const fp = input.file_path || '';
      return fp ? `Read: ${fp}` : `Using tool: Read`;
    }
    case 'Bash': {
      const cmd = input.command || '';
      if (!cmd) return 'Using tool: Bash';
      return 'Bash: ' + (cmd.length > 120 ? cmd.slice(0, 117) + '...' : cmd);
    }
    case 'Glob': {
      const pat = input.pattern || '';
      return pat ? `Glob: ${pat}` : 'Using tool: Glob';
    }
    case 'Grep': {
      const pat = input.pattern || '';
      return pat ? `Grep: ${pat}` : 'Using tool: Grep';
    }
    case 'Agent': {
      const desc = input.description || '';
      const nm   = input.name || '';
      if (nm) return `Spawning agent: ${nm} — ${desc}`;
      if (desc) return `Spawning agent: ${desc}`;
      return 'Using tool: Agent';
    }
    case 'TeamCreate': {
      const tn = input.team_name || 'unknown';
      return `Creating team: ${tn}`;
    }
    case 'TeamDelete':
      return 'Deleting team';
    case 'TaskCreate': {
      const c = input.content || '';
      return c.length > 60 ? c.slice(0, 57) + '...' : c;
    }
    case 'TaskUpdate': {
      const st = input.status || '';
      const ow = input.owner  || '';
      return ow ? `Assign to ${ow} (${st})` : `Status -> ${st}`;
    }
    case 'TaskList':
      return 'Checking task list';
    case 'SendMessage': {
      const mt = input.type || 'message';
      const rc = input.recipient || '';
      const ct = input.content   || '';
      const pv = ct.length > 50 ? ct.slice(0, 47) + '...' : ct;
      if (mt === 'broadcast') return `Broadcast: ${pv}`;
      if (mt === 'shutdown_request') return `Shutdown -> ${rc}`;
      return `DM -> ${rc}: ${pv}`;
    }
    default:
      return `Using tool: ${tool}`;
  }
}

// ─────────────────────────────────────────────────────────────────
// extractFilePathAndLines — for Write/Edit log entries
// ─────────────────────────────────────────────────────────────────
function extractFilePathAndLines(tool, input) {
  if (!input) return [null, null];
  if (tool === 'Write' || tool === 'Edit') {
    const fp = input.file_path || '';
    const lc = tool === 'Write'
      ? ((input.content    || '').split('\n').length)
      : ((input.new_string || '').split('\n').length);
    return [fp || null, lc > 0 ? lc : null];
  }
  return [null, null];
}

// ─────────────────────────────────────────────────────────────────
// buildFileChangeFromInput — FileChange object for Write/Edit
// ─────────────────────────────────────────────────────────────────
function buildFileChangeFromInput(tool, input, agent, ts) {
  const fp      = input.file_path || '';
  const isWrite = tool === 'Write';
  let fc_lines, content_preview, diff_old, diff_new;

  if (isWrite) {
    const ct     = input.content || '';
    fc_lines     = ct.split('\n').length;
    content_preview = ct.length > 2000 ? ct.slice(0, 1997) + '…' : ct;
    diff_old = null; diff_new = null;
  } else {
    const oldS   = input.old_string || '';
    const newS   = input.new_string || '';
    fc_lines     = newS.split('\n').length;
    const old_p  = oldS.length > 1500 ? oldS.slice(0, 1497) + '…' : oldS;
    const new_p  = newS.length > 1500 ? newS.slice(0, 1497) + '…' : newS;
    content_preview = new_p;
    diff_old = old_p; diff_new = new_p;
  }

  return {
    path: fp,
    action: isWrite ? 'created' : 'modified',
    agent,
    timestamp: ts,
    lines: fc_lines,
    content_preview,
    diff_old,
    diff_new,
  };
}

// ─────────────────────────────────────────────────────────────────
// upsertFileChange — update-or-insert file change record
// ─────────────────────────────────────────────────────────────────
function upsertFileChange(fc) {
  if (!missionState || !fc.path) return;
  const existing = missionState.file_changes.find(x => x.path === fc.path);
  if (existing) {
    Object.assign(existing, fc);
  } else {
    missionState.file_changes.push(fc);
  }
  enqueueChunk(missionState.id, buildChunkFromFileChange(fc));
  scheduleFlush(missionState.id);
}

// ─────────────────────────────────────────────────────────────────
// sanitizePlanJson — fix literal newlines/tabs inside JSON strings
// AI sometimes outputs real \n characters instead of \\n escape sequences
// which makes JSON.parse throw. Walk char-by-char and escape them.
// ─────────────────────────────────────────────────────────────────
function sanitizePlanJson(text) {
  let result = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { result += ch; escaped = false; continue; }
    if (ch === '\\') { escaped = true; result += ch; continue; }
    if (ch === '"') { inString = !inString; result += ch; continue; }
    if (inString) {
      if (ch === '\n') { result += '\\n'; continue; }
      if (ch === '\r') { result += '\\r'; continue; }
      if (ch === '\t') { result += '\\t'; continue; }
    }
    result += ch;
  }
  return result;
}

function tryJsonParse(text) {
  try { return JSON.parse(text); } catch (_) {}
  try { return JSON.parse(sanitizePlanJson(text)); } catch (_) {}
  return null;
}

// ─────────────────────────────────────────────────────────────────
// tryParsePlanFromBuffer — attempt to extract plan JSON from text
// Returns { agents, tasks } or null
// ─────────────────────────────────────────────────────────────────
function tryParsePlanFromBuffer(buffer) {
  // 1. Marker-based
  const markerStart = buffer.indexOf('=== MISSION PLAN ===');
  const markerEnd   = buffer.indexOf('=== END PLAN ===');
  if (markerStart >= 0 && markerEnd > markerStart) {
    const planText = buffer.slice(markerStart + 20, markerEnd).trim();
    const js = planText.indexOf('{');
    const je = planText.lastIndexOf('}');
    if (js >= 0 && je > js) {
      const parsed = tryJsonParse(planText.slice(js, je + 1));
      if (parsed && parsed.agents && parsed.tasks) return parsed;
    }
  }

  // 2. Fallback: find first JSON object containing both "agents" and "tasks"
  const startIdx = buffer.indexOf('{');
  if (startIdx < 0) return null;

  let depth = 0, endIdx = -1;
  for (let i = startIdx; i < buffer.length; i++) {
    if (buffer[i] === '{') depth++;
    if (buffer[i] === '}') depth--;
    if (depth === 0) { endIdx = i; break; }
  }
  if (endIdx < 0) return null;

  const candidate = buffer.slice(startIdx, endIdx + 1);
  if (!candidate.includes('"agents"') || !candidate.includes('"tasks"')) return null;

  const parsed = tryJsonParse(candidate);
  if (parsed && Array.isArray(parsed.agents) && parsed.agents.length > 0 &&
      Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
    return parsed;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────
// tryRecoverDanglingQuestion — Lead sometimes ends its turn right after
// writing <<<QUESTION>>>{...} without the <<<END_QUESTION>>> /
// <<<QUESTIONS_END>>> terminator markers the prompt asks for. When that
// happens the normal marker-based detection never fires and the mission
// falls through to "no plan found" even though Lead asked a legitimate
// question. Recover it here as a last resort once the process has
// already exited (no more output is coming, so the JSON we have is final).
// Returns an array of question objects, or null if nothing recoverable.
// ─────────────────────────────────────────────────────────────────
function tryRecoverDanglingQuestion(buffer) {
  const startIdx = buffer.lastIndexOf('<<<QUESTION>>>');
  if (startIdx < 0) return null;

  let jsonText = buffer.slice(startIdx + '<<<QUESTION>>>'.length);
  const endMarkerIdx = jsonText.indexOf('<<<END_QUESTION>>>');
  if (endMarkerIdx >= 0) jsonText = jsonText.slice(0, endMarkerIdx);

  const js = jsonText.indexOf('{');
  const je = jsonText.lastIndexOf('}');
  if (js < 0 || je <= js) return null;

  const parsed = tryJsonParse(jsonText.slice(js, je + 1));
  if (!parsed || !parsed.question) return null;

  return [parsed];
}

// ─────────────────────────────────────────────────────────────────
// applyPlanToState — update missionState from plan JSON + emit
// ─────────────────────────────────────────────────────────────────
function applyPlanToState(planJson, planNow, logMsg, sendToWindow) {
  const newAgents = [];
  const newTasks  = [];

  // Global backend for the mission (default 'claude'). Each agent inherits it
  // unless the plan JSON specifies a per-agent "backend" field.
  const globalBackend = (missionState && missionState.backend) || 'claude';
  for (const a of (planJson.agents || [])) {
    newAgents.push({
      name: a.name || 'unknown',
      role: a.role || '',
      status: 'Idle',
      current_task: null,
      spawned_at: planNow,
      model: a.model || null,
      model_reason: a.reason || null,
      backend: a.backend || globalBackend,
    });
  }
  for (let i = 0; i < (planJson.tasks || []).length; i++) {
    const t = planJson.tasks[i];
    newTasks.push({
      id: `task-${i}`,
      title: t.title || '',
      why: t.why || '',
      depends_on: Array.isArray(t.depends_on) ? t.depends_on : [],
      detail: t.detail || '',
      status: 'pending',
      assigned_agent: t.agent || t.assigned_agent || null,
      started_at: null,
      completed_at: null,
      priority: t.priority || null,
    });
  }

  const missionContext = planJson.mission_context || null;

  // Warn if any tasks came through without an agent assignment (AI missed the field)
  const unassignedCount = newTasks.filter(t => !t.assigned_agent).length;
  if (unassignedCount > 0 && newTasks.length > 0) {
    console.warn(`[applyPlanToState] ${unassignedCount}/${newTasks.length} tasks have no agent — AI may have omitted "agent" field`);
  }

  if (missionState) {
    for (const agent of newAgents) {
      if (!missionState.agents.some(a => a.name === agent.name)) {
        missionState.agents.push(agent);
      }
    }
    missionState.tasks = newTasks;
    missionState.phase = 'ReviewPlan';
    if (missionContext) missionState.mission_context = missionContext;
    const lead = missionState.agents.find(a => a.name === 'Lead');
    if (lead) { lead.status = 'Idle'; lead.current_task = 'Plan ready — waiting for review'; }
    missionState.log.push(makeLogEntry(planNow, 'System', logMsg, 'plan-ready'));
    saveMissionSnapshot(missionState); // milestone: plan ready

    // Save initial plan version — only on first plan (plan_versions empty)
    if (!missionState.plan_versions || missionState.plan_versions.length === 0) {
      savePlanVersionInternal(missionState.id, 'initial', missionState.agents, missionState.tasks)
        .catch(e => console.error('[applyPlanToState] savePlanVersionInternal error:', e));
    }
  }

  sendToWindow('mission:plan-ready', { agents: newAgents, tasks: newTasks, mission_context: missionContext });
}

// ─────────────────────────────────────────────────────────────────
// normalizedEventToClaudeShape — bridge a non-Claude backend's stdout line
// into the Claude stream-json object shape the readers already parse. We ask
// the backend adapter to normalize the raw line (adapter.parseLine → { kind,
// text, sessionId, resultText, … }) and then re-emit a minimal Claude-shaped
// object so the existing switch(msgType) handling — text extraction, marker
// detection, plan detection, tool logging, result classification — all runs
// unchanged and backend-independent.
//
// Returns null for 'none'/unparseable lines (caller then treats it as
// plain-text / ignores), matching the Claude path where JSON.parse fails.
// ─────────────────────────────────────────────────────────────────
function normalizedEventToClaudeShape(backendId, rawLine) {
  const adapter = resolveAdapter(backendId);
  if (!adapter || typeof adapter.parseLine !== 'function') {
    // No adapter → fall back to a raw JSON.parse so we never lose Claude-ish data.
    try { return JSON.parse(rawLine); } catch (_) { return null; }
  }

  const ev = adapter.parseLine(rawLine);
  if (!ev || ev.kind === 'none') return null;

  switch (ev.kind) {
    case 'text':
      // Assistant text — shape like a Claude assistant message so the text
      // branch extracts ev.text (markers preserved verbatim inside it).
      return {
        type: 'assistant',
        session_id: ev.sessionId,
        message: { content: [{ type: 'text', text: ev.text || '' }] },
      };
    case 'tool_use':
      return {
        type: 'assistant',
        session_id: ev.sessionId,
        message: { content: [{ type: 'tool_use', name: ev.tool || 'unknown', input: ev.input || null }] },
      };
    case 'session':
      // Session-only frame — surface as a system/init so session_id is captured.
      return { type: 'system', subtype: 'init', session_id: ev.sessionId };
    case 'system':
      return { type: 'system', subtype: ev.subtype || '', session_id: ev.sessionId, message: ev.text };
    case 'result':
      return { type: 'result', result: ev.resultText || '', session_id: ev.sessionId };
    case 'error':
      return { type: 'error', error: { message: ev.text || '' } };
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// readProcessStdout_launch — stdout reader for launch_mission
// (Planning phase: stream-json, plan detection)
// ─────────────────────────────────────────────────────────────────
function readProcessStdout_launch(proc, missionId, sendToWindow, attemptCtx = {}) {
  const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
  const parser = new OutputParser();
  let lineCount   = 0;
  let fullTextBuf = '';
  let planEmitted = false;
  // Question protocol: accumulate text for marker detection
  let questionTextBuf = '';
  let mockupTextBuf   = '';
  let questionBatch   = [];
  // Capture session_id for resume-based question protocol
  let capturedSessionId = null;

  rl.on('line', (line) => {
    const clean = stripAnsi(line).trim();
    if (!clean) return;
    lineCount++;

    // Emit every raw line
    sendToWindow('mission:raw-line', { line: clean, line_number: lineCount });

    // ── Backend routing ─────────────────────────────────────────────────
    // For non-Claude backends the stdout schema differs, so we normalize the
    // line via the backend adapter's parseLine() and re-shape it into the
    // Claude stream-json object the switch below already understands. This
    // keeps ALL marker/plan/log logic (which operates on extracted text)
    // backend-independent. Claude keeps its exact JSON.parse path unchanged.
    const _backendId = (attemptCtx && attemptCtx.backend) || (missionState && missionState.backend) || 'claude';
    let json;
    if (_backendId && _backendId !== 'claude') {
      json = normalizedEventToClaudeShape(_backendId, clean);
    } else {
      try { json = JSON.parse(clean); } catch (_) { json = null; }
    }

    if (json) {
      const msgType = (json.type || '').toString();
      const ts      = now();

      switch (msgType) {
        case 'assistant':
        case 'content_block_delta':
        case 'content_block_start': {
          // Extract text content — handle multiple stream-json structures
          let text = null;

          // Capture session_id from assistant messages as backup
          if (!capturedSessionId && json.session_id) {
            capturedSessionId = json.session_id;
            if (missionState) missionState.session_id = json.session_id;
            if (attemptCtx) attemptCtx.sessionId = json.session_id;
          }

          // "assistant": { "message": { "content": [{ "text": "..." }] } }
          const msgContent = json.message && json.message.content;
          if (Array.isArray(msgContent)) {
            for (const item of msgContent) {
              if (item.text !== undefined) { text = item.text; break; }
              if (item.type === 'text' && item.text !== undefined) { text = item.text; break; }
            }
          }
          // "assistant": { "content": [{ "text": "..." }] }
          if (text === null && Array.isArray(json.content)) {
            for (const item of json.content) {
              if (item.text !== undefined) { text = item.text; break; }
            }
          }
          // "content_block_delta": { "delta": { "text": "..." } }
          if (text === null && json.delta && json.delta.text !== undefined) {
            text = json.delta.text;
          }
          // "content_block_start": { "content_block": { "text": "..." } }
          if (text === null && json.content_block && json.content_block.text !== undefined) {
            text = json.content_block.text;
          }

          if (text !== null && text !== '') {
            fullTextBuf += text;

            // ── Question Protocol: detect markers in planning text ──
            questionTextBuf += text;
            if (questionTextBuf.includes('<<<QUESTION>>>')) {
              const qRegex = /<<<QUESTION>>>\s*([\s\S]*?)\s*<<<END_QUESTION>>>/g;
              let qMatch;
              while ((qMatch = qRegex.exec(questionTextBuf)) !== null) {
                try {
                  const qJson = JSON.parse(qMatch[1].trim());
                  questionBatch.push(qJson);
                } catch (_) {
                  // Malformed JSON — skip
                }
              }
              if (questionTextBuf.includes('<<<QUESTIONS_END>>>')) {
                if (questionBatch.length > 0) {
                  handleQuestionBatch(questionBatch, proc, sendToWindow);
                  questionBatch = [];
                }
                questionTextBuf = questionTextBuf.slice(
                  questionTextBuf.indexOf('<<<QUESTIONS_END>>>') + '<<<QUESTIONS_END>>>'.length
                );
              }
            }

            // ── Mockup protocol ──────────────────────────────────────────────
            mockupTextBuf += text;
            if (mockupTextBuf.includes('<<<MOCKUP_PAUSE>>>')) {
              const reqMatch = /<<<MOCKUP_REQUEST>>>([\s\S]*?)<<<END_MOCKUP_REQUEST>>>/.exec(mockupTextBuf);
              if (reqMatch) {
                let parsed = null;
                try { parsed = JSON.parse(reqMatch[1].trim()); } catch { /* skip */ }
                if (parsed && parsed.title && parsed.spec) {
                  if (missionState) missionState.status = 'WaitingForMockup';
                  const entry = makeLogEntry(now(), 'Lead',
                    `Requesting UI mockup for "${parsed.title}" — generating preview...`, 'info');
                  if (missionState) missionState.log.push(entry);
                  sendToWindow('mission:log', entry);
                  spawnMockupGenerator(parsed.title, parsed.spec, missionState?.id, sendToWindow);
                }
              }
              // Clear consumed buffer
              mockupTextBuf = mockupTextBuf.slice(
                mockupTextBuf.indexOf('<<<MOCKUP_PAUSE>>>') + '<<<MOCKUP_PAUSE>>>'.length
              );
            }

            // Check for plan markers / fallback JSON in accumulated text
            if (!planEmitted) {
              const parsed = tryParsePlanFromBuffer(fullTextBuf);
              if (parsed) {
                planEmitted = true;
                applyPlanToState(parsed, ts, 'Mission plan ready for review', sendToWindow);
                fullTextBuf = '';
                // Kill the planning process immediately — prevents Lead from continuing
                // to Phase 3 (spawning agents) before the user reviews the plan.
                killClaudeProcess(proc);
              }
            }

            // Emit as thinking log
            const entry = makeLogEntry(ts, 'Lead', text, 'thinking');
            if (missionState) {
              const lead = missionState.agents.find(a => a.name === 'Lead');
              if (lead) {
                lead.status = 'Working';
                lead.current_task = text.length > 80 ? text.slice(0, 77) + '...' : text;
              }
              missionState.log.push(entry);
              missionState.raw_output.push(clean);
              if (missionState.log.length > 2000) missionState.log.splice(0, 500);
            }
            sendToWindow('mission:log', entry);
          }

          // Also extract tool_use blocks from assistant messages
          if (msgType === 'assistant' && Array.isArray(msgContent)) {
            for (const block of msgContent) {
              if (block.type !== 'tool_use') continue;
              const tool   = block.name || 'unknown';
              const input  = block.input || null;
              const detail = buildToolDetail(tool, input);

              const [efp, eln] = extractFilePathAndLines(tool, input);
              const toolEntry = makeLogEntry(ts, 'Lead', detail, 'tool', tool);
              if (efp) toolEntry.file_path = efp;
              if (eln) toolEntry.lines = eln;

              if (missionState) {
                missionState.log.push(toolEntry);
                const lead = missionState.agents.find(a => a.name === 'Lead');
                if (lead) lead.current_task = detail.length > 80 ? detail.slice(0, 77) + '…' : detail;

                // Track file changes for Write/Edit
                if ((tool === 'Write' || tool === 'Edit') && efp && input) {
                  const fc = buildFileChangeFromInput(tool, input, 'Lead', ts);
                  upsertFileChange(fc);
                  sendToWindow('mission:file-change', {
                    path: fc.path, action: fc.action, agent: 'Lead', timestamp: ts,
                    lines: fc.lines, content_preview: fc.content_preview,
                    diff_old: fc.diff_old, diff_new: fc.diff_new,
                  });
                }
              }
              sendToWindow('mission:log', toolEntry);
            }
          }
          break;
        }

        case 'system':
        case 'error': {
          const subtype = json.subtype || '';
          if (subtype === 'init') {
            // Capture session_id for question resume protocol
            if (!capturedSessionId && json.session_id) {
              capturedSessionId = json.session_id;
              if (missionState) missionState.session_id = json.session_id;
              if (attemptCtx) attemptCtx.sessionId = json.session_id;
            }
            // Skip noisy init — just store raw
            if (missionState) missionState.raw_output.push(clean);
          } else {
            let text = (json.error && json.error.message) || json.message || clean;
            if (attemptCtx) attemptCtx.stdoutText = (attemptCtx.stdoutText || '') + text + '\n';
            const entry = makeLogEntry(ts, 'System', text.toString(), msgType === 'error' ? 'error' : 'info');
            if (missionState) missionState.log.push(entry);
            sendToWindow('mission:log', entry);
          }
          break;
        }

        case 'result': {
          const currentPhase = missionState ? missionState.phase : 'Planning';

          if (currentPhase === 'ReviewPlan') {
            // Planning process exited normally — user is reviewing. Don't mark completed.
            const entry = makeLogEntry(ts, 'System', 'Planning phase complete — review the plan above', 'info');
            if (missionState) missionState.log.push(entry);
            sendToWindow('mission:log', entry);

          } else if (currentPhase === 'Planning') {
            // If Lead paused (questions or mockup), don't treat this result as
            // "no plan found". The protocol already set status before result fires.
            if (missionState && (
              missionState.status === 'WaitingForAnswer' ||
              missionState.status === 'WaitingForMockup'
            )) {
              break;
            }

            // Last resort: try to get plan from result text
            const resultText =
              (json.result || '') ||
              (Array.isArray(json.content)
                ? (json.content.find(c => c.text) || {}).text || ''
                : '');

            fullTextBuf += resultText;
            if (attemptCtx) attemptCtx.stdoutText = (attemptCtx.stdoutText || '') + resultText;

            if (!planEmitted) {
              const parsed = tryParsePlanFromBuffer(fullTextBuf);
              if (parsed) {
                planEmitted = true;
                applyPlanToState(parsed, ts, 'Mission plan detected from result — ready for review', sendToWindow);
                fullTextBuf = '';
                killClaudeProcess(proc);
              }
            }

            // Recover a question Lead asked but never closed with
            // <<<END_QUESTION>>>/<<<QUESTIONS_END>>> before ending its turn.
            let dangledUnrecovered = false;
            if (!planEmitted && questionBatch.length === 0) {
              const danglingBuf = questionTextBuf || fullTextBuf;
              const recovered = tryRecoverDanglingQuestion(danglingBuf);
              if (recovered) {
                handleQuestionBatch(recovered, proc, sendToWindow);
                if (missionState && missionState.status === 'WaitingForAnswer') break;
              } else if (danglingBuf.includes('<<<QUESTION>>>')) {
                // Lead was clearly mid-question (marker present) but the JSON
                // after it is malformed/truncated — not recoverable by the
                // lenient parser. Safety net: retry the spawn instead of
                // reporting "no plan found", since re-running usually lets
                // Lead complete the marker cleanly.
                dangledUnrecovered = true;
              }
            }

            if (dangledUnrecovered && attemptCtx && attemptCtx.retryInfo) {
              const { attempt, maxAttempts, backoffMs, retrySpawn } = attemptCtx.retryInfo;
              if (attempt < maxAttempts) {
                const delay = backoffMs[attempt - 1] ?? backoffMs[backoffMs.length - 1];
                const entry = makeLogEntry(ts, 'System',
                  `⚠ Lead bị cắt giữa câu hỏi (thiếu marker đóng), đang thử lại lần ${attempt}/${maxAttempts} sau ${delay / 1000}s...`, 'info');
                if (missionState) {
                  missionState.log.push(entry);
                  missionState.status = 'RetryingDanglingQuestion';
                }
                sendToWindow('mission:log', entry);
                killClaudeProcess(proc);
                sendToWindow('mission:retry-pending', { pending: true, attempt: attempt + 1, maxAttempts, delayMs: delay });
                pendingRetryTimer = setTimeout(() => {
                  pendingRetryTimer = null;
                  sendToWindow('mission:retry-pending', { pending: false });
                  retrySpawn(attempt + 1, attemptCtx.sessionId || null);
                }, delay);
                break;
              }
            }

            if (!planEmitted) {
              // No plan found — classify the error
              const isConnErr  = /ConnectionRefused|Unable to connect to API|ECONNREFUSED|connection refused|Network error|401|authentication/i.test(resultText);
              const isTooLarge = /Request too large|prompt is too long|payload too large|max \d+MB/i.test(resultText);

              const logMsg = isConnErr
                ? '⚠️ Không thể kết nối tới API. Vui lòng kiểm tra lại kết nối và cấu hình API của bạn.'
                : isTooLarge
                  ? '❌ Yêu cầu quá lớn (vượt giới hạn 32MB). Thử lại mà không dùng ngữ cảnh từ mission cũ, hoặc chọn ít file hơn.'
                  : `Result (no plan detected): ${resultText.length > 500 ? resultText.slice(0, 500) + '...' : resultText}`;
              const logType = (isConnErr || isTooLarge) ? 'error' : 'result';

              const entry = makeLogEntry(ts, 'System', logMsg, logType);
              if (missionState) {
                missionState.log.push(entry);
                missionState.status = (isConnErr || isTooLarge) ? 'Failed' : 'Completed';
                missionState.phase  = 'Done';
                const lead = missionState.agents.find(a => a.name === 'Lead');
                if (lead) {
                  lead.status = (isConnErr || isTooLarge) ? 'Error' : 'Done';
                  lead.current_task = isConnErr  ? 'Failed — API connection error'
                    : isTooLarge ? 'Failed — request too large (reduce history context)'
                    : 'Completed — no plan structure found';
                }
              }
              sendToWindow('mission:log', entry);
              sendToWindow('mission:status', { status: (isConnErr || isTooLarge) ? 'failed' : 'completed' });
            }

          } else {
            // Real completion — from deploy or non-plan run
            const text = json.result || (Array.isArray(json.content)
              ? (json.content.find(c => c.text) || {}).text || 'Mission completed'
              : 'Mission completed');
            const display = text.length > 500 ? text.slice(0, 500) + '...' : text;

            const entry = makeLogEntry(ts, 'Lead', `Result: ${display}`, 'result');
            if (missionState) {
              missionState.log.push(entry);
              // Don't mark Completed here — let process exit handler do it
              missionState._lastLeadResult = display;
            }
            sendToWindow('mission:log', entry);
          }
          break;
        }

        default:
          // Unknown JSON type — store raw
          if (missionState) missionState.raw_output.push(clean);
          break;
      }
    } else {
      // Not JSON — regex-based plain-text parsing
      const events = parser.parseLine(clean);
      for (const event of events) {
        handleParsedEvent(event, sendToWindow);
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────────
// readProcessStderr — shared stderr reader
// ─────────────────────────────────────────────────────────────────
function readProcessStderr(proc, sendToWindow, attemptCtx = {}) {
  const rl = readline.createInterface({ input: proc.stderr, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const clean = stripAnsi(line).trim();
    if (!clean) return;
    if (attemptCtx) attemptCtx.stderrText = (attemptCtx.stderrText || '') + clean + '\n';
    const ts    = now();
    const entry = makeLogEntry(ts, 'System', clean, 'error');
    if (missionState) {
      missionState.log.push(entry);
      missionState.raw_output.push(`[stderr] ${clean}`);
    }
    sendToWindow('mission:log', entry);
  });
}

// ─────────────────────────────────────────────────────────────────
// watchProcessExit_launch — watch for process exit during launch phase
// ─────────────────────────────────────────────────────────────────
function watchProcessExit_launch(proc, missionId, sendToWindow, retryInfo = null) {
  proc.on('close', (code) => {
    // This proc was superseded by a newer spawn (e.g. answer_question's
    // killChild() + resume) before its own close event had a chance to
    // fire. The kill signal is async, so the old process can still close
    // after childProcess has already moved on to the new one — acting on
    // it here would incorrectly mark the mission Completed/Failed while
    // the new process is still actively running.
    if (proc !== childProcess) return;

    const currentPhase = missionState ? missionState.phase : 'Planning';

    if (currentPhase === 'ReviewPlan') {
      // Expected exit after planning — don't mark as completed
      return;
    }

    // If WaitingForAnswer (interactive mode question protocol), don't mark as Done.
    // Claude exited because it finished its turn after outputting <<<QUESTIONS_END>>>.
    // The user will answer and we'll resume via answer_question.
    if (missionState && missionState.status === 'WaitingForAnswer') {
      const ts = now();
      const entry = makeLogEntry(ts, 'System',
        'Planning paused — Lead is waiting for your answers', 'info');
      missionState.log.push(entry);
      sendToWindow('mission:log', entry);
      // Keep phase='Planning', status='WaitingForAnswer', don't emit completed
      return;
    }

    if (missionState && missionState.status === 'WaitingForMockup') {
      const entry = makeLogEntry(now(), 'System',
        'Planning paused — review the UI mockup in your browser, then approve or send feedback', 'info');
      missionState.log.push(entry);
      sendToWindow('mission:log', entry);
      return;
    }

    // Dangling-question safety-net retry already scheduled its own respawn
    // (readProcessStdout_launch's result-case handler) — don't mark Completed/Failed here.
    if (missionState && missionState.status === 'RetryingDanglingQuestion') {
      return;
    }

    const finalStatus = (code === 0 || code === null) ? 'Completed' : 'Failed';
    const ts = now();

    if (finalStatus === 'Failed' && retryInfo) {
      const { attemptCtx, attempt, maxAttempts, backoffMs, retrySpawn } = retryInfo;
      const combinedText = (attemptCtx.stdoutText || '') + '\n' + (attemptCtx.stderrText || '');
      if (attempt < maxAttempts && isTransientApiError(combinedText)) {
        const delay = backoffMs[attempt - 1] ?? backoffMs[backoffMs.length - 1];
        const entry = makeLogEntry(ts, 'System',
          `⚠ Gặp lỗi tạm thời (rate limit/API), đang thử lại lần ${attempt}/${maxAttempts} sau ${delay / 1000}s...`, 'info');
        if (missionState) missionState.log.push(entry);
        sendToWindow('mission:log', entry);
        sendToWindow('mission:retry-pending', { pending: true, attempt: attempt + 1, maxAttempts, delayMs: delay });
        pendingRetryTimer = setTimeout(() => {
          pendingRetryTimer = null;
          sendToWindow('mission:retry-pending', { pending: false });
          retrySpawn(attempt + 1, attemptCtx.sessionId || null);
        }, delay);
        return;
      }
      if (attempt >= maxAttempts && isTransientApiError(combinedText)) {
        const entry = makeLogEntry(ts, 'System',
          `Đã thử lại ${maxAttempts} lần nhưng vẫn gặp lỗi rate limit — dừng mission.`, 'error');
        if (missionState) missionState.log.push(entry);
        sendToWindow('mission:log', entry);
      }
    }

    stopAutosave();
    stopStuckChecker();
    if (missionState) {
      missionState.status = finalStatus;
      for (const a of missionState.agents) {
        if (a.status === 'Working' || a.status === 'Idle' || a.status === 'Spawning') {
          a.status       = finalStatus === 'Completed' ? 'Done' : 'Error';
          a.current_task = null;
        }
      }
    }

    const statusStr = finalStatus === 'Completed' ? 'completed' : 'failed';

    // Auto-save
    if (missionState) {
      missionState.ended_at = ts;  // Persist ended_at in snapshot too
      const entry = {
        id: missionState.id,
        description: missionState.description,
        project_path: missionState.project_path,
        execution_mode: missionState.execution_mode || 'standard',
        backend: missionState.backend || 'claude',
        team_size: missionState.team_size,
        status: statusStr,
        started_at: missionState.started_at,
        ended_at: ts,
        agent_count: missionState.agents.length,
        task_summary: missionState.tasks.map(t => `[${t.status}] ${t.title}`),
        file_changes: missionState.file_changes,
        log_count: missionState.log.length,
      };
      saveToHistory(entry);
      saveMissionSnapshot(missionState);
    }

    sendToWindow('mission:status', { mission_id: missionId, status: statusStr });
  });
}

// ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
// handleQuestionBatch — process question markers from Lead
// Auto-answers in 'auto' mode, pauses in 'interactive' mode
// ─────────────────────────────────────────────────────────────────
function handleQuestionBatch(questions, proc, sendToWindow) {
  const permMode = missionState ? missionState.permission_mode : 'auto';
  const ts = now();

  if (permMode === 'auto') {
    // Auto mode: Claude shouldn't ask questions (prompt says "Do NOT output <<<QUESTION>>> markers").
    // If it somehow does, log them and ignore — process will continue on its own.
    const qTexts = questions.map(q => q.question || '').join('"; "');
    const entry = makeLogEntry(ts, 'System',
      `Question auto-resolved (auto mode): "${qTexts}"`, 'info');
    if (missionState) missionState.log.push(entry);
    sendToWindow('mission:log', entry);
    return;
  }

  // Interactive mode: pause mission and emit questions to frontend
  if (missionState) {
    missionState._lastQuestions = questions;
    missionState.pendingQuestions = questions;
    missionState.status = 'WaitingForAnswer';
    saveMissionSnapshot(missionState); // milestone: waiting for answer
  }
  sendToWindow('mission:question', { questions, timestamp: ts });
  sendToWindow('mission:status', { status: 'waiting_for_answer' });

  // Log
  const entry = makeLogEntry(ts, 'Lead',
    `Asking ${questions.length} question(s) — waiting for user answer`, 'info');
  if (missionState) missionState.log.push(entry);
  sendToWindow('mission:log', entry);
}

// readProcessStdout_deploy — stdout reader for deploy_mission /
//                            continue_mission (execution phase)
// ─────────────────────────────────────────────────────────────────
function readProcessStdout_deploy(proc, sendToWindow, isContMode, attemptCtx = {}) {
  const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
  const parser = new OutputParser();
  let lineCount = 0;
  // tool_use_id → agent_name
  const toolUseToAgent = new Map();
  // task IDs currently running
  const runningTasks   = new Set();
  // Question protocol: accumulate text for marker detection
  let questionTextBuf = '';
  let questionBatch   = [];
  // Capture session_id for resume-based question protocol
  let capturedSessionId = null;

  rl.on('line', (line) => {
    const clean = stripAnsi(line).trim();
    if (!clean) return;
    lineCount++;

    sendToWindow('mission:raw-line', { line: clean, line_number: lineCount });
    if (missionState) {
      missionState.raw_output.push(clean);
    }

    // Backend routing (see readProcessStdout_launch): normalize non-Claude
    // lines into the Claude stream-json shape so the switch below is unchanged.
    const _backendId = (attemptCtx && attemptCtx.backend) || (missionState && missionState.backend) || 'claude';
    let json;
    if (_backendId && _backendId !== 'claude') {
      json = normalizedEventToClaudeShape(_backendId, clean);
    } else {
      try { json = JSON.parse(clean); } catch (_) { json = null; }
    }

    if (json) {
      const msgType  = (json.type || '').toString();
      const ts       = now();
      const parentId = (json.parent_tool_use_id || '').toString();
      const sourceAgent = parentId
        ? (toolUseToAgent.get(parentId) || 'Subagent')
        : 'Lead';

      switch (msgType) {
        case 'system': {
          const subtype = (json.subtype || '').toString();
          const toolUseIdDirect = (json.tool_use_id || '').toString();
          const taskAgent = toolUseIdDirect
            ? (toolUseToAgent.get(toolUseIdDirect) || sourceAgent)
            : sourceAgent;

          switch (subtype) {
            case 'init':
              // Capture session_id for resume-based question protocol
              if (json.session_id && missionState) {
                capturedSessionId = json.session_id;
                missionState.session_id = json.session_id;
              }
              if (json.session_id && attemptCtx) attemptCtx.sessionId = json.session_id;
              break; // skip

            case 'task_notification': {
              const output = json.output || '';
              const msg    = !output ? `[${taskAgent}] Task notification received`
                : (output.length > 500 ? output.slice(0, 497) + '...' : output);
              const entry = makeLogEntry(ts, taskAgent, msg, 'result');
              if (missionState) {
                missionState.log.push(entry);
                missionState.raw_output.push(clean);
                const agentObj = missionState.agents.find(a => a.name === taskAgent);
                if (agentObj) { agentObj.status = 'Done'; agentObj.current_task = 'Completed'; }
              }
              sendToWindow('mission:log', entry);
              break;
            }

            case 'task_progress': {
              const desc  = json.description || 'Working...';
              const entry = makeLogEntry(ts, taskAgent, desc, 'tool');
              if (missionState) {
                missionState.log.push(entry);
                missionState.raw_output.push(clean);
                const agentObj = missionState.agents.find(a => a.name === taskAgent);
                if (agentObj && agentObj.status !== 'Done') {
                  agentObj.status = 'Working';
                  agentObj.current_task = typeof desc === 'string'
                    ? desc.slice(0, 80) : String(desc).slice(0, 80);
                }
              }
              sendToWindow('mission:log', entry);
              break;
            }

            case 'task_started': {
              const taskId = (json.task_id || '').toString();
              const desc   = (json.description || '').toString();
              if (taskId) runningTasks.add(taskId);
              const entry = makeLogEntry(ts, taskAgent, `Started: ${desc}`, 'spawn');
              if (missionState) {
                missionState.log.push(entry);
                missionState.raw_output.push(clean);
                const agentObj = missionState.agents.find(a => a.name === taskAgent);
                if (agentObj && agentObj.status !== 'Done') {
                  agentObj.status = 'Working';
                  agentObj.current_task = desc.slice(0, 80);
                }
              }
              sendToWindow('mission:log', entry);
              break;
            }

            case 'task_completed': {
              const taskId = (json.task_id || '').toString();
              if (taskId) runningTasks.delete(taskId);
              if (missionState) {
                const agentObj = missionState.agents.find(a => a.name === taskAgent);
                if (agentObj) { agentObj.status = 'Done'; agentObj.current_task = 'Completed'; }
              }
              const entry = makeLogEntry(ts, taskAgent, `Task completed (remaining: ${runningTasks.size})`, 'result');
              if (missionState) {
                missionState.log.push(entry);
                missionState.raw_output.push(clean);
              }
              sendToWindow('mission:log', entry);
              break;
            }

            default: {
              const text  = (json.message || clean).toString();
              if (attemptCtx) attemptCtx.stdoutText = (attemptCtx.stdoutText || '') + text + '\n';
              const entry = makeLogEntry(ts, sourceAgent, text, 'info');
              if (missionState) {
                missionState.log.push(entry);
                missionState.raw_output.push(clean);
              }
              sendToWindow('mission:log', entry);
              break;
            }
          }
          break;
        }

        case 'assistant': {
          const content = json.message && Array.isArray(json.message.content)
            ? json.message.content : [];
          // Capture session_id from assistant messages as backup
          if (!capturedSessionId && json.session_id) {
            capturedSessionId = json.session_id;
            if (missionState) missionState.session_id = json.session_id;
          }
          if (!attemptCtx.sessionId && json.session_id) attemptCtx.sessionId = json.session_id;

          for (const block of content) {
            const blockType = (block.type || '').toString();

            if (blockType === 'text') {
              const text = (block.text || '').toString();
              if (!text.trim()) continue;

              // ── Question Protocol: detect markers in assistant text ──
              questionTextBuf += text;
              if (questionTextBuf.includes('<<<QUESTION>>>')) {
                // Extract all complete question blocks
                const qRegex = /<<<QUESTION>>>\s*([\s\S]*?)\s*<<<END_QUESTION>>>/g;
                let qMatch;
                while ((qMatch = qRegex.exec(questionTextBuf)) !== null) {
                  try {
                    const qJson = JSON.parse(qMatch[1].trim());
                    questionBatch.push(qJson);
                  } catch (_) {
                    // Malformed JSON — skip this question
                  }
                }
                // Check for batch-end terminal marker
                if (questionTextBuf.includes('<<<QUESTIONS_END>>>')) {
                  if (questionBatch.length > 0) {
                    handleQuestionBatch(questionBatch, proc, sendToWindow);
                    questionBatch = [];
                  }
                  // Clear the buffer after processing
                  questionTextBuf = questionTextBuf.slice(
                    questionTextBuf.indexOf('<<<QUESTIONS_END>>>') + '<<<QUESTIONS_END>>>'.length
                  );
                }
              }

              let [parsedAgent, message] = parseProgressLine(text);
              const finalAgent = parentId ? sourceAgent : parsedAgent;

              const entry = makeLogEntry(ts, finalAgent, message, 'thinking');
              if (missionState) {
                missionState.log.push(entry);
                missionState.raw_output.push(clean);
                const agentObj = missionState.agents.find(a => a.name === finalAgent);
                if (agentObj && agentObj.status !== 'Done') agentObj.status = 'Working';

                // Detect task completion patterns in text
                const lowerMsg = message.toLowerCase();
                if (lowerMsg.includes('completed') || lowerMsg.includes('done') || lowerMsg.includes('finished')) {
                  const finalLower = finalAgent.toLowerCase();
                  for (const task of missionState.tasks) {
                    if (task.status === 'completed') continue;
                    const taskAgentLower = (task.assigned_agent || '').toLowerCase();
                    const agentMatch = taskAgentLower && (
                      taskAgentLower === finalLower ||
                      taskAgentLower.includes(finalLower) ||
                      finalLower.includes(taskAgentLower) ||
                      finalLower.split(/[-_ ]/).some(w => w.length > 2 && taskAgentLower.includes(w))
                    );
                    const taskLower  = task.title.toLowerCase();
                    const titleMatch = taskLower.split(/\s+/).filter(w => w.length > 3)
                      .some(w => lowerMsg.includes(w));
                    if (agentMatch && titleMatch) {
                      task.status = 'completed';
                      task.completed_at = ts;
                      enqueueChunk(missionState.id, buildChunkFromTask(task));
                      scheduleFlush(missionState.id);
                    }
                  }
                }
              }
              sendToWindow('mission:log', entry);

            } else if (blockType === 'tool_use') {
              const tool       = (block.name || 'unknown').toString();
              const toolUseId  = (block.id   || '').toString();
              const input      = block.input  || null;
              const detail     = buildToolDetail(tool, input);

              const [efp, eln] = extractFilePathAndLines(tool, input);
              let msgStr;
              if (tool === 'Write' || tool === 'Edit') {
                const fp = (input && input.file_path) || '';
                const lc = eln || 0;
                msgStr   = `${tool}: ${fp} (+${lc} lines)`;
              } else if (!detail || detail === `Using tool: ${tool}`) {
                msgStr = `Using tool: ${tool}`;
              } else {
                msgStr = `${tool}: ${detail}`;
              }

              const toolEntry = makeLogEntry(ts, sourceAgent, msgStr, 'tool', tool);
              if (efp) toolEntry.file_path = efp;
              if (eln) toolEntry.lines = eln;

              if (missionState) {
                missionState.log.push(toolEntry);
                const agentObj = missionState.agents.find(a => a.name === sourceAgent);
                if (agentObj) {
                  agentObj.current_task = `${tool}: ${detail.length > 80 ? detail.slice(0, 77) + '…' : detail}`;
                  if (agentObj.status !== 'Done') agentObj.status = 'Working';
                }

                // Track file changes for Write/Edit
                if ((tool === 'Write' || tool === 'Edit') && efp && input) {
                  const fc = buildFileChangeFromInput(tool, input, sourceAgent, ts);
                  upsertFileChange(fc);
                  sendToWindow('mission:file-change', {
                    path: fc.path, action: fc.action, agent: sourceAgent, timestamp: ts,
                    lines: fc.lines, content_preview: fc.content_preview,
                    diff_old: fc.diff_old, diff_new: fc.diff_new,
                  });
                }
              }
              sendToWindow('mission:log', toolEntry);

              // ── Agent tool → subagent spawning ──
              if (tool === 'Agent') {
                const rawName  = (input && input.name)        || '';
                const desc     = (input && input.description) || '';
                const modelStr = (input && input.model)       || 'sonnet';

                let agentName;
                if (!isContMode) {
                  // deploy_mission: use planned agent slot resolution
                  if (missionState) {
                    const plannedMatch = missionState.agents.some(a => a.name === rawName && a.name !== 'Lead');
                    if (plannedMatch) {
                      agentName = rawName;
                      const a = missionState.agents.find(x => x.name === rawName);
                      if (a) { a.status = 'Working'; a.current_task = 'Starting...'; }
                    } else {
                      const idleSlot = missionState.agents.find(a =>
                        a.name !== 'Lead' && (a.status === 'Idle' || a.status === 'Spawning'));
                      if (idleSlot) {
                        agentName = idleSlot.name;
                        idleSlot.status = 'Working';
                        idleSlot.current_task = 'Starting...';
                      } else if (rawName) {
                        agentName = rawName;
                        if (!missionState.agents.some(a => a.name === rawName)) {
                          missionState.agents.push({
                            name: rawName, role: inferRole(rawName),
                            status: 'Working', current_task: 'Starting...',
                            model: modelStr, spawned_at: ts, model_reason: null,
                          });
                        }
                      } else {
                        agentName = desc.slice(0, 30);
                      }
                    }
                  } else {
                    agentName = rawName;
                  }
                } else {
                  // continue_mission: simpler — add if not exists
                  agentName = (desc || '').slice(0, 30) || rawName || 'agent';
                  if (missionState && !missionState.agents.some(a => a.name === agentName)) {
                    missionState.agents.push({
                      name: agentName, role: desc || agentName,
                      status: 'Working', current_task: 'Starting...',
                      model: modelStr, spawned_at: ts, model_reason: null,
                    });
                  }
                }

                if (toolUseId) toolUseToAgent.set(toolUseId, agentName || '');

                sendToWindow('mission:agent-spawned', {
                  agent_name: agentName, role: desc, timestamp: ts,
                  model: (missionState && missionState.agents.find(x => x.name === agentName) || {}).model || modelStr || null,
                });
              }

              // ── TeamCreate → store team name ──
              if (tool === 'TeamCreate' && missionState) {
                const teamName = (input && input.team_name) || 'mission';
                missionState.team_name = teamName;
                sendToWindow('mission:team-event', { event: 'created', team_name: teamName, timestamp: ts });
              }

              // ── TeamDelete → clear team ──
              if (tool === 'TeamDelete' && missionState) {
                missionState.team_name = null;
                sendToWindow('mission:team-event', { event: 'deleted', timestamp: ts });
              }

              // ── TaskUpdate → detect task reassignment ──
              if (tool === 'TaskUpdate' && input && missionState) {
                const taskIdUpd  = (input.task_id || input.todos || '').toString();
                const newOwner   = (input.owner || '').toString();
                if (taskIdUpd && newOwner) {
                  const taskObj = missionState.tasks.find(t => t.id === taskIdUpd);
                  if (taskObj && taskObj.assigned_agent && taskObj.assigned_agent !== newOwner) {
                    sendToWindow('mission:task-reassigned', {
                      task_id: taskIdUpd, from: taskObj.assigned_agent, to: newOwner,
                    });
                    taskObj.assigned_agent = newOwner;
                  }
                }
              }

              // ── SendMessage → agent-message event ──
              if (tool === 'SendMessage' && input && missionState) {
                const msgType2  = (input.type      || 'message').toString();
                const recipient = (input.recipient  || '').toString();
                const content   = (input.content    || '').toString();
                const msgId     = `${sourceAgent}-${recipient}-${ts}`;
                if (content) {
                  const messageObj = {
                    timestamp: ts, from: sourceAgent, to: recipient,
                    content, msg_type: msgType2,
                  };
                  missionState.messages.push(messageObj);
                  enqueueChunk(missionState.id, buildChunkFromMessage(messageObj));
                  scheduleFlush(missionState.id);
                  sendToWindow('mission:agent-message', {
                    from: sourceAgent, to: recipient, content, timestamp: ts, msg_id: msgId,
                  });
                }
              }
            }
          }
          break;
        }

        case 'user': {
          // Tool results — store raw only
          if (missionState) missionState.raw_output.push(clean);
          break;
        }

        case 'result': {
          const text = json.result ||
            (Array.isArray(json.content)
              ? ((json.content.find(c => c.text) || {}).text || 'Completed')
              : 'Completed');
          if (attemptCtx) attemptCtx.stdoutText = (attemptCtx.stdoutText || '') + text;
          const display = text.length > 500 ? text.slice(0, 500) + '...' : text;

          if (parentId) {
            // Subagent result
            const entry = makeLogEntry(ts, sourceAgent, `Completed: ${display}`, 'result');
            if (missionState) {
              missionState.log.push(entry);
              const agentObj = missionState.agents.find(a => a.name === sourceAgent);
              if (agentObj) { agentObj.status = 'Done'; agentObj.current_task = 'Completed'; }
              // Fuzzy match tasks to this agent
              const lowerName = sourceAgent.toLowerCase();
              for (const task of missionState.tasks) {
                if (task.status === 'completed') continue;
                const taskAgentLower = (task.assigned_agent || '').toLowerCase();
                const agentMatch = taskAgentLower && (
                  taskAgentLower === lowerName ||
                  taskAgentLower.includes(lowerName) ||
                  lowerName.includes(taskAgentLower)
                );
                if (agentMatch) {
                  task.status = 'completed';
                  task.completed_at = ts;
                  enqueueChunk(missionState.id, buildChunkFromTask(task));
                  scheduleFlush(missionState.id);
                }
              }

              // Safety timer: if all non-Lead agents are Done and the Lead process
              // hasn't exited within 90s, force-complete. This handles the case where
              // the Lead hangs after subagents finish (e.g. SendMessage to exited agent,
              // stuck build verification, etc.)
              const hasNonLeadAgents = missionState.agents.some(a => a.name !== 'Lead');
              const allNonLeadDone = hasNonLeadAgents && missionState.agents.every(
                a => a.name === 'Lead' || a.status === 'Done' || a.status === 'Error'
              );
              if (allNonLeadDone) {
                scheduleAgentTeamsCompletion(missionState.id, sendToWindow);
              }
            }
            sendToWindow('mission:log', entry);
          } else {
            // Lead result message — log it but do NOT mark mission completed.
            // The mission is only truly done when the CLI process exits (watchProcessExit_deploy).
            // `result` events fire per-turn in stream-json — Lead may output a result
            // while subagents are still running. Only process exit = mission done.
            const entry = makeLogEntry(ts, 'Lead', `Result: ${display}`, 'result');
            if (missionState) {
              missionState.log.push(entry);
              missionState._lastLeadResult = display;
            }
            sendToWindow('mission:log', entry);
          }
          break;
        }

        default:
          if (missionState) missionState.raw_output.push(clean);
          break;
      }
    } else {
      // Plain text fallback
      const events = parser.parseLine(clean);
      for (const event of events) {
        handleParsedEvent(event, sendToWindow);
      }
    }
  });

  // Post-mission: scan filesystem when stream ends
  rl.on('close', () => {
    const ts = now();
    if (!missionState) return;

    const projPath = missionState.project_path;
    if (!projPath) return;

    try {
      const existingPaths = new Set(missionState.file_changes.map(f => f.path));
      const foundFiles    = collectFiles(projPath, projPath);

      for (const fpath of foundFiles) {
        if (!existingPaths.has(fpath)) {
          missionState.file_changes.push({
            path: fpath, action: 'created', agent: 'Agent', timestamp: ts,
            lines: null, content_preview: null, diff_old: null, diff_new: null,
          });
          sendToWindow('mission:file-change', { path: fpath, action: 'created', agent: 'Agent', timestamp: ts });
        }
      }

      // Mark pending tasks completed if all agents done
      const allDone = missionState.agents.every(a => a.status === 'Done' || a.name === 'Lead');
      if (allDone && missionState.status === 'Completed') {
        for (const task of missionState.tasks) {
          if (task.status !== 'completed') {
            task.status = 'completed';
            task.completed_at = ts;
            enqueueChunk(missionState.id, buildChunkFromTask(task));
            scheduleFlush(missionState.id);
          }
        }
      }
    } catch (_) {}

    // Recover a question Lead asked but never closed with
    // <<<END_QUESTION>>>/<<<QUESTIONS_END>>> before ending its turn — same
    // fragility as the Planning-phase reader, but here it would otherwise
    // let watchProcessExit_deploy mark the mission Completed/Failed while
    // Lead was actually waiting on an answer.
    if (missionState.status === 'Running' && questionBatch.length === 0) {
      const recovered = tryRecoverDanglingQuestion(questionTextBuf);
      if (recovered) {
        handleQuestionBatch(recovered, proc, sendToWindow);
      } else if (questionTextBuf.includes('<<<QUESTION>>>') && attemptCtx && attemptCtx.retryInfo) {
        // Marker present but JSON malformed/truncated — not recoverable by the
        // lenient parser. Safety net: retry the spawn instead of letting
        // watchProcessExit_deploy mark the mission Completed/Failed.
        const { attempt, maxAttempts, backoffMs, retrySpawn } = attemptCtx.retryInfo;
        if (attempt < maxAttempts) {
          const delay = backoffMs[attempt - 1] ?? backoffMs[backoffMs.length - 1];
          const entry = makeLogEntry(ts, 'System',
            `⚠ Lead bị cắt giữa câu hỏi (thiếu marker đóng), đang thử lại lần ${attempt}/${maxAttempts} sau ${delay / 1000}s...`, 'info');
          missionState.log.push(entry);
          sendToWindow('mission:log', entry);
          missionState.status = 'RetryingDanglingQuestion'; // watchProcessExit_deploy's close handler must not mark Completed/Failed for this status
          sendToWindow('mission:retry-pending', { pending: true, attempt: attempt + 1, maxAttempts, delayMs: delay });
          pendingRetryTimer = setTimeout(() => {
            pendingRetryTimer = null;
            sendToWindow('mission:retry-pending', { pending: false });
            retrySpawn(attempt + 1, attemptCtx.sessionId || null);
          }, delay);
        }
      }
    }

    // Don't mark completed here — let watchProcessExit_deploy handle it
    // when the process actually exits. This prevents premature "Done" state.
  });
}

// ─────────────────────────────────────────────────────────────────
// watchProcessExit_deploy — watch for exit during deploy/continue
// ─────────────────────────────────────────────────────────────────
function watchProcessExit_deploy(proc, missionId, sendToWindow, retryInfo = null) {
  proc.on('close', (code) => {
    // This proc was superseded by a newer spawn (e.g. answer_question's
    // killChild() + resume) before its own close event had a chance to
    // fire. The kill signal is async, so the old process can still close
    // after childProcess has already moved on to the new one — acting on
    // it here would incorrectly mark the mission Completed/Failed while
    // the new process is still actively running.
    if (proc !== childProcess) return;

    const ts = now();
    if (!missionState) return;

    // If WaitingForAnswer (interactive mode question protocol), don't mark as Done.
    // Process exits because stdin was closed after prompt — user will answer via
    // session resume (new process with --resume SESSION_ID).
    if (missionState.status === 'WaitingForAnswer') {
      const entry = makeLogEntry(ts, 'System',
        'Process paused — waiting for user answer (will resume session after answer)', 'info');
      missionState.log.push(entry);
      sendToWindow('mission:log', entry);
      // Keep phase='Executing', status='WaitingForAnswer', don't emit completed
      return;
    }

    // Dangling-question safety-net retry already scheduled its own respawn
    // (readProcessStdout_deploy's rl close handler) — don't mark Completed/Failed here.
    if (missionState.status === 'RetryingDanglingQuestion') {
      return;
    }

    if (missionState.status === 'Running' && code !== 0 && code !== null && retryInfo) {
      const { attemptCtx, attempt, maxAttempts, backoffMs, retrySpawn } = retryInfo;
      const combinedText = (attemptCtx.stdoutText || '') + '\n' + (attemptCtx.stderrText || '');
      if (attempt < maxAttempts && isTransientApiError(combinedText)) {
        const delay = backoffMs[attempt - 1] ?? backoffMs[backoffMs.length - 1];
        const entry = makeLogEntry(ts, 'System',
          `⚠ Gặp lỗi tạm thời (rate limit/API), đang thử lại lần ${attempt}/${maxAttempts} sau ${delay / 1000}s...`, 'info');
        missionState.log.push(entry);
        sendToWindow('mission:log', entry);
        sendToWindow('mission:retry-pending', { pending: true, attempt: attempt + 1, maxAttempts, delayMs: delay });
        pendingRetryTimer = setTimeout(() => {
          pendingRetryTimer = null;
          sendToWindow('mission:retry-pending', { pending: false });
          retrySpawn(attempt + 1, attemptCtx.sessionId || null);
        }, delay);
        return;
      }
      if (attempt >= maxAttempts && isTransientApiError(combinedText)) {
        const entry = makeLogEntry(ts, 'System',
          `Đã thử lại ${maxAttempts} lần nhưng vẫn gặp lỗi rate limit — dừng mission.`, 'error');
        missionState.log.push(entry);
        sendToWindow('mission:log', entry);
      }
    }

    stopWatcher();
    stopAutosave();
    stopStuckChecker();
    clearAgentTeamsTimer();

    const finishDeployExit = () => {
      missionState.phase = 'Done';

      // Mark all agents as Done/Error now that process has actually exited
      for (const a of missionState.agents) {
        if (a.status !== 'Error') a.status = 'Done';
        if (a.name === 'Lead') {
          a.current_task = missionState.status === 'Completed' ? 'Mission completed'
            : missionState.status === 'Running' ? 'Awaiting retry (final QA sweep scheduled one)'
            : 'Mission failed';
        }
      }

      finalizeDeployExit(missionId, sendToWindow, ts);
    };

    if (missionState.status === 'Running') {
      if (code === 0 || code === null) {
        // Success exit code alone is no longer sufficient — the final
        // whole-picture QA sweep is the only path to 'Completed'. If any
        // task isn't 'completed' yet, runFinalQaSweep() leaves status
        // 'Running' rather than forcing it, per spec §3.
        runFinalQaSweep().then(finishDeployExit);
        return;
      }
      missionState.status = 'Failed';
    }
    finishDeployExit();
  }); // end proc.on('close', ...)
}

// ─────────────────────────────────────────────────────────────────
// spawnResumeOrFreshAttempt — shared helper to resume (or fresh-launch)
// the Lead agent process after the driving process has exited. Used by
// autoResumeAfterFinalQaFailure. Reuses the same spawn machinery as
// answer_question and restartLeadAfterMockup.
// ─────────────────────────────────────────────────────────────────
function spawnResumeOrFreshAttempt({ missionId, sendToWindow, promptOverride, reasonForLog }) {
  if (!missionState) return;

  killChild();

  const sessionId   = missionState.session_id || null;
  const leadModel   = missionState.agents.find(a => a.name === 'Lead')?.model || 'sonnet';
  const projectPath = missionState.project_path;
  const execMode    = missionState.execution_mode || 'standard';
  const resumeBackend = agentBackendOf(missionState.agents.find(a => a.name === 'Lead'));

  // Build prompt: use override if given, otherwise build a continuation prompt
  const prompt = promptOverride || buildAutoResumePrompt(reasonForLog);

  const { proc, promptViaStdin } = spawnAgentProcess({
    backendId: resumeBackend, model: leadModel, prompt,
    resumeSessionId: sessionId, maxTurns: 200,
    useAgentTeams: execMode === 'agent_teams',
    cwd: projectPath, sendToWindow,
  });

  // Prevent unhandled 'error' event (e.g. ENOENT if binary not found)
  proc.on('error', (err) => {
    const entry = makeLogEntry(now(), 'System',
      `Auto-resume spawn error: ${err.message}`, 'error');
    if (missionState) missionState.log.push(entry);
    sendToWindow('mission:log', entry);
  });

  // Prompt delivery: stdin (Claude) vs argv (Copilot) — adapter handles it
  if (promptViaStdin) {
    try {
      proc.stdin.write(prompt, 'utf8');
      proc.stdin.end();
    } catch (e) {
      const entry = makeLogEntry(now(), 'System',
        `Failed to write auto-resume prompt: ${e.message}`, 'error');
      if (missionState) missionState.log.push(entry);
      sendToWindow('mission:log', entry);
      killChild();
      return;
    }
  } else {
    try { proc.stdin.end(); } catch (_) {}
  }

  if (missionState) missionState.status = 'Running';
  startAutosave();
  startStuckChecker(sendToWindow, false);

  sendToWindow('mission:status', { mission_id: missionId, status: 'Running' });

  const attemptCtx = { stdoutText: '', stderrText: '', sessionId: null, backend: resumeBackend };
  const retryInfo = {
    attemptCtx, attempt: 1, maxAttempts: 3, backoffMs: [30000, 60000, 120000],
    retrySpawn: (_nextAttempt) => spawnResumeOrFreshAttempt({
      missionId, sendToWindow, promptOverride: prompt, reasonForLog,
    }),
  };
  attemptCtx.retryInfo = retryInfo;

  readProcessStdout_deploy(proc, sendToWindow, false, attemptCtx);
  readProcessStderr(proc, sendToWindow, attemptCtx);
  watchProcessExit_deploy(proc, missionId, sendToWindow, retryInfo);

  if (execMode === 'agent_teams' && projectPath) {
    startFileWatcher(projectPath, sendToWindow);
  }
}

// ─────────────────────────────────────────────────────────────────
// buildAutoResumePrompt — build the prompt for auto-resume after
// final QA sweep failure. Two cases: resume (session_id present)
// vs fresh launch (no session_id).
// ─────────────────────────────────────────────────────────────────
function buildAutoResumePrompt(reasonForLog) {
  if (!missionState) return '';

  // Find the flagged task (in_progress after handleQcQaFailure pushed it back)
  const flaggedTask = missionState.tasks.find(t => t.status === 'in_progress');
  const reason = (flaggedTask && flaggedTask.qcReason) || reasonForLog || 'final QA sweep found an issue';
  const taskTitle = flaggedTask ? flaggedTask.title : '(unknown task)';
  const taskAgent = flaggedTask ? (flaggedTask.assigned_agent || 'unknown') : 'unknown';

  if (missionState.session_id) {
    // Resume case: short nudge — the session already has context
    return `\n[System] The final whole-picture QA sweep flagged an issue and scheduled a retry. ` +
      `Task "${taskTitle}" (owner: ${taskAgent}) needs another pass. Reason: ${reason}\n` +
      `Please address the issue and complete the mission.\n`;
  }

  // Fresh-launch case: full context needed
  const taskList = missionState.tasks.map(t =>
    `- [${t.status}] ${t.title} (owner: ${t.assigned_agent || 'unknown'})`
  ).join('\n');

  return `You are continuing a mission that was interrupted. ` +
    `Mission: ${missionState.description || '(no description)'}\n` +
    `Project path: ${missionState.project_path}\n\n` +
    `Tasks:\n${taskList}\n\n` +
    `This is a continuation after the final whole-picture QA sweep found an issue: ${reason}\n` +
    `The following task needs another pass: "${taskTitle}" (owner: ${taskAgent}).\n` +
    `Please address the issue and complete the mission.`;
}

// ─────────────────────────────────────────────────────────────────
// autoResumeAfterFinalQaFailure — auto-resume the mission when the
// final QA sweep failed after the driving process already exited.
// Bounded to 3 consecutive attempts; falls back to manual Retry.
// ─────────────────────────────────────────────────────────────────
function autoResumeAfterFinalQaFailure(missionId, sendToWindow, ts) {
  missionState.autoResumeCount = (missionState.autoResumeCount || 0) + 1;

  if (missionState.autoResumeCount > 3) {
    const entry = makeLogEntry(ts, 'System',
      'Final QA sweep scheduled a retry after the driving process already exited — ' +
      'mission is awaiting that retry, but no process is currently driving it. ' +
      'Auto-resume already tried 3 times without reaching Completed — stopping. ' +
      'This requires manual intervention (see Retry).',
      'info');
    missionState.log.push(entry);
    sendToWindow('mission:log', entry);
    return;
  }

  const entry = makeLogEntry(ts, 'System',
    `Final QA sweep scheduled a retry after the driving process already exited — ` +
    `auto-resuming mission (attempt ${missionState.autoResumeCount}/3)...`,
    'info');
  missionState.log.push(entry);
  sendToWindow('mission:log', entry);

  spawnResumeOrFreshAttempt({
    missionId, sendToWindow,
    reasonForLog: 'final QA sweep failure after process exit',
  });
}

function finalizeDeployExit(missionId, sendToWindow, ts) {
  // If the final QA sweep FAILed and scheduled a retry (handleQcQaFailure
  // delays failed_qc/failed_qa -> in_progress rather than forcing it),
  // missionState.status is left 'Running' even though the driving `claude`
  // process has already exited. Auto-resume the mission instead of waiting
  // for manual Retry (bounded to 3 consecutive attempts).
  if (missionState.status === 'Running') {
    autoResumeAfterFinalQaFailure(missionId, sendToWindow, ts);
    return;
  }

  // Mark remaining pending tasks
  if (missionState.status === 'Completed') {
    for (const task of missionState.tasks) {
      if (task.status !== 'completed') { task.status = 'completed'; task.completed_at = ts; }
    }
  }

  // Auto-save
  missionState.ended_at = ts;  // Persist ended_at in snapshot too
  const statusStr = missionState.status === 'Completed' ? 'completed' : 'failed';
  const entry = {
    id: missionState.id,
    description: missionState.description,
    project_path: missionState.project_path,
    execution_mode: missionState.execution_mode || 'standard',
    backend: missionState.backend || 'claude',
    team_size: missionState.team_size,
    forked_from: missionState.forked_from || null,
    forked_from_desc: missionState.forked_from_desc || null,
    status: statusStr,
    started_at: missionState.started_at,
    ended_at: ts,
    agent_count: missionState.agents.length,
    task_summary: missionState.tasks.map(t => `[${t.status}] ${t.title}`),
    file_changes: missionState.file_changes,
    log_count: missionState.log.length,
  };
  saveToHistory(entry);
  saveMissionSnapshot(missionState);
  flushPending(missionId).catch(() => {});

  // Fire-and-forget: generate the post-mission debrief summary and merge it
  // onto the snapshot once ready. NOT awaited — finalizeDeployExit must stay
  // synchronous (mission.autoResume.test.js asserts sendToWindow calls happen
  // synchronously right after this function returns; making this async, or
  // awaiting generateDebriefSummary here, would defer those emissions past a
  // microtask/macrotask boundary and break that test, same constraint Task 4
  // already hit with flushPending). The snapshot already written above is
  // valid without debrief_summary; this follow-up write adds it moments
  // later once the spawned agent responds (or resolves null on failure).
  generateDebriefSummary().catch(() => null).then((debrief_summary) => {
    if (missionState && missionState.id === missionId && ['Completed', 'Failed'].includes(missionState.status)) {
      saveMissionSnapshot(missionState, { debrief_summary });
    }
  });

  sendToWindow('mission:status', { mission_id: missionId, status: statusStr });
}

// ─────────────────────────────────────────────────────────────────
// formatVersionLabel — human-readable label for a plan version
// ─────────────────────────────────────────────────────────────────
function formatVersionLabel(trigger, versionNum, replanCount) {
  const now = new Date();
  const hhmm = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  switch (trigger) {
    case 'initial': return 'Plan ban đầu';
    case 'replan': return `Replan #${replanCount}`;
    case 'manual_edit': return `Chỉnh sửa lúc ${hhmm}`;
    case 'rollback': return `Khôi phục v${versionNum}`;
    default: return `Version ${versionNum}`;
  }
}

// ─────────────────────────────────────────────────────────────────
// savePlanVersionInternal — append a plan version snapshot to mission snapshot file
// Used internally by applyPlanToState and replan_mission handler.
// ─────────────────────────────────────────────────────────────────
async function savePlanVersionInternal(missionId, trigger, agents, tasks) {
  try {
    const snapshotPath = path.join(os.homedir(), '.claude', 'agent-teams-snapshots', `${missionId}.json`);
    let snapshot = {};
    try {
      const raw = await fs.promises.readFile(snapshotPath, 'utf-8');
      snapshot = JSON.parse(raw);
    } catch { /* snapshot does not exist yet */ }

    const versions = snapshot.plan_versions || [];
    const nextVersion = versions.length > 0 ? Math.max(...versions.map(v => v.version)) + 1 : 1;
    const replanCount = versions.filter(v => v.trigger === 'replan').length + (trigger === 'replan' ? 1 : 0);

    const newVersion = {
      version: nextVersion,
      timestamp: Date.now(),
      trigger,
      label: formatVersionLabel(trigger, nextVersion, replanCount),
      agents: JSON.parse(JSON.stringify(agents)),
      tasks: JSON.parse(JSON.stringify(tasks)),
    };

    versions.push(newVersion);

    // Keep at most 50 versions, drop oldest
    const trimmed = versions.length > 50 ? versions.slice(versions.length - 50) : versions;

    snapshot.plan_versions = trimmed;
    await fs.promises.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf-8');

    // Also update in-memory missionState so autosave doesn't overwrite plan_versions
    if (missionState && missionState.id === missionId) {
      missionState.plan_versions = trimmed;
    }

    return { version: newVersion.version, label: newVersion.label };
  } catch (err) {
    console.error('savePlanVersionInternal error:', err);
    return { error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────
// askMissionLive — Mission Companion "Ask" side channel (read-only Q&A
// about a currently-running mission). Spawns a SECOND, independent process
// via spawnAgentProcessRef — never touches the mission's real driving
// process. Because spawnAgentProcess has the side effect of setting the
// module-level childProcess/childBackend, this handler saves those values
// immediately before the call and restores them immediately after (both on
// the success path and the synchronous-throw path), so the Lead's driving
// process reference is never disturbed by this call.
// ─────────────────────────────────────────────────────────────────
async function askMissionLive({ question }, sendToWindow) {
  if (!missionState || !['Running', 'Deploying', 'Launching'].includes(missionState.status)) {
    return { answer: null, error: 'No live mission to ask.' };
  }

  // Everything below (index lookup, prompt building, backend resolution, and
  // the spawn itself) is wrapped so this function NEVER rejects — a live-Q&A
  // failure must always resolve as { answer: null, error } rather than
  // surface as an uncaught IPC rejection in the renderer. queryIndex,
  // buildMissionSummary, and agentBackendOf are not expected to throw under
  // normal conditions, but they run before childProcess/childBackend are
  // saved (they don't touch those variables), so a throw here is caught
  // before any save/restore bookkeeping would even be needed.
  try {
    const topK = await queryIndex(missionState.id, question, 6);
    const contextBlock = topK.map(c => `[${c.source.type}] ${c.text}`).join('\n');
    const summary = buildMissionSummary(missionState);
    const prompt = [
      `You are answering a quick question about a mission that is CURRENTLY RUNNING. Answer in 2-4 sentences, based only on the context below. If you don't know, say so — do not guess.`,
      `## Current mission state\n${JSON.stringify(summary)}`,
      `## Relevant context\n${contextBlock}`,
      `## Question\n${question}`,
    ].join('\n\n');

    const leadAgent = (missionState.agents || []).find(a => a.name === 'Lead');
    const backendId = agentBackendOf(leadAgent);

    const savedChildProcess = childProcess;
    const savedChildBackend = childBackend;

    return await new Promise((resolve) => {
      let proc;
      try {
        // sendToWindow is intentionally omitted from this spec — spawnAgentProcess
        // uses it internally only for resume-fallback side-channel logging
        // ('mission:log'), and this secondary spawn must never write into the
        // mission's own activity log.
        const spawned = spawnAgentProcessRef({
          backendId, model: 'sonnet', prompt, resumeSessionId: null, maxTurns: 10,
          useAgentTeams: false, cwd: missionState.project_path,
        });
        proc = spawned.proc;
        try {
          if (spawned.promptViaStdin) proc.stdin.write(prompt, 'utf8');
          proc.stdin.end();
        } catch (_) {}
      } catch (err) {
        childProcess = savedChildProcess;
        childBackend = savedChildBackend;
        resolve({ answer: null, error: err.message });
        return;
      }
      // Restore immediately — spawnAgentProcessRef (== spawnAgentProcess in
      // production) sets childProcess/childBackend as a side effect; this call
      // must never leave the mission's real driving process reference altered.
      childProcess = savedChildProcess;
      childBackend = savedChildBackend;

      let stdout = '';
      const timer = setTimeout(() => {
        try { proc.kill(); } catch (_) {}
        resolve({ answer: null, error: 'Live Q&A timed out after 60s' });
      }, 60000);

      proc.stdout.on('data', d => { stdout += d.toString('utf8'); });
      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({ answer: null, error: err.message });
      });
      proc.on('close', () => {
        clearTimeout(timer);
        const answer = extractAssistantText(stdout);
        const entry = { question, answer, timestamp: Date.now() };
        if (sendToWindow) sendToWindow('mission:companion-answer', entry);
        resolve({ answer });
      });
    });
  } catch (err) {
    return { answer: null, error: err.message };
  }
}

/** Parse `--output-format stream-json` stdout lines, return the last assistant text. */
function extractAssistantText(stdoutText) {
  const lines = stdoutText.split('\n').filter(Boolean);
  let lastText = null;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'assistant' && parsed.message && Array.isArray(parsed.message.content)) {
        const textPart = parsed.message.content.find(p => p.type === 'text');
        if (textPart) lastText = textPart.text;
      }
    } catch (_) { /* not a JSON line, skip */ }
  }
  return lastText;
}

// ─────────────────────────────────────────────────────────────────
// generateDebriefSummary — Mission Companion post-mission debrief.
// Spawns a SECOND, independent process via spawnAgentProcessRef (same
// save/restore-childProcess/childBackend pattern as askMissionLive) to
// produce a structured JSON summary of the just-completed mission. Called
// from finalizeDeployExit's terminal branch — the driving process has
// already exited by that point, so there's no real driving process to
// protect, but the save/restore pattern is kept for consistency and because
// spawnAgentProcess unconditionally sets childProcess/childBackend as a
// side effect. Never rejects — resolves null on any failure/timeout.
// ─────────────────────────────────────────────────────────────────
async function generateDebriefSummary() {
  const prompt = [
    `The mission below has just completed. Produce ONLY a JSON object (no markdown fences, no prose) with this exact shape:`,
    `{"goal": string, "agents_involved": string[], "key_files": string[], "issues_encountered": string[], "outcome": string}`,
    `## Mission description\n${missionState.description || ''}`,
    `## Agents\n${(missionState.agents || []).map(a => a.name).join(', ')}`,
    `## File changes\n${(missionState.file_changes || []).map(f => `${f.path} (${f.action})`).join('\n')}`,
    `## Final task list\n${(missionState.tasks || []).map(t => `${t.title}: ${t.status}`).join('\n')}`,
  ].join('\n\n');

  const leadAgent = (missionState.agents || []).find(a => a.name === 'Lead');
  const backendId = agentBackendOf(leadAgent);

  const savedChildProcess = childProcess;
  const savedChildBackend = childBackend;

  return new Promise((resolve) => {
    let proc;
    try {
      const spawned = spawnAgentProcessRef({
        backendId, model: 'haiku', prompt, resumeSessionId: null, maxTurns: 5,
        useAgentTeams: false, cwd: missionState.project_path,
      });
      proc = spawned.proc;
      try {
        if (spawned.promptViaStdin) proc.stdin.write(prompt, 'utf8');
        proc.stdin.end();
      } catch (_) {}
    } catch {
      childProcess = savedChildProcess;
      childBackend = savedChildBackend;
      resolve(null);
      return;
    }
    childProcess = savedChildProcess;
    childBackend = savedChildBackend;

    let stdout = '';
    const timer = setTimeout(() => {
      try { proc.kill(); } catch (_) {}
      resolve(null);
    }, 60000);

    proc.stdout.on('data', d => { stdout += d.toString('utf8'); });
    proc.on('error', () => { clearTimeout(timer); resolve(null); });
    proc.on('close', () => {
      clearTimeout(timer);
      const text = extractAssistantText(stdout);
      if (!text) { resolve(null); return; }
      try {
        const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        resolve(JSON.parse(cleaned));
      } catch (_) {
        resolve(null);
      }
    });
  });
}

// ═════════════════════════════════════════════════════════════════
// registerMission — main export
// ═════════════════════════════════════════════════════════════════
module.exports = function registerMission(getMainWindow) {

  // Helper: safely send events to renderer.
  // Nếu đang ghi (activeRecording != null) thì append event vào buffer
  // kèm relativeTimestamp — KHÔNG thay đổi hành vi gửi tới renderer.
  // Bỏ qua kênh phụ 'replay:*' để không tự ghi lại tiến trình replay.
  function sendToWindow(channel, data) {
    if (activeRecording && typeof channel === 'string' && !channel.startsWith('replay:')) {
      try {
        activeRecording.events.push(
          recordingSchema.createEvent(Date.now() - activeRecording.startedAt, channel, data)
        );
      } catch (_) {}
    }
    try {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    } catch (_) {}
  }

  // Make sendToWindow reachable from the QC/QA pipeline functions
  // (enqueueQcCheck/enqueueQaCheck/handleQcQaFailure), which live outside
  // this closure and would otherwise have no way to reach the renderer.
  sendToWindowRef = sendToWindow;

  // Khởi tạo replay engine với sendToWindow (đúng channel gốc) và
  // 1 hàm kiểm tra mission thật có đang chạy hay không.
  replayEngine.init({
    sendToWindow,
    isMissionRunning: () =>
      !!(missionState && (missionState.status === 'Running' || missionState.status === 'Launching')),
  });

  // Helper nội bộ: huỷ recording đang ghi mà không lưu.
  function discardActiveRecording() {
    activeRecording = null;
  }

  // ── launch_mission ─────────────────────────────────────────────
  ipcMain.handle('launch_mission', async (_event, args) => {
    const { projectPath, prompt, description, model, executionMode, historyContext, permissionMode, team_size, backend } = args || {};

    // Prevent double-launch
    if (missionState &&
        (missionState.status === 'Running' || missionState.status === 'Launching')) {
      return 'A mission is already running';
    }

    // Mission-wide CLI backend (default 'claude'). Every agent inherits this
    // unless the plan overrides it per-agent.
    const backendArg = backend || 'claude';

    // ── Parse optional history context (continue from history = new mission with context) ──
    let historyState = null;
    if (historyContext) {
      try { historyState = JSON.parse(historyContext); } catch (_) {}
    }

    const ts        = now();
    const missionId = `mission-${ts}`;
    const modelArg  = model || 'sonnet';
    const execMode  = executionMode || 'standard';
    const permMode  = permissionMode || 'auto';

    // Build "previous work" summary if continuing from history
    let previousWorkSection = '';
    if (historyState) {
      const summary = buildMissionSummary(historyState);
      if (summary) {
        previousWorkSection = '\n\n## PREVIOUS WORK (from earlier mission)\n' +
          'This is a continuation of a previous mission. Below is what was accomplished:\n\n' +
          summary +
          '\n\nTake this context into account when planning. Reuse existing work where applicable. ' +
          'Focus on what the NEW requirement asks — do NOT redo completed work unless the user explicitly wants changes.\n';
        // Safety cap — prevents 32MB API limit errors from oversized history context
        if (previousWorkSection.length > 40_000) {
          previousWorkSection = previousWorkSection.slice(0, 40_000) + '\n... (context truncated to fit API limits)\n';
        }
      }
    }

    // Kill any existing process before starting new mission
    if (historyState) {
      stopWatcher();
      killChild();
    }

    // Initialize state
    missionState = {
      id: missionId,
      description: description || '',
      project_path: projectPath || '',
      status: 'Launching',
      phase:  'Planning',
      backend: backendArg,
      agents: [{
        name: 'Lead', role: 'Lead Coordinator',
        status: 'Spawning', current_task: 'Analyzing requirement...',
        spawned_at: ts, model: modelArg, model_reason: null,
        backend: backendArg,
      }],
      tasks: [],
      log: [{
        timestamp: ts, agent: 'System',
        message: historyState
          ? `Mission launched (continuing from ${historyState.id || 'history'}): ${description || ''}`
          : `Mission launched: ${description || ''}`,
        log_type: 'info',
      }],
      file_changes: [],
      started_at: ts,
      raw_output: [],
      team_name: null,
      messages: [],
      execution_mode: execMode,
      permission_mode: permMode,
      team_size: team_size !== undefined ? team_size : null,
      question_history: [],
      plan_versions: [],
      forked_from: historyState ? (historyState.id || null) : undefined,
      forked_from_desc: historyState ? (historyState.description || null) : undefined,
    };

    // Full prompt gửi tới claude (dùng cả cho recording:init snapshot).
    const fullPrompt = (prompt || '') + previousWorkSection;

    // Nếu đang ghi recording → ghi event khởi tạo 'recording:init' NGAY
    // trước khi phát bất kỳ event nào, để replay dựng lại state ban đầu.
    if (activeRecording) {
      activeRecording.missionId = missionId;
      activeRecording.startedAt = ts;
      activeRecording.events.push(
        recordingSchema.createInitEvent({
          prompt: fullPrompt,
          description: description || '',
          model: modelArg,
          projectPath: projectPath || '',
          executionMode: execMode,
          missionState: {
            agents: missionState.agents,
            tasks: missionState.tasks,
            mission_context: missionState.mission_context || null,
          },
        })
      );
    }

    sendToWindow('mission:status', { mission_id: missionId, status: 'launching' });
    // Reset frontend agent list
    sendToWindow('mission:agent-spawned', {
      agent_name: 'Lead', role: 'Lead Coordinator', timestamp: ts, reset: true,
    });

    // Spawn claude -p — planning phase only: do NOT enable AGENT_TEAMS here.
    // If AGENT_TEAMS=1 is set, Lead gains the Agent tool and will spawn sub-agents
    // directly, skipping our plan-review flow entirely.
    // Lead's backend for the planning phase = the mission-wide backend.
    const leadBackend = backendArg;
    const attemptSpawnLaunch = (attempt, resumeSessionId) => {
      // Planning phase: never enable AGENT_TEAMS (Lead must emit a JSON plan).
      const { proc, promptViaStdin } = spawnAgentProcess({
        backendId: leadBackend, model: modelArg, prompt: fullPrompt,
        resumeSessionId, maxTurns: null, useAgentTeams: false,
        cwd: projectPath, sendToWindow,
      });

      try {
        // Resumed attempts don't need the prompt again — the aborted session already has it.
        // For backends that carry the prompt via stdin (Claude), write it now;
        // backends that bake the prompt into argv (Copilot) skip the write.
        if (!resumeSessionId && promptViaStdin) {
          proc.stdin.write(fullPrompt, 'utf8');
        }
        proc.stdin.end();
      } catch (e) {
        const entry = makeLogEntry(now(), 'System', `Failed to write prompt to stdin: ${e.message}`, 'error');
        missionState.log.push(entry);
        sendToWindow('mission:log', entry);
        return;
      }

      childProcess = proc;
      missionState.status = 'Running';
      startAutosave();
      startStuckChecker(sendToWindow, attempt === 1);  // new mission — reset all clocks only on first attempt
      sendToWindow('mission:status', { mission_id: missionId, status: 'running' });

      const attemptCtx = { stdoutText: '', stderrText: '', sessionId: null, backend: leadBackend };
      const retryInfo = {
        attemptCtx, attempt, maxAttempts: 3, backoffMs: [30000, 60000, 120000],
        retrySpawn: (nextAttempt, nextSessionId) => attemptSpawnLaunch(nextAttempt, nextSessionId),
      };
      attemptCtx.retryInfo = retryInfo;

      readProcessStdout_launch(proc, missionId, sendToWindow, attemptCtx);
      readProcessStderr(proc, sendToWindow, attemptCtx);
      watchProcessExit_launch(proc, missionId, sendToWindow, retryInfo);
    };

    attemptSpawnLaunch(1, null);

    return missionState;
  });

  // ── deploy_mission ─────────────────────────────────────────────
  ipcMain.handle('deploy_mission', async (_event, args) => {
    const { agents = [], tasks = [], agentPrompts = {} } = args || {};

    if (!missionState) return 'No active mission';

    const projectPath  = missionState.project_path;
    const leadModel    = (missionState.agents.find(a => a.name === 'Lead') || {}).model || 'sonnet';
    const execMode     = missionState.execution_mode || 'standard';
    const missionDesc  = missionState.description || '';
    const missionId    = missionState.id;

    // Detect Vietnamese
    const viRule = detectVietnamese(missionDesc)
      ? '\n## LANGUAGE REQUIREMENT\nThe requirement is in Vietnamese. Rules:\n' +
        '- All UI text, labels, buttons, placeholders, and user-facing strings MUST be in Vietnamese\n' +
        '- For PDF generation: MUST embed a Unicode font supporting Vietnamese characters (e.g. jsPDF with custom font, or @fontsource). Do NOT use default Latin-only fonts — Vietnamese chars will display as □□□ boxes\n' +
        '- Test that Vietnamese text renders correctly before marking any task done\n'
      : '';

    // Detect project type
    const projectTypeHint = detectProjectType(projectPath);

    // Compute agent-level dependency graph from task depends_on fields
    const agentDepGraph = {};
    for (const a of agents) agentDepGraph[a.name || ''] = new Set();
    for (const t of tasks) {
      const owner = t.assigned_agent || t.agent || '';
      if (!owner) continue;
      for (const depTitle of (t.depends_on || [])) {
        const depTask = tasks.find(x => x.title === depTitle);
        if (depTask) {
          const depAgent = depTask.assigned_agent || depTask.agent || '';
          if (depAgent && depAgent !== owner) {
            if (!agentDepGraph[owner]) agentDepGraph[owner] = new Set();
            agentDepGraph[owner].add(depAgent);
          }
        }
      }
    }

    // Compute spawn waves via topological sort
    const spawnWaves = [];
    const spawned = new Set();
    const remaining = new Set(agents.map(a => a.name || ''));
    let safeguard = 0;
    while (remaining.size > 0 && safeguard++ < 20) {
      const wave = [...remaining].filter(name => {
        const deps = agentDepGraph[name] || new Set();
        return [...deps].every(d => spawned.has(d));
      });
      if (wave.length === 0) { spawnWaves.push([...remaining]); break; }
      wave.forEach(n => { spawned.add(n); remaining.delete(n); });
      spawnWaves.push(wave);
    }
    const hasMultipleWaves = spawnWaves.length > 1;
    const spawnWavesStr = hasMultipleWaves
      ? '\n\n## SPAWN ORDER (CRITICAL — follow this exactly)\n' +
        spawnWaves.map((w, i) => `Wave ${i + 1}: ${w.join(', ')}`).join('\n') +
        '\n\nAgents in later waves DEPEND on outputs from earlier waves. ' +
        'You MUST wait for each wave to complete before spawning the next wave.'
      : '';

    // Build agent blocks
    const agentBlocks = agents.map(a => {
      const name       = a.name        || '';
      const role       = a.role        || '';
      const agentModel = a.model       || 'sonnet';
      const custom     = a.customPrompt || '';
      const skillName  = a.skillFile && a.skillFile.name;
      const skillFileCount = a.skillFile && a.skillFile.fileCount;

      // Log skill injection (unchanged)
      if (skillName) {
        const desc = skillFileCount
          ? `Skill folder "${skillName}" loaded for agent "${name}" (${skillFileCount} files, ${custom.length} chars)`
          : `Skill file "${skillName}" loaded for agent "${name}" (${custom.length} chars)`;
        const skillEntry = makeLogEntry(now(), 'System', desc, 'info');
        missionState.log.push(skillEntry);
        sendToWindow('mission:log', skillEntry);
      }

      // Dependency annotation for Lead
      const depAgents = [...(agentDepGraph[name] || [])];
      const depsLine = depAgents.length > 0
        ? `\n- Depends on agents (spawn AFTER these complete): ${depAgents.join(', ')}`
        : '';

      // ── Verbatim prompt path (PromptPreview was used) ──────────
      const verbatimPrompt = agentPrompts[name];
      if (verbatimPrompt) {
        // Append viRule at end if Vietnamese project (global requirement)
        const finalPrompt = viRule
          ? verbatimPrompt + '\n' + viRule
          : verbatimPrompt;
        return `### Agent: "${name}"\n- Model: ${agentModel}${depsLine}\n- Prompt:\n\`\`\`prompt\n${finalPrompt}\n\`\`\``;
      }

      // ── Fallback: task-list path (no PromptPreview used) ───────
      const agentTasks = tasks
        .filter(t => (t.assigned_agent || t.agent || '') === name)
        .map(t => ({ title: t.title || '', detail: t.detail || '' }));

      const tasksStr = agentTasks.map((t, i) => {
        const line = `   ${i + 1}. ${t.title}`;
        return t.detail ? `${line}\n      Detail: ${t.detail}` : line;
      }).join('\n');

      let skillSection = '';
      let customSection = '';
      if (skillName && custom) {
        skillSection = `\n- SKILL (MANDATORY — inject this VERBATIM into agent prompt):\n\`\`\`skill\n${custom}\n\`\`\``;
      } else if (custom) {
        customSection = `\n- Custom instructions: ${custom}`;
      }

      return `### Agent: "${name}"\n- Role: ${role}\n- Model: ${agentModel}${depsLine}\n- Tasks:\n${tasksStr}${customSection}${skillSection}`;
    });

    const proj      = projectPath.replace(/\\/g, '/');
    const agentsStr = agentBlocks.join('\n\n');
    const total     = agents.length.toString();

    // Build deploy prompt — substitute static vars first, user content last
    const permModeSection = buildPermissionModeSection(missionState.permission_mode);
    const deployPrompt = (execMode === 'agent_teams' ? PROMPT_DEPLOY_AGENT_TEAMS : PROMPT_DEPLOY_STANDARD)
      .replace('{{PROJECT_PATH}}', proj)
      .replace('{{PROJECT_TYPE}}', projectTypeHint)
      .replace('{{LANG_RULE}}',    viRule)
      .replace('{{TOTAL_AGENTS}}', total)
      .replace('{{PERMISSION_MODE}}', permModeSection)
      .replace('{{SPAWN_WAVES}}', spawnWavesStr)
      .replace('{{AGENT_BLOCKS}}', agentsStr);  // last — user content may contain {{ }}

    // Update state to Deploying
    const ts = now();
    missionState.phase  = 'Deploying';
    missionState.status = 'Running';
    const lead = missionState.agents.find(a => a.name === 'Lead');
    if (lead) { lead.status = 'Working'; lead.current_task = 'Deploying teammates...'; }
    // Update agent models from confirmed list
    for (const aJson of agents) {
      const nm = aJson.name  || '';
      const md = aJson.model || 'sonnet';
      const ao = missionState.agents.find(x => x.name === nm);
      if (ao) ao.model = md;
    }
    missionState.log.push(makeLogEntry(ts, 'System',
      'User approved plan — spawning new claude process for execution', 'info'));

    sendToWindow('mission:status', { status: 'deploying' });

    // Kill old process if lingering
    killChild();

    // Spawn NEW claude -p process for execution phase
    // Always enable AGENT_TEAMS — deploy_standard.md and deploy_agent_teams.md
    // both instruct Lead to use the Agent tool to spawn sub-agents.
    // (Planning phase intentionally does NOT set this, so Lead outputs JSON plan instead.)
    const deployBackend = agentBackendOf(missionState.agents.find(a => a.name === 'Lead'));
    const attemptSpawnDeploy = (attempt, resumeSessionId) => {
      // Route through the backend adapter: builds argv, gates agent-teams,
      // handles resume fallback + prompt delivery. Claude stays byte-identical.
      const { proc, promptViaStdin } = spawnAgentProcess({
        backendId: deployBackend, model: leadModel, prompt: deployPrompt,
        resumeSessionId, maxTurns: 200, useAgentTeams: true,
        cwd: projectPath, sendToWindow,
      });

      try {
        if (!resumeSessionId && promptViaStdin) {
          proc.stdin.write(deployPrompt, 'utf8');
        }
        // Always close stdin — interactive questions use session resume (new process)
        proc.stdin.end();
      } catch (e) {
        const entry = makeLogEntry(now(), 'System', `Failed to write deploy prompt: ${e.message}`, 'error');
        missionState.log.push(entry);
        sendToWindow('mission:log', entry);
        return;
      }

      childProcess = proc;
      missionState.phase = 'Executing';
      startAutosave();
      startStuckChecker(sendToWindow, attempt === 1);  // new execution phase — reset all clocks only on first attempt
      if (attempt === 1) saveMissionSnapshot(missionState); // milestone: deploy started

      // Agent_teams mode: start file watcher
      if (execMode === 'agent_teams') {
        startFileWatcher(projectPath, sendToWindow);
      }

      const attemptCtx = { stdoutText: '', stderrText: '', sessionId: null, backend: deployBackend };
      const retryInfo = {
        attemptCtx, attempt, maxAttempts: 3, backoffMs: [30000, 60000, 120000],
        retrySpawn: (nextAttempt, nextSessionId) => attemptSpawnDeploy(nextAttempt, nextSessionId),
      };
      attemptCtx.retryInfo = retryInfo;

      // Wire up readers — pass permission mode for question marker handling
      readProcessStdout_deploy(proc, sendToWindow, false, attemptCtx);
      readProcessStderr(proc, sendToWindow, attemptCtx);
      watchProcessExit_deploy(proc, missionId, sendToWindow, retryInfo);
    };

    attemptSpawnDeploy(1, null);

    return null; // Ok(())
  });

  // ── continue_mission ───────────────────────────────────────────
  ipcMain.handle('continue_mission', async (_event, args) => {
    const { message = '', contextJson = '' } = args || {};

    // Parse optional history context
    let historyState = null;
    if (contextJson) {
      try { historyState = JSON.parse(contextJson); } catch (_) {}
    }

    let projectPath, leadModel, completedSummary;

    // ── Fork from history: create a NEW mission with context from snapshot ──
    if (historyState) {
      projectPath      = (historyState.project_path || '').toString();
      const leadEntry  = (historyState.agents || []).find(a => a.name === 'Lead') || {};
      leadModel        = (leadEntry.model || 'sonnet').toString();

      completedSummary = buildMissionSummary(historyState);
      // Safety cap — prevents 32MB API limit errors from oversized history context
      if (completedSummary.length > 40_000) {
        completedSummary = completedSummary.slice(0, 40_000) + '\n... (context truncated to fit API limits)';
      }

      // ── FORK: create brand-new missionState, link to parent ──
      const ts = now();
      const parentId = (historyState.id || '').toString();
      const parentDesc = (historyState.description || '').toString();
      const forkedExecMode = historyState.execution_mode || 'standard';
      // Inherit backend from the parent mission (default 'claude').
      const forkedBackend = historyState.backend || 'claude';
      const forkedLeadBackend = ((historyState.agents || []).find(a => a.name === 'Lead') || {}).backend || forkedBackend;

      // Kill any currently running mission
      stopWatcher();
      killChild();

      missionState = {
        id:              `mission-${ts}`,
        description:     parentDesc,     // inherit description
        project_path:    projectPath,
        status:          'Running',
        phase:           'Deploying',
        execution_mode:  forkedExecMode,
        permission_mode: historyState.permission_mode || 'auto',
        backend:         forkedBackend,
        question_history: [],
        started_at:      ts,
        ended_at:        null,
        forked_from:     parentId,        // ← parent link
        forked_from_desc: parentDesc,     // ← for display
        agents: [{
          name: 'Lead', role: 'Orchestrator',
          status: 'Working', current_task: 'Continuing from previous mission...',
          model: leadModel, spawned_at: ts, model_reason: null,
          backend: forkedLeadBackend,
        }],
        tasks:           [],
        log:             [makeLogEntry(ts, 'System', `Forked from mission: ${parentId}`, 'info'),
                          makeLogEntry(ts, 'User', `Intervention: ${message}`, 'info')],
        file_changes:    [],
        raw_output:      [],
        messages:        [],
        team_name:       null,
      };

      sendToWindow('mission:agent-spawned', {
        agent_name: 'Lead', role: 'Orchestrator', timestamp: ts, reset: true,
      });
      sendToWindow('mission:log', { timestamp: ts, agent: 'System', message: `Forked from mission: ${parentId}`, log_type: 'info' });
      sendToWindow('mission:log', { timestamp: ts, agent: 'User', message: `Intervention: ${message}`, log_type: 'info' });
      sendToWindow('mission:status', { status: 'running', mission_id: missionState.id, forked_from: parentId });

    } else {
      // ── Normal continue: mutate existing missionState ──
      if (!missionState) return 'No active mission to continue';

      leadModel   = (missionState.agents.find(a => a.name === 'Lead') || {}).model || 'sonnet';
      projectPath = missionState.project_path || '';

      completedSummary = buildMissionSummary(missionState);

      // Log intervention
      const ts = now();
      missionState.log.push(makeLogEntry(ts, 'User', `Intervention: ${message}`, 'info'));
      missionState.phase  = 'Deploying';
      missionState.status = 'Running';
      missionState.messages  = [];
      missionState.team_name = null;

      // Reset Lead status, keep old subagents visible
      for (const a of missionState.agents) {
        if (a.name === 'Lead') {
          a.status = 'Working';
          a.current_task = 'Continuing mission...';
          a.model = leadModel;
        }
        // Previous subagents stay with Done/Error status
      }
      // Ensure Lead exists
      if (!missionState.agents.some(a => a.name === 'Lead')) {
        missionState.agents.unshift({
          name: 'Lead', role: 'Orchestrator',
          status: 'Working', current_task: 'Continuing mission...',
          model: leadModel, spawned_at: ts, model_reason: null,
        });
      }

      sendToWindow('mission:log', { timestamp: ts, agent: 'User', message: `Intervention: ${message}`, log_type: 'info' });
      sendToWindow('mission:status', { status: 'running' });
    }

    // ── Common: build prompt + spawn process ──

    const projectTypeHint = detectProjectTypeCont(projectPath);

    // Determine execution mode: fork inherits from parent, normal uses current
    const execMode = missionState ? missionState.execution_mode || 'standard' : 'standard';

    // Select the appropriate continue prompt template based on execution mode
    const continueTemplate = execMode === 'agent_teams' ? PROMPT_CONTINUE_AGENT_TEAMS : PROMPT_CONTINUE_STANDARD;
    const contPermModeSection = buildPermissionModeSection(
      missionState ? missionState.permission_mode : 'auto'
    );
    const continuePrompt = continueTemplate
      .replace('{{PROJECT_PATH}}', projectPath.replace(/\\/g, '/'))
      .replace('{{PROJECT_TYPE}}', projectTypeHint)
      .replace('{{PERMISSION_MODE}}', contPermModeSection)
      .replace('{{SUMMARY}}', completedSummary || 'No previous work recorded.')
      .replace('{{MESSAGE}}', message);

    // Kill existing process (no-op if already killed in fork path)
    killChild();

    // Both continue_standard.md and continue_agent_teams.md use the Agent tool — always enable it.
    const continueBackend = agentBackendOf(missionState ? missionState.agents.find(a => a.name === 'Lead') : null);
    const attemptSpawnContinue = (attempt, resumeSessionId) => {
      const { proc, promptViaStdin } = spawnAgentProcess({
        backendId: continueBackend, model: leadModel, prompt: continuePrompt,
        resumeSessionId, maxTurns: 200, useAgentTeams: true,
        cwd: projectPath, sendToWindow,
      });

      try {
        if (!resumeSessionId && promptViaStdin) {
          proc.stdin.write(continuePrompt, 'utf8');
        }
        // Always close stdin — interactive questions use session resume (new process)
        proc.stdin.end();
      } catch (e) {
        const entry = makeLogEntry(now(), 'System', `Failed to write continue prompt: ${e.message}`, 'error');
        if (missionState) missionState.log.push(entry);
        sendToWindow('mission:log', entry);
        return;
      }

      childProcess = proc;
      if (missionState) missionState.phase = 'Executing';
      startAutosave();
      startStuckChecker(sendToWindow, false);  // resume — preserve silence clocks

      // Start file watcher if agent_teams mode (detect file changes from subagents)
      if (execMode === 'agent_teams') {
        startFileWatcher(projectPath, sendToWindow);
      }

      const attemptCtx = { stdoutText: '', stderrText: '', sessionId: null, backend: continueBackend };
      const missionIdForWatch = missionState ? missionState.id : 'unknown';
      const retryInfo = {
        attemptCtx, attempt, maxAttempts: 3, backoffMs: [30000, 60000, 120000],
        retrySpawn: (nextAttempt, nextSessionId) => attemptSpawnContinue(nextAttempt, nextSessionId),
      };
      attemptCtx.retryInfo = retryInfo;

      // Wire up readers
      readProcessStdout_deploy(proc, sendToWindow, true, attemptCtx);
      readProcessStderr(proc, sendToWindow, attemptCtx);
      watchProcessExit_deploy(proc, missionIdForWatch, sendToWindow, retryInfo);
    };

    attemptSpawnContinue(1, null);

    return null; // Ok(())
  });

  // ── answer_question ─────────────────────────────────────────
  // User answered Lead's question(s) — resume Claude session with answer
  // Uses `claude -p --resume SESSION_ID` to continue the conversation
  ipcMain.handle('answer_question', async (_event, args) => {
    const { answers = [] } = args || {};

    if (!missionState) {
      return 'No active mission';
    }
    if (!missionState.session_id) {
      return 'No session ID captured — cannot resume Claude session';
    }
    if (missionState.status !== 'WaitingForAnswer') {
      return 'Mission is not waiting for an answer';
    }

    const ts = now();

    // Build answer text to send as the new user message in resumed session
    const answerLines = answers.map(a => {
      const qObj = missionState._lastQuestions && missionState._lastQuestions[a.question_index];
      const qText = qObj ? qObj.question : `Question #${a.question_index}`;
      return `**Q:** ${qText}\n**A:** ${a.answer}${a.note ? ` (Note: ${a.note})` : ''}`;
    });
    const answerPrompt = `The user has answered your questions:\n\n${answerLines.join('\n\n')}\n\nPlease continue with the mission based on these answers.`;

    // Log Q&A for history
    if (!missionState.question_history) missionState.question_history = [];
    for (const a of answers) {
      const qObj = missionState._lastQuestions && missionState._lastQuestions[a.question_index];
      missionState.question_history.push({
        question: qObj ? qObj.question : `Question #${a.question_index}`,
        answer: a.answer,
        note: a.note || '',
        timestamp: ts,
      });
    }
    missionState._lastQuestions = null;
    missionState.pendingQuestions = null;

    // Kill old process if still lingering
    killChild();

    // Spawn new Claude process resuming the session
    const sessionId = missionState.session_id;
    const leadModel = missionState.agents.find(a => a.name === 'Lead')?.model || 'sonnet';
    const projectPath = missionState.project_path;
    const execMode = missionState.execution_mode || 'standard';
    const answerBackend = agentBackendOf(missionState.agents.find(a => a.name === 'Lead'));

    const spawnAnswerAttempt = (attempt) => {
      killChild();
      const { proc, promptViaStdin } = spawnAgentProcess({
        backendId: answerBackend, model: leadModel, prompt: answerPrompt,
        resumeSessionId: sessionId, maxTurns: 200,
        useAgentTeams: execMode === 'agent_teams',
        cwd: projectPath, sendToWindow,
      });

      try {
        if (promptViaStdin) proc.stdin.write(answerPrompt, 'utf8');
        proc.stdin.end();
      } catch (e) {
        const entry = makeLogEntry(now(), 'System', `Failed to write answer prompt: ${e.message}`, 'error');
        if (missionState) missionState.log.push(entry);
        sendToWindow('mission:log', entry);
        return false;
      }

      childProcess = proc;
      if (missionState) missionState.status = 'Running';
      startAutosave();
      startStuckChecker(sendToWindow, false);  // resume after Q&A — preserve silence clocks

      const attemptCtx = { stdoutText: '', stderrText: '', sessionId: null, backend: answerBackend };
      const retryInfo = {
        attemptCtx, attempt, maxAttempts: 3, backoffMs: [30000, 60000, 120000],
        retrySpawn: (nextAttempt) => spawnAnswerAttempt(nextAttempt),
      };
      attemptCtx.retryInfo = retryInfo;

      // Wire up readers — use launch reader for planning phase, deploy reader for execution
      const isPlanning = missionState.phase === 'Planning';
      if (isPlanning) {
        readProcessStdout_launch(proc, missionState.id, sendToWindow, attemptCtx);
        readProcessStderr(proc, sendToWindow, attemptCtx);
        watchProcessExit_launch(proc, missionState.id, sendToWindow, retryInfo);
      } else {
        readProcessStdout_deploy(proc, sendToWindow, false, attemptCtx);
        readProcessStderr(proc, sendToWindow, attemptCtx);
        watchProcessExit_deploy(proc, missionState.id, sendToWindow, retryInfo);
        // Agent Teams: restart file watcher so inter-agent messages are detected
        // after resuming from a Q&A pause (previous watcher may have stopped when
        // the prior process exited after <<<QUESTIONS_END>>>).
        if (execMode === 'agent_teams' && projectPath) {
          startFileWatcher(projectPath, sendToWindow);
        }
      }

      return true;
    };

    const spawnOk = spawnAnswerAttempt(1);
    if (!spawnOk) {
      return 'Failed to send answer to Claude process';
    }

    // Notify frontend
    sendToWindow('mission:answer-sent', { answers });
    sendToWindow('mission:status', { status: 'running' });

    const entry = makeLogEntry(ts, 'User',
      `Answered ${answers.length} question(s) — resuming session`, 'info');
    missionState.log.push(entry);
    sendToWindow('mission:log', entry);

    return null;
  });

  // ── ask_mission_live ─────────────────────────────────────────
  // Mission Companion "Ask" tab — quick, read-only Q&A about the currently
  // running mission via a secondary spawned process. Never touches the
  // mission's real driving process (see askMissionLive's save/restore of
  // childProcess/childBackend above).
  ipcMain.handle('ask_mission_live', async (_event, args) => {
    return askMissionLive(args, sendToWindow);
  });

  // ── mockup_respond ──────────────────────────────────────────────
  // User approved or sent feedback on a UI mockup. Close the HTTP server
  // and resume Lead with the result injected into stdin.
  ipcMain.handle('mockup_respond', async (_event, args) => {
    const { decision, feedback = '' } = args || {};

    if (decision !== 'approve' && decision !== 'revise') return 'Invalid decision value';
    if (!missionState) return 'No active mission';
    if (!missionState.session_id) return 'No session ID — cannot resume';
    if (missionState.status !== 'WaitingForMockup') return 'Not waiting for mockup';

    const missionId = missionState.id;

    // Close HTTP server
    if (mockupServers[missionId]) {
      mockupServers[missionId].close();
      delete mockupServers[missionId];
    }

    const ts = now();
    const injection = decision === 'approve'
      ? 'MOCKUP APPROVED: The user approved the mockup design. Continue planning and output the final plan JSON.'
      : `MOCKUP FEEDBACK: The user wants changes to the mockup. Feedback: "${feedback}". ` +
        'Please revise the spec and output a new <<<MOCKUP_REQUEST>>> block followed by <<<MOCKUP_PAUSE>>>.';

    const logMsg = decision === 'approve'
      ? 'Mockup approved — resuming planning'
      : `Mockup feedback sent: "${feedback}"`;
    const entry = makeLogEntry(ts, 'System', logMsg, 'info');
    missionState.log.push(entry);
    sendToWindow('mission:log', entry);

    restartLeadAfterMockup(missionId, injection, sendToWindow);
    return 'ok';
  });

  // ── replan_mission ────────────────────────────────────────────
  // Incremental re-plan: manager edited tasks/agents, ask Lead to review changes
  // Returns: { agents, tasks } or error string
  ipcMain.handle('replan_mission', async (_event, args) => {
    const { agents: currentAgents = [], tasks: currentTasks = [], note = '' } = args || {};

    if (!PROMPT_REPLAN) return 'Re-plan prompt template not found';

    // Build AGENTS summary
    const agentsSummary = currentAgents.map(a =>
      `- ${a.name} (${a.role || 'developer'}, model: ${a.model || 'sonnet'})`
    ).join('\n');

    // Build TASKS summary (with detail)
    const tasksSummary = currentTasks.map(t => {
      const detail = t.detail ? `\n    Detail: ${t.detail}` : '\n    Detail: (none — needs detail)';
      return `- [${t.priority || 'medium'}] "${t.title}" → agent: ${t.assigned_agent || 'unassigned'}${detail}`;
    }).join('\n');

    // Build CHANGES description
    const noteSection = note
      ? `\n\nADDITIONAL INSTRUCTION FROM MANAGER:\n"${note}"\nPlease incorporate this instruction into the updated plan.`
      : '';
    const changes = `The manager has made edits to the plan. The current state of agents and tasks is shown above.
Some tasks may be missing detail — you MUST fill in detailed implementation specs for any task that has "(none — needs detail)".
Keep all existing tasks that already have detail EXACTLY as they are. Only modify tasks where the manager explicitly changed something or where detail is missing.${noteSection}`;

    const replanPrompt = PROMPT_REPLAN
      .replace('{{AGENTS}}', agentsSummary)
      .replace('{{TASKS}}', tasksSummary)
      .replace('{{CHANGES}}', changes);

    // Use Lead model if available
    const leadModel = missionState
      ? (missionState.agents.find(a => a.name === 'Lead') || {}).model || 'sonnet'
      : 'sonnet';

    const projectPath = missionState ? missionState.project_path || '.' : '.';
    const replanBackend = agentBackendOf(missionState ? missionState.agents.find(a => a.name === 'Lead') : null);

    const runReplanAttempt = () => new Promise((resolve, reject) => {
      const { proc, promptViaStdin } = spawnAgentProcess({
        backendId: replanBackend, model: leadModel, prompt: replanPrompt,
        resumeSessionId: null, maxTurns: 50, useAgentTeams: false,
        cwd: projectPath, sendToWindow,
      });

      let fullText = '';
      let stderrText = '';
      let resolved = false;

      const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        // Backend routing: normalize non-Claude lines into Claude stream-json
        // shape so the text-extraction below is backend-independent.
        let msg;
        if (replanBackend && replanBackend !== 'claude') {
          msg = normalizedEventToClaudeShape(replanBackend, trimmed);
        } else {
          try { msg = JSON.parse(trimmed); } catch (_) { msg = null; }
        }
        if (msg) {
          // Collect text from assistant messages
          if (msg.type === 'assistant' && msg.message?.content) {
            for (const block of msg.message.content) {
              if (block.type === 'text' && block.text) {
                fullText += block.text;
              }
            }
          }
          // Also collect from content_block_delta
          if (msg.type === 'content_block_delta' && msg.delta?.text) {
            fullText += msg.delta.text;
          }
          // result message often has final text
          if (msg.type === 'result' && msg.result) {
            fullText += '\n' + msg.result;
          }
        } else {
          // Non-JSON / unparseable line — just accumulate raw text.
          fullText += trimmed + '\n';
        }
      });

      proc.stderr.on('data', (chunk) => { stderrText += chunk.toString(); });

      proc.on('close', () => {
        if (resolved) return;
        resolved = true;

        const parsed = tryParsePlanFromBuffer(fullText);
        if (parsed && parsed.agents && parsed.tasks) {
          sendToWindow('mission:log', {
            timestamp: now(), agent: 'System',
            message: `Re-plan complete: ${parsed.agents.length} agents, ${parsed.tasks.length} tasks`,
            log_type: 'info',
          });
          // Save replan version to snapshot
          if (missionState) {
            savePlanVersionInternal(missionState.id, 'replan', parsed.agents, parsed.tasks)
              .catch(e => console.error('[replan_mission] savePlanVersionInternal error:', e));
          }
          resolve({
            agents: parsed.agents,
            tasks: parsed.tasks,
            mission_context: parsed.mission_context || (missionState ? missionState.mission_context : null) || null,
          });
        } else {
          reject(new Error(`Failed to parse re-plan output: ${fullText}\n${stderrText}`));
        }
      });

      proc.on('error', (err) => {
        if (resolved) return;
        resolved = true;
        reject(new Error(`Re-plan process error: ${err.message}\n${stderrText}`));
      });

      // Send prompt (stdin for Claude; Copilot carries it in argv)
      try {
        if (promptViaStdin) proc.stdin.write(replanPrompt, 'utf8');
        proc.stdin.end();
      } catch (e) {
        if (!resolved) {
          resolved = true;
          reject(new Error(`Failed to write re-plan prompt: ${e.message}`));
        }
      }

      // Timeout: 120 seconds
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          killBackendProcess(proc, replanBackend);
          reject(new Error(`Re-plan timed out after 120s\n${stderrText}`));
        }
      }, 120000);
    });

    const onRetry = (attempt, maxAttempts, err, delay) => {
      const entry = {
        timestamp: now(), agent: 'System',
        message: `⚠ Gặp lỗi tạm thời (rate limit/API), đang thử lại lần ${attempt}/${maxAttempts} sau ${delay / 1000}s...`,
        log_type: 'info',
      };
      if (missionState) missionState.log.push(entry);
      sendToWindow('mission:log', entry);
    };

    sendToWindow('mission:log', {
      timestamp: now(), agent: 'System',
      message: 'Re-planning: sending changes to Lead for review...',
      log_type: 'info',
    });

    try {
      const result = await retryTransientSpawn(runReplanAttempt, onRetry, 3, [30000, 60000, 120000]);
      return result;
    } catch (err) {
      if (isTransientApiError(err.message)) {
        const entry = {
          timestamp: now(), agent: 'System',
          message: 'Đã thử lại 3 lần nhưng vẫn gặp lỗi rate limit — dừng mission.',
          log_type: 'error',
        };
        if (missionState) missionState.log.push(entry);
        sendToWindow('mission:log', entry);
      } else {
        sendToWindow('mission:log', {
          timestamp: now(), agent: 'System',
          message: 'Re-plan failed: could not parse updated plan from Lead response',
          log_type: 'error',
        });
      }
      return err.message;
    }
  });

  // ── stop_mission ───────────────────────────────────────────────
  ipcMain.handle('stop_mission', async () => {
    // Mission bị dừng giữa chừng → huỷ recording nửa vời (tránh file rác).
    discardActiveRecording();

    stopWatcher();
    stopAutosave();
    stopStuckChecker();
    clearAgentTeamsTimer();
    clearPendingRetryTimer();
    killChild();

    // Close any open mockup HTTP servers
    for (const server of Object.values(mockupServers)) {
      try { server.close(); } catch { /* ignore */ }
    }
    Object.keys(mockupServers).forEach(k => delete mockupServers[k]);

    if (missionState) {
      missionState.status = 'Stopped';
      for (const a of missionState.agents) {
        if (a.status === 'Working' || a.status === 'Spawning') {
          a.status = 'Idle';
          a.current_task = null;
        }
      }
      saveMissionSnapshot(missionState); // milestone: user stopped
    }

    sendToWindow('mission:status', { status: 'stopped' });
    return null;
  });

  // ── reset_mission ──────────────────────────────────────────────
  ipcMain.handle('reset_mission', async () => {
    // Mission bị reset giữa chừng → huỷ recording nửa vời (tránh file rác).
    discardActiveRecording();

    stopWatcher();
    stopAutosave();
    stopStuckChecker();
    clearAgentTeamsTimer();
    clearPendingRetryTimer();
    killChild();

    // Close any open mockup HTTP servers
    for (const server of Object.values(mockupServers)) {
      try { server.close(); } catch { /* ignore */ }
    }
    Object.keys(mockupServers).forEach(k => delete mockupServers[k]);

    missionState = null;
    sendToWindow('mission:status', { status: 'reset' });
    return null;
  });

  // ── read_planning_template ─────────────────────────────────────
  // Load planning.md from disk at RUNTIME so users can edit it
  ipcMain.handle('read_planning_template', async () => {
    const templatePath = promptPath('planning.md');
    return fs.readFileSync(templatePath, 'utf8');
  });

  // ── read_superpowers_skill ─────────────────────────────────────
  // Reads a superpowers skill SKILL.md from the user's Claude plugins cache.
  // Discovers the latest installed version automatically via semver sort.
  // Returns the file content as a string, or null if not found.
  ipcMain.handle('read_superpowers_skill', async (_event, args) => {
    const { skillName } = args || {};
    if (!skillName) return null;

    const superpowersBase = path.join(
      os.homedir(),
      '.claude', 'plugins', 'cache', 'claude-plugins-official', 'superpowers'
    );

    // Find all semver-formatted subdirectories (e.g. "5.0.7")
    let versions;
    try {
      versions = fs.readdirSync(superpowersBase)
        .filter(d => /^\d+\.\d+\.\d+$/.test(d))
        .sort((a, b) => {
          const [aMaj, aMin, aPatch] = a.split('.').map(Number);
          const [bMaj, bMin, bPatch] = b.split('.').map(Number);
          return bMaj - aMaj || bMin - aMin || bPatch - aPatch;
        });
    } catch (err) {
      // superpowers not installed — directory doesn't exist
      console.error('[read_superpowers_skill] Could not read superpowers base dir:', err.message);
      return null;
    }

    if (versions.length === 0) return null;

    const skillPath = path.join(superpowersBase, versions[0], 'skills', skillName, 'SKILL.md');
    try {
      const content = fs.readFileSync(skillPath, 'utf8');
      return content || null;
    } catch (err) {
      console.error('[read_superpowers_skill] Could not read skill file:', skillPath, err.message);
      return null;
    }
  });

  // ── get_mission_state ──────────────────────────────────────────
  ipcMain.handle('get_mission_state', async () => {
    return missionState;
  });

  // ── get_incomplete_missions ─────────────────────────────────────
  // Scan snapshots for missions that weren't properly finalized (crash recovery)
  ipcMain.handle('get_incomplete_missions', async () => {
    try {
      const snapshotsDir = path.join(os.homedir(), '.claude', 'agent-teams-snapshots');
      if (!fs.existsSync(snapshotsDir)) return [];

      const files = fs.readdirSync(snapshotsDir).filter(f => f.endsWith('.json'));
      const incomplete = [];
      const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days

      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(snapshotsDir, file), 'utf8');
          const snap = JSON.parse(raw);
          const status = (snap.status || '').toString();
          if (status !== 'Completed' && status !== 'Failed' && status !== 'Stopped') {
            const age = Date.now() - (snap.started_at || 0);
            if (age < maxAge) {
              incomplete.push({
                id: snap.id,
                description: snap.description || '',
                project_path: snap.project_path || '',
                status,
                phase: snap.phase || '',
                started_at: snap.started_at || 0,
                agent_count: (snap.agents || []).length,
                task_count: (snap.tasks || []).length,
                log_count: (snap.log || []).length,
              });
            }
          }
        } catch (_) {}
      }

      incomplete.sort((a, b) => (b.started_at || 0) - (a.started_at || 0));
      return incomplete;
    } catch (_) {
      return [];
    }
  });

  // ── export_plan_markdown ─────────────────────────────────────────
  ipcMain.handle('export_plan_markdown', async (_event, args) => {
    const { markdown, projectPath } = args || {};
    if (!markdown || !projectPath) return null;
    try {
      const dir = path.join(projectPath, '.claude-agent-team');
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, 'mission-plan.md');
      fs.writeFileSync(filePath, markdown, 'utf8');
      return filePath.replace(/\\/g, '/');
    } catch (err) {
      console.error('[export_plan_markdown] Error:', err);
      return null;
    }
  });

  // ── update_agent_model ─────────────────────────────────────────
  ipcMain.handle('update_agent_model', async (_event, args) => {
    const { agentName, model } = args || {};
    if (missionState && agentName) {
      const agent = missionState.agents.find(a => a.name === agentName);
      if (agent) agent.model = model || null;
    }
    return null;
  });

  // ── update_agent_backend ────────────────────────────────────────
  // Per-agent override of the CLI backend (claude/copilot), set from the
  // PlanReview dropdown. Falls back to the mission-wide backend when unset.
  ipcMain.handle('update_agent_backend', async (_event, args) => {
    const { agentName, backend } = args || {};
    if (missionState && agentName) {
      const agent = missionState.agents.find(a => a.name === agentName);
      // Empty/unset falls back to the mission-wide backend (default 'claude'),
      // so an agent never ends up without a resolvable backend.
      if (agent) agent.backend = backend || missionState.backend || 'claude';
    }
    return null;
  });

  // ── retry_agent ────────────────────────────────────────────────
  ipcMain.handle('retry_agent', async (_event, args) => {
    const { agentName } = args || {};
    return retryAgentCore(agentName, sendToWindow);
  });

  // ── save_plan_version ──────────────────────────────────────────
  // Appends a plan version snapshot to the mission snapshot file.
  // Returns: { version, label } or { error }
  ipcMain.handle('save_plan_version', async (_event, { missionId, trigger, agents, tasks }) => {
    return savePlanVersionInternal(missionId, trigger, agents, tasks);
  });

  // ── get_plan_versions ──────────────────────────────────────────
  // Returns plan versions from the mission snapshot file, newest first.
  // Returns: PlanVersion[] or []
  ipcMain.handle('get_plan_versions', async (_event, { missionId }) => {
    try {
      const snapshotPath = path.join(os.homedir(), '.claude', 'agent-teams-snapshots', `${missionId}.json`);
      const raw = await fs.promises.readFile(snapshotPath, 'utf-8');
      const snapshot = JSON.parse(raw);
      const versions = snapshot.plan_versions || [];
      return [...versions].reverse(); // newest first
    } catch {
      return [];
    }
  });

  // ── export_plan_pdf ────────────────────────────────────────────
  // Renders htmlContent in a hidden BrowserWindow, prints to PDF,
  // shows a native save dialog, and writes the file to disk.
  // Returns: { success: true, filePath } or { success: false, error }
  ipcMain.handle('export_plan_pdf', async (_event, { htmlContent, description }) => {
    let pdfWindow = null;
    try {
      // Create a hidden, offscreen BrowserWindow for PDF rendering
      pdfWindow = new BrowserWindow({
        show: false,
        webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true },
      });

      // Load HTML content via base64 data URL
      const encoded = Buffer.from(htmlContent, 'utf-8').toString('base64');
      await pdfWindow.loadURL(`data:text/html;base64,${encoded}`);

      // Print to PDF
      const pdfBuffer = await pdfWindow.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { top: 1, bottom: 1, left: 1, right: 1 },
      });

      // Build a slug-based default filename
      const slug = (description || 'mission')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .slice(0, 40);
      const date = new Date().toISOString().slice(0, 10);
      const defaultFilename = `${slug}-${date}.pdf`;

      // Show native save dialog
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: defaultFilename,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });

      if (canceled || !filePath) return { success: false, error: 'cancelled' };

      // Write the PDF buffer to disk
      await require('fs').promises.writeFile(filePath, pdfBuffer);
      return { success: true, filePath };
    } catch (err) {
      console.error('export_plan_pdf error:', err);
      return { success: false, error: err.message };
    } finally {
      if (pdfWindow && !pdfWindow.isDestroyed()) pdfWindow.destroy();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // RECORDING — ghi lại business events khi mission chạy
  // ═══════════════════════════════════════════════════════════════

  // ── recording_start ────────────────────────────────────────────
  // Bật ghi. CHỈ cho phép TRƯỚC khi launch_mission (mission phải
  // null/Idle). Trả về { ok: true } hoặc { error }.
  ipcMain.handle('recording_start', async () => {
    if (missionState &&
        missionState.status !== 'Idle' &&
        missionState.status !== 'Completed' &&
        missionState.status !== 'Failed' &&
        missionState.status !== 'Stopped') {
      return { error: 'Không thể bật ghi khi mission đang chạy. Hãy bật Record TRƯỚC khi khởi chạy mission.' };
    }
    if (activeRecording) {
      return { error: 'Đang có 1 phiên ghi. Hãy lưu hoặc huỷ trước khi bắt đầu phiên mới.' };
    }
    activeRecording = { startedAt: Date.now(), missionId: null, events: [] };
    return { ok: true, startedAt: activeRecording.startedAt };
  });

  // ── recording_stop_and_save ────────────────────────────────────
  // Dừng ghi, ghi file JSON ra ~/.claude/agent-teams-recordings/.
  // Trả về metadata bản ghi, hoặc { error }.
  ipcMain.handle('recording_stop_and_save', async (_event, args) => {
    if (!activeRecording) {
      return { error: 'Không có phiên ghi nào đang hoạt động.' };
    }
    const { name } = args || {};
    const rec = activeRecording;
    activeRecording = null; // ngừng capture ngay lập tức

    const createdAt = Date.now();
    const recordingId = `rec-${rec.startedAt}`;
    const durationMs = rec.events.length > 0
      ? rec.events[rec.events.length - 1].relativeTimestamp
      : (createdAt - rec.startedAt);

    // Lấy metadata mô tả từ event init nếu có.
    const initEvent = rec.events.find(e => e.channel === recordingSchema.INIT_CHANNEL);
    const initPayload = initEvent ? initEvent.payload || {} : {};

    const recording = recordingSchema.createRecording(
      {
        id: recordingId,
        name: (name != null && String(name).trim().length > 0)
          ? String(name).trim()
          : (initPayload.description || `Bản ghi ${new Date(createdAt).toLocaleString('vi-VN')}`),
        missionId: rec.missionId,
        createdAt,
        durationMs,
        missionDescription: initPayload.description || '',
        projectPath: initPayload.projectPath || '',
      },
      rec.events
    );

    try {
      const meta = recordingStore.saveRecording(recording);
      return { ok: true, recording: meta };
    } catch (err) {
      return { error: `Lưu recording thất bại: ${err.message}` };
    }
  });

  // ── recording_discard ──────────────────────────────────────────
  // Huỷ phiên ghi hiện tại mà không lưu.
  ipcMain.handle('recording_discard', async () => {
    const had = !!activeRecording;
    discardActiveRecording();
    return { ok: true, discarded: had };
  });

  // ── recording_status ───────────────────────────────────────────
  // Trạng thái ghi hiện tại (frontend hiển thị nút Record).
  ipcMain.handle('recording_status', async () => {
    if (!activeRecording) return { recording: false };
    return {
      recording: true,
      startedAt: activeRecording.startedAt,
      missionId: activeRecording.missionId,
      eventCount: activeRecording.events.length,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // RECORDING LIST / MANAGE — list, get, delete, rename
  // ═══════════════════════════════════════════════════════════════

  // ── list_recordings ────────────────────────────────────────────
  // Trả về mảng metadata (không load toàn bộ events) — đọc từ index.json.
  ipcMain.handle('list_recordings', async () => {
    try {
      return recordingStore.listRecordings();
    } catch (err) {
      console.error('list_recordings error:', err);
      return [];
    }
  });

  // ── get_recording ──────────────────────────────────────────────
  // Đọc đầy đủ 1 recording theo id (kèm events) — dùng khi replay.
  ipcMain.handle('get_recording', async (_event, args) => {
    const { recordingId } = args || {};
    if (!recordingId) return { error: 'Thiếu recordingId.' };
    const rec = recordingStore.getRecording(recordingId);
    if (!rec) return { error: `Không tìm thấy recording: ${recordingId}` };
    return rec;
  });

  // ── delete_recording ───────────────────────────────────────────
  ipcMain.handle('delete_recording', async (_event, args) => {
    const { recordingId } = args || {};
    if (!recordingId) return { error: 'Thiếu recordingId.' };
    try {
      const existed = recordingStore.deleteRecording(recordingId);
      return { ok: true, deleted: existed };
    } catch (err) {
      return { error: `Xoá recording thất bại: ${err.message}` };
    }
  });

  // ── rename_recording ───────────────────────────────────────────
  ipcMain.handle('rename_recording', async (_event, args) => {
    const { recordingId, name } = args || {};
    if (!recordingId) return { error: 'Thiếu recordingId.' };
    try {
      const meta = recordingStore.renameRecording(recordingId, name);
      if (!meta) return { error: `Không tìm thấy recording: ${recordingId}` };
      return { ok: true, recording: meta };
    } catch (err) {
      return { error: `Đổi tên recording thất bại: ${err.message}` };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // REPLAY — phát lại 1 recording theo timeline
  // ═══════════════════════════════════════════════════════════════

  // ── replay_start ───────────────────────────────────────────────
  // Load recording + bắt đầu phát. speed: 1 | 2 | 5 | Infinity.
  ipcMain.handle('replay_start', async (_event, args) => {
    const { recordingId, speed } = args || {};
    if (!recordingId) return { error: 'Thiếu recordingId.' };
    return replayEngine.start({ recordingId, speed });
  });

  // ── replay_pause / replay_resume ───────────────────────────────
  ipcMain.handle('replay_pause', async () => replayEngine.pause());
  ipcMain.handle('replay_resume', async () => replayEngine.resume());

  // ── replay_seek ────────────────────────────────────────────────
  ipcMain.handle('replay_seek', async (_event, args) => {
    const { positionMs } = args || {};
    return replayEngine.seek({ positionMs });
  });

  // ── replay_stop ────────────────────────────────────────────────
  ipcMain.handle('replay_stop', async () => replayEngine.stop());
};

module.exports.retryMockupGeneration = retryMockupGeneration;
module.exports.isTransientApiError = isTransientApiError;
module.exports.retryTransientSpawn = retryTransientSpawn;
module.exports.tryRecoverDanglingQuestion = tryRecoverDanglingQuestion;
// Exported unconditionally (not gated behind NODE_ENV/VITEST) so history.cjs's
// ask_mission_chat handler can spawn a real debrief-chat process in production,
// not just under test.
module.exports.spawnAgentProcess = spawnAgentProcess;
// Exported unconditionally for the same reason: history.cjs's ask_mission_chat
// handler needs to resolve the mission's actual backend (not hardcode 'claude').
module.exports.agentBackendOf = agentBackendOf;

if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
  module.exports.__setMissionStateForTest = (state) => { missionState = state; };
  module.exports.__getMissionStateForTest = () => missionState;
  module.exports.__handleParsedEventForTest = (event, sendToWindow) => handleParsedEvent(event, sendToWindow);
  module.exports.__setSendToWindowForTest = (fn) => { sendToWindowRef = fn; };
  module.exports.__fillTemplateForTest = (template, values) => fillTemplate(template, values);
  module.exports.__setQcQaRunnerForTest = (fn) => { qcQaRunner = fn; };
  module.exports.__qcQaSpawnOptsForTest = () => qcQaSpawnOpts();
  module.exports.__setPendingQcQaTimeoutForTest = (ms) => { pendingQcQaTimeoutMs = ms; };
  module.exports.__enqueueQcCheckForTest = (task, agent) => {
    return new Promise((resolve) => {
      const template = loadPromptTemplate('qc_check.md');
      const prompt = fillTemplate(template, {
        PROJECT_PATH: missionState.project_path, TASK_TITLE: task.title,
        TASK_DETAIL: task.detail || task.title,
        FILES_WRITTEN: (task.files_written || []).join(', ') || '(none reported)',
        BUILD_HINT: detectProjectType(missionState.project_path || '.'),
        RESPONSIBLE_AGENT: agent,
      });
      qcQaRunner({ ...qcQaSpawnOpts(), prompt, projectPath: missionState.project_path,
        model: 'claude-sonnet-5', stage: 'QC', timeoutMs: 180000 }).then((verdict) => {
        if (verdict.verdict === 'PASS') {
          enqueueQaCheck(task, agent, verdict);
        } else {
          handleQcQaFailure(task, 'qc', verdict.responsibleAgent || agent, verdict.reason);
        }
        resolve();
      });
    });
  };
  module.exports.__runFinalQaSweepForTest = () => runFinalQaSweep();
  module.exports.__scheduleAgentTeamsCompletionForTest = (missionId, sendToWindow) =>
    scheduleAgentTeamsCompletion(missionId, sendToWindow);
  module.exports.__retryAgentForTest = (agentName) => retryAgentCore(agentName, sendToWindowRef);
  module.exports.__finalizeDeployExitForTest = (missionId, sendToWindow, ts) =>
    finalizeDeployExit(missionId, sendToWindow, ts);
  module.exports.__autoResumeAfterFinalQaFailureForTest = (missionId, sendToWindow, ts) =>
    autoResumeAfterFinalQaFailure(missionId, sendToWindow, ts);
  module.exports.__spawnResumeOrFreshAttemptForTest = (opts) =>
    spawnResumeOrFreshAttempt(opts);
  module.exports.__setSpawnAgentProcessForTest = (fn) => { spawnAgentProcessRef = fn; };
  module.exports.__setChildProcessForTest = (proc) => { childProcess = proc; };
  module.exports.__getChildProcessForTest = () => childProcess;
  module.exports.__setPendingRetryTimerForTest = (handle) => { pendingRetryTimer = handle; };
  module.exports.__getPendingRetryTimerForTest = () => pendingRetryTimer;
  module.exports.__askMissionLiveForTest = (args) => askMissionLive(args, () => {});
  module.exports.__generateDebriefSummaryForTest = generateDebriefSummary;
  module.exports.__runMockupHtmlForTest = runMockupHtml;
  module.exports.__buildMissionSummaryForTest = (state, logLimit) => buildMissionSummary(state, logLimit);
}
