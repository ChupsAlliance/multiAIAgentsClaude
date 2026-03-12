'use strict';
// Port of system commands from lib.rs → Node.js
const { ipcMain, shell } = require('electron');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

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

  console.log('[IPC] system OK');
};
