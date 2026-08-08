'use strict';
// Port of system commands from lib.rs → Node.js
const { ipcMain, shell, app } = require('electron');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { compareSemver } = require('../lib/compareSemver.cjs');

const RELEASES_URL = 'https://api.github.com/repos/ChupsAlliance/multiAIAgentsClaude/releases/latest';

// ─── Backend CLI detection config ──────────────────────────────────
// Single source of truth for each backend's version-check command.
// Swap COPILOT_VERSION_CMD/COPILOT_VERSION_ARGS here if the binary name
// ever changes — every call site below reads from this constant, so it's
// a one-line change. Confirmed with cli-adapter-core: real binary is the
// standalone `copilot` (@github/copilot-cli v1.0.77), NOT `gh copilot`.
const CLAUDE_VERSION_CMD = 'claude';
const CLAUDE_VERSION_ARGS = ['--version'];
const COPILOT_VERSION_CMD = 'copilot';
const COPILOT_VERSION_ARGS = ['--version'];
const BACKEND_CHECK_TIMEOUT_MS = 5000;

async function checkForUpdates(currentVersion) {
  // E2E tests run offline/sandboxed and must never depend on the real
  // GitHub API — a real "update available" response would force the
  // "What's New" modal open regardless of the changelog_seen_version
  // localStorage flag, blocking every spec that touches the sidebar.
  if (process.env.DISABLE_UPDATE_CHECK) return { hasUpdate: false };
  try {
    const res = await fetch(RELEASES_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { hasUpdate: false };

    const release = await res.json();
    if (typeof release.tag_name !== 'string') return { hasUpdate: false };

    const latestVersion = release.tag_name.replace(/^v/, '');
    const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;
    const exeAsset = (release.assets || []).find(a => a.name.endsWith('.exe'));

    return {
      hasUpdate,
      currentVersion,
      latestVersion,
      downloadUrl: exeAsset ? exeAsset.browser_download_url : release.html_url,
      releaseNotesUrl: release.html_url,
    };
  } catch {
    return { hasUpdate: false, error: true };
  }
}

// ─── buildLaunchTerminalPlan ────────────────────────────────────────
// Pure planning function for launch_in_terminal — validates projectPath
// and returns everything the handler needs to spawn a terminal, with
// zero user-controlled text embedded in any cmd.exe-parsed string.
// projectPath reaches the terminal only via the `cwd` field (a structured
// spawn() option, never shell-parsed); prompt reaches `claude` only via
// tempFileContent, written to a code-generated temp file and redirected
// into `claude -p`'s stdin.
function buildLaunchTerminalPlan(projectPath, prompt) {
  if (typeof projectPath !== 'string' || !projectPath.trim()) {
    throw new Error('projectPath is required');
  }

  const resolvedPath = path.resolve(projectPath);
  const exists = fs.existsSync(resolvedPath);
  if (!exists || !fs.statSync(resolvedPath).isDirectory()) {
    throw new Error(`Directory not found: ${projectPath}`);
  }

  const tempFilePath = path.join(os.tmpdir(), `agent-teams-launch-${crypto.randomUUID()}.txt`);
  const innerCmd = `set CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 && claude -p < "${tempFilePath}"`;

  return {
    cwd: resolvedPath,
    tempFilePath,
    tempFileContent: prompt,
    wtArgs: ['/C', 'wt', '-d', '.', 'cmd', '/K', innerCmd],
    fallbackArgs: ['/C', 'start', 'cmd', '/K', innerCmd],
  };
}

module.exports = function registerSystem(getMainWindow) {
  const userprofile = os.homedir();

  // ─── check_claude_available ─────────────────────────────────────
  ipcMain.handle('check_claude_available', async () => {
    try {
      const output = execSync('claude --version', {
        encoding: 'utf-8',
        env: { ...process.env, CLAUDECODE: undefined, CLAUDE_CODE_SESSION: undefined },
        timeout: 10000,
      });
      return output.trim();
    } catch (e) {
      throw new Error(e.stderr || 'Claude CLI not found. Please install Claude Code first.');
    }
  });

  // ─── check_backends_available ────────────────────────────────────
  // Detect which agent CLIs are installed on this machine, in parallel.
  // Must NEVER throw — an absent binary simply resolves to `false`.
  ipcMain.handle('check_backends_available', async () => {
    const checkOne = (cmd, args) => new Promise((resolve) => {
      try {
        const child = spawn(cmd, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: process.platform === 'win32',
          env: { ...process.env, CLAUDECODE: undefined, CLAUDE_CODE_SESSION: undefined },
        });

        let stdout = '';
        let settled = false;
        const finish = (result) => {
          if (settled) return;
          settled = true;
          try { child.kill(); } catch {}
          resolve(result);
        };

        const timer = setTimeout(() => finish({ ok: false }), BACKEND_CHECK_TIMEOUT_MS);

        child.stdout?.on('data', (d) => { stdout += d.toString(); });
        child.on('error', () => { clearTimeout(timer); finish({ ok: false }); });
        child.on('close', (code) => {
          clearTimeout(timer);
          finish({ ok: code === 0, version: stdout.trim() });
        });
      } catch {
        resolve({ ok: false });
      }
    });

    try {
      const [claudeResult, copilotResult] = await Promise.all([
        checkOne(CLAUDE_VERSION_CMD, CLAUDE_VERSION_ARGS),
        checkOne(COPILOT_VERSION_CMD, COPILOT_VERSION_ARGS),
      ]);

      const result = {
        claude: !!claudeResult.ok,
        copilot: !!copilotResult.ok,
      };
      if (copilotResult.ok && copilotResult.version) {
        result.copilotVersion = copilotResult.version;
      }
      return result;
    } catch {
      // Absolute safety net — handler must never throw.
      return { claude: false, copilot: false };
    }
  });

  // ─── get_system_info ────────────────────────────────────────────
  ipcMain.handle('get_system_info', async () => {
    let claudeOk = false;
    try {
      execSync('claude --version', {
        encoding: 'utf-8',
        env: { ...process.env, CLAUDECODE: undefined, CLAUDE_CODE_SESSION: undefined },
        timeout: 10000,
      });
      claudeOk = true;
    } catch {}

    const settingsPath = path.join(userprofile, '.claude', 'settings.json');
    const settingsExist = fs.existsSync(settingsPath);
    let agentTeamsEnabled = false;
    if (settingsExist) {
      try {
        const content = fs.readFileSync(settingsPath, 'utf-8');
        agentTeamsEnabled = content.includes('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS');
      } catch {}
    }

    return {
      claude_available: claudeOk,
      settings_path: settingsPath,
      settings_exist: settingsExist,
      agent_teams_enabled: agentTeamsEnabled,
      platform: process.platform === 'win32' ? 'windows' : process.platform,
      username: os.userInfo().username || '',
      app_version: app.getVersion(),
    };
  });

  // ─── enable_agent_teams ─────────────────────────────────────────
  ipcMain.handle('enable_agent_teams', async () => {
    const claudeDir = path.join(userprofile, '.claude');
    const settingsPath = path.join(claudeDir, 'settings.json');

    fs.mkdirSync(claudeDir, { recursive: true });

    let json = {};
    if (fs.existsSync(settingsPath)) {
      try {
        json = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      } catch { json = {}; }
    }

    if (!json.env) json.env = {};
    json.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1';

    fs.writeFileSync(settingsPath, JSON.stringify(json, null, 2), 'utf-8');
    return settingsPath;
  });

  // ─── read_settings ──────────────────────────────────────────────
  ipcMain.handle('read_settings', async () => {
    const settingsPath = path.join(userprofile, '.claude', 'settings.json');
    return fs.readFileSync(settingsPath, 'utf-8');
  });

  // ─── open_folder_in_explorer ────────────────────────────────────
  ipcMain.handle('open_folder_in_explorer', async (_event, args) => {
    const p = args.path || args;
    spawn('explorer', [p], { detached: true, stdio: 'ignore' });
  });

  // ─── launch_in_terminal ─────────────────────────────────────────
  ipcMain.handle('launch_in_terminal', async (_event, args) => {
    const { projectPath, prompt } = args;
    const safePrompt = prompt
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, ' ')
      .replace(/\r/g, '');

    const claudeCmd = `cd /d "${projectPath}" && set CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 && claude "${safePrompt}"`;

    // Try Windows Terminal first, fallback to cmd
    try {
      spawn('cmd', ['/C', 'wt', 'cmd', '/K', claudeCmd], { detached: true, stdio: 'ignore' });
    } catch {
      spawn('cmd', ['/C', 'start', 'cmd', '/K', claudeCmd], { detached: true, stdio: 'ignore' });
    }
  });

  // ─── open_url (for plugin-opener shim) ──────────────────────────
  ipcMain.handle('open_url', async (_event, args) => {
    const url = args.url || args;
    shell.openExternal(url);
  });

  // ─── check_for_updates ──────────────────────────────────────────
  ipcMain.handle('check_for_updates', async () => {
    return checkForUpdates(app.getVersion());
  });

  // ─── save_office_layout (TileEditor) ────────────────────────────
  // Note: load_office_layout is handled by pixelAgents.cjs (pixel-agents native format)
  ipcMain.handle('save_office_layout', async (_event, { json }) => {
    const LAYOUT_FILE = path.join(app.getPath('userData'), 'office-layout.json');
    try {
      if (typeof json !== 'string' || json.length > 1_000_000) {
        throw new Error('Invalid layout payload');
      }
      const parsed = JSON.parse(json);
      fs.writeFileSync(LAYOUT_FILE, JSON.stringify(parsed), 'utf-8');
    } catch (err) {
      throw new Error(`Failed to save office layout: ${err.message}`);
    }
  });

  console.log('[IPC] system OK');
};

module.exports.checkForUpdates = checkForUpdates;
module.exports.buildLaunchTerminalPlan = buildLaunchTerminalPlan;
