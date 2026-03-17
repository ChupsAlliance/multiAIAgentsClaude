'use strict';

// ─── mission.cjs ─────────────────────────────────────────────────
// Faithful 1:1 port of the MISSION IPC handlers from Rust (Tauri) → Node.js (Electron)
// Source: src-tauri/src/lib.rs  (MissionManager + all mission commands)
// ─────────────────────────────────────────────────────────────────

const { ipcMain } = require('electron');
const { spawn }   = require('child_process');
const readline    = require('readline');
const fs          = require('fs');
const path        = require('path');
const os          = require('os');

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
let watcherInterval = null; // setInterval for file watcher

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
          });
        }
        missionState.log.push(makeLogEntry(ts, 'System', `Agent '${agentName}' spawned (${role})`, 'spawn'));
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
        if (missionState.log.length > 2000) missionState.log.splice(0, 500);
        sendToWindow('mission:log', entry);
      }
      break;
    }

    case 'TaskStarted': {
      const { agent, description } = event;
      const taskId = `task-${ts}`;
      if (missionState) {
        missionState.tasks.push({
          id: taskId, title: description,
          status: 'in_progress', assigned_agent: agent,
          started_at: ts, completed_at: null, priority: null,
        });
        const a = missionState.agents.find(x => x.name === agent);
        if (a) { a.status = 'Working'; a.current_task = description; }
      }
      sendToWindow('mission:task-update', { task_id: taskId, agent, description, status: 'in_progress', timestamp: ts });
      break;
    }

    case 'TaskCompleted': {
      const { agent, description } = event;
      if (missionState) {
        // Find matching in-progress task for this agent
        const t = missionState.tasks.find(x =>
          x.assigned_agent === agent && x.status === 'in_progress');
        if (t) {
          t.status = 'completed';
          t.completed_at = ts;
        } else {
          // Task wasn't tracked; add as completed
          missionState.tasks.push({
            id: `task-${ts}`, title: description,
            status: 'completed', assigned_agent: agent,
            started_at: ts, completed_at: ts, priority: null,
          });
        }
        const a = missionState.agents.find(x => x.name === agent);
        if (a) { a.status = 'Idle'; a.current_task = null; }
      }
      sendToWindow('mission:task-update', { agent, description, status: 'completed', timestamp: ts });
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
function saveMissionSnapshot(state) {
  try {
    const snapshotsDir = path.join(os.homedir(), '.claude', 'agent-teams-snapshots');
    fs.mkdirSync(snapshotsDir, { recursive: true });
    const filePath = path.join(snapshotsDir, `${state.id}.json`);

    // Clone to avoid mutating live state; truncate raw_output for disk savings
    const snap = Object.assign({}, state);
    if (Array.isArray(snap.raw_output) && snap.raw_output.length > 500) {
      snap.raw_output = snap.raw_output.slice(-500);
    }
    // Truncate log to last 2000 entries (still plenty for review)
    if (Array.isArray(snap.log) && snap.log.length > 2000) {
      snap.log = snap.log.slice(-2000);
    }

    fs.writeFileSync(filePath, JSON.stringify(snap, null, 2), 'utf8');
  } catch (e) {
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
// killChild — kill the running claude subprocess
// ─────────────────────────────────────────────────────────────────
function killChild() {
  if (childProcess !== null) {
    try { childProcess.kill('SIGKILL'); } catch (_) {}
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
                missionState.messages.push({
                  timestamp: msgTs, from, to, content, msg_type: 'message',
                });
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
      try {
        const parsed = JSON.parse(planText.slice(js, je + 1));
        if (parsed.agents && parsed.tasks) return parsed;
      } catch (_) {}
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

  try {
    const parsed = JSON.parse(candidate);
    if (Array.isArray(parsed.agents) && parsed.agents.length > 0 &&
        Array.isArray(parsed.tasks)  && parsed.tasks.length  > 0) {
      return parsed;
    }
  } catch (_) {}

  return null;
}

// ─────────────────────────────────────────────────────────────────
// applyPlanToState — update missionState from plan JSON + emit
// ─────────────────────────────────────────────────────────────────
function applyPlanToState(planJson, planNow, logMsg, sendToWindow) {
  const newAgents = [];
  const newTasks  = [];

  for (const a of (planJson.agents || [])) {
    newAgents.push({
      name: a.name || 'unknown',
      role: a.role || '',
      status: 'Idle',
      current_task: null,
      spawned_at: planNow,
      model: a.model || null,
      model_reason: a.reason || null,
    });
  }
  for (let i = 0; i < (planJson.tasks || []).length; i++) {
    const t = planJson.tasks[i];
    newTasks.push({
      id: `task-${i}`,
      title: t.title || '',
      detail: t.detail || '',
      status: 'pending',
      assigned_agent: t.agent || null,
      started_at: null,
      completed_at: null,
      priority: t.priority || null,
    });
  }

  if (missionState) {
    for (const agent of newAgents) {
      if (!missionState.agents.some(a => a.name === agent.name)) {
        missionState.agents.push(agent);
      }
    }
    missionState.tasks = newTasks;
    missionState.phase = 'ReviewPlan';
    const lead = missionState.agents.find(a => a.name === 'Lead');
    if (lead) { lead.status = 'Idle'; lead.current_task = 'Plan ready — waiting for review'; }
    missionState.log.push(makeLogEntry(planNow, 'System', logMsg, 'plan-ready'));
  }

  sendToWindow('mission:plan-ready', { agents: newAgents, tasks: newTasks });
}

// ─────────────────────────────────────────────────────────────────
// readProcessStdout_launch — stdout reader for launch_mission
// (Planning phase: stream-json, plan detection)
// ─────────────────────────────────────────────────────────────────
function readProcessStdout_launch(proc, missionId, sendToWindow) {
  const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
  const parser = new OutputParser();
  let lineCount   = 0;
  let fullTextBuf = '';
  let planEmitted = false;

  rl.on('line', (line) => {
    const clean = stripAnsi(line).trim();
    if (!clean) return;
    lineCount++;

    // Emit every raw line
    sendToWindow('mission:raw-line', { line: clean, line_number: lineCount });

    let json;
    try { json = JSON.parse(clean); } catch (_) { json = null; }

    if (json) {
      const msgType = (json.type || '').toString();
      const ts      = now();

      switch (msgType) {
        case 'assistant':
        case 'content_block_delta':
        case 'content_block_start': {
          // Extract text content — handle multiple stream-json structures
          let text = null;

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

            // Check for plan markers / fallback JSON in accumulated text
            if (!planEmitted) {
              const parsed = tryParsePlanFromBuffer(fullTextBuf);
              if (parsed) {
                planEmitted = true;
                applyPlanToState(parsed, ts, 'Mission plan ready for review', sendToWindow);
                fullTextBuf = '';
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
            // Skip noisy init — just store raw
            if (missionState) missionState.raw_output.push(clean);
          } else {
            let text = (json.error && json.error.message) || json.message || clean;
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
            // Last resort: try to get plan from result text
            const resultText =
              (json.result || '') ||
              (Array.isArray(json.content)
                ? (json.content.find(c => c.text) || {}).text || ''
                : '');

            fullTextBuf += resultText;

            if (!planEmitted) {
              const parsed = tryParsePlanFromBuffer(fullTextBuf);
              if (parsed) {
                planEmitted = true;
                applyPlanToState(parsed, ts, 'Mission plan detected from result — ready for review', sendToWindow);
                fullTextBuf = '';
              }
            }

            if (!planEmitted) {
              // No plan found — check for connection errors
              const isConnErr = /ConnectionRefused|Unable to connect to API|ECONNREFUSED|connection refused|Network error|401|authentication/i.test(resultText);
              const logMsg = isConnErr
                ? '⚠️ Không thể kết nối tới API. Vui lòng kiểm tra lại kết nối và cấu hình API của bạn.'
                : `Result (no plan detected): ${resultText.length > 500 ? resultText.slice(0, 500) + '...' : resultText}`;
              const logType = isConnErr ? 'error' : 'result';

              const entry = makeLogEntry(ts, 'System', logMsg, logType);
              if (missionState) {
                missionState.log.push(entry);
                missionState.status = isConnErr ? 'Failed' : 'Completed';
                missionState.phase  = 'Done';
                const lead = missionState.agents.find(a => a.name === 'Lead');
                if (lead) {
                  lead.status = isConnErr ? 'Error' : 'Done';
                  lead.current_task = isConnErr ? 'Failed — API connection error' : 'Completed — no plan structure found';
                }
              }
              sendToWindow('mission:log', entry);
              sendToWindow('mission:status', { status: isConnErr ? 'failed' : 'completed' });
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
function readProcessStderr(proc, sendToWindow) {
  const rl = readline.createInterface({ input: proc.stderr, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const clean = stripAnsi(line).trim();
    if (!clean) return;
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
function watchProcessExit_launch(proc, missionId, sendToWindow) {
  proc.on('close', (code) => {
    const currentPhase = missionState ? missionState.phase : 'Planning';

    if (currentPhase === 'ReviewPlan') {
      // Expected exit after planning — don't mark as completed
      return;
    }

    const finalStatus = (code === 0 || code === null) ? 'Completed' : 'Failed';
    const ts = now();

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
// readProcessStdout_deploy — stdout reader for deploy_mission /
//                            continue_mission (execution phase)
// ─────────────────────────────────────────────────────────────────
function readProcessStdout_deploy(proc, sendToWindow, isContMode) {
  const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
  const parser = new OutputParser();
  let lineCount = 0;
  // tool_use_id → agent_name
  const toolUseToAgent = new Map();
  // task IDs currently running
  const runningTasks   = new Set();

  rl.on('line', (line) => {
    const clean = stripAnsi(line).trim();
    if (!clean) return;
    lineCount++;

    sendToWindow('mission:raw-line', { line: clean, line_number: lineCount });
    if (missionState) {
      missionState.raw_output.push(clean);
    }

    let json;
    try { json = JSON.parse(clean); } catch (_) { json = null; }

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

          for (const block of content) {
            const blockType = (block.type || '').toString();

            if (blockType === 'text') {
              const text = (block.text || '').toString();
              if (!text.trim()) continue;

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
                sendToWindow('mission:team-event', { event_type: 'created', data: { team_name: teamName }, timestamp: ts });
              }

              // ── TeamDelete → clear team ──
              if (tool === 'TeamDelete' && missionState) {
                missionState.team_name = null;
                sendToWindow('mission:team-event', { event_type: 'deleted', data: {}, timestamp: ts });
              }

              // ── TaskUpdate → detect task reassignment ──
              if (tool === 'TaskUpdate' && input && missionState) {
                const taskIdUpd  = (input.task_id || input.todos || '').toString();
                const newOwner   = (input.owner || '').toString();
                const newStatus  = (input.status || '').toString();
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
                  missionState.messages.push({
                    timestamp: ts, from: sourceAgent, to: recipient,
                    content, msg_type: msgType2,
                  });
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
                if (agentMatch) { task.status = 'completed'; task.completed_at = ts; }
              }
            }
            sendToWindow('mission:log', entry);
          } else {
            // Lead result message — log it but do NOT mark mission completed yet.
            // The mission is only truly done when the CLI process exits (handled by watchProcessExit_deploy).
            // Marking completed here causes premature "Done" while CLI still runs bash commands.
            const entry = makeLogEntry(ts, 'Lead', `Result: ${display}`, 'result');
            if (missionState) {
              missionState.log.push(entry);
              // Store the result text for summary, but keep status as Running
              missionState._lastLeadResult = display;
              if (missionState.agents.find(a => a.name === 'Lead')) {
                missionState.agents.find(a => a.name === 'Lead').current_task = 'Finishing up...';
              }
            }
            sendToWindow('mission:log', entry);
            sendToWindow('mission:status', { status: 'completed' });
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
      const foundFiles    = [];

      function scanDir(dir, base) {
        let entries;
        try { entries = fs.readdirSync(dir); } catch (_) { return; }
        for (const name of entries) {
          if (['node_modules', '.git', '.claude', 'dist', 'build', 'target'].includes(name) || name.startsWith('.')) continue;
          const full = path.join(dir, name);
          let stat;
          try { stat = fs.statSync(full); } catch (_) { continue; }
          if (stat.isDirectory()) {
            scanDir(full, base);
          } else {
            const rel = path.relative(base, full).replace(/\\/g, '/');
            foundFiles.push(rel);
          }
        }
      }
      scanDir(projPath, projPath);

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
          if (task.status !== 'completed') { task.status = 'completed'; task.completed_at = ts; }
        }
      }
    } catch (_) {}

    // Don't mark completed here — let watchProcessExit_deploy handle it
    // when the process actually exits. This prevents premature "Done" state.
  });
}

// ─────────────────────────────────────────────────────────────────
// watchProcessExit_deploy — watch for exit during deploy/continue
// ─────────────────────────────────────────────────────────────────
function watchProcessExit_deploy(proc, missionId, sendToWindow) {
  proc.on('close', (code) => {
    const ts = now();
    if (!missionState) return;

    if (missionState.status === 'Running') {
      missionState.status = code === 0 || code === null ? 'Completed' : 'Failed';
    }
    missionState.phase = 'Done';

    // Mark all agents as Done/Error now that process has actually exited
    for (const a of missionState.agents) {
      if (a.status !== 'Error') a.status = 'Done';
      if (a.name === 'Lead') a.current_task = missionState.status === 'Completed' ? 'Mission completed' : 'Mission failed';
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

    sendToWindow('mission:status', { mission_id: missionId, status: statusStr });
  });
}

// ═════════════════════════════════════════════════════════════════
// registerMission — main export
// ═════════════════════════════════════════════════════════════════
module.exports = function registerMission(getMainWindow) {

  // Helper: safely send events to renderer
  function sendToWindow(channel, data) {
    try {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    } catch (_) {}
  }

  // ── launch_mission ─────────────────────────────────────────────
  ipcMain.handle('launch_mission', async (_event, args) => {
    const { projectPath, prompt, description, model, executionMode, historyContext } = args || {};

    // Prevent double-launch
    if (missionState &&
        (missionState.status === 'Running' || missionState.status === 'Launching')) {
      return 'A mission is already running';
    }

    // ── Parse optional history context (continue from history = new mission with context) ──
    let historyState = null;
    if (historyContext) {
      try { historyState = JSON.parse(historyContext); } catch (_) {}
    }

    const ts        = now();
    const missionId = `mission-${ts}`;
    const modelArg  = model || 'sonnet';
    const execMode  = executionMode || 'standard';

    // Build "previous work" summary if continuing from history
    let previousWorkSection = '';
    if (historyState) {
      const parts = [];
      const hTasks = historyState.tasks || [];
      const completed  = hTasks.filter(t => t.status === 'completed')
        .map(t => `- [DONE] ${t.title} (by ${t.assigned_agent || 'unknown'})`);
      const inProgress = hTasks.filter(t => t.status === 'in_progress')
        .map(t => `- [IN PROGRESS] ${t.title} (by ${t.assigned_agent || 'unknown'})`);
      const pending    = hTasks.filter(t => t.status === 'pending')
        .map(t => `- [PENDING] ${t.title}`);
      if (completed.length)  parts.push(`Completed tasks:\n${completed.join('\n')}`);
      if (inProgress.length) parts.push(`In Progress:\n${inProgress.join('\n')}`);
      if (pending.length)    parts.push(`Pending:\n${pending.join('\n')}`);

      const hLogs = (historyState.log || []).filter(l => l.log_type !== 'raw').slice(-20)
        .map(l => `[${l.agent}] ${l.message}`);
      if (hLogs.length) parts.push(`Recent activity:\n${hLogs.join('\n')}`);

      const hFiles = (historyState.file_changes || []).map(f => `- ${f.path} (${f.action})`);
      if (hFiles.length) parts.push(`Files created/modified:\n${hFiles.join('\n')}`);

      if (parts.length) {
        previousWorkSection = '\n\n## PREVIOUS WORK (from earlier mission)\n' +
          'This is a continuation of a previous mission. Below is what was accomplished:\n\n' +
          parts.join('\n\n') +
          '\n\nTake this context into account when planning. Reuse existing work where applicable. ' +
          'Focus on what the NEW requirement asks — do NOT redo completed work unless the user explicitly wants changes.\n';
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
      agents: [{
        name: 'Lead', role: 'Lead Coordinator',
        status: 'Spawning', current_task: 'Analyzing requirement...',
        spawned_at: ts, model: modelArg, model_reason: null,
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
      forked_from: historyState ? (historyState.id || null) : undefined,
      forked_from_desc: historyState ? (historyState.description || null) : undefined,
    };

    sendToWindow('mission:status', { mission_id: missionId, status: 'launching' });
    // Reset frontend agent list
    sendToWindow('mission:agent-spawned', {
      agent_name: 'Lead', role: 'Lead Coordinator', timestamp: ts, reset: true,
    });

    // Spawn claude -p
    const proc = spawnClaude(
      ['-p', '--dangerously-skip-permissions', '--model', modelArg,
       '--output-format', 'stream-json', '--verbose'],
      projectPath,
      true   // always set CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 for launch
    );

    try {
      // Write prompt to stdin then close it
      // If continuing from history, append previous work context to the prompt
      const fullPrompt = (prompt || '') + previousWorkSection;
      proc.stdin.write(fullPrompt, 'utf8');
      proc.stdin.end();
    } catch (e) {
      return `Failed to write prompt to stdin: ${e.message}`;
    }

    childProcess = proc;
    missionState.status = 'Running';
    sendToWindow('mission:status', { mission_id: missionId, status: 'running' });

    // Wire up readers
    readProcessStdout_launch(proc, missionId, sendToWindow);
    readProcessStderr(proc, sendToWindow);
    watchProcessExit_launch(proc, missionId, sendToWindow);

    return missionState;
  });

  // ── deploy_mission ─────────────────────────────────────────────
  ipcMain.handle('deploy_mission', async (_event, args) => {
    const { agents = [], tasks = [] } = args || {};

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

    // Build agent blocks
    const agentBlocks = agents.map(a => {
      const name      = a.name       || '';
      const role      = a.role       || '';
      const agentModel = a.model     || 'sonnet';
      const custom    = a.customPrompt || '';
      const skillName = a.skillFile && a.skillFile.name;
      const skillFileCount = a.skillFile && a.skillFile.fileCount;

      if (skillName) {
        // Log skill injection
        const desc = skillFileCount
          ? `Skill folder "${skillName}" loaded for agent "${name}" (${skillFileCount} files, ${custom.length} chars)`
          : `Skill file "${skillName}" loaded for agent "${name}" (${custom.length} chars)`;
        const skillEntry = makeLogEntry(now(), 'System', desc, 'info');
        missionState.log.push(skillEntry);
        sendToWindow('mission:log', skillEntry);
      }

      const agentTasks = tasks
        .filter(t => (t.assigned_agent || t.agent || '') === name)
        .map(t => ({ title: t.title || '', detail: t.detail || '' }));

      const tasksStr  = agentTasks.map((t, i) => {
        const line = `   ${i + 1}. ${t.title}`;
        return t.detail ? `${line}\n      Detail: ${t.detail}` : line;
      }).join('\n');

      // Separate skill content from custom instructions for clarity
      let skillSection = '';
      let customSection = '';
      if (skillName && custom) {
        skillSection = `\n- SKILL (MANDATORY — inject this VERBATIM into agent prompt):\n\`\`\`skill\n${custom}\n\`\`\``;
      } else if (custom) {
        customSection = `\n- Custom instructions: ${custom}`;
      }

      return `### Agent: "${name}"\n- Role: ${role}\n- Model: ${agentModel}\n- Tasks:\n${tasksStr}${customSection}${skillSection}`;
    });

    const proj      = projectPath.replace(/\\/g, '/');
    const agentsStr = agentBlocks.join('\n\n');
    const total     = agents.length.toString();

    // Build deploy prompt — substitute static vars first, user content last
    const deployPrompt = (execMode === 'agent_teams' ? PROMPT_DEPLOY_AGENT_TEAMS : PROMPT_DEPLOY_STANDARD)
      .replace('{{PROJECT_PATH}}', proj)
      .replace('{{PROJECT_TYPE}}', projectTypeHint)
      .replace('{{LANG_RULE}}',    viRule)
      .replace('{{TOTAL_AGENTS}}', total)
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
    const proc = spawnClaude(
      ['-p', '--dangerously-skip-permissions', '--model', leadModel,
       '--output-format', 'stream-json', '--verbose', '--max-turns', '200'],
      projectPath,
      execMode === 'agent_teams'
    );

    try {
      proc.stdin.write(deployPrompt, 'utf8');
      proc.stdin.end();
    } catch (e) {
      return `Failed to write deploy prompt: ${e.message}`;
    }

    childProcess = proc;
    missionState.phase = 'Executing';

    // Agent_teams mode: start file watcher
    if (execMode === 'agent_teams') {
      startFileWatcher(projectPath, sendToWindow);
    }

    // Wire up readers
    readProcessStdout_deploy(proc, sendToWindow, false);
    readProcessStderr(proc, sendToWindow);
    watchProcessExit_deploy(proc, missionId, sendToWindow);

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

      // Build rich summary from history snapshot (tasks + logs + files)
      const parts = [];
      const hTasks = historyState.tasks || [];
      const completed  = hTasks.filter(t => t.status === 'completed')
        .map(t => `- [DONE] ${t.title} (by ${t.assigned_agent || 'unknown'})`);
      const inProgress = hTasks.filter(t => t.status === 'in_progress')
        .map(t => `- [IN PROGRESS] ${t.title} (by ${t.assigned_agent || 'unknown'})`);
      const pending    = hTasks.filter(t => t.status === 'pending')
        .map(t => `- [PENDING] ${t.title}`);
      if (completed.length)  parts.push(`Completed:\n${completed.join('\n')}`);
      if (inProgress.length) parts.push(`In Progress:\n${inProgress.join('\n')}`);
      if (pending.length)    parts.push(`Pending:\n${pending.join('\n')}`);

      const hLogs = (historyState.log || []).filter(l => l.log_type !== 'raw').slice(-30)
        .map(l => `[${l.agent}] ${l.message}`);
      if (hLogs.length) parts.push(`Recent activity:\n${hLogs.join('\n')}`);

      const hFiles = (historyState.file_changes || []).map(f => `- ${f.path} (${f.action})`);
      if (hFiles.length) parts.push(`Files created/modified:\n${hFiles.join('\n')}`);

      completedSummary = parts.join('\n\n');

      // ── FORK: create brand-new missionState, link to parent ──
      const ts = now();
      const parentId = (historyState.id || '').toString();
      const parentDesc = (historyState.description || '').toString();
      const forkedExecMode = historyState.execution_mode || 'standard';

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
        started_at:      ts,
        ended_at:        null,
        forked_from:     parentId,        // ← parent link
        forked_from_desc: parentDesc,     // ← for display
        agents: [{
          name: 'Lead', role: 'Orchestrator',
          status: 'Working', current_task: 'Continuing from previous mission...',
          model: leadModel, spawned_at: ts, model_reason: null,
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

      const completed   = missionState.tasks.filter(t => t.status === 'completed')
        .map(t => `- [DONE] ${t.title} (by ${t.assigned_agent || 'unknown'})`);
      const inProgress  = missionState.tasks.filter(t => t.status === 'in_progress')
        .map(t => `- [IN PROGRESS] ${t.title} (by ${t.assigned_agent || 'unknown'})`);
      const pending     = missionState.tasks.filter(t => t.status === 'pending')
        .map(t => `- [PENDING] ${t.title}`);

      const parts = [];
      if (completed.length)  parts.push(`Completed:\n${completed.join('\n')}`);
      if (inProgress.length) parts.push(`In Progress:\n${inProgress.join('\n')}`);
      if (pending.length)    parts.push(`Pending:\n${pending.join('\n')}`);

      // Recent logs (last 30, exclude "raw" type)
      const recentLogs = missionState.log
        .filter(l => l.log_type !== 'raw')
        .slice(-30)
        .map(l => `[${l.agent}] ${l.message}`);
      if (recentLogs.length) parts.push(`Recent activity:\n${recentLogs.join('\n')}`);

      // File changes
      const fileChanges = missionState.file_changes.map(f => `- ${f.path} (${f.action})`);
      if (fileChanges.length) parts.push(`Files created/modified:\n${fileChanges.join('\n')}`);

      completedSummary = parts.join('\n\n');

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
    const useAgentTeams = execMode === 'agent_teams';

    // Select the appropriate continue prompt template based on execution mode
    const continueTemplate = useAgentTeams ? PROMPT_CONTINUE_AGENT_TEAMS : PROMPT_CONTINUE_STANDARD;
    const continuePrompt = continueTemplate
      .replace('{{PROJECT_PATH}}', projectPath.replace(/\\/g, '/'))
      .replace('{{PROJECT_TYPE}}', projectTypeHint)
      .replace('{{SUMMARY}}', completedSummary || 'No previous work recorded.')
      .replace('{{MESSAGE}}', message);

    // Kill existing process (no-op if already killed in fork path)
    killChild();

    // Spawn new claude process — respect execution_mode for AGENT_TEAMS env
    const proc = spawnClaude(
      ['-p', '--dangerously-skip-permissions', '--model', leadModel,
       '--output-format', 'stream-json', '--verbose', '--max-turns', '200'],
      projectPath,
      useAgentTeams  // enable AGENT_TEAMS if original mission used it
    );

    try {
      proc.stdin.write(continuePrompt, 'utf8');
      proc.stdin.end();
    } catch (e) {
      return `Failed to write continue prompt: ${e.message}`;
    }

    childProcess = proc;
    if (missionState) missionState.phase = 'Executing';

    // Start file watcher if agent_teams mode (detect file changes from subagents)
    if (useAgentTeams) {
      startFileWatcher(projectPath, sendToWindow);
    }

    // Wire up readers
    readProcessStdout_deploy(proc, sendToWindow, true);
    readProcessStderr(proc, sendToWindow);

    const missionId = missionState ? missionState.id : 'unknown';
    watchProcessExit_deploy(proc, missionId, sendToWindow);

    return null; // Ok(())
  });

  // ── replan_mission ────────────────────────────────────────────
  // Incremental re-plan: manager edited tasks/agents, ask Lead to review changes
  // Returns: { agents, tasks } or error string
  ipcMain.handle('replan_mission', async (_event, args) => {
    const { agents: currentAgents = [], tasks: currentTasks = [] } = args || {};

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

    // Build CHANGES description (what the manager changed — we don't have a diff, so describe current state)
    const changes = `The manager has made edits to the plan. The current state of agents and tasks is shown above.
Some tasks may be missing detail — you MUST fill in detailed implementation specs for any task that has "(none — needs detail)".
Keep all existing tasks that already have detail EXACTLY as they are. Only modify tasks where the manager explicitly changed something or where detail is missing.`;

    const replanPrompt = PROMPT_REPLAN
      .replace('{{AGENTS}}', agentsSummary)
      .replace('{{TASKS}}', tasksSummary)
      .replace('{{CHANGES}}', changes);

    // Use Lead model if available
    const leadModel = missionState
      ? (missionState.agents.find(a => a.name === 'Lead') || {}).model || 'sonnet'
      : 'sonnet';

    const projectPath = missionState ? missionState.project_path || '.' : '.';

    sendToWindow('mission:log', {
      timestamp: now(), agent: 'System',
      message: 'Re-planning: sending changes to Lead for review...',
      log_type: 'info',
    });

    return new Promise((resolve) => {
      const proc = spawnClaude(
        ['-p', '--dangerously-skip-permissions', '--model', leadModel,
         '--output-format', 'stream-json', '--verbose', '--max-turns', '50'],
        projectPath,
        false
      );

      let fullText = '';
      let resolved = false;

      const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const msg = JSON.parse(trimmed);
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
        } catch (_) {
          // Non-JSON line — just accumulate
          fullText += trimmed + '\n';
        }
      });

      proc.stderr.on('data', () => {}); // Drain stderr

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
          resolve({ agents: parsed.agents, tasks: parsed.tasks });
        } else {
          sendToWindow('mission:log', {
            timestamp: now(), agent: 'System',
            message: 'Re-plan failed: could not parse updated plan from Lead response',
            log_type: 'error',
          });
          resolve('Failed to parse re-plan output');
        }
      });

      proc.on('error', (err) => {
        if (resolved) return;
        resolved = true;
        resolve(`Re-plan process error: ${err.message}`);
      });

      // Send prompt
      try {
        proc.stdin.write(replanPrompt, 'utf8');
        proc.stdin.end();
      } catch (e) {
        if (!resolved) {
          resolved = true;
          resolve(`Failed to write re-plan prompt: ${e.message}`);
        }
      }

      // Timeout: 120 seconds
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try { proc.kill(); } catch (_) {}
          resolve('Re-plan timed out after 120s');
        }
      }, 120000);
    });
  });

  // ── stop_mission ───────────────────────────────────────────────
  ipcMain.handle('stop_mission', async () => {
    stopWatcher();
    killChild();

    if (missionState) {
      missionState.status = 'Stopped';
      for (const a of missionState.agents) {
        if (a.status === 'Working' || a.status === 'Spawning') {
          a.status = 'Idle';
          a.current_task = null;
        }
      }
    }

    sendToWindow('mission:status', { status: 'stopped' });
    return null;
  });

  // ── reset_mission ──────────────────────────────────────────────
  ipcMain.handle('reset_mission', async () => {
    stopWatcher();
    killChild();
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

  // ── get_mission_state ──────────────────────────────────────────
  ipcMain.handle('get_mission_state', async () => {
    return missionState;
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
};
