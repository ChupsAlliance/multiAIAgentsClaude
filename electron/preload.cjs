'use strict';
const path = require('path');
const { contextBridge, ipcRenderer } = require('electron');

// Commands the frontend can invoke (whitelist)
const ALLOWED_COMMANDS = [
  // system
  'check_claude_available', 'get_system_info', 'enable_agent_teams',
  'read_settings', 'open_folder_in_explorer', 'launch_in_terminal', 'open_url',
  // files
  'pick_folder', 'pick_files', 'read_file_content', 'get_file_info',
  'save_clipboard_image', 'search_project_files', 'scaffold_project',
  'read_skill_folder',
  // history
  'save_to_history', 'load_history', 'get_mission_history',
  'delete_history_entry', 'get_mission_detail',
  // mission
  'launch_mission', 'deploy_mission', 'continue_mission', 'replan_mission',
  'stop_mission', 'reset_mission', 'get_mission_state', 'get_incomplete_missions',
  'update_agent_model',
  'read_planning_template', 'answer_question', 'read_superpowers_skill', 'mockup_respond', 'retry_agent',
  // office
  'load_office_layout', 'save_office_layout',
  // pixel-agents persistence
  'pa:save-layout', 'pa:save-seats',
];

// Events the backend can push to frontend (whitelist)
const ALLOWED_EVENTS = [
  'mission:status', 'mission:agent-spawned', 'mission:log',
  'mission:file-change', 'mission:task-update', 'mission:raw-line',
  'mission:plan-ready', 'mission:agent-message', 'mission:team-event',
  'mission:task-reassigned', 'mission:question', 'mission:answer-sent',
  'mission:mockup',
  'claude-output',
];

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Invoke an IPC command (frontend → main process)
   * Mirrors Tauri's invoke(command, args) API
   */
  invoke(command, args = {}) {
    if (!ALLOWED_COMMANDS.includes(command)) {
      return Promise.reject(new Error(`IPC command not allowed: ${command}`));
    }
    return ipcRenderer.invoke(command, args);
  },

  /**
   * Listen for events from main process (main → frontend)
   * Mirrors Tauri's listen(event, callback) API
   * Returns an unlisten function
   */
  on(event, callback) {
    if (!ALLOWED_EVENTS.includes(event)) {
      console.warn(`[preload] Event not in allowlist: ${event}`);
      return () => {};
    }
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(event, handler);
    // Return unlisten function (like Tauri)
    return () => ipcRenderer.removeListener(event, handler);
  },

  /**
   * Get paths for webview preload and pixel-agents assets
   */
  getPaths() {
    return {
      webviewPreload: path.join(__dirname, 'webview-preload.cjs'),
      pixelAgentsDist: path.join(__dirname, '../src/assets/pixel-agents-webview'),
    };
  },
});
